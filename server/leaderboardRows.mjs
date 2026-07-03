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
    currentKings: 0,
    score: 0,
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
  return [...byAuthor.values()]
    .map((entry) => ({
      ...entry,
      currentKings: [...latestLaneWinners.values()].filter(
        (winner) => winner.author === entry.author
      ).length,
      score: entry.wins * 100 + entry.openSubmissions * 5
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.wins - left.wins ||
        right.totalSubmissions - left.totalSubmissions
    );
}
