// Golden shape of `/api/status` for zero-, one- and two-lane deployments.
//
// The board is a read-only consumer of state owned by `kata` and `kata-bot`. Its payload is the
// widest cross-project contract in the system: the whole UI reads it, and a key that quietly
// disappears renders as an empty panel rather than an error.
//
// Recorded BEFORE the refactor so "nothing observable changed" is checkable. Regenerate
// deliberately with GOLDEN_UPDATE=1 and review the diff -- a fixture that is regenerated to make a
// test pass has stopped being a fixture.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadBoardStatus } from "./status.mjs";
import { shapeLines } from "./goldenShape.mjs";

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "golden");

function writeJson(dir, name, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2) + "\n");
}

function laneRecord(laneId, evaluatorId) {
  return {
    schema_version: 1,
    lane_id: laneId,
    repo_pack: laneId,
    mode: "miner",
    evaluator_id: evaluatorId,
    evaluator_policy_version: "v1",
    active: true,
  };
}

/** A kata root with `lanes` active lanes and no bot state, which is the shape a freshly installed
 *  deployment actually has. */
function makeRoot(lanes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-golden-"));
  const lanesRoot = path.join(root, "lanes");
  writeJson(lanesRoot, "registry.json", {
    schema_version: 1,
    packs: lanes.map(([id, evaluator]) => ({
      lane_id: id, repo_pack: id, mode: "miner", evaluator_id: evaluator, active: true,
    })),
  });
  for (const [id, evaluator] of lanes) {
    writeJson(path.join(lanesRoot, id), "lane.json", laneRecord(id, evaluator));
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

const CASES = {
  "zero-lane": [],
  "one-lane": [["sn60__bitsec", "sn60_bitsec"]],
  "two-lane": [["sn22__desearch", "sn22_desearch"], ["sn60__bitsec", "sn60_bitsec"]],
};

for (const [name, lanes] of Object.entries(CASES)) {
  test(`/api/status shape is unchanged for a ${name} deployment`, async () => {
    const root = makeRoot(lanes);
    const status = await loadBoardStatus(boardEnv(root));
    const actual = shapeLines(status).join("\n") + "\n";
    const goldenPath = path.join(GOLDEN_DIR, `api-status-${name}.shape`);

    if (process.env.GOLDEN_UPDATE === "1" || !fs.existsSync(goldenPath)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(goldenPath, actual);
      return;
    }
    assert.equal(actual, fs.readFileSync(goldenPath, "utf8"),
      `/api/status shape changed for ${name}. If deliberate, rerun with GOLDEN_UPDATE=1 and review ` +
      `the diff; every UI reader of a removed key renders empty rather than failing.`);
  });
}

test("the golden fixtures contain no secret or benchmark material", () => {
  // A fixture is committed and public. Capturing a token or a private benchmark once is permanent.
  const forbidden = /gh[ps]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}|BEGIN [A-Z ]*PRIVATE KEY/;
  for (const file of fs.readdirSync(GOLDEN_DIR)) {
    const body = fs.readFileSync(path.join(GOLDEN_DIR, file), "utf8");
    assert.ok(!forbidden.test(body), `${file} contains secret-shaped material`);
  }
});
