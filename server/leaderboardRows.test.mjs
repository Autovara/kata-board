import assert from "node:assert/strict";
import test from "node:test";

import { calculateKataGittensorScore } from "./leaderboardRows.mjs";

test("calculates Kata Gittensor score from reward label and repo time decay", () => {
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

  assert.equal(score, 2.64);
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

  assert.equal(score, 8.8);
});

test("drops Kata Gittensor score outside the configured PR lookback", () => {
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

  assert.equal(score, 0);
});

test("applies Kata open PR spam gate to winner score", () => {
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

  assert.equal(score, 0);
});
