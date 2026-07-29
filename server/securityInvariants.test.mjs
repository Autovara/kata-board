// Board security invariants, stated as named properties.
//
// The board is read-only, so "security" here means two things: it must not advertise a lane that
// has not been activated, and it must never show one lane's state under another lane's name. Both
// fail SILENTLY -- as a lane appearing early, or as a duel rendered against the wrong king -- so
// neither is caught by anything that only checks the page renders.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEvaluatorLanes } from "./evaluator.mjs";
import { loadBoardStatus } from "./status.mjs";

function writeJson(dir, name, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2) + "\n");
}

function laneRecord(laneId, evaluatorId, active) {
  return {
    schema_version: 1, lane_id: laneId, repo_pack: laneId, mode: "miner",
    evaluator_id: evaluatorId, evaluator_policy_version: "v1", active,
  };
}

function makeRoot(lanes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-sec-"));
  const lanesRoot = path.join(root, "lanes");
  writeJson(lanesRoot, "registry.json", {
    schema_version: 1,
    packs: lanes.map(([id, ev, active]) => ({
      lane_id: id, repo_pack: id, mode: "miner", evaluator_id: ev, active,
    })),
  });
  for (const [id, ev, active] of lanes) {
    writeJson(path.join(lanesRoot, id), "lane.json", laneRecord(id, ev, active));
  }
  return root;
}

function boardEnv(root) {
  return {
    KATA_ROOT: root,
    KATA_BOT_ROOT: path.join(root, "no-bot"),
    KATA_QUEUE_STATE_PATH: path.join(root, "no-bot", "queue.json"),
    KATA_BOARD_STATE_ROOT: path.join(root, "bot-state"),
    KATA_STATUS_CACHE_TTL_MS: "0",
  };
}

// ---- INVARIANT: an inactive lane is invisible ---

test("a lane marked inactive never appears in the payload", async () => {
  // Installed and publicly live are different states. Conflating them is how a lane goes live by
  // accident -- advertised as competing while its timer is still disabled.
  const root = makeRoot([["sn22__desearch", "sn22_desearch", false],
                         ["sn60__bitsec", "sn60_bitsec", true]]);
  const status = await loadBoardStatus(boardEnv(root));
  const ids = status.lanes.map((lane) => lane.id);
  assert.ok(!ids.some((id) => id.startsWith("sn22")), `inactive lane leaked: ${ids}`);
  assert.ok(ids.some((id) => id.startsWith("sn60")), "the active lane must still show");
});

test("activating a lane does not disturb the other one", async () => {
  // Activating one lane is not a change to the other; if it were, going live with SN22 would be a
  // change to SN60's public record.
  const off = await loadBoardStatus(boardEnv(makeRoot(
    [["sn22__desearch", "sn22_desearch", false], ["sn60__bitsec", "sn60_bitsec", true]])));
  const sn60Off = off.lanes.find((lane) => lane.id.startsWith("sn60"));
  const on = await loadBoardStatus(boardEnv(makeRoot(
    [["sn22__desearch", "sn22_desearch", true], ["sn60__bitsec", "sn60_bitsec", true]])));
  const sn60On = on.lanes.find((lane) => lane.id.startsWith("sn60"));
  assert.deepEqual(sn60On.subnetPack, sn60Off.subnetPack);
  assert.deepEqual(sn60On.mode, sn60Off.mode);
});

// ---- INVARIANT: one lane never reads another lane's state ---

test("each lane's competition data comes from its own lane-scoped directory", async () => {
  const root = makeRoot([["sn22__desearch", "sn22_desearch", true],
                         ["sn60__bitsec", "sn60_bitsec", true]]);
  const stateRoot = path.join(root, "bot-state");
  writeJson(path.join(stateRoot, "sn22__desearch"), "challenge-history.json",
            { challenges: [{ run_id: "sn22-only" }] });
  writeJson(path.join(stateRoot, "sn60__bitsec"), "challenge-history.json",
            { challenges: [{ run_id: "sn60-only" }, { run_id: "sn60-second" }] });

  const status = await loadBoardStatus(boardEnv(root));
  const sn22 = status.byLane["sn22__desearch:miner"];
  const sn60 = status.byLane["sn60__bitsec:miner"];
  assert.equal(sn22.challengeHistory.length, 1, "SN22 read someone else's history");
  assert.equal(sn60.challengeHistory.length, 2, "SN60 read someone else's history");
  assert.equal(sn22.challengeHistory[0].runId, "sn22-only");
});

test("a lane with no state of its own does not inherit another lane's", async () => {
  // The failure this guards is silent: an empty lane rendering a busy lane's duel looks like a
  // working board.
  const root = makeRoot([["sn22__desearch", "sn22_desearch", true],
                         ["sn60__bitsec", "sn60_bitsec", true]]);
  writeJson(path.join(root, "bot-state", "sn60__bitsec"), "challenge-history.json",
            { challenges: [{ run_id: "sn60-only" }] });
  const status = await loadBoardStatus(boardEnv(root));
  const sn22 = status.byLane["sn22__desearch:miner"];
  assert.equal((sn22.challengeHistory || []).length, 0, "SN22 inherited SN60's history");
});

// ---- INVARIANT: lane discovery is registry-driven ---

test("a lane directory with no registry entry is not discovered", async () => {
  const root = makeRoot([["sn60__bitsec", "sn60_bitsec", true]]);
  // A stray directory must not become a lane: the registry is what an operator reviewed.
  writeJson(path.join(root, "lanes", "sn99__rogue"), "lane.json",
            laneRecord("sn99__rogue", "sn99_rogue", true));
  const lanes = loadEvaluatorLanes({ kataRoot: root, latestLaneWinners: {} });
  const ids = lanes.map((lane) => lane.laneId || lane.subnetPack);
  assert.ok(!ids.includes("sn99__rogue"), `undeclared lane discovered: ${ids}`);
});
