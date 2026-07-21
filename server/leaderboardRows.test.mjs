import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateKataGittensorScore,
  createAuthorRow,
  finalizeLeaderboardRows,
} from "./leaderboardRows.mjs";

test("calculates Kata score from a subnet-qualified winner label and Gittensor decay", () => {
  // PR #1644: the reigning king (kata:winner) earns the 0.70 window multiplier.
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 0,
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:winner:sn60__bitsec"],
        },
      ],
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 0.6333);
});

test("scores a runner-up king still in the reward window (king2/king3/king4)", () => {
  const at = new Date("2026-07-08T17:30:00Z");
  const scoreFor = (tier) =>
    calculateKataGittensorScore(
      {
        winnerPulls: [
          {
            mergedAt: "2026-07-08T17:30:00Z",
            labels: [`kata:${tier}:sn60__bitsec`],
          },
        ],
      },
      at
    );

  // king2/king3/king4 each carry the same 0.10 window multiplier.
  assert.equal(scoreFor("king2"), 0.0905);
  assert.equal(scoreFor("king3"), 0.0905);
  assert.equal(scoreFor("king4"), 0.0905);
});

test("gives a king that fell out of the window (kata:defeat) no reward", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 0,
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:defeat:sn60__bitsec"],
        },
      ],
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 0);
});

test("resolves overlapping reward labels by the highest matching multiplier", () => {
  // A PR carrying both a runner-up and a fell-out label resolves to the higher
  // tier (king2 0.10 over defeat 0.0).
  const score = calculateKataGittensorScore(
    {
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:defeat:sn60__bitsec", "kata:king2:sn60__bitsec"],
        },
      ],
    },
    new Date("2026-07-08T17:30:00Z")
  );
  assert.equal(score, 0.0905);
});

test("applies Gittensor-style time decay to old winner score", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 0,
      winnerPulls: [
        {
          mergedAt: "2026-06-01T00:00:00Z",
          labels: ["kata:winner:sn60__bitsec"],
        },
      ],
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.ok(score < 0.7);
  assert.ok(score > 0);
});

test("does not count open PRs as leaderboard miner score", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 2,
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:winner:sn60__bitsec"],
        },
      ],
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 0.6333);
});

test("normalizes pool share across active kings so empty tiers redistribute", () => {
  const mergedAt = "2026-07-08T17:30:00Z";
  const byAuthor = new Map();
  const winner = createAuthorRow("Dexterity104");
  winner.wins = 1;
  winner.winnerPulls = [{ mergedAt, labels: ["kata:winner:sn60__bitsec"] }];
  const king2 = createAuthorRow("jimcody1995");
  king2.wins = 1;
  king2.winnerPulls = [{ mergedAt, labels: ["kata:king2:sn60__bitsec"] }];
  const idle = createAuthorRow("nobody");
  byAuthor.set(winner.author, winner);
  byAuthor.set(king2.author, king2);
  byAuthor.set(idle.author, idle);

  const rows = finalizeLeaderboardRows(byAuthor, new Map());
  const share = (author) => rows.find((row) => row.author === author).poolShare;

  // Raw weights 0.70 : 0.10 -> the whole kata pool splits 87.5% / 12.5% between
  // the two active kings; the empty king3/king4 tiers are not lost.
  assert.equal(share("Dexterity104"), 0.875);
  assert.equal(share("jimcody1995"), 0.125);
  assert.equal(share("nobody"), 0);
  const activeTotal = share("Dexterity104") + share("jimcody1995");
  assert.ok(Math.abs(activeTotal - 1) < 1e-9);
});

test("does not award a score when a reconstructed winner has no trusted Kata label", () => {
  const score = calculateKataGittensorScore(
    {
      winnerPulls: [{ mergedAt: "2026-07-08T17:30:00Z", labels: [] }],
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 0);
});
