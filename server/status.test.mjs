import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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
      candidate_total_expected: 16,
      king_total_expected: 12,
      candidate_precision: 0.8,
      king_precision: 0.6,
      candidate_f1_score: 0.7741935484,
      king_f1_score: 0.5454545455,
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

function git(root, args, env = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function commitEmpty(root, message, isoDate, authorName, authorEmail) {
  git(
    root,
    ["commit", "--allow-empty", "-m", message],
    {
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_NAME: authorName,
      GIT_COMMITTER_EMAIL: authorEmail,
      GIT_COMMITTER_DATE: isoDate
    }
  );
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
  assert.deepEqual(current.totalExpected, { king: 12, candidate: 16, delta: 4 });
  assert.equal(current.precision.candidate, 0.8);
  assert.equal(current.f1Scores.king, 0.5454545455);
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
  assert.equal(status.overview.selectedCodebases, 2);
  assert.equal(status.overview.uniqueChallengers, 1);
  assert.equal(status.overview.totalSubmissions, 1);
  assert.equal(status.overview.recentDuels, 1);
  assert.ok(status.overview.totalGittensorScore > 0);
  assert.ok(status.overview.totalGittensorScore <= 1);
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
  const benchmarkPath = path.join(root, "curated-highs-only-2025-08-08.json");
  fs.writeFileSync(
    benchmarkPath,
    JSON.stringify(
      [
        {
          project_id: "project-alpha",
          vulnerabilities: [{}, {}, {}, {}, {}]
        }
      ],
      null,
      2
    ) + "\n"
  );
  writeSn60Evaluation(runRoot, "candidate", "project-alpha", "replica-01", {
    status: "success",
    result: { result: "PASS", true_positives: 3, total_expected: 3, total_found: 3 }
  });
  writeSn60Evaluation(runRoot, "candidate", "project-alpha", "replica-02", {
    status: "success",
    result: { result: "PASS", true_positives: 2, total_expected: 2, total_found: 2 }
  });
  writeSn60Evaluation(runRoot, "candidate", "project-alpha", "replica-03", {
    status: "error",
    result: {}
  });
  writeSn60Evaluation(runRoot, "king", "project-alpha", "replica-01", {
    status: "success",
    result: { result: "FAIL", true_positives: 0, total_expected: 1, total_found: 0 }
  });
  writeSn60Evaluation(runRoot, "king", "project-alpha", "replica-02", {
    status: "success",
    result: { result: "FAIL", true_positives: 0, total_expected: 1, total_found: 0 }
  });
  writeSn60Evaluation(runRoot, "king", "project-alpha", "replica-03", {
    status: "success",
    result: { result: "FAIL", true_positives: 0, total_expected: 1, total_found: 0 }
  });
  writeSn60Evaluation(runRoot, "candidate", "project-beta", "replica-01", {
    status: "success",
    result: { result: "PASS", true_positives: 9 }
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOT_ROOT: botRoot,
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath,
    KATA_WORK_ROOT: workRoot,
    KATA_SN60_BENCHMARK_FILE: benchmarkPath
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
  assert.equal(active.primary.totalExpected.candidate, 10);
  assert.equal(active.primary.precision.candidate, 1);
  assert.equal(active.primary.f1Scores.candidate, 2 / 3);
  assert.equal(active.primary.invalidRuns.candidate, 1);
  assert.deepEqual(active.primary.replicaProgress.candidate, {
    completed: 4,
    total: 6
  });
  assert.deepEqual(active.primary.replicaProgress.king, {
    completed: 3,
    total: 6
  });
  assert.equal(active.primary.taskStatuses[0].candidate.completedReplicas, 3);
  assert.equal(active.primary.taskStatuses[0].candidate.totalReplicas, 3);
  assert.equal(active.primary.taskStatuses[0].status, "candidate invalid");
  assert.equal(active.primary.taskStatuses[1].candidate.completedReplicas, 1);
  assert.equal(active.primary.taskStatuses[1].candidate.totalReplicas, 3);
});

test("ignores malformed queue and live-status elements", async () => {
  const root = makeKataRoot();
  const botRoot = path.join(root, "bot");
  const queuePath = path.join(botRoot, "state", "queue.json");
  const liveStatusPath = path.join(botRoot, "state", "live-status.json");
  const jobId = "job-malformed";
  writeJson(path.dirname(queuePath), "queue.json", {
    schema_version: 1,
    jobs: [
      null,
      {
        schema_version: 1,
        job_id: jobId,
        kata_repo: "owner/kata",
        pull_number: 42,
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
    lane_id: "sn60__bitsec",
    candidate_submission_id: "carol-20260702-01",
    job: { job_id: jobId, pull_number: 42, attempts: 1 },
    pools: {
      primary: {
        state: "running",
        total_tasks: 2,
        task_statuses: [
          null,
          {
            task_id: "project-alpha",
            status: "running",
            candidate: { started: true },
            king: {}
          }
        ]
      }
    }
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOT_ROOT: botRoot,
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath
  });

  assert.equal(status.validator.queue.counts.total, 1);
  assert.equal(status.validator.activeEvaluation.primary.taskStatuses.length, 1);
  assert.equal(
    status.validator.activeEvaluation.primary.taskStatuses[0].taskId,
    "project-alpha"
  );
});

test("keeps latest completed SN60 duel visible after queue finishes", async () => {
  const root = makeKataRoot();
  const botRoot = path.join(root, "bot");
  const queuePath = path.join(botRoot, "state", "queue.json");
  const liveStatusPath = path.join(botRoot, "state", "live-status.json");
  const workRoot = path.join(botRoot, "work");
  const jobId = "job-completed";
  writeJson(path.dirname(queuePath), "queue.json", {
    schema_version: 1,
    jobs: [
      {
        schema_version: 1,
        job_id: jobId,
        kata_repo: "owner/kata",
        pull_number: 77,
        head_sha: "b".repeat(40),
        status: "completed",
        attempts: 1,
        enqueued_at: "2026-07-02T04:00:00+00:00",
        started_at: "2026-07-02T04:01:00+00:00",
        finished_at: "2026-07-02T04:20:00+00:00",
        final_action: "close-losing"
      }
    ]
  });
  writeJson(path.dirname(liveStatusPath), "live-status.json", {
    schema_version: 1,
    state: "completed",
    phase: "completed",
    lane_id: "sn60__bitsec",
    candidate_submission_id: "erin-20260702-01",
    project_keys: ["project-alpha"],
    replicas_per_project: 1,
    final_action: "close-losing",
    final_reason: "candidate did not beat king",
    job: {
      job_id: jobId,
      kata_repo: "owner/kata",
      pull_number: 77,
      attempts: 1,
      enqueued_at: "2026-07-02T04:00:00+00:00",
      started_at: "2026-07-02T04:01:00+00:00"
    }
  });

  const workspace = path.join(workRoot, "kata-bot-job-completed");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "changed-paths.txt"),
    "submissions/sn60__bitsec/miner/erin-20260702-01/agent.py\n"
  );
  const runRoot = path.join(workspace, "runs-initial", "sn60-duel-completed");
  writeJson(runRoot, "duel_summary.json", {
    candidate: {
      true_positives: 1,
      total_expected: 4,
      total_found: 2,
      precision: 0.5,
      f1_score: 1 / 3
    },
    king: {
      true_positives: 2,
      total_expected: 4,
      total_found: 2,
      precision: 1,
      f1_score: 2 / 3
    }
  });
  writeJson(runRoot, "challenge_summary.json", {
    schema_version: 5,
    run_id: "sn60-duel-completed",
    manifest_path: path.join(runRoot, "duel_summary.json"),
    mode: "miner",
    created_at: "2026-07-02T04:20:00+00:00",
    primary: {
      project_keys: ["project-alpha"],
      run_summary_path: "duel_summary.json",
      variant_successes: { king: 0, candidate: 0 },
      variant_invalid_runs: { king: 0, candidate: 0 },
      variant_scores: { king: 50, candidate: 25 },
      candidate_beats_king: false,
      candidate_score_delta: -25
    },
    promotion_ready: false,
    promotion_reason: "sn60__bitsec: candidate did not beat the current SN60 king"
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOT_ROOT: botRoot,
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath,
    KATA_WORK_ROOT: workRoot
  });

  const active = status.validator.activeEvaluation;
  assert.equal(status.validator.queue.activeJob, null);
  assert.equal(active.available, true);
  assert.equal(active.state, "completed");
  assert.equal(active.phase, "completed");
  assert.equal(active.pullNumber, 77);
  assert.equal(active.finalAction, "close-losing");
  assert.equal(active.candidateSubmissionId, "erin-20260702-01");
  assert.equal(active.primary.scores.candidate, 0.25);
  assert.equal(active.primary.scores.king, 0.5);
  assert.equal(active.primary.truePositives.candidate, 1);
  assert.equal(active.primary.totalExpected.candidate, 4);
  assert.equal(active.primary.precision.king, 1);
});

test("shows live SN60 screening project and timeout before result exists", async () => {
  const root = makeKataRoot();
  const botRoot = path.join(root, "bot");
  const queuePath = path.join(botRoot, "state", "queue.json");
  const liveStatusPath = path.join(botRoot, "state", "live-status.json");
  const workRoot = path.join(botRoot, "work");
  const jobId = "job-screening";
  writeJson(path.dirname(queuePath), "queue.json", {
    schema_version: 1,
    jobs: [
      {
        schema_version: 1,
        job_id: jobId,
        kata_repo: "owner/kata",
        pull_number: 42,
        head_sha: "c".repeat(40),
        status: "running",
        attempts: 1,
        enqueued_at: "2026-07-02T02:00:00+00:00",
        started_at: "2026-07-02T02:01:00+00:00"
      }
    ]
  });
  writeJson(path.dirname(liveStatusPath), "live-status.json", {
    schema_version: 1,
    state: "screening",
    phase: "sn60-screening",
    lane_id: "sn60__bitsec",
    candidate_submission_id: "dana-20260702-01",
    project_keys: ["project-alpha", "project-beta"],
    screening_project_key: "project-alpha",
    screening_started_at: "2026-07-02T02:01:05+00:00",
    screening_timeout_seconds: 300,
    screening_timeout_at: "2026-07-02T02:06:05+00:00",
    job: {
      job_id: jobId,
      kata_repo: "owner/kata",
      pull_number: 42,
      attempts: 1,
      enqueued_at: "2026-07-02T02:00:00+00:00",
      started_at: "2026-07-02T02:01:00+00:00"
    }
  });
  const workspace = path.join(workRoot, "kata-bot-job-screening");
  fs.mkdirSync(
    path.join(workspace, "runs-initial", "sn60-screening-live", "reports", "project-alpha"),
    { recursive: true }
  );
  fs.writeFileSync(
    path.join(workspace, "changed-paths.txt"),
    "submissions/sn60__bitsec/miner/dana-20260702-01/agent.py\n"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOT_ROOT: botRoot,
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath,
    KATA_WORK_ROOT: workRoot
  });

  const active = status.validator.activeEvaluation;
  assert.equal(active.state, "screening");
  assert.equal(active.phase, "sn60-screening");
  assert.equal(active.screening.projectKey, "project-alpha");
  assert.equal(active.screening.timeoutSeconds, 300);
  assert.equal(active.primary.completedTasks, 0);
  assert.equal(active.primary.taskStatuses[0].taskId, "project-alpha");
  assert.equal(active.primary.taskStatuses[0].status, "screening running");
});

test("completed SN60 screening failure overrides stale lane winner state", async () => {
  const root = makeKataRoot();
  const botRoot = path.join(root, "bot");
  const queuePath = path.join(botRoot, "state", "queue.json");
  const liveStatusPath = path.join(botRoot, "state", "live-status.json");
  const workRoot = path.join(botRoot, "work");
  const jobId = "job-screen-failed";
  const reason = "SN60 screening report must include at least one candidate vulnerability. Empty reports are treated as no-op submissions.";
  writeJson(path.dirname(queuePath), "queue.json", {
    schema_version: 1,
    jobs: [
      {
        schema_version: 1,
        job_id: jobId,
        kata_repo: "owner/kata",
        pull_number: 42,
        head_sha: "d".repeat(40),
        status: "completed",
        attempts: 1,
        enqueued_at: "2026-07-02T05:00:00+00:00",
        started_at: "2026-07-02T05:01:00+00:00",
        finished_at: "2026-07-02T05:08:00+00:00",
        final_action: "close-losing"
      }
    ]
  });
  writeJson(path.dirname(liveStatusPath), "live-status.json", {
    schema_version: 1,
    state: "completed",
    phase: "completed",
    lane_id: "sn60__bitsec",
    candidate_submission_id: "failer-20260702-01",
    project_keys: ["project-alpha"],
    final_action: "close-losing",
    final_reason: "Submission lost to the current king and should be auto-closed.",
    job: {
      job_id: jobId,
      kata_repo: "owner/kata",
      pull_number: 42,
      attempts: 1,
      enqueued_at: "2026-07-02T05:00:00+00:00",
      started_at: "2026-07-02T05:01:00+00:00",
      finished_at: "2026-07-02T05:08:00+00:00"
    }
  });

  const workspace = path.join(workRoot, "kata-bot-job-screen-failed");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "changed-paths.txt"),
    "submissions/sn60__bitsec/miner/failer-20260702-01/agent.py\n"
  );
  const runRoot = path.join(workspace, "runs-initial", "sn60-screening-failed");
  writeJson(runRoot, "screening_result.json", {
    status: "failed",
    stage: "execution",
    project_key: "project-alpha",
    reasons: [reason]
  });
  writeJson(runRoot, "challenge_summary.json", {
    schema_version: 5,
    run_id: "sn60-screening-failed",
    manifest_path: path.join(runRoot, "screening_result.json"),
    mode: "miner",
    created_at: "2026-07-02T05:08:00+00:00",
    primary: {
      project_keys: ["project-alpha"],
      run_summary_path: "screening_result.json",
      variant_successes: { king: 0, candidate: 0 },
      variant_invalid_runs: { king: 0, candidate: 1 },
      variant_scores: { king: 0, candidate: 0 },
      candidate_beats_king: false,
      candidate_score_delta: 0
    },
    promotion_ready: false,
    promotion_reason: `sn60__bitsec: candidate failed SN60 screening: ${reason}`
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOT_ROOT: botRoot,
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath,
    KATA_WORK_ROOT: workRoot
  });

  const active = status.validator.activeEvaluation;
  assert.equal(active.state, "completed");
  assert.equal(active.finalAction, "close-losing");
  assert.equal(active.finalReason, `sn60__bitsec: candidate failed SN60 screening: ${reason}`);
  assert.equal(active.screeningStatus, "failed");
  assert.equal(active.screeningStage, "execution");
  assert.deepEqual(active.screeningReasons, [reason]);
  assert.equal(active.primary.completedTasks, 1);
  assert.equal(active.primary.taskStatuses[0].status, "screening failed");
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
  assert.equal(dave.gittensorScore, 0);
});

