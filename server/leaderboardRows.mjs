// Shared leaderboard row shaping for both sources (GitHub PR scan and the
// kata-bot event log). Keeping the row shape, score formula, and ordering in
// one place stops the two pipelines drifting apart.

export function createAuthorRow(author) {
  return {
    author,
    wins: 0,
    totalSubmissions: 0,
    openSubmissions: 0,
    closedSubmissions: 0,
    pendingSubmissions: 0,
    reviewSubmissions: 0,
    invalidSubmissions: 0,
    executingSubmissions: 0,
    staleSubmissions: 0,
    holdSubmissions: 0,
    losingSubmissions: 0,
    winnerSubmissions: 0,
    currentKings: 0,
    score: 0,
    gittensorBaseScore: 0,
    gittensorScore: 0,
    winnerPulls: [],
    lastActivityAt: null,
    recentPulls: []
  };
}

export function maxDate(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return new Date(left) > new Date(right) ? left : right;
}

export function finalizeLeaderboardRows(byAuthor, latestLaneWinners) {
  const now = new Date();
  return [...byAuthor.values()]
    .map((entry) => {
      const gittensorScore = calculateKataGittensorScore(entry, now);
      return {
        ...entry,
        currentKings: [...latestLaneWinners.values()].filter(
          (winner) => winner.author === entry.author
        ).length,
        gittensorBaseScore: entry.wins,
        gittensorScore,
        score: gittensorScore
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.wins - left.wins ||
        right.totalSubmissions - left.totalSubmissions
    );
}

const KATA_GITTENSOR_CONFIG = {
  fixedBaseScore: 1.0,
  prLookbackDays: 14,
  maxOpenPrThreshold: 1,
  defaultLabelMultiplier: 0.0,
  labelMultipliers: {
    "kata:winner:*": 1.0,
    "kata:reward:xl": 10.0,
    "kata:reward:l": 5.0,
    "kata:reward:m": 3.0,
    "kata:reward:s": 1.5,
    "kata:invalid": 0.0,
    "kata:losing": 0.0,
    "kata:stale": 0.0,
    "kata:hold": 0.0,
    "kata:evaluating": 0.0
  },
  timeDecay: {
    gracePeriodHours: 0,
    sigmoidMidpointDays: 2,
    sigmoidSteepness: 1.0,
    minMultiplier: 0.05
  }
};

export function calculateKataGittensorScore(entry, now = new Date()) {
  const pulls = Array.isArray(entry?.winnerPulls) ? entry.winnerPulls : [];
  const openPrSpamMultiplier =
    Number(entry?.openSubmissions || 0) <= KATA_GITTENSOR_CONFIG.maxOpenPrThreshold
      ? 1.0
      : 0.0;
  return Number(
    pulls
      .reduce(
        (total, pull) =>
          total + calculateKataWinnerPullScore(pull, now) * openPrSpamMultiplier,
        0
      )
      .toFixed(4)
  );
}

function calculateKataWinnerPullScore(pull, now) {
  const labelMultiplier = resolveKataLabelMultiplier(pull?.labels);
  if (labelMultiplier <= 0) {
    return 0;
  }
  const timeDecayMultiplier = calculateTimeDecayMultiplier(pull?.mergedAt, now);
  return KATA_GITTENSOR_CONFIG.fixedBaseScore * labelMultiplier * timeDecayMultiplier;
}

function resolveKataLabelMultiplier(labels) {
  const normalized = normalizeLabelNames(labels);
  const candidateLabels = normalized.length ? normalized : ["kata:winner:sn60__bitsec"];
  const candidates = [];
  for (const label of candidateLabels) {
    for (const [pattern, multiplier] of Object.entries(
      KATA_GITTENSOR_CONFIG.labelMultipliers
    )) {
      if (labelMatchesPattern(label, pattern)) {
        candidates.push([label, multiplier]);
      }
    }
  }
  if (!candidates.length) {
    return KATA_GITTENSOR_CONFIG.defaultLabelMultiplier;
  }
  candidates.sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]));
  return candidates[0][1];
}

function normalizeLabelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => String(label?.name || label || "").trim().toLowerCase())
    .filter(Boolean);
}

function labelMatchesPattern(label, pattern) {
  const escaped = String(pattern || "")
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(String(label || "").toLowerCase());
}

function calculateTimeDecayMultiplier(mergedAt, now) {
  const mergedTime = new Date(mergedAt || 0).getTime();
  if (!Number.isFinite(mergedTime) || mergedTime <= 0) {
    return 0;
  }
  const hoursSinceMerge = Math.max(0, (now.getTime() - mergedTime) / 3_600_000);
  const ageDays = hoursSinceMerge / 24;
  if (ageDays > KATA_GITTENSOR_CONFIG.prLookbackDays) {
    return 0;
  }
  if (hoursSinceMerge < KATA_GITTENSOR_CONFIG.timeDecay.gracePeriodHours) {
    return 1;
  }
  const sigmoid =
    1 /
    (1 +
      Math.exp(
        KATA_GITTENSOR_CONFIG.timeDecay.sigmoidSteepness *
          (ageDays - KATA_GITTENSOR_CONFIG.timeDecay.sigmoidMidpointDays)
      ));
  return Number(
    Math.max(sigmoid, KATA_GITTENSOR_CONFIG.timeDecay.minMultiplier).toFixed(2)
  );
}
