const SUBMISSION_PATH_PATTERN =
  /^submissions\/([^/]+)\/([^/]+)\/([^/]+)\//;

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
    const touchedSubmissions = await fetchSubmissionFiles(
      repoSlug,
      pull.number,
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
      laneKeys,
      submissionPaths: touchedSubmissions
    });
  }

  const byAuthor = new Map();
  const latestLaneWinners = new Map();

  for (const pull of relevantPulls) {
    const entry = byAuthor.get(pull.author) || createAuthorRow(pull.author);
    entry.totalSubmissions += 1;
    if (pull.state === "open") {
      entry.openSubmissions += 1;
    } else if (pull.mergedAt) {
      entry.wins += 1;
    } else {
      entry.closedSubmissions += 1;
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, pull.updatedAt);
    entry.recentPulls.unshift({
      number: pull.number,
      title: pull.title,
      htmlUrl: pull.htmlUrl,
      state: pull.mergedAt ? "merged" : pull.state,
      updatedAt: pull.updatedAt
    });
    entry.recentPulls = entry.recentPulls.slice(0, 4);
    byAuthor.set(pull.author, entry);

    if (pull.mergedAt) {
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

  const rows = [...byAuthor.values()]
    .map((entry) => ({
      ...entry,
      currentFrontiers: [...latestLaneWinners.entries()].filter(
        ([, lane]) => lane.author === entry.author
      ).length,
      score:
        entry.wins * 100 +
        entry.currentFrontiers * 30 +
        entry.openSubmissions * 5
    }))
    .sort((left, right) => {
      return (
        right.score - left.score ||
        right.wins - left.wins ||
        right.currentFrontiers - left.currentFrontiers ||
        right.totalSubmissions - left.totalSubmissions
      );
    });

  return {
    source: "github",
    rows,
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function emptyLeaderboard(source) {
  return {
    source,
    rows: [],
    latestLaneWinners: {}
  };
}

function createAuthorRow(author) {
  return {
    author,
    wins: 0,
    totalSubmissions: 0,
    openSubmissions: 0,
    closedSubmissions: 0,
    currentFrontiers: 0,
    score: 0,
    lastActivityAt: null,
    recentPulls: []
  };
}

function maxDate(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return new Date(left) > new Date(right) ? left : right;
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

async function githubRequest(path, githubToken) {
  const headers = {
    "User-Agent": "kata-board",
    Accept: "application/vnd.github+json"
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(`https://api.github.com${path}`, {
    headers
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
