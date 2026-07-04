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
      king_aggregated_score: 0.5,
      candidate_aggregated_score_delta: 0.25,
      sandbox_commit: "b462a1e8e10b0000000000000000000000000000",
      benchmark_sha256: "benchmark-sha",
      scorer_version: "ScaBenchScorerV2"
    },
    local_replica_scores: {
      king: [0.5, 0.5, 0.5],
      candidate: [0.7, 0.75, 0.8]
    },
    pass_counts: { king: 1, candidate: 2 },
    true_positives: { king: 6, candidate: 12 },
    invalid_runs: { king: 0, candidate: 0 },
    final_winner: "candidate",
    reward_label_applied: null,
    recorded_at: "2026-07-02T01:00:00+00:00"
  });

  const runRoot = path.join(root, "runs", "sn60-duel-1");
  writeJson(runRoot, "challenge_summary.json", {
    schema_version: 5,
    run_id: "sn60-duel-1",
    manifest_path: path.join(runRoot, "duel_summary.json"),
    mode: "miner",
    evaluator_version: "ScaBenchScorerV2@b462a1e8e10b",
    validator_model: "sn60-bitsec-sandbox",
    king_artifact: "/kings/sn60__bitsec/miner",
    candidate_artifact: "/submissions/sn60__bitsec/miner/bob-20260702-01",
    king_artifact_hash: "king-hash",
    candidate_artifact_hash: "candidate-hash",
    primary_pool_fingerprint: "fingerprint-1",
    created_at: "2026-07-02T01:00:00+00:00",
    primary: {
      project_keys: ["project-alpha", "project-beta"],
      run_summary_path: "duel_summary.json",
      total_task_weight: 2,
      variant_successes: { king: 1, candidate: 2 },
      variant_invalid_runs: { king: 0, candidate: 0 },
      variant_scores: { king: 50, candidate: 100 },
      candidate_beats_king: true,
      candidate_score_delta: 50
    },
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
  assert.equal(lane.subnetPack, "sn60__bitsec");
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
  assert.deepEqual(current.codebasesPassed, { king: 1, candidate: 2 });
  assert.deepEqual(current.truePositives, { king: 6, candidate: 12 });
  assert.deepEqual(current.invalidRuns, { king: 0, candidate: 0 });
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

test("reads aggregated score metrics from the promotion record", async () => {
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

test("merges live status with active SN60 worktree progress", async () => {
  const root = makeKataRoot();
  const botRoot = path.join(root, "bot");
  const queuePath = path.join(botRoot, "state", "queue.json");
  const liveStatusPath = path.join(botRoot, "state", "live-status.json");
  const workRoot = path.join(botRoot, "work");
  const jobId = "job-1";
  writeJson(path.dirname(queuePath), "queue.json", {
    schema_version: 1,
    jobs: [
      {
        schema_version: 1,
        job_id: jobId,
        kata_repo: "owner/kata",
        pull_number: 42,
        head_sha: "a".repeat(40),
        status: "running",
        attempts: 1,
        enqueued_at: "2026-07-02T02:00:00+00:00",
        started_at: "2026-07-02T02:01:00+00:00"
      }
    ]
  });
  writeJson(path.dirname(liveStatusPath), "live-status.json", {
    schema_version: 1,
    state: "evaluating",
    phase: "sn60-duel",
    subnet_pack: "sn60__bitsec",
    mode: "miner",
    candidate_submission_id: "carol-20260702-01",
    project_keys: ["project-alpha", "project-beta"],
    replicas_per_project: 3,
    job: {
      job_id: jobId,
      pull_number: 42,
      attempts: 1,
      enqueued_at: "2026-07-02T02:00:00+00:00",
      started_at: "2026-07-02T02:01:00+00:00"
    }
  });

  const staleWorkspace = path.join(workRoot, "kata-bot-job-stale");
  fs.mkdirSync(staleWorkspace, { recursive: true });
  fs.writeFileSync(
    path.join(staleWorkspace, "changed-paths.txt"),
    "submissions/sn60__bitsec/miner/other-20260702-01/agent.py\n"
  );
  const staleRunRoot = path.join(staleWorkspace, "runs-initial", "sn60-duel-stale");
  writeSn60Evaluation(staleRunRoot, "candidate", "project-alpha", "replica-01", {
    status: "success",
    result: { result: "FAIL", true_positives: 0 }
  });

  const workspace = path.join(workRoot, "kata-bot-job-active");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "changed-paths.txt"),
    "submissions/sn60__bitsec/miner/carol-20260702-01/agent.py\n"
  );
  const runRoot = path.join(workspace, "runs-initial", "sn60-duel-active");
  writeSn60Evaluation(runRoot, "candidate", "project-alpha", "replica-01", {
    status: "success",
    result: { result: "PASS", true_positives: 3 }
  });
  writeSn60Evaluation(runRoot, "candidate", "project-alpha", "replica-02", {
    status: "success",
    result: { result: "PASS", true_positives: 2 }
  });
  writeSn60Evaluation(runRoot, "king", "project-alpha", "replica-01", {
    status: "success",
    result: { result: "FAIL", true_positives: 0 }
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOT_ROOT: botRoot,
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath,
    KATA_WORK_ROOT: workRoot
  });

  const active = status.validator.activeEvaluation;
  assert.equal(active.state, "evaluating");
  assert.equal(active.phase, "sn60-duel");
  assert.equal(active.candidateSubmissionId, "carol-20260702-01");
  assert.equal(active.primary.totalTasks, 2);
  assert.equal(active.primary.passCounts.candidate, 1);
  assert.equal(active.primary.passCounts.king, 0);
  assert.equal(active.primary.scores.candidate, 0.5);
  assert.equal(active.primary.truePositives.candidate, 5);
  assert.deepEqual(active.primary.replicaProgress.candidate, {
    completed: 2,
    total: 6
  });
  assert.deepEqual(active.primary.replicaProgress.king, {
    completed: 1,
    total: 6
  });
  assert.equal(active.primary.taskStatuses[0].candidate.completedReplicas, 2);
  assert.equal(active.primary.taskStatuses[0].candidate.totalReplicas, 3);
  assert.equal(active.primary.taskStatuses[1].candidate.completedReplicas, 0);
  assert.equal(active.primary.taskStatuses[1].candidate.totalReplicas, 3);
});

test("leaderboard includes losing candidates from run artifacts", async () => {
  const root = makeKataRoot();
  const losingRunRoot = path.join(root, "runs", "sn60-duel-loser");
  writeJson(losingRunRoot, "challenge_summary.json", {
    schema_version: 5,
    run_id: "sn60-duel-loser",
    manifest_path: path.join(losingRunRoot, "duel_summary.json"),
    mode: "miner",
    evaluator_version: "ScaBenchScorerV2@b462a1e8e10b",
    validator_model: "sn60-bitsec-sandbox",
    king_artifact: "/kings/sn60__bitsec/miner",
    candidate_artifact: "/submissions/sn60__bitsec/miner/dave-20260702-01",
    king_artifact_hash: "king-hash",
    candidate_artifact_hash: "candidate-hash-2",
    primary_pool_fingerprint: "fingerprint-2",
    created_at: "2026-07-02T03:00:00+00:00",
    primary: {
      project_keys: ["project-alpha", "project-beta"],
      run_summary_path: "duel_summary.json",
      total_task_weight: 2,
      variant_successes: { king: 2, candidate: 1 },
      variant_invalid_runs: { king: 0, candidate: 0 },
      variant_scores: { king: 100, candidate: 50 },
      candidate_beats_king: false,
      candidate_score_delta: -50
    },
    promotion_ready: false,
    promotion_reason: "sn60__bitsec: candidate did not beat the current SN60 king"
  });

  const status = await loadBoardStatus(boardEnv(root));
  const dave = status.leaderboard.rows.find((row) => row.author === "dave");

  assert.ok(dave);
  assert.equal(dave.wins, 0);
  assert.equal(dave.totalSubmissions, 1);
  assert.equal(dave.closedSubmissions, 1);
});

test("degrades gracefully when the kata root is empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kata-board-empty-"));
  const status = await loadBoardStatus(boardEnv(root));

  assert.deepEqual(status.lanes, []);
  assert.deepEqual(status.activity, []);
  assert.equal(status.dataSources.validatorQueue, false);
});

