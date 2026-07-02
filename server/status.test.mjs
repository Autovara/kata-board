import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadBoardStatus } from "./status.mjs";

function writeJson(dir, name, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2) + "\n");
}

function makeKataRoot({ active = true, withRegistry = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-test-"));
  const lanesRoot = path.join(root, "lanes");
  const laneRoot = path.join(lanesRoot, "sn60__bitsec");

  writeJson(laneRoot, "lane.json", {
    schema_version: 1,
    lane_id: "sn60__bitsec",
    repo_pack: "sn60__bitsec",
    mode: "miner",
    evaluator_id: "sn60_bitsec",
    evaluator_policy_version: "v1",
    active,
    created_at: "2026-07-01T00:00:00+00:00",
    updated_at: "2026-07-02T00:00:00+00:00"
  });
  if (withRegistry) {
    writeJson(lanesRoot, "registry.json", {
      schema_version: 1,
      packs: [
        {
          lane_id: "sn60__bitsec",
          repo_pack: "sn60__bitsec",
          mode: "miner",
          evaluator_id: "sn60_bitsec",
          active
        }
      ],
      updated_at: "2026-07-02T00:00:00+00:00"
    });
  }
  writeJson(laneRoot, "king.json", {
    schema_version: 1,
    current_king_submission_id: "alice-20260701-01",
    current_king_artifact_hash: "king-hash",
    promotion_source_pr: null,
    promotion_timestamp: "2026-07-01T12:00:00+00:00",
    updated_at: "2026-07-01T12:00:00+00:00"
  });
  writeJson(laneRoot, "benchmark_snapshot.json", {
    schema_version: 1,
    sandbox_mirror_source: "/srv/sandbox",
    sandbox_commit_hash: "b462a1e8e10b0000000000000000000000000000",
    benchmark_dataset_id: "curated-highs-only-2025-08-08.json",
    benchmark_dataset_hash: "benchmark-sha",
    project_list_hash: "project-list-hash",
    project_keys: ["project-alpha", "project-beta"],
    container_images: [
      "ghcr.io/bitsec-ai/project-alpha:latest",
      "ghcr.io/bitsec-ai/project-beta:latest"
    ],
    scorer_version: "ScaBenchScorerV2",
    updated_at: "2026-07-02T00:00:00+00:00"
  });
  writeJson(laneRoot, "challenge_state.json", {
    schema_version: 1,
    candidate_submission_id: "bob-20260702-01",
    candidate_artifact_hash: "candidate-hash",
    king_artifact_hash: "king-hash",
    screening_result: { status: "passed", stage: "execution", reasons: [] },
    selected_project_keys: ["project-alpha", "project-beta"],
    validator_replica_count: 3,
    run_ids: ["sn60-duel-1"],
    freshness_fingerprint: "fingerprint-1",
    updated_at: "2026-07-02T01:00:00+00:00"
  });
  writeJson(laneRoot, "promotion_record.json", {
    schema_version: 1,
    final_metrics: {
      run_id: "sn60-duel-1",
      promotion_ready: true,
      promotion_reason: "candidate beat the current SN60 king",
      candidate_aggregated_score: 0.75,
      frontier_aggregated_score: 0.5,
      candidate_aggregated_score_delta: 0.25,
      // legacy keys deliberately different to prove the aggregated keys win
      candidate_average_score: 0.9,
      frontier_average_score: 0.1,
      candidate_score_delta: 0.8,
      sandbox_commit: "b462a1e8e10b0000000000000000000000000000",
      benchmark_sha256: "benchmark-sha",
      scorer_version: "ScaBenchScorerV2"
    },
    local_replica_scores: {
      frontier: [0.5, 0.5, 0.5],
      candidate: [0.7, 0.75, 0.8]
    },
    pass_counts: { frontier: 1, candidate: 2 },
    true_positives: { frontier: 6, candidate: 12 },
    invalid_runs: { frontier: 0, candidate: 0 },
    final_winner: "candidate",
    reward_label_applied: null,
    recorded_at: "2026-07-02T01:00:00+00:00"
  });

  const runRoot = path.join(root, "runs", "sn60-duel-1");
  writeJson(runRoot, "challenge_summary.json", {
    schema_version: 4,
    run_id: "sn60-duel-1",
    manifest_path: path.join(runRoot, "duel_summary.json"),
    mode: "miner",
    evaluator_version: "ScaBenchScorerV2@b462a1e8e10b",
    validator_model: "sn60-bitsec-sandbox",
    frontier_artifact: "/kings/sn60__bitsec/miner",
    candidate_artifact: "/submissions/sn60__bitsec/miner/bob-20260702-01",
    frontier_artifact_hash: "king-hash",
    candidate_artifact_hash: "candidate-hash",
    primary_pool_fingerprint: "fingerprint-1",
    holdout_pool_fingerprint: null,
    promotion_margin_points: 0,
    holdout_promotion_margin_points: 0,
    created_at: "2026-07-02T01:00:00+00:00",
    primary: {
      task_ids: ["project-alpha", "project-beta"],
      eval_run_summary: "duel_summary.json",
      total_task_weight: 2,
      variant_successes: { frontier: 1, candidate: 2 },
      variant_invalid_tasks: { frontier: 0, candidate: 0 },
      variant_scores: { frontier: 50, candidate: 100 },
      candidate_beats_frontier: true,
      candidate_score_delta: 50
    },
    holdout: null,
    promotion_ready: true,
    promotion_reason: "sn60__bitsec: candidate beat the current SN60 king"
  });

  return root;
}

function boardEnv(root) {
  return {
    KATA_ROOT: root,
    KATA_BOT_ROOT: path.join(root, "no-bot"),
    KATA_QUEUE_STATE_PATH: path.join(root, "no-bot", "queue.json"),
    KATA_STATUS_CACHE_TTL_MS: "0"
  };
}

test("discovers the active SN60 lane from the central pack registry", async () => {
  const root = makeKataRoot();
  const status = await loadBoardStatus(boardEnv(root));

  assert.deepEqual(
    status.lanes.map((lane) => lane.id),
    ["sn60__bitsec:miner"]
  );
  const lane = status.lanes[0];
  assert.equal(lane.repoPack, "sn60__bitsec");
  assert.equal(lane.mode, "miner");
  assert.equal(lane.king.submissionId, "alice-20260701-01");
});

test("renders the SN60 duel state from lane state files", async () => {
  const root = makeKataRoot();
  const status = await loadBoardStatus(boardEnv(root));
  const current = status.lanes[0].evaluatorState.current;

  assert.equal(current.candidateSubmissionId, "bob-20260702-01");
  assert.equal(current.kingSubmissionId, "alice-20260701-01");
  assert.equal(current.screeningStatus, "passed");
  assert.equal(current.screeningStage, "execution");
  assert.deepEqual(current.codebasesPassed, { frontier: 1, candidate: 2 });
  assert.deepEqual(current.truePositives, { frontier: 6, candidate: 12 });
  assert.deepEqual(current.invalidRuns, { frontier: 0, candidate: 0 });
  assert.equal(current.finalWinner, "candidate");

  // stability comes from per-replica scores
  assert.equal(current.stability.candidate.count, 3);
  assert.ok(Math.abs(current.stability.candidate.spread - 0.1) < 1e-9);
  assert.equal(current.stability.king.spread, 0);

  // provenance mirrors the pinned benchmark snapshot
  assert.equal(
    current.provenance.sandboxCommit,
    "b462a1e8e10b0000000000000000000000000000"
  );
  assert.equal(current.provenance.scorerVersion, "ScaBenchScorerV2");
  assert.equal(current.provenance.containerImages.length, 2);
  assert.equal(current.provenance.freshnessFingerprint, "fingerprint-1");
});

test("prefers aggregated score metrics over legacy average keys", async () => {
  const root = makeKataRoot();
  const status = await loadBoardStatus(boardEnv(root));
  const scores = status.lanes[0].evaluatorState.current.scores;

  assert.equal(scores.candidate, 0.75);
  assert.equal(scores.king, 0.5);
  assert.equal(scores.delta, 0.25);
});

test("excludes packs marked inactive in the registry", async () => {
  const root = makeKataRoot({ active: false });
  const status = await loadBoardStatus(boardEnv(root));

  assert.deepEqual(status.lanes, []);
});

test("falls back to directory discovery when no registry exists", async () => {
  const root = makeKataRoot({ withRegistry: false });
  const status = await loadBoardStatus(boardEnv(root));

  assert.deepEqual(
    status.lanes.map((lane) => lane.id),
    ["sn60__bitsec:miner"]
  );
});

test("loads recent activity from challenge summaries", async () => {
  const root = makeKataRoot();
  const status = await loadBoardStatus(boardEnv(root));

  assert.equal(status.activity.length, 1);
  const entry = status.activity[0];
  assert.equal(entry.runId, "sn60-duel-1");
  assert.equal(entry.laneId, "sn60__bitsec:miner");
  assert.equal(entry.promotionReady, true);
  assert.equal(entry.primary.candidateScore, 100);
});

test("degrades gracefully when the kata root is empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-empty-"));
  const status = await loadBoardStatus(boardEnv(root));

  assert.deepEqual(status.lanes, []);
  assert.deepEqual(status.activity, []);
  assert.equal(status.dataSources.validatorQueue, false);
});
