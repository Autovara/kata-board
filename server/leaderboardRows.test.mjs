import assert from "node:assert/strict";
import test from "node:test";

import { calculateKataGittensorScore } from "./leaderboardRows.mjs";

test("calculates stable Kata score from the highest reward label", () => {
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

  assert.equal(score, 3);
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

  assert.equal(score, 10);
});

test("keeps winner score stable instead of decaying by age", () => {
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

  assert.equal(score, 10);
});

test("open PR count does not erase a verified winner score", () => {
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

  assert.equal(score, 10);
});
