import assert from "node:assert/strict";
import test from "node:test";

import { calculateKataGittensorScore } from "./leaderboardRows.mjs";

test("calculates Kata score from the highest reward label and Gittensor decay", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 0,
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:winner:sn60__bitsec", "kata:reward:m"]
        }
      ]
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 2.6424);
});

test("uses the highest matching Kata reward label", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 0,
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:winner:sn60__bitsec", "kata:reward:s", "kata:reward:xl"]
        }
      ]
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 8.808);
});

test("applies Gittensor-style time decay to old winner score", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 0,
      winnerPulls: [
        {
          mergedAt: "2026-06-01T00:00:00Z",
          labels: ["kata:winner:sn60__bitsec", "kata:reward:xl"]
        }
      ]
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.ok(score < 10);
  assert.ok(score > 0);
});

test("does not count open PRs as leaderboard miner score", () => {
  const score = calculateKataGittensorScore(
    {
      openSubmissions: 2,
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:winner:sn60__bitsec", "kata:reward:xl"]
        }
      ]
    },
    new Date("2026-07-08T17:30:00Z")
  );

  assert.equal(score, 8.808);
});
