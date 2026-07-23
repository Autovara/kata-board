import assert from "node:assert/strict";
import test from "node:test";

import { enrichPublicProofWithLiveWinner } from "./publicProof.mjs";

// Regression for the PR #195/#197 incident: PR #195 was the real merged king, but PR #197
// won the NEXT challenge and its promotion was then rejected (stale-king guard), leaving it
// unmerged. The board still crowned it, producing a currentKing assembled from two
// different kings -- right author (#195), wrong PR and submission id (#197).

const ACTIVE_LANE = {
  subnetPack: "sn60__bitsec",
  mode: "miner",
  // The authoritative lane king, written by the promotion itself.
  king: { submissionId: "bohdansolovie-20260723-08" },
};

const MERGED_KING_LEADERBOARD = {
  latestLaneWinners: {
    "sn60__bitsec::miner": {
      author: "bohdansolovie",
      mergedAt: "2026-07-23T01:24:36.684335+00:00",
      pullNumber: 195,
      submissionId: "bohdansolovie-20260723-08",
    },
  },
};

// A challenge won by a DIFFERENT submission whose promotion never landed.
const UNPROMOTED_WINNER_CHALLENGE = {
  runId: "sn60-challenge-20260723T065433Z-081c92",
  winnerSubmissionId: "pr-197",
  generatedAt: "2026-07-23T09:37:03.081209+00:00",
  finishedAt: "2026-07-23T09:37:03.081209+00:00",
  entrants: [
    {
      pull_number: 197,
      submission_id: "Dexterity104-20260723-01",
      author: "Dexterity104",
      selected_winner: true,
    },
  ],
};

test("an unmerged challenge winner cannot supply the king when merged data is incomplete", () => {
  // The exact production precondition: status.mjs had overwritten the lane's merged-winner
  // entry from the challenge, leaving pullNumber null. That null made the king's PR fall
  // through to the challenge winner, injecting the unmerged PR #197 as the king's PR.
  const proof = enrichPublicProofWithLiveWinner(
    {
      schemaVersion: 1,
      activePack: "sn60__bitsec",
      activeMode: "miner",
      currentKing: {},
      latestChallenge: {},
    },
    {
      challenge: null,
      challengeHistory: [UNPROMOTED_WINNER_CHALLENGE],
      leaderboard: {
        latestLaneWinners: {
          "sn60__bitsec::miner": {
            author: "bohdansolovie",
            mergedAt: "2026-07-23T01:24:36.684335+00:00",
            pullNumber: null,
            submissionId: null,
          },
        },
      },
      activeLane: ACTIVE_LANE,
    }
  );

  // It must NOT borrow the unmerged challenge winner's identity.
  assert.notEqual(proof.currentKing.sourcePullRequest, 197);
  assert.notEqual(proof.currentKing.submissionId, "Dexterity104-20260723-01");
});

test("an unmerged challenge winner never becomes the king", () => {
  const proof = enrichPublicProofWithLiveWinner(
    {
      schemaVersion: 1,
      activePack: "sn60__bitsec",
      activeMode: "miner",
      currentKing: {},
      latestChallenge: {},
    },
    {
      challenge: null,
      challengeHistory: [UNPROMOTED_WINNER_CHALLENGE],
      leaderboard: MERGED_KING_LEADERBOARD,
      activeLane: ACTIVE_LANE,
    }
  );

  // The king must be the merged one, as a coherent unit -- never a mix of sources.
  assert.equal(proof.currentKing.author, "bohdansolovie");
  assert.equal(proof.currentKing.sourcePullRequest, 195);
  assert.equal(proof.currentKing.submissionId, "bohdansolovie-20260723-08");
});

test("the last-challenge section reports its own winner, not the king", () => {
  const proof = enrichPublicProofWithLiveWinner(
    {
      schemaVersion: 1,
      activePack: "sn60__bitsec",
      activeMode: "miner",
      currentKing: {},
      latestChallenge: {},
    },
    {
      challenge: null,
      challengeHistory: [UNPROMOTED_WINNER_CHALLENGE],
      leaderboard: MERGED_KING_LEADERBOARD,
      activeLane: ACTIVE_LANE,
    }
  );

  assert.equal(proof.latestChallenge.winnerPullRequest, 197);
  assert.equal(proof.latestChallenge.winnerSubmissionId, "Dexterity104-20260723-01");
  assert.equal(proof.latestChallenge.winnerAuthor, "Dexterity104");
  // It won, but it is not king -- claiming "king_promoted" is what misled the dashboard.
  assert.equal(proof.latestChallenge.outcome, "winner_pending_promotion");
});

test("a challenge winner that IS the reigning king still crowns normally", () => {
  const promotedChallenge = {
    runId: "sn60-challenge-20260723T011604Z-f6f88c",
    winnerSubmissionId: "pr-195",
    generatedAt: "2026-07-23T01:23:53.538570+00:00",
    finishedAt: "2026-07-23T01:23:53.538570+00:00",
    entrants: [
      {
        pull_number: 195,
        submission_id: "bohdansolovie-20260723-08",
        author: "bohdansolovie",
        selected_winner: true,
      },
    ],
  };

  const proof = enrichPublicProofWithLiveWinner(
    {
      schemaVersion: 1,
      activePack: "sn60__bitsec",
      activeMode: "miner",
      currentKing: {},
      latestChallenge: {},
    },
    {
      challenge: null,
      challengeHistory: [promotedChallenge],
      leaderboard: MERGED_KING_LEADERBOARD,
      activeLane: ACTIVE_LANE,
    }
  );

  assert.equal(proof.currentKing.sourcePullRequest, 195);
  assert.equal(proof.currentKing.submissionId, "bohdansolovie-20260723-08");
  assert.equal(proof.latestChallenge.outcome, "king_promoted");
});
