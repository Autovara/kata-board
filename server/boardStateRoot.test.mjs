// S1d: the board's bot-state contract.
//
// Before this, `buildByLane` short-circuited on a single lane and returned the globally loaded
// fields, which came from root paths derived from KATA_QUEUE_STATE_PATH. A one-lane board therefore
// read `state/challenge-status.json`, not `state/<laneId>/`. The moment S1e moves that state, the
// old root files still exist and are frozen -- so the dashboard would have shown a stale challenge
// and history with no error at all. These tests pin the lane-only contract.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertBoardStateRoot, buildByLane } from "./status.mjs";
import { refreshByLaneChallengeProgress } from "./challengeProgress.mjs";

const LANE_A = "sn60__bitsec";
const LANE_B = "sn126__poker44";

function writeJson(dir, name, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2) + "\n");
}

function makeRoots() {
  const kataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-s1d-"));
  return { kataRoot, stateRoot: path.join(kataRoot, "state") };
}

function laneOf(laneId) {
  return { id: `${laneId}:miner`, laneId, subnetPack: laneId };
}

// --- the state root is validated, never sniffed --------------------------------------------

test("a state root that IS a lane directory is rejected", () => {
  assert.throws(
    () => assertBoardStateRoot("/srv/kata-bot/state/sn60__bitsec", [LANE_A, LANE_B]),
    /must be the directory CONTAINING lane directories/
  );
});

test("the intended default is accepted even though it holds a top-level queue.json", () => {
  // `/srv/kata-bot/state` legitimately contains queue.json today, and pre-migration files may be
  // kept deliberately for rollback -- so the directory's ROLE must not be inferred from its files.
  const { stateRoot } = makeRoots();
  writeJson(stateRoot, "queue.json", { schema_version: 1, jobs: [] });
  assert.equal(assertBoardStateRoot(stateRoot, [LANE_A]), path.resolve(stateRoot));
});

test("a trailing separator does not defeat the lane-directory check", () => {
  assert.throws(() => assertBoardStateRoot("/srv/kata-bot/state/sn60__bitsec/", [LANE_A]), /lane/);
});

// --- contradictory sentinels: lane state wins, for ONE lane and for many --------------------

test("with one lane, the lane's state is rendered at top level and under byLane", () => {
  const { kataRoot, stateRoot } = makeRoots();
  // Contradictory sentinels: the root file is what the old code would have shown.
  writeJson(stateRoot, "challenge-status.json", { run_id: "ROOT-MUST-NOT-BE-READ" });
  writeJson(path.join(stateRoot, LANE_A), "challenge-status.json", { run_id: "LANE-VALUE" });

  const laneChallenge = { runId: "LANE-VALUE" };
  const byLane = buildByLane(
    [laneOf(LANE_A)],
    { challenge: laneChallenge, challengeHistory: [], publicProof: null },
    { kataRoot, stateDir: stateRoot, env: {}, primaryLaneId: LANE_A }
  );

  // The single lane reuses the enriched object BY REFERENCE, so top level and byLane cannot drift.
  assert.strictEqual(byLane[`${LANE_A}:miner`].challenge, laneChallenge);
  assert.equal(byLane[`${LANE_A}:miner`].challenge.runId, "LANE-VALUE");
});

test("with two lanes, each reads only its own state", () => {
  const { kataRoot, stateRoot } = makeRoots();
  writeJson(stateRoot, "challenge-status.json", { run_id: "ROOT-MUST-NOT-BE-READ" });
  writeJson(path.join(stateRoot, LANE_A), "challenge-status.json", {
    run_id: "A-RUN",
    state: "completed",
  });
  writeJson(path.join(stateRoot, LANE_B), "challenge-status.json", {
    run_id: "B-RUN",
    state: "completed",
  });

  const byLane = buildByLane(
    [laneOf(LANE_A), laneOf(LANE_B)],
    { challenge: { runId: "A-RUN" }, challengeHistory: [], publicProof: null },
    { kataRoot, stateDir: stateRoot, env: {}, primaryLaneId: LANE_A }
  );

  assert.equal(byLane[`${LANE_A}:miner`].challenge.runId, "A-RUN");
  assert.equal(byLane[`${LANE_B}:miner`].challenge.runId, "B-RUN");
});

test("an absent lane file renders as missing, never as stale root state", () => {
  const { kataRoot, stateRoot } = makeRoots();
  writeJson(stateRoot, "challenge-status.json", { run_id: "ROOT-MUST-NOT-BE-READ" });
  // LANE_B has no state directory at all.
  const byLane = buildByLane(
    [laneOf(LANE_A), laneOf(LANE_B)],
    { challenge: null, challengeHistory: [], publicProof: null },
    { kataRoot, stateDir: stateRoot, env: {}, primaryLaneId: LANE_A }
  );

  assert.equal(byLane[`${LANE_B}:miner`].challenge, null);
});

