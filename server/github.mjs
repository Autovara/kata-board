import { execFileSync } from "node:child_process";

import {
  createAuthorRow,
  finalizeLeaderboardRows,
  maxDate
} from "./leaderboardRows.mjs";

const SUBMISSION_PATH_PATTERN =
  /^submissions\/([^/]+)\/([^/]+)\/([^/]+)\//;

// Per-PR file listings keyed by updated_at. Without this, every leaderboard
// refresh costs one files-request per PR (an N+1 that burns the GitHub rate
// limit); with it, only PRs updated since the last refresh are re-fetched.
const pullFilesCache = new Map();
const PULL_FILES_CACHE_MAX_ENTRIES = 2000;
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

export async function loadGithubLeaderboard({
  repoSlug,
  githubToken
}) {
  if (!repoSlug) {
    return emptyLeaderboard("github-not-configured");
  }

  const pulls = await fetchPulls(repoSlug, githubToken);
  const relevantPulls = [];

  for (const pull of pulls) {
    const touchedSubmissions = await fetchSubmissionFilesCached(
      repoSlug,
      pull,
      githubToken
    );
    if (!touchedSubmissions.length) {
      continue;
    }

    const laneKeys = [
      ...new Set(
        touchedSubmissions.map((path) => {
          const match = path.match(SUBMISSION_PATH_PATTERN);
          if (!match) {
            return null;
          }
          return `${match[1]}::${match[2]}`;
        })
      )
    ].filter(Boolean);

    relevantPulls.push({
      number: pull.number,
      title: pull.title,
      state: pull.state,
      mergedAt: pull.merged_at,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      htmlUrl: pull.html_url,
      author: pull.user?.login || "unknown",
      labels: normalizeLabelNames(pull.labels),
      winnerEligible: isKataWinnerPull(pull),
      laneKeys,
      submissionPaths: touchedSubmissions
    });
  }

  return buildLeaderboardFromRelevantPulls("github", relevantPulls);
}

