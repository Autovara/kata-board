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
    .map((entry) => ({
      ...entry,
      currentKings: [...latestLaneWinners.values()].filter(
        (winner) => winner.author === entry.author
      ).length,
      gittensorBaseScore: entry.wins,
      gittensorScore: calculateGittensorWinnerScore(entry.winnerPulls, now),
      score: calculateGittensorWinnerScore(entry.winnerPulls, now)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.wins - left.wins ||
        right.totalSubmissions - left.totalSubmissions
    );
}

function calculateGittensorWinnerScore(winnerPulls, now) {
  const pulls = Array.isArray(winnerPulls) ? winnerPulls : [];
  return Number(
    pulls
      .reduce((total, pull) => total + calculateTimeDecayMultiplier(pull.mergedAt, now), 0)
      .toFixed(4)
  );
}

function calculateTimeDecayMultiplier(mergedAt, now) {
  const mergedTime = new Date(mergedAt || 0).getTime();
  if (!Number.isFinite(mergedTime) || mergedTime <= 0) {
    return 1;
  }
  const hoursSinceMerge = Math.max(0, (now.getTime() - mergedTime) / 3_600_000);
  const gracePeriodHours = 12;
  if (hoursSinceMerge < gracePeriodHours) {
    return 1;
  }
  const daysSinceMerge = hoursSinceMerge / 24;
  const sigmoidMidpointDays = 10;
  const sigmoidSteepness = 0.4;
  const minMultiplier = 0.05;
  const sigmoid =
    1 / (1 + Math.exp(sigmoidSteepness * (daysSinceMerge - sigmoidMidpointDays)));
  return Math.max(sigmoid, minMultiplier);
}