test("leaderboard fallback includes all scored round-summary contributors", async () => {
  const root = makeKataRoot();
  const roundRoot = path.join(root, "runs", "sn60-round-all");
  writeJson(roundRoot, "round_summary.json", {
    run_id: "sn60-round-all",
    created_at: "2026-07-07T12:00:00Z",
    winner_submission_id: null,
    entries: [
      {
        submission_id: "pr-67",
        artifact_path: path.join(
          root,
          "work",
          "submissions",
          "sn60__bitsec",
          "miner",
          "statxc-20260706-01"
        ),
        beats_king: false,
        candidate: { aggregated_score: 0, true_positives: 0 }
      },
      {
        submission_id: "pr-69",
        artifact_path: path.join(
          root,
          "work",
          "submissions",
          "sn60__bitsec",
          "miner",
          "Helios531-20260706-01"
        ),
        beats_king: false,
        candidate: { aggregated_score: 0, true_positives: 0 }
      }
    ]
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_REPO_SLUG: "",
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  const authors = status.leaderboard.rows.map((row) => row.author);
  assert.ok(authors.includes("statxc"));
  assert.ok(authors.includes("Helios531"));
  const statxc = status.leaderboard.rows.find((row) => row.author === "statxc");
  assert.equal(statxc.totalSubmissions, 1);
  assert.equal(statxc.closedSubmissions, 1);
  assert.equal(statxc.gittensorScore, 0);
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
  assert.ok(row.gittensorScore > 0);
  assert.ok(row.gittensorScore <= 1);
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

test("sanitizes validator health payload before exposing status", async () => {
  const root = makeKataRoot();
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        status: "ok",
        service: "kata-validator",
        secret_path: "/srv/kata-bot/state/queue.json",
        token: "should-not-leak",
        queue: {
          total_jobs: 3,
          pending_jobs: 1,
          running_jobs: 1,
          completed_jobs: 1,
          failed_jobs: 0,
          internal_path: "/srv/private"
        }
      })
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const status = await loadBoardStatus({
      ...boardEnv(root),
      KATA_VALIDATOR_HEALTH_URL: `http://127.0.0.1:${port}/healthz`
    });

    assert.equal(status.validator.health.ok, true);
    assert.equal(status.validator.health.payload.status, "ok");
    assert.equal(status.validator.health.payload.token, undefined);
    assert.equal(status.validator.health.payload.secret_path, undefined);
    assert.equal(status.validator.health.payload.queue.running_jobs, 1);
    assert.equal(status.validator.health.payload.queue.internal_path, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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

  const alice = status.leaderboard.rows.find((row) => row.author === "alice");
  assert.ok(alice);
  assert.equal(alice.wins, 1);
  assert.ok(alice.gittensorScore > 0);
  assert.ok(alice.gittensorScore <= 1);
});

test("leaderboard does not split a known PR winner by submission id prefix", async () => {
  const root = makeKataRoot();
  const eventLogPath = path.join(root, "events.jsonl");
  fs.writeFileSync(
    eventLogPath,
    JSON.stringify({
      created_at: "2026-07-02T01:02:00Z",
      author: "bob-github",
      repo_pack: "sn60__bitsec",
      mode: "miner",
      final_action: "merge",
      pull_number: 12
    }) + "\n"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_BOARD_EVENT_LOG: eventLogPath,
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(
    status.leaderboard.rows.some((row) => row.author === "bob"),
    false
  );
  const row = status.leaderboard.rows.find((item) => item.author === "bob-github");
  assert.ok(row);
  assert.equal(row.wins, 1);
  assert.ok(row.gittensorScore > 0);
  assert.ok(row.gittensorScore <= 1);
  assert.deepEqual(row.winnerPulls, [
    {
      pullNumber: 12,
      mergedAt: "2026-07-02T01:02:00Z"
    }
  ]);
});

test("leaderboard uses completed validator identity when github history is unavailable", async () => {
  const root = makeKataRoot();
  const botStateRoot = path.join(root, "bot", "state");
  const queuePath = path.join(botStateRoot, "queue.json");
  const liveStatusPath = path.join(botStateRoot, "live-status.json");
  const roundStatusPath = path.join(botStateRoot, "round-status.json");
  writeJson(botStateRoot, "queue.json", {
    schema_version: 1,
    jobs: [
      {
        schema_version: 1,
        job_id: "owner__kata-pr12-abc",
        kata_repo: "owner/kata",
        pull_number: 12,
        head_sha: "a".repeat(40),
        status: "completed",
        attempts: 1,
        enqueued_at: "2026-07-02T01:00:00Z",
        started_at: "2026-07-02T01:01:00Z",
        finished_at: "2026-07-02T01:03:00Z",
        final_action: "merge"
      }
    ]
  });
  writeJson(botStateRoot, "live-status.json", {
    schema_version: 1,
    source: "kata-bot",
    state: "completed",
    phase: "completed",
    updated_at: "2026-07-02T01:03:00Z",
    final_action: "merge",
    candidate_github_login: "bob-github",
    job: {
      job_id: "owner__kata-pr12-abc",
      kata_repo: "owner/kata",
      pull_number: 12,
      head_sha: "a".repeat(40),
      status: "completed",
      attempts: 1,
      enqueued_at: "2026-07-02T01:00:00Z",
      started_at: "2026-07-02T01:01:00Z",
      finished_at: "2026-07-02T01:03:00Z"
    }
  });
  writeJson(botStateRoot, "round-status.json", {
    schema_version: 1,
    state: "completed",
    winner_submission_id: "bob-20260702-01",
    entrants: [
      {
        pull_number: 12,
        submission_id: "bob-20260702-01",
        status: "winner"
      }
    ]
  });
  writeJson(path.join(root, "lanes", "sn60__bitsec"), "king.json", {
    schema_version: 1,
    current_king_submission_id: "bob-20260702-01",
    current_king_artifact_hash: "candidate-hash",
    promotion_source_pr: null,
    promotion_timestamp: "2026-07-02T01:03:00Z",
    updated_at: "2026-07-02T01:03:00Z"
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_QUEUE_STATE_PATH: queuePath,
    KATA_LIVE_STATUS_PATH: liveStatusPath,
    KATA_ROUND_STATUS_PATH: roundStatusPath,
    KATA_REPO_SLUG: "",
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(
    status.leaderboard.rows.some((row) => row.author === "bob"),
    false
  );
  const row = status.leaderboard.rows.find((item) => item.author === "bob-github");
  assert.ok(row);
  assert.equal(row.wins, 1);
  assert.equal(status.lanes[0].king.author, "bob-github");
  assert.equal(status.round.entrants[0].author, "bob-github");
});

test("leaderboard falls back to round entrants when github history is unavailable", async () => {
  const root = makeKataRoot();
  const roundStatusPath = path.join(root, "round-status.json");
  writeJson(root, "round-status.json", {
    schema_version: 1,
    state: "completed",
    generated_at: "2026-07-02T02:00:00Z",
    winner_submission_id: "alice-20260702-01",
    entrants: [
      {
        pull_number: 10,
        submission_id: "alice-20260702-01",
        status: "winner"
      },
      {
        pull_number: 11,
        submission_id: "charlie-20260702-01",
        status: "losing"
      }
    ]
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_ROUND_STATUS_PATH: roundStatusPath,
    KATA_REPO_SLUG: "",
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  const authors = status.leaderboard.rows.map((row) => row.author);
  assert.ok(authors.includes("alice"));
  assert.ok(authors.includes("charlie"));
  const charlie = status.leaderboard.rows.find((row) => row.author === "charlie");
  assert.equal(charlie.totalSubmissions, 1);
  assert.equal(charlie.closedSubmissions, 1);
});

test("leaderboard reconstructs promoted winners from local git history", async () => {
  const root = makeKataRoot();
  writeJson(path.join(root, "lanes", "sn60__bitsec"), "king.json", {
    schema_version: 1,
    current_king_submission_id: "jonathanchang31-20260707-01",
    current_king_artifact_hash: "candidate-hash",
    promotion_source_pr: null,
    promotion_timestamp: "2026-07-07T16:46:38Z",
    updated_at: "2026-07-07T16:46:38Z"
  });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "kata-bot"]);
  git(root, ["config", "user.email", "kata-bot@users.noreply.github.com"]);

  commitEmpty(
    root,
    "feat(sn60): depth-first matcher-tuned bitsec miner (nickmopen-20260705-01) (#47)",
    "2026-07-05T18:28:36Z",
    "Nick M",
    "nickmelnikov82@proton.me"
  );
  commitEmpty(
    root,
    "chore: promote king from PR #47",
    "2026-07-05T20:27:20Z",
    "kata-bot",
    "kata-bot@users.noreply.github.com"
  );
  commitEmpty(
    root,
    "feat(sn60): jonathan -20260707-01 (#76)",
    "2026-07-07T16:46:35Z",
    "Jonathan Chang",
    "55106972+jonathanchang31@users.noreply.github.com"
  );
  commitEmpty(
    root,
    "chore: promote king from PR #76",
    "2026-07-07T16:46:38Z",
    "kata-bot",
    "kata-bot@users.noreply.github.com"
  );

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_REPO_SLUG: "",
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(status.leaderboard.source, "local-git+runs");
  const jonathan = status.leaderboard.rows.find(
    (row) => row.author === "jonathanchang31"
  );
  const nick = status.leaderboard.rows.find((row) => row.author === "nickmopen");
  assert.ok(jonathan);
  assert.ok(nick);
  assert.equal(jonathan.wins, 1);
  assert.equal(nick.wins, 1);
  assert.ok(jonathan.gittensorScore > 0);
  assert.ok(nick.gittensorScore > 0);
  assert.ok(jonathan.gittensorScore >= nick.gittensorScore);
  assert.equal(status.overview.currentWinnerGittensorScore, jonathan.gittensorScore);
  assert.ok(status.overview.totalGittensorScore > status.overview.currentWinnerGittensorScore);
  assert.equal(
    status.leaderboard.latestLaneWinners["sn60__bitsec::miner"].author,
    "jonathanchang31"
  );
});

test("completed round keeps the king identity from before promotion", async () => {
  const root = makeKataRoot();
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "kata-bot"]);
  git(root, ["config", "user.email", "kata-bot@users.noreply.github.com"]);

  commitEmpty(
    root,
    "feat(sn60): depth-first matcher-tuned bitsec miner (nickmopen-20260705-01) (#47)",
    "2026-07-05T18:28:36Z",
    "Nick M",
    "nickmelnikov82@proton.me"
  );
  commitEmpty(
    root,
    "chore: promote king from PR #47",
    "2026-07-05T20:27:20Z",
    "kata-bot",
    "kata-bot@users.noreply.github.com"
  );
  commitEmpty(
    root,
    "feat(sn60): jonathan -20260707-01 (#76)",
    "2026-07-07T16:46:35Z",
    "Jonathan Chang",
    "55106972+jonathanchang31@users.noreply.github.com"
  );
  commitEmpty(
    root,
    "chore: promote king from PR #76",
    "2026-07-07T16:46:38Z",
    "kata-bot",
    "kata-bot@users.noreply.github.com"
  );

  writeJson(path.join(root, "lanes", "sn60__bitsec"), "king.json", {
    schema_version: 1,
    current_king_submission_id: "jonathanchang31-20260707-01",
    current_king_artifact_hash: "candidate-hash",
    promotion_source_pr: null,
    promotion_timestamp: "2026-07-07T16:46:38Z",
    updated_at: "2026-07-07T16:46:38Z"
  });
  writeJson(root, "round-status.json", {
    schema_version: 1,
    state: "completed",
    generated_at: "2026-07-07T16:36:32Z",
    run_id: "sn60-round-promoted",
    repo: "Owner/kata",
    king: { aggregated_score: 0.05, true_positives: 2 },
    winner_submission_id: "pr-76",
    entrants: [
      {
        pull_number: 76,
        submission_id: "jonathan-20260707-01",
        author: "jonathanchang31",
        status: "winner",
        aggregated_score: 0.1,
        true_positives: 4,
        beats_king: true
      }
    ]
  });

  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_REPO_SLUG: "",
    KATA_ROUND_STATUS_PATH: path.join(root, "round-status.json"),
    KATA_LEADERBOARD_CACHE_TTL_MS: "0"
  });

  assert.equal(status.lanes[0].currentHolder, "jonathanchang31");
  assert.equal(status.round.kingAuthor, "nickmopen");
  assert.equal(status.round.kingSubmissionId, "nickmopen-20260705-01");
  assert.equal(status.round.entrants[0].author, "jonathanchang31");
});

test("exposes the current competition round from round-status.json", async () => {
  const root = makeKataRoot();
  writeJson(root, "round-status.json", {
    schema_version: 1,
    state: "completed",
    generated_at: "2026-07-06T12:00:00Z",
    run_id: "sn60-round-x",
    repo: "Owner/kata",
    king: { aggregated_score: 0.2, true_positives: 1 },
    winner_submission_id: "m-1",
    entrants: [
      {
        pull_number: 1,
        submission_id: "m-1",
        status: "winner",
        aggregated_score: 0.5,
        true_positives: 2,
        beats_king: true
      },
      {
        pull_number: 2,
        submission_id: "m-2",
        status: "losing",
        aggregated_score: 0.0,
        true_positives: 0,
        beats_king: false
      }
    ],
    screened_out: [{ pull_number: 6, reason: "screening failed" }],
    closed_extras: [{ pull_number: 3, kept_pull_number: 1 }],
    skipped_stale: [4]
  });

  const status = await loadBoardStatus({
    KATA_ROOT: root,
    KATA_BOT_ROOT: path.join(root, "no-bot"),
    KATA_QUEUE_STATE_PATH: path.join(root, "no-bot", "queue.json"),
    KATA_ROUND_STATUS_PATH: path.join(root, "round-status.json"),
    KATA_STATUS_CACHE_TTL_MS: "0"
  });

  assert.equal(status.round.state, "completed");
  assert.equal(status.round.generatedAt, "2026-07-06T12:00:00Z");
  assert.equal(status.round.runId, "sn60-round-x");
  assert.equal(status.round.winnerSubmissionId, "m-1");
  assert.equal(status.round.king.aggregated_score, 0.2);
  assert.equal(status.round.entrants.length, 2);
  assert.equal(status.round.entrants[0].status, "winner");
  assert.equal(status.round.screenedOut[0].pull_number, 6);
});

test("exposes a skipped round and its note for the dashboard", async () => {
  const root = makeKataRoot();
  writeJson(root, "round-status.json", {
    schema_version: 1,
    state: "skipped",
    note: "Round skipped: the OpenRouter key limit was exceeded.",
    entrants: [],
  });
  const status = await loadBoardStatus({
    ...boardEnv(root),
    KATA_ROUND_STATUS_PATH: path.join(root, "round-status.json"),
  });
  assert.equal(status.round.state, "skipped");
  assert.equal(status.round.note, "Round skipped: the OpenRouter key limit was exceeded.");
  assert.equal(status.round.entrants.length, 0);
});

test("round is null when no round-status file exists", async () => {
  const root = makeKataRoot();
  const status = await loadBoardStatus(boardEnv(root));
  assert.equal(status.round, null);
});

test("attaches live per-candidate progress while a round is executing", async () => {
  const root = makeKataRoot();
  writeJson(root, "round-status.json", {
    schema_version: 1,
    state: "executing",
    entrants: [{ pull_number: 5, submission_id: "m-5", status: "executing" }]
  });
  writeJson(root, "round-progress.json", {
    schema_version: 1,
    state: "executing",
    run_id: "sn60-round-live",
    updated_at: "2026-07-06T12:00:05Z",
    king: { done: 4, total: 6 },
    candidates: [{ submission_id: "pr-5", done: 2, total: 6, state: "scoring" }]
  });

  const status = await loadBoardStatus({
    KATA_ROOT: root,
    KATA_BOT_ROOT: path.join(root, "no-bot"),
    KATA_QUEUE_STATE_PATH: path.join(root, "no-bot", "queue.json"),
    KATA_ROUND_STATUS_PATH: path.join(root, "round-status.json"),
    KATA_ROUND_PROGRESS_PATH: path.join(root, "round-progress.json"),
    KATA_STATUS_CACHE_TTL_MS: "0"
  });

  assert.equal(status.round.state, "executing");
  assert.equal(status.round.liveProgress.state, "executing");
  assert.equal(status.round.liveProgress.king.done, 4);
  assert.equal(status.round.liveProgress.candidates[0].submission_id, "pr-5");
  assert.equal(status.round.liveProgress.candidates[0].done, 2);
});

test("exposes the round-history feed from round-history.json", async () => {
  const root = makeKataRoot();
  writeJson(root, "round-history.json", {
    schema_version: 1,
    rounds: [
      {
        run_id: "r1",
        generated_at: "2026-07-06T00:00:00Z",
        candidate_count: 2,
        winner_submission_id: "m-1",
        best_detection: 0.5,
        best_true_positives: 2,
        achievements: ["👑 New king", "🥇 First true positive"],
        headline: "🏆 Round — new king, best detection 50%, 2 candidates"
      }
    ]
  });

  const status = await loadBoardStatus({
    KATA_ROOT: root,
    KATA_BOT_ROOT: path.join(root, "no-bot"),
    KATA_QUEUE_STATE_PATH: path.join(root, "no-bot", "queue.json"),
    KATA_ROUND_HISTORY_PATH: path.join(root, "round-history.json"),
    KATA_STATUS_CACHE_TTL_MS: "0"
  });

  assert.equal(status.roundHistory.length, 1);
  assert.equal(status.roundHistory[0].winnerSubmissionId, "m-1");
  assert.equal(status.roundHistory[0].bestDetection, 0.5);
  assert.deepEqual(status.roundHistory[0].achievements, ["👑 New king", "🥇 First true positive"]);
});
