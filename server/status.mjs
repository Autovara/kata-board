import { execFileSync } from "node:child_process";
import { dateIsAfter, f1Score, normalizeLabelNames, numberOrNull, positiveIntegerOrNull, summarizeTaskStatusCounts, uniqueStrings } from "./status_utils.mjs";
import { loadEvaluatorActivityMetrics, loadEvaluatorLanes, loadRecentActivity } from "./evaluator.mjs";
import {
  enrichPublicProofWithLiveWinner,
  findWinnerEntrant,
  loadPublicProof,
  prNumberFromSubmissionId,
} from "./publicProof.mjs";

export { loadPublicProof };
import {
  applyChallengeStalenessGuard,
  assignChallengeSequence,
  challengeReplicaPayload,
  loadChallengeProgress,
  loadChallengeStatus,
  refreshByLaneChallengeProgress,
  summarizeEvaluatorProjectProgress,
} from "./challengeProgress.mjs";
export { refreshByLaneChallengeProgress };
import fs from "node:fs";
import path from "node:path";

import {
  githubRequest,
  loadGithubCliLeaderboard,
  loadGithubLeaderboard,
  parseGithubTokenList,
} from "./github.mjs";
import {
  createAuthorRow,
  finalizeLeaderboardRows,
  hasKataRewardLabel,
  maxDate,
} from "./leaderboardRows.mjs";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";
import {
  collectFiles,
  listDirectories,
  newestMtimeIso,
  readJsonSafe,
  readTextSafe,
  statMtimeIso,
} from "./status/fsUtil.mjs";
import {
  applyChallengeIdentityAliases,
  buildIdentityAliases,
  resolveAuthorAlias,
} from "./status/identity.mjs";

const DEFAULT_CACHE_TTL_MS = 3_000;
// The GitHub leaderboard fans out one files-request per PR, so it gets its
// own, much longer TTL than the cheap filesystem status.
const DEFAULT_LEADERBOARD_CACHE_TTL_MS = 60_000;
const DEFAULT_LEADERBOARD_BUILD_TIMEOUT_MS = 2_500;
let cachedStatus = null;
let cachedAt = 0;
let cachedLeaderboard = null;
let cachedLeaderboardAt = 0;
let cachedLeaderboardKey = null;
let leaderboardRefreshPromise = null;
let leaderboardRefreshKey = null;

// This lane's published proof: `public-results/<laneId>/current.json`, falling back to the ROOT
// `public-results/current.json` (a single catch-all lane publishes at the root -> byte-identical).
function lanePublicResultsCurrentPath(kataRoot, laneId) {
  const perLane = path.resolve(kataRoot, "public-results", laneId, "current.json");
  if (fs.existsSync(perLane)) {
    return perLane;
  }
  return path.resolve(kataRoot, "public-results", "current.json");
}

// One lane's competition fields, read from its lane-scoped bot state (`state/<laneId>/…`) and its
// published proof. The challenge/history are sequenced the same way the global flow does.
function loadLaneCompetition(kataRoot, stateDir, laneId) {
  const laneStateDir = path.join(stateDir, laneId);
  let challenge = loadChallengeStatus(path.join(laneStateDir, "challenge-status.json"));
  if (challenge) {
    challenge.liveProgress = loadChallengeProgress(
      path.join(laneStateDir, "challenge-progress.json"),
      kataRoot
    );
  }
  let challengeHistory = loadChallengeHistory(path.join(laneStateDir, "challenge-history.json"));
  ({ challenge, challengeHistory } = assignChallengeSequence(challenge, challengeHistory));
  const publicProof = loadPublicProof(lanePublicResultsCurrentPath(kataRoot, laneId), kataRoot);
  return { challenge, challengeHistory, publicProof };
}

export function buildByLane(lanes, fields, context = {}) {
  if (!Array.isArray(lanes) || !lanes.length) {
    return {};
  }
  if (lanes.length === 1) {
    return { [lanes[0].id]: { ...fields } };
  }
  const { kataRoot, stateDir } = context;
  const out = {};
  for (const lane of lanes) {
    const laneId = lane.laneId || lane.subnetPack;
    const competition = loadLaneCompetition(kataRoot, stateDir, laneId);
    out[lane.id] = {
      challenge: competition.challenge,
      challengeHistory: competition.challengeHistory,
      publicProof: competition.publicProof,
      leaderboard: fields.leaderboard,
      activity: fields.activity,
    };
  }
  return out;
}

export async function loadBoardStatus(env) {
  const cacheTtlMs = readCacheTtlMs(env);
  const roots = resolveRoots(env);
  const runtimeEnv = resolveRuntimeEnv(env, roots);
  if (cachedStatus && Date.now() - cachedAt < cacheTtlMs) {
    // Live challenge progress is a cheap local-file read that moves fast during a
    // challenge, while the rest of the payload (GitHub PRs, leaderboard) is slow and
    // rate-limited. Refresh just the progress on a cache hit so the dashboard
    // animates smoothly every stream frame without re-hitting GitHub.
    if (cachedStatus.challenge) {
      cachedStatus.challenge.liveProgress = loadChallengeProgress(roots.challengeProgressPath, roots.kataRoot);
      cachedStatus.challenge = applyChallengeStalenessGuard(cachedStatus.challenge, env);
    }
    refreshByLaneChallengeProgress(cachedStatus, roots);
    return cachedStatus;
  }
  const validator = await loadValidatorStatus(runtimeEnv, roots);
  let challenge = loadChallengeStatus(roots.challengeStatusPath);
  if (challenge) {
    challenge.liveProgress = loadChallengeProgress(roots.challengeProgressPath, roots.kataRoot);
    challenge = applyChallengeStalenessGuard(challenge, env);
  }
  let challengeHistory = loadChallengeHistory(roots.challengeHistoryPath);
  ({ challenge, challengeHistory } = assignChallengeSequence(challenge, challengeHistory));
  let publicProof = loadPublicProof(roots.publicResultsCurrentPath, roots.kataRoot);
  const activity = loadRecentActivity(roots.kataRoot, runtimeEnv);
  const identityAliases = buildIdentityAliases({ validator, challenge });
  challenge = applyChallengeIdentityAliases(challenge, identityAliases);
  let lanes = loadEvaluatorLanes({
    kataRoot: roots.kataRoot,
    latestLaneWinners: {},
    identityAliases,
  });
  const challengeLane = resolveChallengeLane(challenge, lanes, publicProof);
  const baseLeaderboard = augmentLeaderboardWithChallenge(
    await loadLeaderboard(runtimeEnv),
    challenge,
    identityAliases,
    challengeLane
  );
  // The authoritative king per lane, read from the lane state the promotion itself wrote
  // (lanes are loaded above with no winner overrides, so their king is that file verbatim).
  // Nothing derived from a challenge may crown a submission this map does not name.
  const authoritativeKingByLaneKey = new Map(
    (lanes || [])
      .map((lane) => [laneKeyForLane(lane), String(lane?.king?.submissionId || "").trim()])
      .filter(([laneKey, submissionId]) => laneKey && submissionId)
  );
  let leaderboard = augmentLeaderboardWithActivity(
    baseLeaderboard,
    activity,
    identityAliases,
    authoritativeKingByLaneKey
  );
  challenge = enrichChallengeKingIdentity(challenge, leaderboard);
  leaderboard = enrichLeaderboardLatestWinnerWithChallenge(leaderboard, challenge, challengeLane);
  leaderboard = await overlayLiveKataPulls(leaderboard, runtimeEnv);
  const submissionStatus = buildSubmissionStatus(leaderboard, validator);
  publicProof = enrichPublicProofWithLiveWinner(publicProof, {
    challenge,
    challengeHistory,
    leaderboard,
    activeLane: challengeLane,
  });
  lanes = loadEvaluatorLanes({
    kataRoot: roots.kataRoot,
    latestLaneWinners: leaderboard.latestLaneWinners,
    identityAliases,
  });
  lanes = enrichLaneKingsWithProof(lanes, publicProof);
  const notes = buildNotes({
    leaderboard,
    validator,
    lanes,
  });
  const byLane = buildByLane(
    lanes,
    {
      challenge,
      challengeHistory,
      publicProof,
      leaderboard,
      activity,
    },
    { kataRoot: roots.kataRoot, stateDir: path.dirname(roots.challengeStatusPath) }
  );

  cachedStatus = {
    generatedAt: new Date().toISOString(),
    publicLinks: {
      kataRepo: runtimeEnv.KATA_REPO_SLUG || null,
    },
    dataSources: {
      filesystem: true,
      githubLeaderboard: leaderboardSourceIncludes(leaderboard, "github"),
      eventFeed: leaderboardSourceIncludes(leaderboard, "events"),
      validatorQueue: Boolean(validator.queue.available),
      validatorHealth: Boolean(validator.health.configured),
      publicProof: Boolean(publicProof),
    },
    overview: buildOverview(lanes, activity, leaderboard, validator, submissionStatus, {
      challenge,
      publicProof,
    }),
    validator,
    publicProof,
    submissionStatus,
    challenge,
    challengeHistory,
    lanes,
    activity,
    leaderboard,
    byLane,
    notes,
    dataNotice: buildDataNotice(leaderboard),
  };
  cachedAt = Date.now();
  return cachedStatus;
}

// A user-facing banner when the board can't reach GitHub and is showing
// provisional data reconstructed from local history. Names and rankings can be
// incomplete in this mode; it clears automatically once GitHub recovers.
function buildDataNotice(leaderboard) {
  const githubError = leaderboard?.githubError;
  if (!githubError || leaderboardSourceIncludes(leaderboard, "github")) {
    return null;
  }
  return {
    level: "warning",
    message:
      "GitHub is temporarily unavailable, so the leaderboard and current king are " +
      "provisional — reconstructed from local history and may be incomplete. This " +
      "corrects itself automatically once GitHub recovers.",
    detail: String(githubError),
  };
}

function leaderboardSourceIncludes(leaderboard, sourceName) {
  return String(leaderboard?.source || "")
    .split("+")
    .includes(sourceName);
}