// --- cache-hit progress refresh is lane-scoped too ------------------------------------------

test("a cache-hit progress refresh reads the lane's progress, not the root's", () => {
  const { kataRoot, stateRoot } = makeRoots();
  writeJson(stateRoot, "challenge-progress.json", { state: "executing", run_id: "ROOT-PROGRESS" });
  writeJson(path.join(stateRoot, LANE_A), "challenge-progress.json", {
    state: "executing",
    run_id: "LANE-PROGRESS",
  });

  const challenge = { liveProgress: { runId: "STALE" } };
  const status = {
    challenge,
    lanes: [laneOf(LANE_A)],
    byLane: { [`${LANE_A}:miner`]: { challenge } },
  };

  refreshByLaneChallengeProgress(status, { boardStateRoot: stateRoot, kataRoot }, {});

  assert.equal(status.challenge.liveProgress.runId, "LANE-PROGRESS");
  // ...and the alias is intact, so the top level and byLane still cannot drift apart.
  assert.strictEqual(status.byLane[`${LANE_A}:miner`].challenge, status.challenge);
});

test("a cache-hit refresh keeps each of two lanes on its own progress file", () => {
  const { kataRoot, stateRoot } = makeRoots();
  writeJson(path.join(stateRoot, LANE_A), "challenge-progress.json", {
    state: "executing",
    run_id: "A-PROGRESS",
  });
  writeJson(path.join(stateRoot, LANE_B), "challenge-progress.json", {
    state: "executing",
    run_id: "B-PROGRESS",
  });

  const status = {
    challenge: null,
    lanes: [laneOf(LANE_A), laneOf(LANE_B)],
    byLane: {
      [`${LANE_A}:miner`]: { challenge: { liveProgress: { runId: "STALE" } } },
      [`${LANE_B}:miner`]: { challenge: { liveProgress: { runId: "STALE" } } },
    },
  };

  refreshByLaneChallengeProgress(status, { boardStateRoot: stateRoot, kataRoot }, {});

  assert.equal(status.byLane[`${LANE_A}:miner`].challenge.liveProgress.runId, "A-PROGRESS");
  assert.equal(status.byLane[`${LANE_B}:miner`].challenge.liveProgress.runId, "B-PROGRESS");
});

// --- the stale-challenge alias --------------------------------------------------------------

test("a cache-hit refresh of a STALE one-lane challenge keeps top level and byLane identical", () => {
  // The staleness guard returns a NEW paused object. Guarding the top level separately from the
  // lane entry therefore SPLIT the alias: top level went paused while byLane kept the old
  // executing object, so a lane-aware UI carried on animating a phantom challenge.
  const { kataRoot, stateRoot } = makeRoots();
  writeJson(path.join(stateRoot, LANE_A), "challenge-progress.json", {
    state: "executing",
    run_id: "r1",
    updated_at: "2020-01-01T00:00:00Z", // long past the staleness window
  });

  const challenge = {
    state: "executing",
    generatedAt: "2020-01-01T00:00:00Z",
    liveProgress: {},
  };
  const status = {
    challenge,
    lanes: [laneOf(LANE_A)],
    byLane: { [`${LANE_A}:miner`]: { challenge } },
  };

  refreshByLaneChallengeProgress(status, { boardStateRoot: stateRoot, kataRoot }, {});

  assert.equal(status.challenge.state, "paused");
  assert.equal(status.byLane[`${LANE_A}:miner`].challenge.state, "paused");
  assert.equal(status.challenge.stale, true);
  assert.strictEqual(status.byLane[`${LANE_A}:miner`].challenge, status.challenge);
});

test("a stale NON-primary lane is paused without disturbing the primary lane's object", () => {
  const { kataRoot, stateRoot } = makeRoots();
  writeJson(path.join(stateRoot, LANE_A), "challenge-progress.json", {
    state: "executing",
    run_id: "fresh",
    updated_at: new Date().toISOString(),
  });
  writeJson(path.join(stateRoot, LANE_B), "challenge-progress.json", {
    state: "executing",
    run_id: "old",
    updated_at: "2020-01-01T00:00:00Z",
  });

  const primary = { state: "executing", generatedAt: new Date().toISOString(), liveProgress: {} };
  const status = {
    challenge: primary,
    lanes: [laneOf(LANE_A), laneOf(LANE_B)],
    byLane: {
      [`${LANE_A}:miner`]: { challenge: primary },
      [`${LANE_B}:miner`]: {
        challenge: { state: "executing", generatedAt: "2020-01-01T00:00:00Z", liveProgress: {} },
      },
    },
  };

  refreshByLaneChallengeProgress(status, { boardStateRoot: stateRoot, kataRoot }, {});

  assert.equal(status.challenge.state, "executing");
  assert.strictEqual(status.byLane[`${LANE_A}:miner`].challenge, status.challenge);
  assert.equal(status.byLane[`${LANE_B}:miner`].challenge.state, "paused");
});
