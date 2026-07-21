import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadChallengeStatus } from "./challengeProgress.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-reign-"));
}

function writeStatus(dir, kingHash) {
  const p = path.join(dir, "challenge-status.json");
  fs.writeFileSync(
    p,
    JSON.stringify({
      state: "executing",
      king: { submission_id: "king-1", artifact_hash: kingHash },
      entrants: [],
    })
  );
  return p;
}

function writeLedger(dir, kingHash, records) {
  fs.writeFileSync(
    path.join(dir, "king-rank-ledger.json"),
    JSON.stringify({ king_hash: kingHash, records })
  );
}

const RECORDS = [
  { pass_score: 0, codebase_pass_count: 0, true_positives: 3, invalid_runs: 0, precision: 0.05, f1_score: 0.06 },
];

test("loadChallengeStatus exposes reign records when the ledger is for this king", () => {
  const dir = tmpDir();
  const statusPath = writeStatus(dir, "king-hash-1");
  writeLedger(dir, "king-hash-1", RECORDS);

  const challenge = loadChallengeStatus(statusPath);

  assert.deepEqual(challenge.kingReignRecords, RECORDS);
});

test("loadChallengeStatus hides reign records when the ledger is for a different king", () => {
  const dir = tmpDir();
  const statusPath = writeStatus(dir, "king-hash-1");
  writeLedger(dir, "old-king-hash", RECORDS); // ledger not yet reset to the current king

  const challenge = loadChallengeStatus(statusPath);

  assert.deepEqual(challenge.kingReignRecords, []);
});

test("loadChallengeStatus returns no reign records when the ledger is missing", () => {
  const dir = tmpDir();
  const statusPath = writeStatus(dir, "king-hash-1");

  const challenge = loadChallengeStatus(statusPath);

  assert.deepEqual(challenge.kingReignRecords, []);
});