export function loadGithubCliLeaderboard({ repoSlug, run = execFileSync }) {
  if (!repoSlug) {
    return emptyLeaderboard("github-cli-not-configured");
  }
  const output = run(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,state,mergedAt,updatedAt,url,author,labels,files"
    ],
    {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const pulls = JSON.parse(output);
  const relevantPulls = (Array.isArray(pulls) ? pulls : [])
    .map((pull) => {
      const touchedSubmissions = (Array.isArray(pull.files) ? pull.files : [])
        .map((file) => file?.path)
        .filter((filePath) => String(filePath || "").startsWith("submissions/"));
      if (!touchedSubmissions.length) {
        return null;
      }
      const laneKeys = [
        ...new Set(
          touchedSubmissions.map((path) => {
            const match = String(path || "").match(SUBMISSION_PATH_PATTERN);
            return match ? `${match[1]}::${match[2]}` : null;
          })
        )
      ].filter(Boolean);
      return {
        number: pull.number,
        title: pull.title,
        state: normalizePullState(pull.state),
        mergedAt: pull.mergedAt || null,
        createdAt: pull.createdAt || null,
        updatedAt: pull.updatedAt || pull.mergedAt || null,
        htmlUrl: pull.url || null,
        author: pull.author?.login || "unknown",
        labels: normalizeLabelNames(pull.labels),
        winnerEligible: isKataWinnerPull(pull),
        laneKeys,
        submissionPaths: touchedSubmissions
      };
    })
    .filter(Boolean);
  return buildLeaderboardFromRelevantPulls("github-cli", relevantPulls);
}

function buildLeaderboardFromRelevantPulls(source, relevantPulls) {
  const byAuthor = new Map();
  const latestLaneWinners = new Map();

  for (const pull of relevantPulls) {
    const entry = byAuthor.get(pull.author) || createAuthorRow(pull.author);
    entry.totalSubmissions += 1;
    incrementStatusCounts(entry, pull.labels);
    if (pull.state === "open") {
      entry.openSubmissions += 1;
    } else if (pull.mergedAt && pull.winnerEligible) {
      entry.wins += 1;
      entry.winnerPulls.push({
        pullNumber: pull.number,
        mergedAt: pull.mergedAt,
        labels: pull.labels
      });
    } else {
      entry.closedSubmissions += 1;
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, pull.updatedAt);
    // Pulls arrive newest-first (sort=updated&direction=desc), so keep the
    // first 4 seen — the most recently updated — rather than evicting them.
    if (entry.recentPulls.length < 4) {
      entry.recentPulls.push({
        number: pull.number,
        title: pull.title,
        htmlUrl: pull.htmlUrl,
        state: pull.mergedAt ? "merged" : pull.state,
        statusLabel: primaryKataStatusLabel(pull.labels),
        updatedAt: pull.updatedAt
      });
    }
    byAuthor.set(pull.author, entry);

    if (pull.mergedAt && pull.winnerEligible) {
      for (const laneKey of pull.laneKeys) {
        const current = latestLaneWinners.get(laneKey);
        if (!current || new Date(pull.mergedAt) > new Date(current.mergedAt)) {
          latestLaneWinners.set(laneKey, {
            author: pull.author,
            mergedAt: pull.mergedAt,
            pullNumber: pull.number
          });
        }
      }
    }
  }

  return {
    source,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function normalizePullState(state) {
  const value = String(state || "").toLowerCase();
  if (value === "open") {
    return "open";
  }
  return "closed";
}

function isKataWinnerPull(pull) {
  const labels = normalizeLabelNames(pull?.labels);
  return labels.some((label) => label.startsWith("kata:winner:"));
}

function normalizeLabelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => String(label?.name || label || "").trim())
    .filter(Boolean);
}

function incrementStatusCounts(entry, labels) {
  const status = new Set(normalizeLabelNames(labels));
  if (status.has("kata:pending")) {
    entry.pendingSubmissions += 1;
  }
  if (status.has("kata:review")) {
    entry.reviewSubmissions += 1;
  }
  if (status.has("kata:invalid")) {
    entry.invalidSubmissions += 1;
  }
  if (status.has("kata:executing")) {
    entry.executingSubmissions += 1;
  }
  if (status.has("kata:stale")) {
    entry.staleSubmissions += 1;
  }
  if (status.has("kata:hold")) {
    entry.holdSubmissions += 1;
  }
  if (status.has("kata:losing")) {
    entry.losingSubmissions += 1;
  }
  if ([...status].some((label) => label.startsWith("kata:winner:"))) {
    entry.winnerSubmissions += 1;
  }
}

function primaryKataStatusLabel(labels) {
  const status = new Set(normalizeLabelNames(labels));
  for (const label of [
    "kata:executing",
    "kata:review",
    "kata:pending",
    "kata:hold",
    "kata:invalid",
    "kata:stale",
    "kata:losing"
  ]) {
    if (status.has(label)) {
      return label;
    }
  }
  return normalizeLabelNames(labels).find((label) => label.startsWith("kata:winner:")) || null;
}

function emptyLeaderboard(source) {
  return {
    source,
    rows: [],
    latestLaneWinners: {}
  };
}

async function fetchPulls(repoSlug, githubToken) {
  const pulls = [];
  for (let page = 1; page <= 4; page += 1) {
    const response = await githubRequest(
      `/repos/${repoSlug}/pulls?state=all&per_page=50&page=${page}&sort=updated&direction=desc`,
      githubToken
    );
    if (!response.length) {
      break;
    }
    pulls.push(...response);
    if (response.length < 50) {
      break;
    }
  }
  return pulls;
}

async function fetchSubmissionFilesCached(repoSlug, pull, githubToken) {
  const cacheKey = `${repoSlug}#${pull.number}`;
  const cached = pullFilesCache.get(cacheKey);
  if (cached && cached.updatedAt === pull.updated_at) {
    return cached.files;
  }
  const files = await fetchSubmissionFiles(repoSlug, pull.number, githubToken);
  pullFilesCache.set(cacheKey, { updatedAt: pull.updated_at, files });
  if (pullFilesCache.size > PULL_FILES_CACHE_MAX_ENTRIES) {
    const oldestKey = pullFilesCache.keys().next().value;
    pullFilesCache.delete(oldestKey);
  }
  return files;
}

async function fetchSubmissionFiles(repoSlug, pullNumber, githubToken) {
  const files = [];
  for (let page = 1; page <= 4; page += 1) {
    const response = await githubRequest(
      `/repos/${repoSlug}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      githubToken
    );
    if (!response.length) {
      break;
    }
    for (const file of response) {
      if (typeof file.filename === "string" && file.filename.startsWith("submissions/")) {
        files.push(file.filename);
      }
    }
    if (response.length < 100) {
      break;
    }
  }
  return files;
}

export async function githubRequest(path, githubToken) {
  let response;
  try {
    response = await fetchGithubResponse(path, githubToken);
    if (
      githubToken &&
      (response.status === 401 || response.status === 403)
    ) {
      const publicResponse = await fetchGithubResponse(path, "");
      if (publicResponse.ok) {
        return publicResponse.json();
      }
    }
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed: ${response.status} ${response.statusText}`
      );
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `GitHub API request timed out after ${GITHUB_REQUEST_TIMEOUT_MS}ms`
      );
    }
    throw error;
  }
}

async function fetchGithubResponse(path, githubToken) {
  const headers = {
    "User-Agent": "kata-board",
    Accept: "application/vnd.github+json"
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`https://api.github.com${path}`, {
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