function readCacheTtlMs(env) {
  return readTtlMs(env.KATA_STATUS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
}

function readTtlMs(rawValue, defaultMs) {
  const value = Number.parseInt(rawValue || "", 10);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  return defaultMs;
}

function resolveRoots(env) {
  const boardRoot = env.KATA_BOARD_ROOT || path.resolve(process.cwd(), "..");
  const kataBotRoot = resolveExistingRoot(env.KATA_BOT_ROOT, path.join(boardRoot, "kata-bot"));
  const kataRoot = resolveExistingRoot(env.KATA_ROOT, path.join(boardRoot, "kata"));
  return {
    boardRoot,
    kataRoot,
    kataBotRoot,
    benchmarkFile:
      env.KATA_BENCHMARK_FILE || env.KATA_SN60_BENCHMARK_FILE
        ? path.resolve(env.KATA_BENCHMARK_FILE || env.KATA_SN60_BENCHMARK_FILE)
        : null,
    workRoot: path.resolve(env.KATA_WORK_ROOT || path.join(kataBotRoot, "work")),
    queueStatePath: path.resolve(
      env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
    ),
    liveStatusPath: path.resolve(
      env.KATA_LIVE_STATUS_PATH ||
        path.join(
          path.dirname(env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")),
          "live-status.json"
        )
    ),
    challengeStatusPath: path.resolve(
      env.KATA_CHALLENGE_STATUS_PATH ||
        path.join(
          path.dirname(env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")),
          "challenge-status.json"
        )
    ),
    challengeHistoryPath: path.resolve(
      env.KATA_CHALLENGE_HISTORY_PATH ||
        path.join(
          path.dirname(env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")),
          "challenge-history.json"
        )
    ),
    challengeProgressPath: path.resolve(
      env.KATA_CHALLENGE_PROGRESS_PATH ||
        path.join(
          path.dirname(env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")),
          "challenge-progress.json"
        )
    ),
    reviewApprovalsPath: path.resolve(
      env.KATA_REVIEW_APPROVALS_PATH ||
        path.join(
          path.dirname(env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")),
          "review-approvals.json"
        )
    ),
    publicResultsCurrentPath: path.resolve(
      env.KATA_PUBLIC_RESULTS_CURRENT_PATH || path.join(kataRoot, "public-results", "current.json")
    ),
  };
}

function resolveRuntimeEnv(env, roots) {
  return {
    ...env,
    KATA_ROOT: roots.kataRoot,
    KATA_BOT_ROOT: roots.kataBotRoot,
    KATA_REPO_SLUG:
      String(env.KATA_REPO_SLUG || "").trim() || inferGitHubRepoSlug(roots.kataRoot) || "",
  };
}

function inferGitHubRepoSlug(repoRoot) {
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, ".git"))) {
    return null;
  }
  try {
    const output = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match =
      output.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i) ||
      output.match(/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[?#].*)?$/i);
    if (!match) {
      return null;
    }
    return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
  } catch {
    return null;
  }
}

function loadChallengeHistory(challengeHistoryPath) {
  // Public feed of completed challenges + achievements (most recent first).
  const data = readJsonSafe(challengeHistoryPath);
  const challenges = data && Array.isArray(data.challenges) ? data.challenges : [];
  return challenges
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      runId: entry.run_id || null,
      generatedAt: entry.generated_at || null,
      candidateCount: entry.candidate_count ?? 0,
      winnerSubmissionId: entry.winner_submission_id || null,
      kingDetection: entry.king_detection ?? null,
      bestDetection: entry.best_detection ?? null,
      bestTruePositives: entry.best_true_positives ?? 0,
      achievements: Array.isArray(entry.achievements) ? entry.achievements : [],
      headline: entry.headline || null,
    }))
    .reverse();
}

function enrichLeaderboardLatestWinnerWithChallenge(leaderboard, challenge, challengeLane) {
  if (challenge?.state !== "completed" || !challenge.winnerSubmissionId) {
    return leaderboard;
  }
  const winnerPullNumber = prNumberFromSubmissionId(challenge.winnerSubmissionId);
  const winnerEntrant = findWinnerEntrant(challenge, winnerPullNumber);
  if (!winnerEntrant?.author) {
    return leaderboard;
  }
  const laneKey = laneKeyForLane(challengeLane);
  if (!laneKey) {
    return leaderboard;
  }
  // Winning a challenge is NOT the same as being king: the promotion can still be
  // rejected afterwards (a stale-king guard, a held merge), leaving the PR unmerged.
  // Only accept this winner as the lane's king when the authoritative lane state --
  // written by the promotion itself -- already says it IS the king. Otherwise the
  // board would crown an unmerged challenger and report its PR number as the king's.
  const authoritativeKingSubmissionId = String(challengeLane?.king?.submissionId || "").trim();
  const challengeWinnerSubmissionId = String(
    winnerEntrant.submission_id || winnerEntrant.submissionId || ""
  ).trim();
  if (
    !authoritativeKingSubmissionId ||
    authoritativeKingSubmissionId !== challengeWinnerSubmissionId
  ) {
    return leaderboard;
  }
  const current = leaderboard?.latestLaneWinners?.[laneKey] || {};
  const winnerPull =
    Number(winnerEntrant.pull_number ?? winnerEntrant.pullNumber) ||
    current.pullNumber ||
    winnerPullNumber ||
    null;
  const latestLaneWinners = {
    ...(leaderboard?.latestLaneWinners || {}),
    [laneKey]: {
      ...current,
      author: winnerEntrant.author,
      mergedAt: current.mergedAt || challenge.finishedAt || challenge.generatedAt || null,
      pullNumber: winnerPull,
      submissionId:
        winnerEntrant.submission_id || winnerEntrant.submissionId || current.submissionId || null,
    },
  };
  return {
    ...leaderboard,
    rows: normalizeLeaderboardWinnerAuthor(
      leaderboard.rows,
      winnerPull,
      winnerEntrant.author,
      latestLaneWinners
    ),
    latestLaneWinners,
  };
}

function normalizeLeaderboardWinnerAuthor(rows, winnerPullNumber, author, latestLaneWinners) {
  const normalizedAuthor = String(author || "").trim();
  const pullNumber = Number(winnerPullNumber || 0);
  if (!normalizedAuthor || !pullNumber || !Array.isArray(rows)) {
    return rows || [];
  }
  const byAuthor = new Map();
  for (const row of rows) {
    const ownsWinnerPull = (row?.winnerPulls || []).some(
      (pull) => Number(pull?.pullNumber || 0) === pullNumber
    );
    const rowAuthor = ownsWinnerPull ? normalizedAuthor : row.author;
    mergeLeaderboardRow(byAuthor, rowAuthor, row);
  }
  return finalizeLeaderboardRows(byAuthor, new Map(Object.entries(latestLaneWinners || {})));
}

function mergeLeaderboardRow(byAuthor, author, row) {
  const key = String(author || row?.author || "unknown");
  const target = byAuthor.get(key) || createAuthorRow(key);
  for (const field of [
    "totalSubmissions",
    "openSubmissions",
    "closedSubmissions",
    "pendingSubmissions",
    "reviewSubmissions",
    "invalidSubmissions",
    "executingSubmissions",
    "staleSubmissions",
    "holdSubmissions",
    "losingSubmissions",
    "winnerSubmissions",
  ]) {
    target[field] = Number(target[field] || 0) + Number(row?.[field] || 0);
  }
  target.lastActivityAt = maxDate(target.lastActivityAt, row?.lastActivityAt);
  target.winnerPulls = dedupeWinnerPulls([
    ...(target.winnerPulls || []),
    ...(row?.winnerPulls || []),
  ]);
  target.wins =
    target.winnerPulls.length || Math.max(Number(target.wins || 0), Number(row?.wins || 0));
  target.recentPulls = dedupeRecentPulls([
    ...(target.recentPulls || []),
    ...(row?.recentPulls || []),
  ]).slice(0, 4);
  byAuthor.set(key, target);
}

function dedupeWinnerPulls(pulls) {
  const byKey = new Map();
  const result = [];
  for (const pull of pulls || []) {
    const key = pull?.pullNumber ? `pr:${Number(pull.pullNumber)}` : `run:${pull?.mergedAt || ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.labels = uniqueStrings([...(existing.labels || []), ...(pull?.labels || [])]);
      existing.mergedAt = dateIsAfter(pull?.mergedAt, existing.mergedAt)
        ? pull.mergedAt
        : existing.mergedAt;
      continue;
    }
    const copy = {
      ...pull,
      labels: uniqueStrings(pull?.labels || []),
    };
    byKey.set(key, copy);
    result.push(copy);
  }
  return result.sort(
    (left, right) => new Date(right?.mergedAt || 0) - new Date(left?.mergedAt || 0)
  );
}

function dedupeRecentPulls(pulls) {
  const seen = new Set();
  const result = [];
  for (const pull of pulls || []) {
    const key = `${pull?.number || "run"}:${pull?.title || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(pull);
  }
  return result.sort(
    (left, right) => new Date(right?.updatedAt || 0) - new Date(left?.updatedAt || 0)
  );
}

async function overlayLiveKataPulls(leaderboard, env) {
  let livePulls = [];
  try {
    livePulls = await withTimeout(
      loadLiveKataPulls(env),
      readTtlMs(env.KATA_LEADERBOARD_BUILD_TIMEOUT_MS, DEFAULT_LEADERBOARD_BUILD_TIMEOUT_MS),
      "live Kata PR overlay"
    );
  } catch {
    livePulls = [];
  }
  if (!livePulls.length) {
    return leaderboard;
  }
  const latestLaneWinners = new Map(Object.entries(leaderboard.latestLaneWinners || {}));
  const byAuthor = new Map();
  for (const row of leaderboard.rows || []) {
    mergeLeaderboardRow(byAuthor, row.author, row);
  }
  const pullsByAuthor = new Map();
  for (const pull of livePulls) {
    const author = pull.author || "unknown";
    const key = findAuthorKey(byAuthor, author) || author;
    pullsByAuthor.set(key, [...(pullsByAuthor.get(key) || []), pull]);
  }
  for (const [author, pulls] of pullsByAuthor.entries()) {
    const existingKey = findAuthorKey(byAuthor, author);
    const entry = byAuthor.get(existingKey) || createAuthorRow(author);
    entry.author = existingKey || author;
    resetLiveKataStatusCounts(entry);
    entry.totalSubmissions = pulls.length;
    entry.recentPulls = pulls
      .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0))
      .slice(0, 4)
      .map((pull) => ({
        number: pull.number,
        title: pull.title,
        htmlUrl: pull.htmlUrl,
        state: pull.mergedAt ? "merged" : pull.state,
        statusLabel: primaryKataStatusLabel(pull.labels),
        updatedAt: pull.updatedAt,
      }));
    for (const pull of pulls) {
      applyLivePullCounts(entry, pull);
      maybeAttachWinnerPull(entry, pull, latestLaneWinners);
      entry.lastActivityAt = maxDate(entry.lastActivityAt, pull.updatedAt);
    }
    entry.winnerPulls = dedupeWinnerPulls(entry.winnerPulls || []);
    entry.wins = entry.winnerPulls.length;
    byAuthor.set(entry.author, entry);
  }
  return {
    ...leaderboard,
    source: `${leaderboard.source}+live-kata-prs`,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners),
  };
}

function resetLiveKataStatusCounts(row) {
  row.totalSubmissions = 0;
  row.openSubmissions = 0;
  row.closedSubmissions = 0;
  row.pendingSubmissions = 0;
  row.reviewSubmissions = 0;
  row.invalidSubmissions = 0;
  row.executingSubmissions = 0;
  row.staleSubmissions = 0;
  row.holdSubmissions = 0;
  row.losingSubmissions = 0;
  row.winnerSubmissions = 0;
  row.recentPulls = [];
}

