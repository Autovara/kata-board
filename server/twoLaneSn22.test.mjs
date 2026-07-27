// SN22-8/SN22-10: the board must show a second lane only once it is publicly activated.
//
// "Installed" and "publicly live" are different states, and conflating them is how a lane goes live
// by accident. SN22 is installed with `active: false` in both the lane registry and its own
// lane.json; the final go-live step flips it. Two failure modes bracket that:
//
//   * the board shows SN22 before its canary passed -- a lane advertised as competing when its
//     timer is still disabled and it has never run a paid round;
//   * flipping SN22 on disturbs SN60 -- the incumbent's rendering must be byte-identical either
//     way, because activating one lane is not a change to the other.
//
// The generic "two lanes read their own files" property lives in boardStateRoot.test.mjs. This
// covers the ACTIVATION gate and the SN22/SN60 pair specifically.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEvaluatorLanes } from "./evaluator.mjs";

const SN60 = "sn60__bitsec";
const SN22 = "sn22__desearch";

function writeJson(dir, name, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2) + "\n");
}

// Exactly the shape installer/generate_lane_artifacts.py emits, so a change to the generator that
// broke the board would fail here rather than on the production dashboard.
function laneRecord(laneId, evaluatorId, active) {
  return {
    schema_version: 1,
    lane_id: laneId,
    repo_pack: laneId,
    mode: "miner",
    evaluator_id: evaluatorId,
    evaluator_policy_version: "v1",
    active,
  };
}

function makeKataRoot({ sn22Active }) {
  const kataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-sn22-"));
  writeJson(path.join(kataRoot, "lanes"), "registry.json", {
    schema_version: 1,
    packs: [
      {
        lane_id: SN22,
        repo_pack: SN22,
        mode: "miner",
        evaluator_id: "sn22_desearch",
        active: sn22Active,
      },
      { lane_id: SN60, repo_pack: SN60, mode: "miner", evaluator_id: "sn60_bitsec", active: true },
    ],
  });

  writeJson(path.join(kataRoot, "lanes", SN60), "lane.json", laneRecord(SN60, "sn60_bitsec", true));
  writeJson(path.join(kataRoot, "lanes", SN60), "king.json", {
    current_king_submission_id: "pr-195",
    current_king_artifact_hash: "sha60",
    promotion_source_pr: "195",
  });

  writeJson(
    path.join(kataRoot, "lanes", SN22),
    "lane.json",
    laneRecord(SN22, "sn22_desearch", sn22Active)
  );
  writeJson(path.join(kataRoot, "lanes", SN22), "king.json", {
    current_king_submission_id: "pr-7",
    current_king_artifact_hash: "sha22",
    promotion_source_pr: "7",
    seeded: true,
  });
  return kataRoot;
}

function laneIds(lanes) {
  return lanes.map((lane) => lane.laneId || lane.subnetPack).sort();
}

// --- before go-live: installed, not published ------------------------------------------------

test("an installed but inactive SN22 does not appear on the board", () => {
  const kataRoot = makeKataRoot({ sn22Active: false });
  const lanes = loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} });
  assert.deepEqual(laneIds(lanes), [SN60]);
});

test("its state is on disk and complete -- it is the ACTIVE flag alone that withholds it", () => {
  // Otherwise this test would pass for the wrong reason: a lane absent because its files are
  // missing proves nothing about the activation gate.
  const kataRoot = makeKataRoot({ sn22Active: false });
  const laneFile = path.join(kataRoot, "lanes", SN22, "lane.json");
  const kingFile = path.join(kataRoot, "lanes", SN22, "king.json");
  assert.ok(fs.existsSync(laneFile) && fs.existsSync(kingFile));
  assert.equal(JSON.parse(fs.readFileSync(kingFile, "utf8")).current_king_submission_id, "pr-7");
  assert.equal(JSON.parse(fs.readFileSync(laneFile, "utf8")).active, false);
});

test("the incumbent is unaffected by the presence of an inactive neighbour", () => {
  const kataRoot = makeKataRoot({ sn22Active: false });
  const [sn60] = loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} });
  assert.equal(sn60.king.submissionId, "pr-195");
  assert.equal(sn60.king.artifactHash, "sha60");
});

// --- after go-live: both lanes, each from its own files ---------------------------------------

test("activating SN22 publishes it alongside SN60", () => {
  const kataRoot = makeKataRoot({ sn22Active: true });
  const lanes = loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} });
  assert.deepEqual(laneIds(lanes), [SN22, SN60]);
});

test("each lane renders its OWN king, never the neighbour's", () => {
  const kataRoot = makeKataRoot({ sn22Active: true });
  const byId = Object.fromEntries(
    loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} }).map((lane) => [lane.laneId, lane])
  );
  assert.equal(byId[SN60].king.submissionId, "pr-195");
  assert.equal(byId[SN60].king.artifactHash, "sha60");
  assert.equal(byId[SN22].king.submissionId, "pr-7");
  assert.equal(byId[SN22].king.artifactHash, "sha22");
});

test("activating SN22 leaves SN60's rendering byte-identical", () => {
  // The activation acceptance checklist requires the board to show SN22 "without altering SN60".
  const before = loadEvaluatorLanes({
    kataRoot: makeKataRoot({ sn22Active: false }),
    latestLaneWinners: {},
  }).find((lane) => lane.laneId === SN60);
  const after = loadEvaluatorLanes({
    kataRoot: makeKataRoot({ sn22Active: true }),
    latestLaneWinners: {},
  }).find((lane) => (lane.laneId === SN22 ? false : lane.laneId === SN60));

  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)));
});

test("each lane's evaluator id comes from its own record", () => {
  const kataRoot = makeKataRoot({ sn22Active: true });
  const lanes = loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} });
  const evaluators = lanes.map((lane) => lane.evaluatorId || lane.evaluator_id).filter(Boolean);
  if (evaluators.length) {
    assert.equal(new Set(evaluators).size, evaluators.length);
  }
});

// --- the gate is per lane, not global -----------------------------------------------------------

test("a registry entry alone is not enough: the lane's own record must agree", () => {
  // Two files declare activation, and the board requires both. A half-flipped activation -- the
  // registry updated, the lane record not -- must fail closed rather than publish a lane whose own
  // state says it is not live.
  const kataRoot = makeKataRoot({ sn22Active: false });
  const registry = path.join(kataRoot, "lanes", "registry.json");
  const document = JSON.parse(fs.readFileSync(registry, "utf8"));
  document.packs = document.packs.map((pack) =>
    pack.lane_id === SN22 ? { ...pack, active: true } : pack
  );
  fs.writeFileSync(registry, JSON.stringify(document, null, 2) + "\n");

  const lanes = loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} });
  assert.deepEqual(laneIds(lanes), [SN60]);
});

test("a lane with no state directory is skipped, not rendered empty", () => {
  const kataRoot = makeKataRoot({ sn22Active: true });
  fs.rmSync(path.join(kataRoot, "lanes", SN22), { recursive: true, force: true });
  assert.deepEqual(laneIds(loadEvaluatorLanes({ kataRoot, latestLaneWinners: {} })), [SN60]);
});
