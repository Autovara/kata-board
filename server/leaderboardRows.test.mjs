import assert from "node:assert/strict";
import test from "node:test";

import { calculateKataGittensorScore } from "./leaderboardRows.mjs";

test("calculates Kata score from a subnet-qualified winner label and Gittensor decay", () => {
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

  assert.equal(score, 1.8093);
});

test("uses the subnet-qualified defeat multiplier for a dethroned king", () => {
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

  assert.equal(score, 0.1809);
});

test("resolves the subnet-specific winner tier by the highest matching multiplier", () => {
  // PR #1638: kata:winner:sn22__desearch = 3.0 (vs the 1.0 kata:winner:* base).
  const sn22 = calculateKataGittensorScore(
    {
      winnerPulls: [
        {
          mergedAt: "2026-07-08T17:30:00Z",
          labels: ["kata:winner:sn22__desearch"],
        },
      ],
    },
    new Date("2026-07-08T17:30:00Z")
  );
  assert.equal(sn22, 2.714);
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

  assert.ok(score < 1);
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

  assert.equal(score, 1.8093);
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