async function loadLiveKataPulls(env) {
  const repoSlug = String(env.KATA_REPO_SLUG || "").trim();
  if (!repoSlug) {
    return [];
  }
  // Use the authenticated (async, non-blocking) GitHub API. The `gh` CLI path is
  // SYNCHRONOUS (execFileSync) -- it blocks Node's single event loop for up to its
  // timeout on every status build, and `gh` is not authenticated for the board's
  // service user, so it only ever hangs and piles up, freezing the whole board.
  // Gate it behind the explicit opt-in flag; otherwise degrade gracefully to an
  // empty live overlay when the API read fails.
  const allowGhCli = env.KATA_BOARD_ALLOW_GH_CLI_FALLBACK === "true";
  try {
    const pulls = await githubRequest(
      `/repos/${repoSlug}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
      githubReadTokens(env).length ? githubReadTokens(env) : env.KATA_GITHUB_TOKEN
    );
    return normalizeLiveKataPulls(pulls);
  } catch {
    return allowGhCli ? loadLiveKataPullsFromGhCli(repoSlug) : [];
  }
}

function loadLiveKataPullsFromGhCli(repoSlug) {
  try {
    const output = execFileSync(
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
        "number,title,state,mergedAt,updatedAt,url,author,labels",
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const pulls = JSON.parse(output);
    return normalizeLiveKataPulls(pulls);
  } catch {
    return [];
  }
}

function normalizeLiveKataPulls(pulls) {
  return (Array.isArray(pulls) ? pulls : [])
    .map((pull) => ({
      number: Number(pull?.number || 0),
      title: String(pull?.title || ""),
      author: pull?.user?.login || pull?.author?.login || "unknown",
      labels: normalizeLabelNames(pull?.labels),
      state: normalizePullState(pull?.state),
      mergedAt: pull?.merged_at || pull?.mergedAt || null,
      updatedAt: pull?.updated_at || pull?.updatedAt || null,
      htmlUrl: pull?.html_url || pull?.url || null,
    }))
    .filter((pull) => pull.number && pull.labels.some((label) => label.startsWith("kata:")));
}

function normalizePullState(state) {
  const value = String(state || "").toLowerCase();
  return value === "open" ? "open" : "closed";
}

function findAuthorKey(byAuthor, author) {
  const normalized = String(author || "").toLowerCase();
  for (const key of byAuthor.keys()) {
    if (String(key || "").toLowerCase() === normalized) {
      return key;
    }
  }
  return author;
}

function applyLivePullCounts(entry, pull) {
  const status = new Set(normalizeLabelNames(pull?.labels));
  const isOpen = pull?.state === "open";
  if (pull?.state === "open") {
    entry.openSubmissions += 1;
  } else {
    entry.closedSubmissions += 1;
  }
  if (isOpen && status.has("kata:pending")) {
    entry.pendingSubmissions += 1;
  }
  if (isOpen && status.has("kata:review")) {
    entry.reviewSubmissions += 1;
  }
  if (status.has("kata:invalid")) {
    entry.invalidSubmissions += 1;
  }
  if (isOpen && status.has("kata:executing")) {
    entry.executingSubmissions += 1;
  }
  if (isOpen && status.has("kata:stale")) {
    entry.staleSubmissions += 1;
  }
  if (isOpen && status.has("kata:hold")) {
    entry.holdSubmissions += 1;
  }
  if (status.has("kata:losing")) {
    entry.losingSubmissions += 1;
  }
  if ([...status].some((label) => label.startsWith("kata:winner:"))) {
    entry.winnerSubmissions += 1;
  }
}

function maybeAttachWinnerPull(entry, pull, latestLaneWinners) {
  // Any reward-bearing king PR (reigning kata:winner, runner-up kata:king2/3/4, or
  // dethroned kata:defeat) counts toward the score at its tier -- collect them all.
  if (!pull?.mergedAt || !hasKataRewardLabel(pull?.labels)) {
    return;
  }
  entry.winnerPulls = dedupeWinnerPulls([
    ...(entry.winnerPulls || []),
    {
      pullNumber: pull.number,
      mergedAt: pull.mergedAt,
      labels: pull.labels,
    },
  ]);
  // Only the REIGNING king (kata:winner) is the current lane winner.
  const winnerLabel = normalizeLabelNames(pull?.labels).find((label) =>
    label.startsWith("kata:winner:")
  );
  if (!winnerLabel) {
    return;
  }
  const laneKey = laneKeyFromWinnerPull(pull, winnerLabel);
  if (!laneKey) {
    return;
  }
  const current = latestLaneWinners.get(laneKey);
  if (!current || new Date(pull.mergedAt) > new Date(current.mergedAt || 0)) {
    latestLaneWinners.set(laneKey, {
      author: entry.author,
      mergedAt: pull.mergedAt,
      pullNumber: pull.number,
    });
  }
}

function laneKeyFromWinnerPull(pull, winnerLabel) {
  const subnetPack = winnerLabel.slice("kata:winner:".length);
  if (!subnetPack) {
    return null;
  }
  const artifact = (pull?.files || [])
    .map((file) => inferArtifactSubmission(file?.path))
    .find(Boolean);
  const mode = artifact?.mode || "miner";
  return `${subnetPack}::${mode}`;
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
    "kata:losing",
  ]) {
    if (status.has(label)) {
      return label;
    }
  }
  return normalizeLabelNames(labels).find((label) => label.startsWith("kata:winner:")) || null;
}

function resolveExistingRoot(explicitPath, fallbackPath) {
  return path.resolve(explicitPath || fallbackPath);
}

async function loadLeaderboard(env) {
  const cacheKey = leaderboardCacheKey(env);
  const cacheTtlMs = readTtlMs(env.KATA_LEADERBOARD_CACHE_TTL_MS, DEFAULT_LEADERBOARD_CACHE_TTL_MS);
  if (
    cachedLeaderboard &&
    cachedLeaderboardKey === cacheKey &&
    Date.now() - cachedLeaderboardAt < cacheTtlMs
  ) {
    return cachedLeaderboard;
  }
  if (!leaderboardRefreshPromise || leaderboardRefreshKey !== cacheKey) {
    leaderboardRefreshKey = cacheKey;
    leaderboardRefreshPromise = computeLeaderboard(env)
      .then((leaderboard) => {
        cachedLeaderboard = leaderboard;
        cachedLeaderboardAt = Date.now();
        cachedLeaderboardKey = cacheKey;
        return leaderboard;
      })
      .finally(() => {
        leaderboardRefreshPromise = null;
        leaderboardRefreshKey = null;
      });
  }

  if (cachedLeaderboard && cachedLeaderboardKey === cacheKey) {
    return cachedLeaderboard;
  }

  try {
    return await withTimeout(
      leaderboardRefreshPromise,
      readTtlMs(env.KATA_LEADERBOARD_BUILD_TIMEOUT_MS, DEFAULT_LEADERBOARD_BUILD_TIMEOUT_MS),
      "leaderboard refresh"
    );
  } catch (error) {
    return loadLocalLeaderboardFallback(env, error);
  }
}

function leaderboardCacheKey(env) {
  return [
    env.KATA_BOARD_EVENT_LOG || "",
    env.KATA_ROOT || "",
    env.KATA_REPO_SLUG || "",
    githubReadTokens(env).length ? "read-token-pool" : env.KATA_GITHUB_TOKEN ? "token" : "public",
    env.KATA_BOARD_ALLOW_GH_CLI_FALLBACK === "true" ? "gh-cli" : "no-gh-cli",
  ].join("\n");
}

async function computeLeaderboard(env) {
  if (env.KATA_BOARD_EVENT_LOG) {
    try {
      return loadEventLeaderboard(env.KATA_BOARD_EVENT_LOG);
    } catch (error) {
      return {
        source: "unavailable",
        error: error instanceof Error ? error.message : "unknown leaderboard error",
        rows: [],
        latestLaneWinners: {},
      };
    }
  }

  try {
    const leaderboard = await loadGithubLeaderboard({
      repoSlug: env.KATA_REPO_SLUG,
      githubToken: env.KATA_GITHUB_TOKEN,
      githubTokens: githubReadTokens(env),
    });
    // Only compute the local artifact leaderboard when GitHub gave us nothing to
    // show. It runs SYNCHRONOUS git commands + a recursive runs/ walk, so doing it on
    // the normal success path -- then discarding it -- needlessly blocks the event
    // loop for the whole build (and gets slower as runs/ grows).
    if (leaderboard.source === "github-not-configured" || !leaderboard.rows.length) {
      const localLeaderboard = loadLocalArtifactLeaderboard(env.KATA_ROOT);
      if (localLeaderboard.rows.length) {
        return localLeaderboard;
      }
    }
    return leaderboard;
  } catch (error) {
    const githubCliLeaderboard = loadGithubCliLeaderboardSafe(env);
    if (githubCliLeaderboard.rows.length) {
      return {
        ...githubCliLeaderboard,
        githubError: error instanceof Error ? error.message : "unknown leaderboard error",
      };
    }
    const localLeaderboard = loadLocalArtifactLeaderboard(env.KATA_ROOT);
    if (localLeaderboard.rows.length) {
      return {
        ...localLeaderboard,
        githubError: error instanceof Error ? error.message : "unknown leaderboard error",
      };
    }
    return {
      source: "unavailable",
      error: error instanceof Error ? error.message : "unknown leaderboard error",
      rows: [],
      latestLaneWinners: {},
    };
  }
}

function loadGithubCliLeaderboardSafe(env) {
  if (env.KATA_BOARD_ALLOW_GH_CLI_FALLBACK !== "true") {
    return {
      source: "github-cli-disabled",
      rows: [],
      latestLaneWinners: {},
    };
  }
  try {
    return loadGithubCliLeaderboard({ repoSlug: env.KATA_REPO_SLUG });
  } catch {
    return {
      source: "github-cli-unavailable",
      rows: [],
      latestLaneWinners: {},
    };
  }
}

function loadLocalLeaderboardFallback(env, error) {
  const message = error instanceof Error ? error.message : "unknown leaderboard error";
  const localLeaderboard = loadLocalArtifactLeaderboard(env.KATA_ROOT);
  if (localLeaderboard.rows.length) {
    return {
      ...localLeaderboard,
      githubError: message,
    };
  }
  return {
    source: "unavailable",
    error: message,
    rows: [],
    latestLaneWinners: {},
  };
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function loadValidatorStatus(env, roots) {
  const health = await loadValidatorHealth(env.KATA_VALIDATOR_HEALTH_URL);
  const queue = loadQueueStatus(roots.queueStatePath, health.payload?.queue || null);
  const reviewApprovals = loadReviewApprovals(roots.reviewApprovalsPath);
  const benchmarkExpectedCounts = loadBenchmarkExpectedCounts(roots.benchmarkFile);
  const visibleJob = queue.activeJob || queue.latestJob;
  const activeEvaluation = loadActiveEvaluationProgress(
    roots.liveStatusPath,
    roots.workRoot,
    visibleJob,
    benchmarkExpectedCounts
  );
  const activePullAuthor = await loadActivePullAuthor(env, visibleJob);
  return {
    mode: "resident",
    queue,
    reviewApprovals,
    health,
    activeEvaluation: enrichActiveEvaluationWithPullAuthor(activeEvaluation, activePullAuthor),
  };
}

function loadReviewApprovals(reviewApprovalsPath) {
  const payload = readJsonSafe(reviewApprovalsPath);
  const approvals = Array.isArray(payload?.approvals) ? payload.approvals : [];
  const sanitized = approvals
    .filter((approval) => approval && typeof approval === "object")
    .map((approval) => ({
      repo: typeof approval.repo === "string" ? approval.repo : null,
      pullNumber: numberOrNull(approval.pull_number),
      submissionId: typeof approval.submission_id === "string" ? approval.submission_id : null,
      reason: typeof approval.reason === "string" ? approval.reason : null,
      approvedBy: typeof approval.approved_by === "string" ? approval.approved_by : null,
      approvedAt: typeof approval.approved_at === "string" ? approval.approved_at : null,
    }))
    .sort((left, right) => new Date(right.approvedAt || 0) - new Date(left.approvedAt || 0));
  return {
    available: Boolean(payload),
    count: sanitized.length,
    recent: sanitized.slice(0, 8),
  };
}

async function loadActivePullAuthor(env, activeJob) {
  if (!activeJob?.pullNumber || !activeJob?.kataRepo) {
    return null;
  }
  try {
    const pull = await githubRequest(
      `/repos/${activeJob.kataRepo}/pulls/${activeJob.pullNumber}`,
      githubReadTokens(env).length ? githubReadTokens(env) : env.KATA_GITHUB_TOKEN
    );
    const user = pull?.user || {};
    const head = pull?.head || {};
    const headRepo = head.repo || {};
    return {
      login: typeof user.login === "string" ? user.login : null,
      avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
      htmlUrl: typeof user.html_url === "string" ? user.html_url : null,
      pullUrl: typeof pull.html_url === "string" ? pull.html_url : null,
      headRepo: typeof headRepo.full_name === "string" ? headRepo.full_name : null,
      headSha: typeof head.sha === "string" ? head.sha : null,
    };
  } catch {
    return null;
  }
}

function githubReadTokens(env) {
  return parseGithubTokenList(env.KATA_GITHUB_READ_TOKENS || env.KATA_TARGET_READ_TOKENS || "");
}

function enrichActiveEvaluationWithPullAuthor(activeEvaluation, pullAuthor) {
  if (!activeEvaluation || !pullAuthor?.login) {
    return activeEvaluation;
  }
  return {
    ...activeEvaluation,
    candidateGithubLogin: pullAuthor.login,
    candidateAvatarUrl: pullAuthor.avatarUrl,
    candidateGithubUrl: pullAuthor.htmlUrl,
    candidatePullUrl: pullAuthor.pullUrl,
    candidateAgentUrl: buildCandidateAgentUrl(activeEvaluation, pullAuthor),
    candidateAuthor: pullAuthor.login,
  };
}

function buildCandidateAgentUrl(activeEvaluation, pullAuthor) {
  if (!pullAuthor?.headRepo || !pullAuthor?.headSha || !activeEvaluation?.candidateSubmissionId) {
    return null;
  }
  const subnetPack = activeEvaluation.subnetPack || activeEvaluation.repoPack;
  const mode = activeEvaluation.mode;
  if (!subnetPack || !mode) {
    return null;
  }
  const agentPath = [
    "submissions",
    subnetPack,
    mode,
    activeEvaluation.candidateSubmissionId,
    "agent.py",
  ].join("/");
  return `https://github.com/${pullAuthor.headRepo}/blob/${pullAuthor.headSha}/${agentPath}`;
}

function loadQueueStatus(queueStatePath, healthQueuePayload = null) {
  const queuePayload = readJsonSafe(queueStatePath);
  if (!queuePayload) {
    return queueStatusFromHealth(healthQueuePayload);
  }
  const jobs = Array.isArray(queuePayload?.jobs)
    ? queuePayload.jobs.filter((job) => job && typeof job === "object")
    : [];
  const counts = {
    total: jobs.length,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    other: 0,
  };

  for (const job of jobs) {
    if (job.status === "pending") {
      counts.pending += 1;
    } else if (job.status === "running") {
      counts.running += 1;
    } else if (job.status === "completed") {
      counts.completed += 1;
    } else if (job.status === "failed") {
      counts.failed += 1;
    } else {
      counts.other += 1;
    }
  }

  const jobsByRecency = [...jobs].sort(
    (left, right) => new Date(jobSortDate(right)) - new Date(jobSortDate(left))
  );
  const activeJob = jobsByRecency.find((job) => job.status === "running") || null;
  const latestJob = jobsByRecency[0] || null;

  return {
    available: Boolean(queuePayload),
    counts,
    activeJob: activeJob ? summarizeQueueJob(activeJob) : null,
    latestJob: latestJob ? summarizeQueueJob(latestJob) : null,
    recentJobs: jobsByRecency.slice(0, 8).map(summarizeQueueJob),
  };
}

function queueStatusFromHealth(payload) {
  const counts = {
    total: Number(payload?.total_jobs || 0),
    pending: Number(payload?.pending_jobs || 0),
    running: Number(payload?.running_jobs || 0),
    completed: Number(payload?.completed_jobs || 0),
    failed: Number(payload?.failed_jobs || 0),
    other: 0,
  };
  return {
    available: Boolean(payload),
    counts,
    activeJob: null,
    latestJob: null,
    recentJobs: [],
  };
}

function loadActiveEvaluationProgress(
  liveStatusPath,
  workRoot,
  activeJob,
  benchmarkExpectedCounts = new Map()
) {
  const baseState = evaluationJobState(activeJob);
  const base = {
    available: Boolean(activeJob),
    state: baseState,
    phase: baseState,
    workspacePath: null,
    updatedAt: null,
    subnetPack: null,
    repoPack: null,
    mode: null,
    candidateSubmissionId: null,
    candidateAuthor: null,
    kataRepo: activeJob?.kataRepo || null,
    pullNumber: activeJob?.pullNumber || null,
    startedAt: activeJob?.startedAt || null,
    finishedAt: activeJob?.finishedAt || null,
    enqueuedAt: activeJob?.enqueuedAt || null,
    attempts: activeJob?.attempts || 0,
    finalAction: activeJob?.finalAction || null,
    finalReason: activeJob?.finalReason || null,
    primary: null,
  };
  if (!activeJob) {
    return base;
  }

  const liveStatus = loadLiveEvaluationProgress(liveStatusPath, activeJob);
  const workspace = findActiveWorkspaceProgress(
    workRoot,
    activeJob,
    liveStatus,
    benchmarkExpectedCounts
  );
  const workspaceRoot = workspace?.workspaceRoot || null;
  const lane = workspace?.lane || null;
  const phaseProgress = workspace?.phaseProgress || null;
  const evaluatorFinal = phaseProgress?.evaluator || null;
  const phaseScreeningFailed = evaluatorFinal?.screeningStatus === "failed";
  if (liveStatus || phaseProgress || lane) {
    return {
      ...base,
      ...(liveStatus || {}),
      workspacePath: liveStatus?.workspacePath || workspaceRoot || null,
      updatedAt:
        liveStatus?.updatedAt ||
        phaseProgress?.updatedAt ||
        (workspaceRoot ? statMtimeIso(workspaceRoot) : null) ||
        activeJob.startedAt ||
        activeJob.enqueuedAt,
      subnetPack: liveStatus?.subnetPack || lane?.subnetPack || lane?.repoPack || null,
      repoPack: liveStatus?.repoPack || lane?.subnetPack || lane?.repoPack || null,
      mode: liveStatus?.mode || lane?.mode || null,
      candidateSubmissionId: liveStatus?.candidateSubmissionId || lane?.submissionId || null,
      candidateAuthor:
        liveStatus?.candidateAuthor ||
        (lane?.submissionId ? inferSubmissionAuthorFromId(lane.submissionId) : null),
      screeningStatus: liveStatus?.screeningStatus || evaluatorFinal?.screeningStatus || null,
      screeningStage: liveStatus?.screeningStage || evaluatorFinal?.screeningStage || null,
      screeningReasons: liveStatus?.screeningReasons?.length
        ? liveStatus.screeningReasons
        : evaluatorFinal?.screeningReasons || [],
      finalReason:
        (phaseScreeningFailed ? phaseProgress?.promotionReason : null) ||
        liveStatus?.finalReason ||
        phaseProgress?.promotionReason ||
        activeJob.finalReason ||
        null,
      primary: liveStatus?.primary || phaseProgress?.primary || null,
    };
  }
  return base;
}

function evaluationJobState(job) {
  if (!job) {
    return "idle";
  }
  if (job.status === "completed") {
    return "completed";
  }
  if (job.status === "failed") {
    return "failed";
  }
  if (job.status === "pending") {
    return "queued";
  }
  return "running";
}

function loadLiveEvaluationProgress(liveStatusPath, activeJob) {
  const payload = readJsonSafe(liveStatusPath);
  if (
    !payload ||
    typeof payload !== "object" ||
    !payload.job ||
    typeof payload.job !== "object" ||
    payload.job.job_id !== activeJob.jobId
  ) {
    return null;
  }
  const primary = normalizeLivePool(payload.pools?.primary, true);
  const laneId = payload.lane_id || null;
  return {
    available: true,
    state: payload.state || "running",
    phase: payload.phase || "running",
    workspacePath: null,
    updatedAt: payload.updated_at || null,
    laneId,
    subnetPack: payload.subnet_pack || payload.repo_pack || laneId,
    repoPack: payload.subnet_pack || payload.repo_pack || laneId,
    mode: payload.mode || null,
    candidateSubmissionId: payload.candidate_submission_id || null,
    candidateGithubLogin: payload.candidate_github_login || null,
    candidateAvatarUrl: payload.candidate_avatar_url || null,
    candidateGithubUrl: payload.candidate_github_url || null,
    screening: {
      projectKey: payload.screening_project_key || null,
      startedAt: payload.screening_started_at || null,
      timeoutSeconds: numberOrNull(payload.screening_timeout_seconds),
      timeoutAt: payload.screening_timeout_at || null,
    },
    screeningStatus: payload.screening_status || null,
    screeningStage: payload.screening_stage || null,
    screeningReasons: Array.isArray(payload.screening_reasons) ? payload.screening_reasons : [],
    candidateAuthor:
      payload.candidate_github_login ||
      payload.candidate_author ||
      inferSubmissionAuthorFromId(payload.candidate_submission_id),
    projectKeys: Array.isArray(payload.project_keys) ? payload.project_keys : [],
    replicasPerProject: Number(payload.replicas_per_project || 0) || null,
    finalAction: payload.final_action || activeJob.finalAction || null,
    finalReason: payload.final_reason || null,
    kataRepo: payload.job.kata_repo || activeJob.kataRepo || null,
    pullNumber: payload.job.pull_number || activeJob.pullNumber || null,
    startedAt: payload.job.started_at || activeJob.startedAt || null,
    finishedAt: payload.job.finished_at || activeJob.finishedAt || null,
    enqueuedAt: payload.job.enqueued_at || activeJob.enqueuedAt || null,
    attempts: payload.job.attempts ?? activeJob.attempts ?? 0,
    primary,
  };
}

function normalizeLivePool(pool, revealTaskIds) {
  if (!pool) {
    return null;
  }
  const rawTasks = Array.isArray(pool.task_statuses) ? pool.task_statuses : [];
  const taskStatuses = rawTasks
    .filter((task) => task && typeof task === "object")
    .map((task) => ({
      taskId: revealTaskIds ? task.task_id || null : null,
      status: task.status || "queued",
      completed: Boolean(task.completed),
      candidate: normalizeLiveVariant(task.candidate),
      king: normalizeLiveVariant(task.king),
    }));
  return {
    live: pool.state !== "completed",
    totalTasks: Number(pool.total_tasks ?? taskStatuses.length ?? 0),
    completedTasks: Number(
      pool.completed_tasks ?? taskStatuses.filter((task) => task.completed).length
    ),
    taskStatuses: revealTaskIds ? taskStatuses : [],
    counts: summarizeTaskStatusCounts(taskStatuses),
    scores: normalizeVariantNumberMap(pool.scores),
    passCounts: normalizeVariantNumberMap(pool.pass_counts),
    truePositives: normalizeVariantNumberMap(pool.true_positives),
    totalFound: normalizeVariantNumberMap(pool.total_found),
    invalidRuns: normalizeVariantNumberMap(pool.invalid_runs),
    replicaProgress: normalizeReplicaProgress(pool.replica_progress),
    projectKeys: Array.isArray(pool.project_keys) ? pool.project_keys : [],
    updatedAt: pool.updated_at || null,
  };
}

function normalizeVariantNumberMap(value) {
  const payload = value && typeof value === "object" ? value : {};
  return {
    king: numberOrNull(payload.king),
    candidate: numberOrNull(payload.candidate),
    delta: numberOrNull(payload.delta),
  };
}

function normalizeReplicaProgress(value) {
  const payload = value && typeof value === "object" ? value : {};
  return {
    king: normalizeReplicaProgressSide(payload.king),
    candidate: normalizeReplicaProgressSide(payload.candidate),
  };
}

function normalizeReplicaProgressSide(value) {
  const payload = value && typeof value === "object" ? value : {};
  return {
    completed: Number(payload.completed || 0),
    total: Number(payload.total || 0),
  };
}

function normalizeLiveVariant(variant) {
  return {
    started: Boolean(variant?.started),
    finished: Boolean(variant?.finished),
    solved: Boolean(variant?.solved),
    valid: Boolean(variant?.valid),
    success: Boolean(variant?.success),
    verifierScore: numberOrNull(variant?.verifier_score),
    weightedTaskScore: numberOrNull(variant?.weighted_task_score),
    completedReplicas: Number(variant?.completed_replicas ?? variant?.completedReplicas ?? 0),
    totalReplicas: Number(variant?.total_replicas ?? variant?.totalReplicas ?? 0),
  };
}

function findActiveWorkspaceProgress(
  workRoot,
  activeJob,
  liveStatus,
  benchmarkExpectedCounts = new Map()
) {
  const workspaces = listActiveWorkspaces(workRoot);
  if (!workspaces.length) {
    return null;
  }

  const candidates = workspaces.map((workspaceRoot) => {
    const lane = inferLaneFromWorkspace(workspaceRoot);
    const phaseProgress =
      inspectChallengePhase(
        path.join(workspaceRoot, "runs-confirm"),
        "confirm",
        liveStatus?.projectKeys || [],
        liveStatus?.replicasPerProject,
        benchmarkExpectedCounts
      ) ||
      inspectChallengePhase(
        path.join(workspaceRoot, "runs-initial"),
        "initial",
        liveStatus?.projectKeys || [],
        liveStatus?.replicasPerProject,
        benchmarkExpectedCounts
      );
    return {
      workspaceRoot,
      lane,
      phaseProgress,
      score: activeWorkspaceScore({ workspaceRoot, lane, phaseProgress, activeJob, liveStatus }),
      updatedAt:
        phaseProgress?.updatedAt || newestMtimeIso(workspaceRoot) || statMtimeIso(workspaceRoot),
    };
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
  });
  return candidates[0] || null;
}

function listActiveWorkspaces(workRoot) {
  if (!fs.existsSync(workRoot)) {
    return [];
  }
  try {
    return fs
      .readdirSync(workRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("kata-bot-job-"))
      .map((entry) => path.join(workRoot, entry.name));
  } catch {
    return [];
  }
}

function activeWorkspaceScore({ workspaceRoot, lane, phaseProgress, activeJob, liveStatus }) {
  let score = 0;
  if (phaseProgress?.primary) {
    score += 100;
  }
  if (phaseProgress) {
    score += 25;
  }
  if (
    liveStatus?.candidateSubmissionId &&
    lane?.submissionId === liveStatus.candidateSubmissionId
  ) {
    score += 1000;
  }
  if (
    liveStatus?.subnetPack &&
    lane?.subnetPack === liveStatus.subnetPack &&
    (!liveStatus.mode || lane?.mode === liveStatus.mode)
  ) {
    score += 200;
  }
  const latest = newestMtimeIso(workspaceRoot) || statMtimeIso(workspaceRoot);
  if (
    activeJob?.startedAt &&
    latest &&
    new Date(latest).getTime() >= new Date(activeJob.startedAt).getTime() - 60_000
  ) {
    score += 10;
  }
  return score;
}

function inferLaneFromWorkspace(workspaceRoot) {
  const changedPaths = readTextSafe(path.join(workspaceRoot, "changed-paths.txt"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const changedPath of changedPaths) {
    const match = changedPath.match(/^submissions\/([^/]+)\/([^/]+)\/([^/]+)\//);
    if (!match) {
      continue;
    }
    return {
      subnetPack: match[1],
      repoPack: match[1],
      mode: match[2],
      submissionId: match[3],
    };
  }
  return null;
}

function inspectChallengePhase(
  phaseRoot,
  phase,
  selectedProjectKeys = [],
  replicasPerProject = null,
  benchmarkExpectedCounts = new Map()
) {
  if (!fs.existsSync(phaseRoot)) {
    return null;
  }
  const challengeRoots = listDirectories(phaseRoot)
    .map((name) => path.join(phaseRoot, name))
    .sort((left, right) => new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0));
  if (!challengeRoots.length) {
    return {
      state: "running",
      phase,
      updatedAt: statMtimeIso(phaseRoot),
      primary: null,
    };
  }
  const challengeRoot = challengeRoots[0];
  const summaryPath = path.join(challengeRoot, "challenge_summary.json");
  const summary = readJsonSafe(summaryPath);
  const evaluatorProgress = inspectEvaluatorProgress(
    challengeRoot,
    summary,
    phase,
    selectedProjectKeys,
    replicasPerProject,
    benchmarkExpectedCounts
  );
  const evaluatorMetrics = summary ? loadEvaluatorActivityMetrics(summary) : null;
  if (evaluatorProgress) {
    return {
      state: summary ? "verifying" : "running",
      phase,
      runId: path.basename(challengeRoot),
      promotionReason: summary?.promotion_reason || null,
      evaluator: evaluatorMetrics,
      updatedAt:
        summary?.created_at ||
        evaluatorProgress.updatedAt ||
        statMtimeIso(summaryPath) ||
        statMtimeIso(challengeRoot),
      primary: evaluatorProgress,
    };
  }
  return {
    state: summary ? "verifying" : "running",
    phase,
    runId: path.basename(challengeRoot),
    promotionReason: summary?.promotion_reason || null,
    evaluator: evaluatorMetrics,
    updatedAt: summary?.created_at || statMtimeIso(summaryPath) || statMtimeIso(challengeRoot),
    primary: inspectPoolProgress(path.join(challengeRoot, "primary"), true),
  };
}

function inspectEvaluatorProgress(
  runRoot,
  summary,
  phase,
  selectedProjectKeys = [],
  replicasPerProject = null,
  benchmarkExpectedCounts = new Map()
) {
  const runId = path.basename(runRoot).toLowerCase();
  const isScreening =
    String(phase || "")
      .toLowerCase()
      .includes("screening") ||
    runId.includes("screening") ||
    fs.existsSync(path.join(runRoot, "screening_result.json"));
  if (isScreening) {
    const screening = readJsonSafe(path.join(runRoot, "screening_result.json"));
    const screeningProjectKey = screening?.project_key || selectedProjectKeys[0] || "screening";
    const screeningStatus = screening
      ? screening.status === "passed"
        ? "screening passed"
        : "screening failed"
      : "screening running";
    return {
      live: !summary,
      totalTasks: 1,
      completedTasks: screening ? 1 : 0,
      taskStatuses: [
        {
          taskId: screeningProjectKey,
          status: screeningStatus,
          completed: Boolean(screening),
          candidate: {
            started: true,
            finished: Boolean(screening),
            solved: screening?.status === "passed",
            valid: screening?.status === "passed",
            success: screening?.status === "passed",
            verifierScore: null,
            weightedTaskScore: null,
          },
          king: {
            started: false,
            finished: false,
            solved: false,
            valid: false,
            success: false,
            verifierScore: null,
            weightedTaskScore: null,
          },
        },
      ],
      counts: screening
        ? { [screening.status === "passed" ? "screening passed" : "screening failed"]: 1 }
        : { screening: 1 },
      scores: { king: null, candidate: null, delta: null },
      passCounts: { king: 0, candidate: 0, delta: 0 },
      truePositives: { king: 0, candidate: 0, delta: 0 },
      totalFound: { king: 0, candidate: 0, delta: 0 },
      invalidRuns: { king: 0, candidate: screening?.status === "failed" ? 1 : 0, delta: null },
      replicaProgress: {
        king: { completed: 0, total: 0 },
        candidate: { completed: screening ? 1 : 0, total: 1 },
      },
      projectKeys: screeningProjectKey === "screening" ? [] : [screeningProjectKey],
      updatedAt: statMtimeIso(path.join(runRoot, "screening_result.json")) || statMtimeIso(runRoot),
    };
  }
  const isDuel =
    Boolean(summary?.primary) ||
    fs.existsSync(path.join(runRoot, "duel_summary.json")) ||
    fs.existsSync(path.join(runRoot, "candidate")) ||
    fs.existsSync(path.join(runRoot, "king"));
  if (!isDuel) {
    return null;
  }
  if (summary?.primary) {
    return summarizeEvaluatorSummaryPrimary(summary, runRoot);
  }
  return summarizeRunningEvaluatorDuel(
    runRoot,
    selectedProjectKeys,
    replicasPerProject,
    benchmarkExpectedCounts
  );
}

function summarizeEvaluatorSummaryPrimary(summary, runRoot) {
  const primary = summary.primary || {};
  const duel = readJsonSafe(resolveRunManifestPath(summary, runRoot));
  const candidate = duel?.candidate || {};
  const king = duel?.king || {};
  const candidateScore = numberOrNull(primary.variant_scores?.candidate);
  const kingScore = numberOrNull(primary.variant_scores?.king);
  const passCounts = primary.variant_successes || {};
  const invalidRuns = primary.variant_invalid_runs || {};
  const projectKeys = Array.isArray(primary.project_keys) ? primary.project_keys : [];
  return {
    live: false,
    totalTasks: projectKeys.length,
    completedTasks: projectKeys.length,
    taskStatuses: [],
    counts: {},
    scores: {
      king: kingScore === null ? null : kingScore / 100,
      candidate: candidateScore === null ? null : candidateScore / 100,
      delta:
        candidateScore === null || kingScore === null ? null : (candidateScore - kingScore) / 100,
    },
    passCounts: {
      king: numberOrNull(passCounts.king),
      candidate: numberOrNull(passCounts.candidate),
      delta: null,
    },
    truePositives: {
      king: numberOrNull(king.true_positives),
      candidate: numberOrNull(candidate.true_positives),
      delta: numberDelta(candidate.true_positives, king.true_positives),
    },
    totalFound: {
      king: numberOrNull(king.total_found),
      candidate: numberOrNull(candidate.total_found),
      delta: numberDelta(candidate.total_found, king.total_found),
    },
    totalExpected: {
      king: numberOrNull(king.total_expected),
      candidate: numberOrNull(candidate.total_expected),
      delta: numberDelta(candidate.total_expected, king.total_expected),
    },
    precision: {
      king: numberOrNull(king.precision),
      candidate: numberOrNull(candidate.precision),
      delta: numberDelta(candidate.precision, king.precision),
    },
    f1Scores: {
      king: numberOrNull(king.f1_score),
      candidate: numberOrNull(candidate.f1_score),
      delta: numberDelta(candidate.f1_score, king.f1_score),
    },
    invalidRuns: {
      king: numberOrNull(invalidRuns.king),
      candidate: numberOrNull(invalidRuns.candidate),
      delta: null,
    },
    replicaProgress: {
      king: { completed: 0, total: 0 },
      candidate: { completed: 0, total: 0 },
    },
    projectKeys,
    updatedAt: summary.created_at || statMtimeIso(runRoot),
  };
}

function summarizeRunningEvaluatorDuel(
  runRoot,
  selectedProjectKeys = [],
  replicasPerProject = null,
  benchmarkExpectedCounts = new Map()
) {
  const expectedReplicas = positiveIntegerOrNull(replicasPerProject);
  const king = summarizeEvaluatorVariantProgress(
    path.join(runRoot, "king"),
    selectedProjectKeys,
    expectedReplicas,
    benchmarkExpectedCounts
  );
  const candidate = summarizeEvaluatorVariantProgress(
    path.join(runRoot, "candidate"),
    selectedProjectKeys,
    expectedReplicas,
    benchmarkExpectedCounts
  );
  const projectKeys = [
    ...new Set([...selectedProjectKeys, ...king.projectKeys, ...candidate.projectKeys]),
  ].sort();
  const totalProjects =
    projectKeys.length || Math.max(king.projectCount, candidate.projectCount, 1);
  const taskStatuses = projectKeys.map((projectKey) => {
    const kingProject = king.projects.get(projectKey) || emptyEvaluatorProjectProgress(projectKey);
    const candidateProject =
      candidate.projects.get(projectKey) || emptyEvaluatorProjectProgress(projectKey);
    return {
      taskId: projectKey,
      status:
        candidateProject.finished && kingProject.finished
          ? exactTaskStatusLabel(candidateProject, kingProject)
          : runningTaskStatusLabel(candidateProject, kingProject),
      completed: candidateProject.finished && kingProject.finished,
      candidate: evaluatorProjectToLiveVariant(candidateProject),
      king: evaluatorProjectToLiveVariant(kingProject),
    };
  });
  const completedTasks = taskStatuses.filter((task) => task.completed);
  const completedCandidatePasses = completedTasks.filter((task) => task.candidate.solved).length;
  const completedKingPasses = completedTasks.filter((task) => task.king.solved).length;
  const completedCandidateTruePositives = completedTasks.reduce(
    (total, task) => total + Number(task.candidate.truePositives || 0),
    0
  );
  const completedKingTruePositives = completedTasks.reduce(
    (total, task) => total + Number(task.king.truePositives || 0),
    0
  );
  const completedCandidateExpected = completedTasks.reduce(
    (total, task) => total + Number(task.candidate.totalExpected || 0),
    0
  );
  const completedKingExpected = completedTasks.reduce(
    (total, task) => total + Number(task.king.totalExpected || 0),
    0
  );
  const completedCandidateFound = completedTasks.reduce(
    (total, task) => total + Number(task.candidate.totalFound || 0),
    0
  );
  const completedKingFound = completedTasks.reduce(
    (total, task) => total + Number(task.king.totalFound || 0),
    0
  );
  const candidateScore = completedCandidateExpected
    ? completedCandidateTruePositives / completedCandidateExpected
    : 0;
  const kingScore = completedKingExpected ? completedKingTruePositives / completedKingExpected : 0;
  const candidatePrecision = completedCandidateFound
    ? completedCandidateTruePositives / completedCandidateFound
    : 0;
  const kingPrecision = completedKingFound ? completedKingTruePositives / completedKingFound : 0;
  const candidateF1 = f1Score(candidateScore, candidatePrecision);
  const kingF1 = f1Score(kingScore, kingPrecision);
  return {
    live: true,
    totalTasks: totalProjects,
    completedTasks: completedTasks.length,
    taskStatuses,
    counts: summarizeTaskStatusCounts(taskStatuses),
    scores: {
      king: kingScore,
      candidate: candidateScore,
      delta: candidateScore - kingScore,
    },
    passCounts: {
      king: completedKingPasses,
      candidate: completedCandidatePasses,
      delta: completedCandidatePasses - completedKingPasses,
    },
    truePositives: {
      king: completedKingTruePositives,
      candidate: completedCandidateTruePositives,
      delta: completedCandidateTruePositives - completedKingTruePositives,
    },
    totalFound: {
      king: completedKingFound,
      candidate: completedCandidateFound,
      delta: completedCandidateFound - completedKingFound,
    },
    totalExpected: {
      king: completedKingExpected,
      candidate: completedCandidateExpected,
      delta: completedCandidateExpected - completedKingExpected,
    },
    precision: {
      king: kingPrecision,
      candidate: candidatePrecision,
      delta: candidatePrecision - kingPrecision,
    },
    f1Scores: {
      king: kingF1,
      candidate: candidateF1,
      delta: candidateF1 - kingF1,
    },
    invalidRuns: {
      king: king.invalidRuns,
      candidate: candidate.invalidRuns,
      delta: candidate.invalidRuns - king.invalidRuns,
    },
    replicaProgress: {
      king: { completed: king.completedReplicas, total: king.totalReplicas },
      candidate: {
        completed: candidate.completedReplicas,
        total: candidate.totalReplicas,
      },
    },
    projectKeys,
    updatedAt: newestMtimeIso(runRoot) || statMtimeIso(runRoot),
  };
}

function summarizeEvaluatorVariantProgress(
  variantRoot,
  selectedProjectKeys = [],
  expectedReplicas = null,
  benchmarkExpectedCounts = new Map()
) {
  const projects = new Map();
  for (const projectKey of selectedProjectKeys) {
    projects.set(
      projectKey,
      summarizeEvaluatorProjectProgress(
        path.join(variantRoot, projectKey),
        projectKey,
        expectedReplicas,
        benchmarkExpectedCounts
      )
    );
  }
  if (!fs.existsSync(variantRoot)) {
    const projectList = [...projects.values()];
    return {
      projectKeys: projectList.map((project) => project.projectKey),
      projectCount: projectList.length,
      projects,
      codebasesPassed: 0,
      truePositives: 0,
      invalidRuns: 0,
      completedReplicas: 0,
      totalReplicas: projectList.reduce((total, project) => total + project.totalReplicas, 0),
    };
  }
  for (const projectKey of listDirectories(variantRoot).sort()) {
    const project = summarizeEvaluatorProjectProgress(
      path.join(variantRoot, projectKey),
      projectKey,
      expectedReplicas,
      benchmarkExpectedCounts
    );
    projects.set(projectKey, project);
  }
  const projectList = [...projects.values()];
  return {
    projectKeys: projectList.map((project) => project.projectKey),
    projectCount: projectList.length,
    projects,
    codebasesPassed: projectList.filter((project) => project.solved).length,
    truePositives: projectList.reduce((total, project) => total + project.truePositives, 0),
    invalidRuns: projectList.reduce((total, project) => total + project.invalidRuns, 0),
    completedReplicas: projectList.reduce((total, project) => total + project.completedReplicas, 0),
    totalReplicas: projectList.reduce((total, project) => total + project.totalReplicas, 0),
  };
}

function emptyEvaluatorProjectProgress(projectKey) {
  return {
    projectKey,
    started: false,
    finished: false,
    solved: false,
    valid: false,
    success: false,
    verifierScore: null,
    weightedTaskScore: null,
    truePositives: 0,
    totalExpected: 0,
    totalFound: 0,
    precision: 0,
    f1Score: 0,
    invalidRuns: 0,
    passCount: 0,
    completedReplicas: 0,
    totalReplicas: 0,
    replicas: [],
  };
}

function evaluatorProjectToLiveVariant(project) {
  return {
    started: Boolean(project.started),
    finished: Boolean(project.finished),
    solved: Boolean(project.solved),
    valid: Boolean(project.valid),
    success: Boolean(project.success),
    verifierScore: numberOrNull(project.verifierScore),
    weightedTaskScore: numberOrNull(project.weightedTaskScore),
    truePositives: Number(project.truePositives || 0),
    totalExpected: Number(project.totalExpected || 0),
    totalFound: Number(project.totalFound || 0),
    precision: numberOrNull(project.precision),
    f1Score: numberOrNull(project.f1Score),
    completedReplicas: Number(project.completedReplicas || 0),
    totalReplicas: Number(project.totalReplicas || 0),
    passCount: Number(project.passCount || 0),
    replicas: Array.isArray(project.replicas) ? project.replicas.map(challengeReplicaPayload) : [],
  };
}

function inspectPoolProgress(poolRoot, revealTaskIds) {
  if (!fs.existsSync(poolRoot)) {
    return null;
  }
  const runRoots = listDirectories(poolRoot)
    .map((name) => path.join(poolRoot, name))
    .sort((left, right) => new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0));
  if (!runRoots.length) {
    return null;
  }
  const runRoot = runRoots[0];
  const runSummaryPath = path.join(runRoot, "run_summary.json");
  const runSummary = readJsonSafe(runSummaryPath);
  if (runSummary) {
    return summarizeCompletedPool(runSummary, revealTaskIds);
  }
  return summarizeRunningPool(runRoot, revealTaskIds);
}

function summarizeCompletedPool(runSummary, revealTaskIds) {
  const tasks = Array.isArray(runSummary?.tasks) ? runSummary.tasks : [];
  const taskStatuses = tasks.map((task) => {
    const candidate = summarizeTaskVariant(task, "candidate");
    const king = summarizeTaskVariant(task, "king");
    return {
      taskId: revealTaskIds ? task.task_id : null,
      status: exactTaskStatusLabel(candidate, king),
      completed: true,
      candidate,
      king,
    };
  });
  return {
    live: false,
    totalTasks: tasks.length,
    completedTasks: tasks.length,
    taskStatuses: revealTaskIds ? taskStatuses : [],
    counts: summarizeTaskStatusCounts(taskStatuses),
    updatedAt: runSummary.created_at || null,
  };
}

function summarizeRunningPool(runRoot, revealTaskIds) {
  const tasksRoot = path.join(runRoot, "tasks");
  const taskRoots = listDirectories(tasksRoot)
    .map((name) => path.join(tasksRoot, name))
    .sort();
  const taskStatuses = taskRoots.map((taskRoot) => summarizeRunningTask(taskRoot, revealTaskIds));
  return {
    live: true,
    totalTasks: taskStatuses.length,
    completedTasks: taskStatuses.filter((task) => task.completed).length,
    taskStatuses: revealTaskIds ? taskStatuses : [],
    counts: summarizeTaskStatusCounts(taskStatuses),
    updatedAt: statMtimeIso(runRoot),
  };
}

function summarizeRunningTask(taskRoot, revealTaskIds) {
  const candidate = summarizeRunningVariant(path.join(taskRoot, "candidate"));
  const king = summarizeRunningVariant(path.join(taskRoot, "king"));
  const taskId = path.basename(taskRoot);
  return {
    taskId: revealTaskIds ? taskId : null,
    status: runningTaskStatusLabel(candidate, king),
    completed: candidate.finished && king.finished,
    candidate,
    king,
  };
}

function summarizeRunningVariant(variantRoot) {
  const files = {
    agentStdout: fs.existsSync(path.join(variantRoot, "agent.stdout.txt")),
    agentStderr: fs.existsSync(path.join(variantRoot, "agent.stderr.txt")),
    checksStdout: fs.existsSync(path.join(variantRoot, "checks.stdout.txt")),
    checksStderr: fs.existsSync(path.join(variantRoot, "checks.stderr.txt")),
    score: fs.existsSync(path.join(variantRoot, "score.txt")),
  };
  const started = Object.values(files).some(Boolean) || fs.existsSync(variantRoot);
  const finished =
    files.score ||
    ((files.agentStdout || files.agentStderr) && (files.checksStdout || files.checksStderr));
  return {
    started,
    finished,
  };
}

function summarizeTaskVariant(task, variantName) {
  const variants = Array.isArray(task?.variants) ? task.variants : [];
  const variant = variants.find((item) => item.name === variantName) || {};
  return {
    solved: Boolean(variant.task_solved),
    valid: Boolean(variant.validity_passed),
    success: Boolean(variant.success),
    verifierScore: numberOrNull(variant.verifier_score),
    weightedTaskScore: numberOrNull(variant.weighted_task_score),
  };
}

function exactTaskStatusLabel(candidate, king) {
  if (!candidate.valid) {
    return "candidate invalid";
  }
  if (candidate.solved && !king.solved) {
    return "candidate leads";
  }
  if (candidate.solved && king.solved) {
    return "both verified";
  }
  if (!candidate.solved && king.solved) {
    return "king leads";
  }
  return "no verified findings";
}

function runningTaskStatusLabel(candidate, king) {
  if (candidate.finished && !candidate.valid) {
    return "candidate invalid";
  }
  if (king.finished && !king.valid) {
    return "king invalid";
  }
  if (candidate.finished && king.finished) {
    return "finished";
  }
  if (candidate.started || king.started) {
    return "running";
  }
  return "queued";
}

function numberDelta(left, right) {
  const leftNumber = numberOrNull(left);
  const rightNumber = numberOrNull(right);
  return leftNumber === null || rightNumber === null ? null : leftNumber - rightNumber;
}

function resolveRunManifestPath(summary, runRoot) {
  const manifestPath = String(summary?.manifest_path || "");
  if (!manifestPath) {
    return path.join(runRoot, "duel_summary.json");
  }
  return path.isAbsolute(manifestPath) ? manifestPath : path.join(runRoot, manifestPath);
}

async function loadValidatorHealth(healthUrl) {
  if (!healthUrl) {
    return {
      configured: false,
      ok: null,
      checkedAt: null,
      payload: null,
      error: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const payload = await response.json();
    return {
      configured: true,
      ok: Boolean(response.ok && payload?.status === "ok"),
      checkedAt: new Date().toISOString(),
      payload: sanitizeValidatorHealthPayload(payload),
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      checkedAt: new Date().toISOString(),
      payload: null,
      error: error instanceof Error ? error.message : "unknown validator health error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function sanitizeValidatorHealthPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const queue = payload.queue && typeof payload.queue === "object" ? payload.queue : null;
  return {
    status: typeof payload.status === "string" ? payload.status : null,
    service: typeof payload.service === "string" ? payload.service : null,
    queue: queue
      ? {
          total_jobs: numberOrNull(queue.total_jobs) ?? 0,
          pending_jobs: numberOrNull(queue.pending_jobs) ?? 0,
          running_jobs: numberOrNull(queue.running_jobs) ?? 0,
          completed_jobs: numberOrNull(queue.completed_jobs) ?? 0,
          failed_jobs: numberOrNull(queue.failed_jobs) ?? 0,
        }
      : null,
  };
}

function jobSortDate(job) {
  return job.finished_at || job.started_at || job.enqueued_at || "1970-01-01T00:00:00Z";
}

function summarizeQueueJob(job) {
  return {
    jobId: job.job_id,
    status: job.status,
    kataRepo: job.kata_repo || null,
    benchmarksRepo: job.benchmarks_repo || null,
    pullNumber: job.pull_number,
    headSha: job.head_sha || null,
    attempts: job.attempts,
    finalAction: job.final_action || null,
    finalReason: job.final_reason || null,
    enqueuedAt: job.enqueued_at || null,
    startedAt: job.started_at || null,
    finishedAt: job.finished_at || null,
    error: job.last_error || null,
  };
}

function loadEventLeaderboard(eventLogPath) {
  const resolved = path.resolve(eventLogPath);
  if (!fs.existsSync(resolved)) {
    return {
      source: "events",
      rows: [],
      latestLaneWinners: {},
      error: `event log not found: ${resolved}`,
    };
  }

  const byAuthor = new Map();
  const latestLaneWinners = new Map();
  const lines = fs
    .readFileSync(resolved, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      // Skip partial or corrupt lines (e.g. the tail of an in-progress
      // append) instead of failing the whole leaderboard.
      continue;
    }
    // A parseable-but-non-object line (e.g. literal `null`) must not take out
    // the whole leaderboard either.
    if (!item || typeof item !== "object") {
      continue;
    }
    const author = item.author || "unknown";
    const laneKey = `${item.subnet_pack || item.repo_pack || "unknown"}::${item.mode || "unknown"}`;
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions += 1;
    if (item.final_action === "merge") {
      entry.wins += 1;
      entry.winnerPulls.push({
        pullNumber: item.pull_number || null,
        mergedAt: item.created_at,
        labels: item.labels || [],
      });
      latestLaneWinners.set(laneKey, {
        author,
        mergedAt: item.created_at,
        pullNumber: item.pull_number || null,
      });
    } else if (item.final_action === "open") {
      entry.openSubmissions += 1;
    } else {
      entry.closedSubmissions += 1;
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, item.created_at);
    byAuthor.set(author, entry);
  }

  return {
    source: "events",
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners),
  };
}

const LOCAL_ARTIFACT_LEADERBOARD_TTL_MS = 60_000;
let localArtifactLeaderboardCache = null;

export function loadLocalArtifactLeaderboard(kataRoot) {
  // Memoize the synchronous git + runs/ walk. A GitHub outage routes every
  // leaderboard refresh through here, so without this it would re-run the blocking
  // work on each refresh; the cache bounds it to at most once per TTL per root.
  const key = kataRoot ? path.resolve(kataRoot) : "";
  const now = Date.now();
  if (
    localArtifactLeaderboardCache &&
    localArtifactLeaderboardCache.key === key &&
    now - localArtifactLeaderboardCache.at <= LOCAL_ARTIFACT_LEADERBOARD_TTL_MS
  ) {
    return localArtifactLeaderboardCache.value;
  }
  const value = augmentLeaderboardWithChallengeResults(
    loadLocalGitWinnerLeaderboard(kataRoot),
    kataRoot,
  );
  localArtifactLeaderboardCache = { key, at: now, value };
  return value;
}

function loadLocalGitWinnerLeaderboard(kataRoot) {
  const resolvedRoot = kataRoot ? path.resolve(kataRoot) : null;
  if (!resolvedRoot || !fs.existsSync(path.join(resolvedRoot, ".git"))) {
    return {
      source: "local-git",
      rows: [],
      latestLaneWinners: {},
    };
  }

  const commits = loadLocalGitCommits(resolvedRoot);
  const knownLanes = loadEvaluatorLanes({
    kataRoot: resolvedRoot,
    latestLaneWinners: {},
    identityAliases: new Map(),
  });
  if (!commits.length) {
    return {
      source: "local-git",
      rows: [],
      latestLaneWinners: {},
    };
  }

  const mergeCommitsByPull = new Map();
  for (const commit of commits) {
    const pullNumber = extractPullNumberFromSquashSubject(commit.subject);
    if (!pullNumber) {
      continue;
    }
    const existing = mergeCommitsByPull.get(pullNumber);
    if (!existing || new Date(commit.authorDate) > new Date(existing.authorDate)) {
      mergeCommitsByPull.set(pullNumber, commit);
    }
  }

  const byAuthor = new Map();
  const latestLaneWinners = new Map();
  for (const promotion of commits) {
    const pullNumber = extractPromotedPullNumber(promotion.subject);
    if (!pullNumber) {
      continue;
    }
    const mergeCommit = mergeCommitsByPull.get(pullNumber);
    if (!mergeCommit) {
      continue;
    }
    // Prefer the GitHub username from the submission directory the merge added
    // (Kata enforces `<github-user>-YYYYMMDD-NN`), so this local-git fallback
    // still shows the real login even when the committer used a plain email.
    // Fall back to the commit's email/subject/name only if that path is gone.
    const author =
      submissionAuthorFromMergeCommit(resolvedRoot, mergeCommit.hash) ||
      inferGitHubAuthorFromCommit(mergeCommit);
    const lane = inferLaneFromPromotionCommit(promotion, knownLanes);
    if (!author || !lane) {
      continue;
    }

    const mergedAt =
      normalizeIsoDate(mergeCommit.authorDate) || normalizeIsoDate(promotion.authorDate);
    const laneKey = laneKeyForLane(lane);
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions = Math.max(entry.totalSubmissions || 0, 1);
    entry.wins += 1;
    entry.winnerPulls.push({
      pullNumber,
      mergedAt,
      labels: [`kata:winner:${lane.subnetPack}`],
    });
    entry.lastActivityAt = maxDate(entry.lastActivityAt, mergedAt);
    if (entry.recentPulls.length < 4) {
      entry.recentPulls.push({
        number: pullNumber,
        title: mergeCommit.subject,
        htmlUrl: null,
        state: "merged",
        updatedAt: mergedAt,
      });
    }
    byAuthor.set(author, entry);

    const current = latestLaneWinners.get(laneKey);
    if (!current || new Date(mergedAt) > new Date(current.mergedAt || 0)) {
      latestLaneWinners.set(laneKey, {
        author,
        mergedAt,
        pullNumber,
      });
    }
  }

  return {
    source: "local-git",
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners),
  };
}

function inferLaneFromPromotionCommit(promotion, lanes) {
  const knownLanes = Array.isArray(lanes) ? lanes : [];
  if (knownLanes.length === 1) {
    return knownLanes[0];
  }
  const subject = String(promotion?.subject || "").toLowerCase();
  const matchingPack = knownLanes.filter((lane) => subject.includes(lane.subnetPack.toLowerCase()));
  if (matchingPack.length === 1) {
    return matchingPack[0];
  }
  const subnet = subject.match(/\b(sn\d+)\b/i)?.[1]?.toLowerCase();
  const matchingSubnet = subnet
    ? knownLanes.filter((lane) => lane.subnetPack.toLowerCase().startsWith(`${subnet}__`))
    : [];
  return matchingSubnet.length === 1 ? matchingSubnet[0] : null;
}

function augmentLeaderboardWithChallengeResults(leaderboard, kataRoot) {
  const resolvedRoot = kataRoot ? path.resolve(kataRoot) : null;
  if (!resolvedRoot) {
    return leaderboard;
  }
  const summaryPaths = collectFiles(path.join(resolvedRoot, "runs"), "challenge_result.json");
  if (!summaryPaths.length) {
    return leaderboard;
  }

  const byAuthor = new Map((leaderboard.rows || []).map((row) => [row.author, { ...row }]));
  const latestLaneWinners = new Map(Object.entries(leaderboard.latestLaneWinners || {}));
  const winnerByPull = new Map();
  for (const row of leaderboard.rows || []) {
    for (const pull of row.winnerPulls || []) {
      if (pull.pullNumber) {
        winnerByPull.set(Number(pull.pullNumber), row.author);
      }
    }
  }

  let added = false;
  const seenPullsByAuthor = new Map();
  for (const row of leaderboard.rows || []) {
    seenPullsByAuthor.set(
      row.author,
      new Set((row.recentPulls || []).map((pull) => Number(pull.number || 0)).filter(Boolean))
    );
  }

  for (const summaryPath of summaryPaths) {
    const summary = readJsonSafe(summaryPath);
    if (!summary || typeof summary !== "object") {
      continue;
    }
    const createdAt = summary.created_at || statMtimeIso(summaryPath);
    for (const challengeEntry of Array.isArray(summary.entries) ? summary.entries : []) {
      const pullNumber = pullNumberFromChallengeEntry(challengeEntry);
      const artifact = inferArtifactSubmission(challengeEntry?.artifact_path);
      const author =
        (pullNumber ? winnerByPull.get(pullNumber) : null) ||
        inferSubmissionAuthorFromId(artifact?.submissionId) ||
        inferSubmissionAuthorFromId(challengeEntry?.submission_id) ||
        "unknown";
      const entry = byAuthor.get(author) || createAuthorRow(author);
      const seenPulls = seenPullsByAuthor.get(author) || new Set();
      if (!pullNumber || !seenPulls.has(pullNumber)) {
        entry.totalSubmissions += 1;
        if (challengeEntry?.selected_winner) {
          entry.winnerSubmissions += 1;
        } else if (challengeEntry?.beats_king) {
          // A non-winning candidate can beat the old king but remain open for
          // a future challenge. Only live GitHub state should decide whether it is
          // still open/pending now.
        } else {
          entry.closedSubmissions += 1;
        }
        if (pullNumber) {
          seenPulls.add(pullNumber);
        }
      }
      entry.lastActivityAt = maxDate(entry.lastActivityAt, createdAt);
      if (entry.recentPulls.length < 4 && pullNumber && !seenPulls.has(-pullNumber)) {
        entry.recentPulls.push({
          number: pullNumber,
          title: artifact?.submissionId || challengeEntry?.submission_id || `PR #${pullNumber}`,
          htmlUrl: null,
          state: challengeEntry?.selected_winner
            ? "merged"
            : challengeEntry?.beats_king
              ? "open"
              : "closed",
          updatedAt: createdAt,
        });
        seenPulls.add(-pullNumber);
      }
      seenPullsByAuthor.set(author, seenPulls);
      byAuthor.set(author, entry);
      added = true;
    }
  }

  return {
    ...leaderboard,
    source: added ? `${leaderboard.source}+challenge-artifacts` : leaderboard.source,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners),
  };
}

function pullNumberFromChallengeEntry(entry) {
  const match = String(entry?.submission_id || "").match(/^pr-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferArtifactSubmission(artifactPath) {
  const match = String(artifactPath || "").match(
    /\/submissions\/([^/]+)\/([^/]+)\/([^/]+)(?:\/|$)/
  );
  if (!match) {
    return null;
  }
  return {
    subnetPack: match[1],
    mode: match[2],
    submissionId: match[3],
  };
}

function loadLocalGitCommits(kataRoot) {
  try {
    const output = execFileSync(
      "git",
      [
        "-C",
        kataRoot,
        "log",
        "--all",
        "--date=iso-strict",
        "--pretty=format:%H%x1f%aI%x1f%cI%x1f%an%x1f%ae%x1f%s%x1e",
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    return output
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map(parseLocalGitCommit)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseLocalGitCommit(record) {
  const parts = record.split("\x1f");
  if (parts.length < 6) {
    return null;
  }
  return {
    hash: parts[0],
    authorDate: parts[1],
    committerDate: parts[2],
    authorName: parts[3],
    authorEmail: parts[4],
    subject: parts.slice(5).join("\x1f"),
  };
}

function extractPromotedPullNumber(subject) {
  const match = String(subject || "").match(/^chore: promote king from PR #(\d+)\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractPullNumberFromSquashSubject(subject) {
  const match = String(subject || "").match(/\(#(\d+)\)\s*$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferGitHubAuthorFromCommit(commit) {
  const emailLogin = String(commit.authorEmail || "").match(
    /^\d+\+([^@]+)@users\.noreply\.github\.com$/i
  );
  if (emailLogin?.[1]) {
    return emailLogin[1];
  }
  const plainNoreplyLogin = String(commit.authorEmail || "").match(
    /^([^@]+)@users\.noreply\.github\.com$/i
  );
  if (plainNoreplyLogin?.[1] && plainNoreplyLogin[1] !== "kata-bot") {
    return plainNoreplyLogin[1];
  }
  const submissionId = String(commit.subject || "").match(/([A-Za-z0-9][A-Za-z0-9_-]*-\d{8}-\d+)/);
  if (submissionId?.[1]) {
    return inferSubmissionAuthorFromId(submissionId[1]);
  }
  const authorName = String(commit.authorName || "").trim();
  return authorName ? authorName.replace(/\s+/g, "-").toLowerCase() : null;
}

// Best local source of a winner's GitHub login when GitHub is unreachable: the
// submission directory the merge added. Kata requires that directory to be
// `submissions/<pack>/<mode>/<github-user>-YYYYMMDD-NN`, so the leading segment
// is the author's real GitHub username. Returns null if the path isn't found.
function submissionAuthorFromMergeCommit(kataRoot, commitHash) {
  if (!kataRoot || !commitHash) {
    return null;
  }
  try {
    const output = execFileSync(
      "git",
      ["-C", kataRoot, "show", "--name-only", "--pretty=format:", commitHash],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }
    );
    for (const line of output.split("\n")) {
      const match = line.trim().match(/^submissions\/[^/]+\/[^/]+\/([^/]+)\//);
      if (match?.[1]) {
        const author = inferSubmissionAuthorFromId(match[1]);
        if (author) {
          return author;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeIsoDate(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

// The lane's king is built from lane state, which historically did not record the winning
// PR number (it was written only to the published proof). When the published proof's current
// king matches a lane's king (same artifact hash, else same author), backfill the source PR
// so the Winners page can show and link it. Only fills a gap -- never overrides a value the
// lane state already has, and never touches a seeded king.
export function enrichLaneKingsWithProof(lanes, publicProof) {
  const proofKing = publicProof?.currentKing;
  const proofPull = proofKing?.sourcePullRequest ?? null;
  if (!Array.isArray(lanes) || proofPull == null) {
    return lanes;
  }
  const proofHash = String(proofKing?.artifactHash || "").toLowerCase();
  const proofAuthor = String(proofKing?.author || "").toLowerCase();
  return lanes.map((lane) => {
    const king = lane?.king;
    if (!king || king.seeded || king.sourcePullRequest != null) {
      return lane;
    }
    const laneHash = String(king.artifactHash || "").toLowerCase();
    const laneAuthor = String(king.author || "").toLowerCase();
    const matches =
      (proofHash && laneHash && proofHash === laneHash) ||
      (proofAuthor && laneAuthor && proofAuthor === laneAuthor);
    if (!matches) {
      return lane;
    }
    return { ...lane, king: { ...king, sourcePullRequest: proofPull } };
  });
}

function enrichChallengeKingIdentity(challenge, leaderboard) {
  if (!challenge || challenge.kingAuthor || challenge.kingSubmissionId) {
    return challenge;
  }
  const winner = latestWinnerBefore(
    leaderboard?.rows || [],
    challenge.generatedAt || new Date().toISOString()
  );
  if (!winner) {
    return challenge;
  }
  return {
    ...challenge,
    kingAuthor: winner.author,
    kingSubmissionId: winner.submissionId || null,
  };
}

function latestWinnerBefore(rows, cutoffIso) {
  const cutoff = new Date(cutoffIso || 0).getTime();
  if (!Number.isFinite(cutoff) || cutoff <= 0) {
    return null;
  }
  let latest = null;
  for (const row of rows || []) {
    for (const pull of row.winnerPulls || []) {
      const mergedAt = new Date(pull.mergedAt || 0).getTime();
      if (!Number.isFinite(mergedAt) || mergedAt > cutoff) {
        continue;
      }
      if (!latest || mergedAt > latest.mergedAtMs) {
        latest = {
          author: row.author,
          mergedAtMs: mergedAt,
          submissionId: submissionIdFromWinnerPull(row, pull),
        };
      }
    }
  }
  return latest;
}

function submissionIdFromWinnerPull(row, pull) {
  const pullNumber = Number(pull?.pullNumber || 0);
  const detail = (row?.recentPulls || []).find((item) => Number(item?.number || 0) === pullNumber);
  return extractSubmissionIdFromText(detail?.title) || null;
}

function extractSubmissionIdFromText(value) {
  const match = String(value || "").match(/([A-Za-z0-9][A-Za-z0-9_-]*-\d{8}-\d+)/);
  return match?.[1] || null;
}

function augmentLeaderboardWithChallenge(
  leaderboard,
  challenge,
  identityAliases = new Map(),
  challengeLane = null
) {
  const source = String(leaderboard.source || "");
  if (
    !challenge?.entrants?.length ||
    (!source.startsWith("unavailable") &&
      source !== "github-not-configured" &&
      source !== "local-git")
  ) {
    return leaderboard;
  }
  const byAuthor = new Map(
    (leaderboard.rows || []).map((row) => [
      resolveAuthorAlias(row.author, identityAliases),
      { ...row, author: resolveAuthorAlias(row.author, identityAliases) },
    ])
  );
  const latestLaneWinners = new Map(Object.entries(leaderboard.latestLaneWinners || {}));
  const activityAt = challenge.generatedAt || new Date().toISOString();
  const laneKey = laneKeyForLane(challengeLane);

  for (const entrant of challenge.entrants) {
    const author =
      resolveAuthorAlias(entrant.author, identityAliases) ||
      inferSubmissionAuthorFromId(entrant.submission_id) ||
      "unknown";
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions = Math.max(entry.totalSubmissions || 0, 1);
    if (entrant.status === "winner") {
      entry.wins = Math.max(entry.wins || 0, 1);
      if (!(entry.winnerPulls || []).length) {
        entry.winnerPulls = [
          {
            pullNumber: entrant.pull_number || null,
            mergedAt: activityAt,
            labels: entrant.labels || [],
          },
        ];
      }
      const current = laneKey ? latestLaneWinners.get(laneKey) : null;
      if (laneKey && (!current || new Date(activityAt) > new Date(current.mergedAt || 0))) {
        latestLaneWinners.set(laneKey, {
          author,
          mergedAt: activityAt,
          pullNumber: entrant.pull_number || null,
        });
      }
    } else if (entrant.status === "pending" || entrant.status === "executing") {
      entry.openSubmissions = Math.max(entry.openSubmissions || 0, 1);
    } else {
      entry.closedSubmissions = Math.max(entry.closedSubmissions || 0, 1);
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, activityAt);
    byAuthor.set(author, entry);
  }

  return {
    ...leaderboard,
    source: `${leaderboard.source}+challenge`,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners),
  };
}

function augmentLeaderboardWithActivity(
  leaderboard,
  activity,
  identityAliases = new Map(),
  authoritativeKingByLaneKey = new Map()
) {
  const byAuthor = new Map(
    (leaderboard.rows || []).map((row) => [
      resolveAuthorAlias(row.author, identityAliases),
      { ...row, author: resolveAuthorAlias(row.author, identityAliases) },
    ])
  );
  const latestLaneWinners = new Map(Object.entries(leaderboard.latestLaneWinners || {}));
  const activityByAuthor = new Map();

  for (const item of activity || []) {
    const laneKey = item.laneId ? item.laneId.replace(":", "::") : null;
    const knownLaneWinner = item.promotionReady && laneKey ? latestLaneWinners.get(laneKey) : null;
    const author =
      knownLaneWinner?.author ||
      resolveAuthorAlias(item.candidateAuthor, identityAliases) ||
      resolveAuthorAlias(
        inferSubmissionAuthorFromId(item.candidateSubmissionId),
        identityAliases
      ) ||
      item.candidateAuthor ||
      inferSubmissionAuthorFromId(item.candidateSubmissionId) ||
      "unknown";
    const entry = activityByAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions += 1;
    if (item.promotionReady) {
      entry.wins += 1;
      if (!knownLaneWinner?.pullNumber) {
        entry.winnerPulls.push({
          pullNumber: null,
          mergedAt: item.createdAt,
          labels: item.labels || [],
        });
      }
    } else {
      entry.closedSubmissions += 1;
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, item.createdAt);
    activityByAuthor.set(author, entry);

    // "promotionReady" only means the challenge judged this candidate ready -- the
    // promotion can still be rejected afterwards (stale-king guard, held merge), leaving
    // it unmerged. Crowning from it produced a king stitched from two sources: the author
    // of the PREVIOUS real king with the losing candidate's submission id and a null PR,
    // and that null then let the king's PR fall through to the challenge winner.
    // Only the authoritative lane king, written by the promotion itself, may crown.
    const authoritativeKing = laneKey
      ? String(authoritativeKingByLaneKey.get(laneKey) || "").trim()
      : "";
    const activityIsReigningKing =
      Boolean(authoritativeKing) &&
      authoritativeKing === String(item.candidateSubmissionId || "").trim();
    if (item.promotionReady && laneKey && activityIsReigningKing) {
      const current = latestLaneWinners.get(laneKey);
      if (!current || new Date(item.createdAt) > new Date(current.mergedAt || 0)) {
        latestLaneWinners.set(laneKey, {
          ...(current || {}),
          author,
          mergedAt: item.createdAt,
          submissionId: item.candidateSubmissionId || null,
        });
      }
    }
  }

  for (const [author, activityEntry] of activityByAuthor.entries()) {
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions = Math.max(entry.totalSubmissions || 0, activityEntry.totalSubmissions);
    entry.wins = Math.max(entry.wins || 0, activityEntry.wins);
    const mergedWinnerKeys = new Set(
      (entry.winnerPulls || []).map((pull) => `${pull.pullNumber || "run"}:${pull.mergedAt}`)
    );
    entry.winnerPulls = [...(entry.winnerPulls || [])];
    for (const pull of activityEntry.winnerPulls || []) {
      const key = `${pull.pullNumber || "run"}:${pull.mergedAt}`;
      if (!mergedWinnerKeys.has(key)) {
        entry.winnerPulls.push(pull);
        mergedWinnerKeys.add(key);
      }
    }
    entry.closedSubmissions = Math.max(
      entry.closedSubmissions || 0,
      activityEntry.closedSubmissions
    );
    entry.lastActivityAt = maxDate(entry.lastActivityAt, activityEntry.lastActivityAt);
    byAuthor.set(author, entry);
  }

  return {
    ...leaderboard,
    source: activity?.length ? `${leaderboard.source}+runs` : leaderboard.source,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners),
  };
}

function buildSubmissionStatus(leaderboard, validator) {
  const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : [];
  const counts = {
    total: 0,
    open: 0,
    pending: 0,
    review: 0,
    approvedReview: Number(validator?.reviewApprovals?.count || 0),
    invalid: 0,
    executing: 0,
    stale: 0,
    hold: 0,
    losing: 0,
    winner: 0,
    closed: 0,
  };
  const pendingPulls = [];
  const reviewPulls = [];
  const holdPulls = [];
  const invalidPulls = [];

  for (const row of rows) {
    counts.total += Number(row.totalSubmissions || 0);
    counts.open += Number(row.openSubmissions || 0);
    counts.pending += Number(row.pendingSubmissions || 0);
    counts.review += Number(row.reviewSubmissions || 0);
    counts.invalid += Number(row.invalidSubmissions || 0);
    counts.executing += Number(row.executingSubmissions || 0);
    counts.stale += Number(row.staleSubmissions || 0);
    counts.hold += Number(row.holdSubmissions || 0);
    counts.losing += Number(row.losingSubmissions || 0);
    counts.winner += Number(row.winnerSubmissions || 0);
    counts.closed += Number(row.closedSubmissions || 0);

    for (const pull of row.recentPulls || []) {
      const summary = {
        author: row.author,
        pullNumber: pull.number || null,
        title: pull.title || null,
        htmlUrl: pull.htmlUrl || null,
        updatedAt: pull.updatedAt || null,
        statusLabel: pull.statusLabel || null,
      };
      if (pull.state === "open" && pull.statusLabel === "kata:pending") {
        pendingPulls.push(summary);
      } else if (pull.state === "open" && pull.statusLabel === "kata:review") {
        reviewPulls.push(summary);
      } else if (pull.state === "open" && pull.statusLabel === "kata:hold") {
        holdPulls.push(summary);
      } else if (pull.statusLabel === "kata:invalid") {
        invalidPulls.push(summary);
      }
    }
  }

  return {
    source: leaderboard?.source || "unknown",
    counts,
    pendingPulls: sortRecentSummaries(pendingPulls).slice(0, 8),
    reviewPulls: sortRecentSummaries(reviewPulls).slice(0, 8),
    holdPulls: sortRecentSummaries(holdPulls).slice(0, 8),
    invalidPulls: sortRecentSummaries(invalidPulls).slice(0, 8),
    reviewApprovals: validator?.reviewApprovals || {
      available: false,
      count: 0,
      recent: [],
    },
  };
}

function sortRecentSummaries(items) {
  return [...items].sort(
    (left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0)
  );
}

function buildOverview(lanes, activity, leaderboard, validator, submissionStatus, context = {}) {
  const laneProjectCount = lanes.reduce(
    (accumulator, lane) => accumulator + (lane.projects?.length || 0),
    0
  );
  const projectCount =
    selectedProjectCountFromChallenge(context.challenge) ||
    positiveIntegerOrNull(context.publicProof?.selectedProjectCount) ||
    laneProjectCount;
  const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : [];
  const totalSubmissions = rows.reduce(
    (total, row) => total + Number(row.totalSubmissions || 0),
    0
  );
  const totalGittensorScore = rows.reduce(
    (total, row) => total + Number(row.gittensorScore || row.score || 0),
    0
  );
  const currentWinnerGittensorScore = calculateCurrentWinnerGittensorScore(lanes, rows);

  return {
    activeSubnetPacks: new Set(lanes.map((lane) => lane.subnetPack || lane.repoPack)).size,
    activeRepoPacks: new Set(lanes.map((lane) => lane.subnetPack || lane.repoPack)).size,
    activeLanes: lanes.length,
    benchmarkProjects: projectCount,
    selectedCodebases: projectCount,
    recentChallenges: activity.length,
    recentDuels: activity.length,
    leaderboardEntries: rows.length,
    uniqueChallengers: rows.length,
    totalSubmissions,
    totalGittensorScore: Number(totalGittensorScore.toFixed(4)),
    currentWinnerGittensorScore: Number(currentWinnerGittensorScore.toFixed(4)),
    submissionPending: submissionStatus.counts.pending,
    submissionReview: submissionStatus.counts.review,
    submissionHold: submissionStatus.counts.hold,
    submissionApprovedReview: submissionStatus.counts.approvedReview,
    submissionInvalid: submissionStatus.counts.invalid,
    validatorPendingJobs: validator.queue.counts.pending,
    validatorRunningJobs: validator.queue.counts.running,
    validatorCompletedJobs: validator.queue.counts.completed,
    validatorFailedJobs: validator.queue.counts.failed,
  };
}

function selectedProjectCountFromChallenge(challenge) {
  const liveCount = positiveIntegerOrNull(challenge?.liveProgress?.projectKeys?.length);
  if (liveCount) {
    return liveCount;
  }
  const kingProjectCount = positiveIntegerOrNull(challenge?.king?.projects?.length);
  if (kingProjectCount) {
    return kingProjectCount;
  }
  const entrantProjectCounts = (Array.isArray(challenge?.entrants) ? challenge.entrants : [])
    .map((entrant) => positiveIntegerOrNull(entrant?.projects?.length))
    .filter(Boolean);
  return entrantProjectCounts.length ? Math.max(...entrantProjectCounts) : null;
}

function calculateCurrentWinnerGittensorScore(lanes, rows) {
  const rowByAuthor = new Map(rows.map((row) => [String(row.author || "").toLowerCase(), row]));
  const rowByWinnerPull = new Map();
  for (const row of rows) {
    for (const pull of row.winnerPulls || []) {
      if (pull?.pullNumber) {
        rowByWinnerPull.set(Number(pull.pullNumber), row);
      }
    }
  }

  const seenAuthors = new Set();
  let total = 0;
  for (const lane of lanes) {
    const row =
      (lane.currentHolderPullNumber
        ? rowByWinnerPull.get(Number(lane.currentHolderPullNumber))
        : null) ||
      rowByAuthor.get(String(lane.king?.author || lane.currentHolder || "").toLowerCase());
    if (!row || seenAuthors.has(row.author)) {
      continue;
    }
    seenAuthors.add(row.author);
    total += Number(row.gittensorScore || row.score || 0);
  }
  return total;
}

function buildNotes({ leaderboard, validator }) {
  const notes = [];
  if (!leaderboard.rows.length) {
    notes.push(
      "Miner leaderboard is empty because no GitHub PR history or event log is configured yet."
    );
  }
  if (!validator.queue.available) {
    notes.push(
      "Validator queue state file was not found. Configure `KATA_QUEUE_STATE_PATH` to show resident bot activity."
    );
  }
  if (validator.health.configured && !validator.health.ok) {
    notes.push(
      `Validator health check is failing: ${validator.health.error || "service returned a non-ok status"}.`
    );
  }
  return notes;
}

function loadBenchmarkExpectedCounts(filePath) {
  const payload = readJsonSafe(filePath);
  const counts = new Map();
  if (!Array.isArray(payload)) {
    return counts;
  }
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const projectKey = String(entry.project_id || entry.id || "").trim();
    if (!projectKey) {
      continue;
    }
    counts.set(projectKey, Array.isArray(entry.vulnerabilities) ? entry.vulnerabilities.length : 0);
  }
  return counts;
}

function laneKeyForLane(lane) {
  if (!lane?.subnetPack || !lane?.mode) {
    return null;
  }
  return `${lane.subnetPack}::${lane.mode}`;
}

function resolveChallengeLane(challenge, lanes, publicProof) {
  const knownLanes = Array.isArray(lanes) ? lanes : [];
  const challengeLaneId = String(challenge?.laneId || "").trim();
  if (challengeLaneId) {
    const byId = knownLanes.find((lane) => lane.laneId === challengeLaneId || lane.id === challengeLaneId);
    if (byId) {
      return byId;
    }
  }
  const activePack = String(publicProof?.activePack || "").trim();
  const activeMode = String(publicProof?.activeMode || "").trim();
  const byProof = knownLanes.find(
    (lane) => lane.subnetPack === activePack && lane.mode === activeMode
  );
  return byProof || (knownLanes.length === 1 ? knownLanes[0] : null);
}