function writeSn60Evaluation(runRoot, variant, projectKey, replicaName, payload) {
  const reportsRoot = path.join(
    runRoot,
    variant,
    projectKey,
    replicaName,
    "reports",
    projectKey
  );
  fs.mkdirSync(reportsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(reportsRoot, "report.json"),
    JSON.stringify({ success: true, report: { vulnerabilities: [] } }) + "\n"
  );
  fs.writeFileSync(
    path.join(reportsRoot, "evaluation.json"),
    JSON.stringify(payload) + "\n"
  );
}

test("survives a malformed run artifact without failing the whole status", async () => {
  const root = makeKataRoot();
  const badRunRoot = path.join(root, "runs", "sn60-duel-2");
  fs.mkdirSync(badRunRoot, { recursive: true });
  // Simulate a challenge summary caught mid-write.
  fs.writeFileSync(
    path.join(badRunRoot, "challenge_summary.json"),
    '{"schema_version": 5, "run_id": "sn60-du'
  );

  const status = await loadBoardStatus(boardEnv(root));

  assert.equal(status.activity.length, 1);
  assert.equal(status.activity[0].runId, "sn60-duel-1");
});

test("skips malformed event-log lines instead of failing the leaderboard", async () => {
  const root = makeKataRoot();
  const eventLogPath = path.join(root, "events.jsonl");
  fs.writeFileSync(
    eventLogPath,
    [
      JSON.stringify({
        created_at: "2026-07-01T00:00:00Z",
        author: "alice",
        repo_pack: "sn60__bitsec",
        mode: "miner",
        final_action: "merge",
        pull_number: 7
      }),
      '{"created_at":"2026-07-02T00:00:00Z","author":"bob","repo_'
    ].join("\n") + "\n"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOARD_EVENT_LOG: eventLogPath,
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(status.leaderboard.source, "events+runs");
  const row = status.leaderboard.rows.find((item) => item.author === "alice");
  assert.ok(row);
  assert.equal(row.author, "alice");
  assert.equal(row.wins, 1);
});

test("survives a wrong-typed selected_project_keys without a 500", async () => {
  const root = makeKataRoot();
  const laneRoot = path.join(root, "lanes", "sn60__bitsec");
  // Valid JSON, wrong type (string instead of array) — must not throw.
  writeJson(laneRoot, "challenge_state.json", {
    schema_version: 1,
    selected_project_keys: "project-alpha",
    screening_result: { status: "passed", stage: "execution", reasons: [] }
  });

  const status = await loadBoardStatus(boardEnv(root));

  assert.equal(status.lanes.length, 1);
  assert.deepEqual(status.lanes[0].projects, []);
});

test("skips a parseable-but-null event-log line", async () => {
  const root = makeKataRoot();
  const eventLogPath = path.join(root, "events.jsonl");
  fs.writeFileSync(
    eventLogPath,
    [
      JSON.stringify({
        created_at: "2026-07-01T00:00:00Z",
        author: "alice",
        repo_pack: "sn60__bitsec",
        mode: "miner",
        final_action: "merge",
        pull_number: 7
      }),
      "null",
      "123"
    ].join("\n") + "\n"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOARD_EVENT_LOG: eventLogPath,
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(status.leaderboard.source, "events+runs");
  assert.ok(status.leaderboard.rows.find((row) => row.author === "alice"));
});

test("projects only derived evaluator state to clients", async () => {
  const root = makeKataRoot();
  const status = await loadBoardStatus(boardEnv(root));
  const evaluatorState = status.lanes[0].evaluatorState;

  assert.deepEqual(Object.keys(evaluatorState).sort(), ["current", "laneId"]);
  // Raw lane files (with server paths and internal payloads) must not ship.
  assert.equal(evaluatorState.benchmarkSnapshot, undefined);
  assert.equal(evaluatorState.promotionRecord, undefined);
  assert.equal(evaluatorState.challengeState, undefined);
});

test("lane state wins over PR history for the current holder", async () => {
  const root = makeKataRoot();
  const eventLogPath = path.join(root, "events.jsonl");
  // PR history claims mallory merged last on this lane, but lane state says
  // the king is alice's submission.
  fs.writeFileSync(
    eventLogPath,
    JSON.stringify({
      created_at: "2026-07-02T00:00:00Z",
      author: "mallory",
      repo_pack: "sn60__bitsec",
      mode: "miner",
      final_action: "merge",
      pull_number: 9
    }) + "\n"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOARD_EVENT_LOG: eventLogPath,
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  const lane = status.lanes[0];
  assert.equal(lane.currentHolder, "alice");
  // Merged-PR metadata belongs to a different author, so it must not be
  // attributed to the current king.
  assert.equal(lane.currentHolderPullNumber, null);
  assert.equal(lane.currentHolderMergedAt, null);
});

test("accepts subnet_pack in event log leaderboard entries", async () => {
  const root = makeKataRoot();
  const eventLogPath = path.join(root, "events.jsonl");
  fs.writeFileSync(
    eventLogPath,
    JSON.stringify({
      created_at: "2026-07-02T00:00:00Z",
      author: "alice",
      subnet_pack: "sn60__bitsec",
      mode: "miner",
      final_action: "merge",
      pull_number: 7
    }) + "\n"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOARD_EVENT_LOG: eventLogPath,
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(status.leaderboard.rows[0].author, "alice");
  assert.equal(status.leaderboard.rows[0].wins, 1);
});
