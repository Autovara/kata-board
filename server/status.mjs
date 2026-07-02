import fs from "node:fs";
import path from "node:path";

import { loadGithubLeaderboard } from "./github.mjs";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";

const DEFAULT_CACHE_TTL_MS = 3_000;
let cachedStatus = null;
let cachedAt = 0;

export async function loadBoardStatus(env) {
  const cacheTtlMs = readCacheTtlMs(env);
  if (cachedStatus && Date.now() - cachedAt < cacheTtlMs) {
    return cachedStatus;
  }

  const roots = resolveRoots(env);
  const leaderboard = await loadLeaderboard(env);
  const validator = await loadValidatorStatus(env, roots);
  const lanes = loadEvaluatorLanes({
    kataRoot: roots.kataRoot,
    latestLaneWinners: leaderboard.latestLaneWinners
  });
  const activity = loadRecentActivity(roots.kataRoot, env);
  const notes = buildNotes({
    leaderboard,
    validator,
    lanes
  });

  cachedStatus = {
    generatedAt: new Date().toISOString(),
    publicLinks: {
      kataRepo: env.KATA_REPO_SLUG || null
    },
    dataSources: {
      filesystem: true,
      githubLeaderboard: leaderboard.source === "github",
      eventFeed: leaderboard.source === "events",
      validatorQueue: Boolean(validator.queue.available),
      validatorHealth: Boolean(validator.health.configured)
    },
    overview: buildOverview(lanes, activity, leaderboard, validator),
    validator,
    lanes,
    activity,
    leaderboard,
    notes
  };
  cachedAt = Date.now();
  return cachedStatus;
}

function readCacheTtlMs(env) {
  const value = Number.parseInt(env.KATA_STATUS_CACHE_TTL_MS || "", 10);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  return DEFAULT_CACHE_TTL_MS;
}

function resolveRoots(env) {
  const boardRoot = env.KATA_BOARD_ROOT || path.resolve(process.cwd(), "..");
  const kataBotRoot = resolveExistingRoot(
    env.KATA_BOT_ROOT,
    path.join(boardRoot, "kata-bot")
  );
  return {
    boardRoot,
    kataRoot: resolveExistingRoot(env.KATA_ROOT, path.join(boardRoot, "kata")),
    kataBotRoot,
    workRoot: path.resolve(
      env.KATA_WORK_ROOT || path.join(kataBotRoot, "work")
    ),
    queueStatePath: path.resolve(
      env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
    ),
    liveStatusPath: path.resolve(
      env.KATA_LIVE_STATUS_PATH ||
        path.join(
          path.dirname(
            env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
          ),
          "live-status.json"
        )
    )
  };
}

function resolveExistingRoot(explicitPath, fallbackPath) {
  return path.resolve(explicitPath || fallbackPath);
}



function loadEvaluatorLanes({ kataRoot, latestLaneWinners }) {
  const lanesRoot = path.join(kataRoot, "lanes");
  const registry = readJsonSafe(path.join(lanesRoot, "registry.json"));
  const laneIds = Array.isArray(registry?.packs)
    ? registry.packs
        .filter((pack) => pack?.active === true)
        .map((pack) => pack?.lane_id)
        .filter(Boolean)
    : listDirectories(lanesRoot);
  return laneIds
    .map((laneId) => loadEvaluatorLane(kataRoot, laneId, latestLaneWinners))
    .filter(Boolean);
}

function loadEvaluatorLane(kataRoot, laneId, latestLaneWinners) {
  const state = loadEvaluatorLaneState(kataRoot, laneId);
  const lane = state?.lane || null;
  if (!lane?.active) {
    return null;
  }
  const repoPack = lane.repo_pack || laneId;
  const mode = lane.mode || "miner";
  const latestWinner = latestLaneWinners?.[`${repoPack}::${mode}`] || null;
  const king = {
    submissionId: state.king?.current_king_submission_id || null,
    author: inferSubmissionAuthorFromId(state.king?.current_king_submission_id),
    challengeRunId: null,
    artifactHash: state.king?.current_king_artifact_hash || null,
    source: state.king?.promotion_source_pr || "evaluator lane",
    updatedAt: state.king?.promotion_timestamp || state.king?.updated_at || null,
    seeded: !state.king?.current_king_submission_id
  };
  const currentHolder =
    latestWinner?.author || king.author || humanizeKingSource(king.source);
  const selectedProjects = state.challengeState?.selected_project_keys || [];
  return {
    id: `${repoPack}:${mode}`,
    repoPack,
    repoName: displayRepoPack(repoPack),
    repoRef: null,
    mode,
    updatedAt: lane.updated_at || state.king?.updated_at || null,
    frontierUpdatedAt: state.king?.updated_at || lane.updated_at || null,
    currentHolder,
    currentHolderMergedAt: latestWinner?.mergedAt || null,
    currentHolderPullNumber: latestWinner?.pullNumber || null,
    king,
    duelRules: {
      publicSelection: "sn60_project_set",
      publicTaskCount: selectedProjects.length || state.benchmarkSnapshot?.project_keys?.length || 0,
      privateTaskCount: 0,
      promotionMarginPoints: 0,
      holdoutPromotionMarginPoints: 0,
      promotionMarginTasks: null,
      holdoutPromotionMarginTasks: null,
      holdoutRule: "SN60 miner lane uses Bitsec sandbox replicas"
    },
    publicPool: {
      selection: "sn60_project_set",
      configuredTaskCount: selectedProjects.length || state.benchmarkSnapshot?.project_keys?.length || 0,
      targetTaskCount: state.benchmarkSnapshot?.project_keys?.length || selectedProjects.length || 0,
      liveTasks: state.benchmarkSnapshot?.project_keys?.length || selectedProjects.length || 0,
      totalTasks: state.benchmarkSnapshot?.project_keys?.length || selectedProjects.length || 0,
      fingerprint: state.challengeState?.freshness_fingerprint || null,
      tasks: selectedProjects.map((projectKey) => ({
        taskId: projectKey,
        title: projectKey,
        description: "SN60 Bitsec sandbox project selected for the current duel.",
        visibility: "sandbox",
        status: "live",
        qualityScore: null,
        sourceRef: null,
        tags: ["sn60", "bitsec"]
      })),
      categoryCounts: { sn60: selectedProjects.length },
      categoryTargets: {},
      similarityThreshold: null,
      maxScopeConcentration: null,
      notes: null
    },
    privatePool: {
      configured: false,
      hidden: false,
      configuredTaskCount: 0,
      targetTaskCount: 0,
      liveTasks: 0,
      totalTasks: 0,
      retiredWaitingTasks: 0,
      retiredTasks: 0,
      fingerprint: null,
      updatedAt: null,
      evaluatorVersion: lane.evaluator_policy_version || null
    },
    evaluatorState: state
  };
}

function loadEvaluatorLaneState(kataRoot, laneId) {
  const laneRoot = path.join(kataRoot, "lanes", laneId);
  const lane = readJsonSafe(path.join(laneRoot, "lane.json"));
  if (!lane) {
    return null;
  }
  const king = readJsonSafe(path.join(laneRoot, "king.json"));
  const benchmarkSnapshot = readJsonSafe(path.join(laneRoot, "benchmark_snapshot.json"));
  const challengeState = readJsonSafe(path.join(laneRoot, "challenge_state.json"));
  const promotionRecord = readJsonSafe(path.join(laneRoot, "promotion_record.json"));
  return {
    laneId,
    lane,
    king,
    benchmarkSnapshot,
    challengeState,
    promotionRecord,
    current: buildEvaluatorCurrentState({
      lane,
      king,
      benchmarkSnapshot,
      challengeState,
      promotionRecord
    })
  };
}

function buildEvaluatorCurrentState({
  lane,
  king,
  benchmarkSnapshot,
  challengeState,
  promotionRecord
}) {
  if (!lane) {
    return null;
  }
  const screening = challengeState?.screening_result || null;
  const finalMetrics = promotionRecord?.final_metrics || {};
  const projectKeys = challengeState?.selected_project_keys || benchmarkSnapshot?.project_keys || [];
  return {
    candidateSubmissionId: challengeState?.candidate_submission_id || null,
    candidateAuthor: inferSubmissionAuthorFromId(challengeState?.candidate_submission_id),
    kingSubmissionId: king?.current_king_submission_id || null,
    kingAuthor: inferSubmissionAuthorFromId(king?.current_king_submission_id),
    screeningStatus: screening?.status || null,
    screeningStage: screening?.stage || null,
    screeningReasons: Array.isArray(screening?.reasons) ? screening.reasons : [],
    projectKeys,
    codebasesPassed: promotionRecord?.pass_counts || {},
    truePositives: promotionRecord?.true_positives || {},
    invalidRuns: promotionRecord?.invalid_runs || {},
    localReplicaScores: promotionRecord?.local_replica_scores || {},
    finalWinner: promotionRecord?.final_winner || null,
    rewardLabelApplied: promotionRecord?.reward_label_applied || null,
    recordedAt: promotionRecord?.recorded_at || null,
    finalMetrics,
    scores: {
      candidate: numberOrNull(
        finalMetrics.candidate_aggregated_score ?? finalMetrics.candidate_average_score
      ),
      king: numberOrNull(
        finalMetrics.frontier_aggregated_score ?? finalMetrics.frontier_average_score
      ),
      delta: numberOrNull(
        finalMetrics.candidate_aggregated_score_delta ?? finalMetrics.candidate_score_delta
      )
    },
    stability: summarizeReplicaStability(promotionRecord?.local_replica_scores || {}),
    provenance: {
      freshnessFingerprint: challengeState?.freshness_fingerprint || null,
      sandboxCommit:
        finalMetrics.sandbox_commit || benchmarkSnapshot?.sandbox_commit_hash || null,
      benchmarkSha256:
        finalMetrics.benchmark_sha256 || benchmarkSnapshot?.benchmark_dataset_hash || null,
      scorerVersion: finalMetrics.scorer_version || benchmarkSnapshot?.scorer_version || null,
      projectListHash: benchmarkSnapshot?.project_list_hash || null,
      containerImages: benchmarkSnapshot?.container_images || [],
      updatedAt:
        challengeState?.updated_at ||
        promotionRecord?.recorded_at ||
        benchmarkSnapshot?.updated_at ||
        lane.updated_at ||
        null
    }
  };
}

function humanizeKingSource(value) {
  if (!value) {
    return "unknown";
  }
  if (value.startsWith("kata-init")) {
    return "Kata Seed";
  }
  return value;
}

function loadRecentActivity(kataRoot, env) {
  const runsRoot = path.join(kataRoot, "runs");
  const challengePaths = collectFiles(runsRoot, "challenge_summary.json");
  const limit = Number.parseInt(env.KATA_ACTIVITY_LIMIT || "18", 10);

  return challengePaths
    .map((filePath) => readJson(filePath))
    .filter(Boolean)
    .map((summary) => {
      const primaryCandidateScore = summary.primary?.variant_scores?.candidate ?? 0;
      const primaryFrontierScore = summary.primary?.variant_scores?.frontier ?? 0;
      const holdoutCandidateScore = summary.holdout?.variant_scores?.candidate ?? null;
      const holdoutFrontierScore = summary.holdout?.variant_scores?.frontier ?? null;
      const repoPack = inferRepoPackFromSummary(summary);
      const sn60Metrics = loadSn60ActivityMetrics(summary);
      return {
        runId: summary.run_id,
        createdAt: summary.created_at,
        laneId: `${repoPack}:${summary.mode}`,
        mode: summary.mode,
        repoPack,
        promotionReady: Boolean(summary.promotion_ready),
        promotionReason: summary.promotion_reason || null,
        promotionMarginPoints: summary.promotion_margin_points ?? 0,
        holdoutPromotionMarginPoints: summary.holdout_promotion_margin_points ?? 0,
        candidateArtifactHash: summary.candidate_artifact_hash || null,
        candidateSubmissionId: inferSubmissionId(summary.candidate_artifact),
        candidateAuthor: inferSubmissionAuthor(summary.candidate_artifact),
        frontierArtifactHash: summary.frontier_artifact_hash || null,
        primary: {
          taskIds: summary.primary?.task_ids || [],
          candidateScore: primaryCandidateScore,
          frontierScore: primaryFrontierScore,
          candidateDelta:
            summary.primary?.candidate_score_delta ??
            primaryCandidateScore - primaryFrontierScore
        },
        holdout: summary.holdout
          ? {
              taskIds: summary.holdout.task_ids || [],
              candidateScore: holdoutCandidateScore,
              frontierScore: holdoutFrontierScore,
              candidateDelta:
                summary.holdout.candidate_score_delta ??
                holdoutCandidateScore - holdoutFrontierScore
            }
          : null,
        sn60: sn60Metrics
      };
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, limit);
}

function inferSubmissionId(artifactPath) {
  if (!artifactPath) {
    return null;
  }
  return path.basename(artifactPath);
}

function inferSubmissionAuthor(artifactPath) {
  return inferSubmissionAuthorFromId(inferSubmissionId(artifactPath));
}

function loadSn60ActivityMetrics(summary) {
  if (summary.mode !== "miner" || !String(summary.promotion_reason || "").includes("SN60")) {
    return null;
  }
  const manifestPath = summary.manifest_path || "";
  const runRoot = manifestPath ? path.dirname(manifestPath) : null;
  const screening = runRoot
    ? readJsonSafe(path.join(runRoot, "screening_result.json"))
    : null;
  const duel = path.basename(manifestPath) === "duel_summary.json"
    ? readJsonSafe(manifestPath)
    : null;
  return {
    screeningStatus: screening?.status || (manifestPath.endsWith("screening_result.json") ? "failed" : null),
    screeningStage: screening?.stage || null,
    screeningReasons: Array.isArray(screening?.reasons) ? screening.reasons : [],
    passCounts: summary.primary?.variant_successes || {},
    invalidRuns: summary.primary?.variant_invalid_tasks || {},
    truePositives: {
      candidate: numberOrNull(duel?.candidate?.true_positives),
      frontier: numberOrNull(duel?.frontier?.true_positives)
    },
    replicaScores: {
      candidate: Array.isArray(duel?.candidate?.replica_results)
        ? duel.candidate.replica_results.map((result) => numberOrNull(result.score)).filter((value) => value !== null)
        : [],
      frontier: Array.isArray(duel?.frontier?.replica_results)
        ? duel.frontier.replica_results.map((result) => numberOrNull(result.score)).filter((value) => value !== null)
        : []
    },
    provenance: {
      sandboxCommit: duel?.sandbox_source?.sandbox_commit || null,
      benchmarkSha256: duel?.sandbox_source?.benchmark_sha256 || null,
      scorerVersion: duel?.sandbox_source?.scorer_version || null,
      projectKeys: duel?.project_keys || summary.primary?.task_ids || []
    }
  };
}

async function loadLeaderboard(env) {
  if (env.KATA_BOARD_EVENT_LOG) {
    return loadEventLeaderboard(env.KATA_BOARD_EVENT_LOG);
  }

  try {
    return await loadGithubLeaderboard({
      repoSlug: env.KATA_REPO_SLUG,
      githubToken: env.KATA_GITHUB_TOKEN
    });
  } catch (error) {
    return {
      source: "unavailable",
      error: error instanceof Error ? error.message : "unknown leaderboard error",
      rows: [],
      latestLaneWinners: {}
    };
  }
}

async function loadValidatorStatus(env, roots) {
  const health = await loadValidatorHealth(env.KATA_VALIDATOR_HEALTH_URL);
  const queue = loadQueueStatus(roots.queueStatePath, health.payload?.queue || null);
  const activeEvaluation = loadActiveEvaluationProgress(
    roots.liveStatusPath,
    roots.workRoot,
    queue.activeJob
  );
  const activePullAuthor = await loadActivePullAuthor(env, queue.activeJob);
  return {
    mode: "resident",
    queue,
    health,
    activeEvaluation: enrichActiveEvaluationWithPullAuthor(
      activeEvaluation,
      activePullAuthor
    )
  };
}

async function loadActivePullAuthor(env, activeJob) {
  if (!activeJob?.pullNumber || !activeJob?.kataRepo) {
    return null;
  }
  try {
    const pull = await githubApiRequest(
      `/repos/${activeJob.kataRepo}/pulls/${activeJob.pullNumber}`,
      env.KATA_GITHUB_TOKEN
    );
    const user = pull?.user || {};
    return {
      login: typeof user.login === "string" ? user.login : null,
      avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
      htmlUrl: typeof user.html_url === "string" ? user.html_url : null
    };
  } catch {
    return null;
  }
}

function enrichActiveEvaluationWithPullAuthor(activeEvaluation, pullAuthor) {
  if (!activeEvaluation || !pullAuthor?.login) {
    return activeEvaluation;
  }
  return {
    ...activeEvaluation,
    candidateGithubLogin: pullAuthor.login,
    candidateAvatarUrl: pullAuthor.avatarUrl,
    candidateGithubUrl: pullAuthor.htmlUrl,
    candidateAuthor: pullAuthor.login
  };
}

async function githubApiRequest(requestPath, githubToken) {
  const headers = {
    "User-Agent": "kata-board",
    Accept: "application/vnd.github+json"
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  const response = await fetch(`https://api.github.com${requestPath}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status}`);
  }
  return response.json();
}

function loadQueueStatus(queueStatePath, healthQueuePayload = null) {
  const queuePayload = readJsonSafe(queueStatePath);
  if (!queuePayload) {
    return queueStatusFromHealth(healthQueuePayload);
  }
  const jobs = Array.isArray(queuePayload?.jobs) ? queuePayload.jobs : [];
  const counts = {
    total: jobs.length,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    other: 0
  };

  for (const job of jobs) {
    if (job.status === "pending") {
      counts.pending += 1;
    } else if (job.status === "running") {
      counts.running += 1;
    } else if (job.status === "completed") {
      counts.completed += 1;
    } else if (job.status === "failed") {
      counts.failed += 1;
    } else {
      counts.other += 1;
    }
  }

  const jobsByRecency = [...jobs].sort(
    (left, right) => new Date(jobSortDate(right)) - new Date(jobSortDate(left))
  );
  const activeJob = jobsByRecency.find((job) => job.status === "running") || null;
  const latestJob = jobsByRecency[0] || null;

  return {
    available: Boolean(queuePayload),
    counts,
    activeJob: activeJob ? summarizeQueueJob(activeJob) : null,
    latestJob: latestJob ? summarizeQueueJob(latestJob) : null,
    recentJobs: jobsByRecency.slice(0, 8).map(summarizeQueueJob)
  };
}

function queueStatusFromHealth(payload) {
  const counts = {
    total: Number(payload?.total_jobs || 0),
    pending: Number(payload?.pending_jobs || 0),
    running: Number(payload?.running_jobs || 0),
    completed: Number(payload?.completed_jobs || 0),
    failed: Number(payload?.failed_jobs || 0),
    other: 0
  };
  return {
    available: Boolean(payload),
    counts,
    activeJob: null,
    latestJob: null,
    recentJobs: []
  };
}

function loadActiveEvaluationProgress(liveStatusPath, workRoot, activeJob) {
  const base = {
    available: Boolean(activeJob),
    state: activeJob ? "queued" : "idle",
    phase: activeJob ? "queued" : "idle",
    workspacePath: null,
    updatedAt: null,
    repoPack: null,
    mode: null,
    candidateSubmissionId: null,
    candidateAuthor: null,
    pullNumber: activeJob?.pullNumber || null,
    startedAt: activeJob?.startedAt || null,
    enqueuedAt: activeJob?.enqueuedAt || null,
    attempts: activeJob?.attempts || 0,
    primary: null,
    holdout: null
  };
  if (!activeJob) {
    return base;
  }

  const liveStatus = loadLiveEvaluationProgress(liveStatusPath, activeJob);
  if (liveStatus) {
    return {
      ...base,
      ...liveStatus
    };
  }

  const workspaceRoot = findLatestActiveWorkspace(workRoot);
  if (!workspaceRoot) {
    return base;
  }

  const lane = inferLaneFromWorkspace(workspaceRoot);
  const phaseProgress =
    inspectChallengePhase(path.join(workspaceRoot, "runs-confirm"), "confirm") ||
    inspectChallengePhase(path.join(workspaceRoot, "runs-initial"), "initial");
  return {
    ...base,
    state: phaseProgress?.state || "running",
    phase: phaseProgress?.phase || "staging",
    workspacePath: workspaceRoot,
    updatedAt:
      phaseProgress?.updatedAt ||
      statMtimeIso(workspaceRoot) ||
      activeJob.startedAt ||
      activeJob.enqueuedAt,
    repoPack: lane?.repoPack || null,
    mode: lane?.mode || null,
    candidateSubmissionId: lane?.submissionId || null,
    candidateAuthor: lane?.submissionId
      ? inferSubmissionAuthorFromId(lane.submissionId)
      : null,
    primary: phaseProgress?.primary || null,
    holdout: phaseProgress?.holdout || null
  };
}

function loadLiveEvaluationProgress(liveStatusPath, activeJob) {
  const payload = readJsonSafe(liveStatusPath);
  if (!payload?.job || payload.job.job_id !== activeJob.jobId) {
    return null;
  }
  const primary = normalizeLivePool(payload.pools?.primary, true);
  const holdout = normalizeLivePool(payload.pools?.holdout, false);
  return {
    available: true,
    state: payload.state || "running",
    phase: payload.phase || "running",
    workspacePath: null,
    updatedAt: payload.updated_at || null,
    repoPack: payload.repo_pack || null,
    mode: payload.mode || null,
    candidateSubmissionId: payload.candidate_submission_id || null,
    candidateGithubLogin: payload.candidate_github_login || null,
    candidateAvatarUrl: payload.candidate_avatar_url || null,
    candidateGithubUrl: payload.candidate_github_url || null,
    candidateAuthor:
      payload.candidate_github_login ||
      payload.candidate_author ||
      inferSubmissionAuthorFromId(payload.candidate_submission_id),
    pullNumber: payload.job.pull_number || activeJob.pullNumber || null,
    startedAt: payload.job.started_at || activeJob.startedAt || null,
    enqueuedAt: payload.job.enqueued_at || activeJob.enqueuedAt || null,
    attempts: payload.job.attempts ?? activeJob.attempts ?? 0,
    primary,
    holdout
  };
}

function normalizeLivePool(pool, revealTaskIds) {
  if (!pool) {
    return null;
  }
  const rawTasks = Array.isArray(pool.task_statuses) ? pool.task_statuses : [];
  const taskStatuses = rawTasks.map((task) => ({
    taskId: revealTaskIds ? task.task_id || null : null,
    status: task.status || "queued",
    completed: Boolean(task.completed),
    candidate: normalizeLiveVariant(task.candidate),
    frontier: normalizeLiveVariant(task.frontier)
  }));
  return {
    live: pool.state !== "completed",
    totalTasks: Number(pool.total_tasks ?? taskStatuses.length ?? 0),
    completedTasks: Number(
      pool.completed_tasks ??
        taskStatuses.filter((task) => task.completed).length
    ),
    taskStatuses: revealTaskIds ? taskStatuses : [],
    counts: summarizeTaskStatusCounts(taskStatuses),
    updatedAt: pool.updated_at || null
  };
}

function normalizeLiveVariant(variant) {
  return {
    started: Boolean(variant?.started),
    finished: Boolean(variant?.finished),
    solved: Boolean(variant?.solved),
    valid: Boolean(variant?.valid),
    success: Boolean(variant?.success),
    verifierScore: numberOrNull(variant?.verifier_score),
    weightedTaskScore: numberOrNull(variant?.weighted_task_score)
  };
}

function findLatestActiveWorkspace(workRoot) {
  if (!fs.existsSync(workRoot)) {
    return null;
  }
  let candidates = [];
  try {
    candidates = fs
      .readdirSync(workRoot, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("kata-bot-job-")
      )
      .map((entry) => path.join(workRoot, entry.name));
  } catch {
    return null;
  }
  if (!candidates.length) {
    return null;
  }
  candidates.sort(
    (left, right) =>
      new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0)
  );
  return candidates[0];
}

function inferLaneFromWorkspace(workspaceRoot) {
  const changedPaths = readTextSafe(path.join(workspaceRoot, "changed-paths.txt"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const changedPath of changedPaths) {
    const match = changedPath.match(
      /^submissions\/([^/]+)\/([^/]+)\/([^/]+)\//
    );
    if (!match) {
      continue;
    }
    return {
      repoPack: match[1],
      mode: match[2],
      submissionId: match[3]
    };
  }
  return null;
}

function inspectChallengePhase(phaseRoot, phase) {
  if (!fs.existsSync(phaseRoot)) {
    return null;
  }
  const challengeRoots = listDirectories(phaseRoot)
    .map((name) => path.join(phaseRoot, name))
    .sort(
      (left, right) =>
        new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0)
    );
  if (!challengeRoots.length) {
    return {
      state: "running",
      phase,
      updatedAt: statMtimeIso(phaseRoot),
      primary: null,
      holdout: null
    };
  }
  const challengeRoot = challengeRoots[0];
  const summaryPath = path.join(challengeRoot, "challenge_summary.json");
  const summary = readJsonSafe(summaryPath);
  return {
    state: summary ? "verifying" : "running",
    phase,
    runId: path.basename(challengeRoot),
    updatedAt:
      summary?.created_at ||
      statMtimeIso(summaryPath) ||
      statMtimeIso(challengeRoot),
    primary: inspectPoolProgress(path.join(challengeRoot, "primary"), true),
    holdout: inspectPoolProgress(path.join(challengeRoot, "holdout"), false)
  };
}

function inspectPoolProgress(poolRoot, revealTaskIds) {
  if (!fs.existsSync(poolRoot)) {
    return null;
  }
  const runRoots = listDirectories(poolRoot)
    .map((name) => path.join(poolRoot, name))
    .sort(
      (left, right) =>
        new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0)
    );
  if (!runRoots.length) {
    return null;
  }
  const runRoot = runRoots[0];
  const runSummaryPath = path.join(runRoot, "run_summary.json");
  const runSummary = readJsonSafe(runSummaryPath);
  if (runSummary) {
    return summarizeCompletedPool(runSummary, revealTaskIds);
  }
  return summarizeRunningPool(runRoot, revealTaskIds);
}

function summarizeCompletedPool(runSummary, revealTaskIds) {
  const tasks = Array.isArray(runSummary?.tasks) ? runSummary.tasks : [];
  const taskStatuses = tasks.map((task) => {
    const candidate = summarizeTaskVariant(task, "candidate");
    const frontier = summarizeTaskVariant(task, "frontier");
    return {
      taskId: revealTaskIds ? task.task_id : null,
      status: exactTaskStatusLabel(candidate, frontier),
      completed: true,
      candidate,
      frontier
    };
  });
  return {
    live: false,
    totalTasks: tasks.length,
    completedTasks: tasks.length,
    taskStatuses: revealTaskIds ? taskStatuses : [],
    counts: summarizeTaskStatusCounts(taskStatuses),
    updatedAt: runSummary.created_at || null
  };
}

function summarizeRunningPool(runRoot, revealTaskIds) {
  const tasksRoot = path.join(runRoot, "tasks");
  const taskRoots = listDirectories(tasksRoot)
    .map((name) => path.join(tasksRoot, name))
    .sort();
  const taskStatuses = taskRoots.map((taskRoot) =>
    summarizeRunningTask(taskRoot, revealTaskIds)
  );
  return {
    live: true,
    totalTasks: taskStatuses.length,
    completedTasks: taskStatuses.filter((task) => task.completed).length,
    taskStatuses: revealTaskIds ? taskStatuses : [],
    counts: summarizeTaskStatusCounts(taskStatuses),
    updatedAt: statMtimeIso(runRoot)
  };
}

function summarizeRunningTask(taskRoot, revealTaskIds) {
  const candidate = summarizeRunningVariant(path.join(taskRoot, "candidate"));
  const frontier = summarizeRunningVariant(path.join(taskRoot, "frontier"));
  const taskId = path.basename(taskRoot);
  return {
    taskId: revealTaskIds ? taskId : null,
    status: runningTaskStatusLabel(candidate, frontier),
    completed: candidate.finished && frontier.finished,
    candidate,
    frontier
  };
}

function summarizeRunningVariant(variantRoot) {
  const files = {
    agentStdout: fs.existsSync(path.join(variantRoot, "agent.stdout.txt")),
    agentStderr: fs.existsSync(path.join(variantRoot, "agent.stderr.txt")),
    checksStdout: fs.existsSync(path.join(variantRoot, "checks.stdout.txt")),
    checksStderr: fs.existsSync(path.join(variantRoot, "checks.stderr.txt")),
    score: fs.existsSync(path.join(variantRoot, "score.txt"))
  };
  const started = Object.values(files).some(Boolean) || fs.existsSync(variantRoot);
  const finished =
    files.score ||
    ((files.agentStdout || files.agentStderr) &&
      (files.checksStdout || files.checksStderr));
  return {
    started,
    finished
  };
}

function summarizeTaskVariant(task, variantName) {
  const variants = Array.isArray(task?.variants) ? task.variants : [];
  const variant = variants.find((item) => item.name === variantName) || {};
  return {
    solved: Boolean(variant.task_solved),
    valid: Boolean(variant.validity_passed),
    success: Boolean(variant.success),
    verifierScore: numberOrNull(variant.verifier_score),
    weightedTaskScore: numberOrNull(variant.weighted_task_score)
  };
}

function exactTaskStatusLabel(candidate, frontier) {
  if (!candidate.valid) {
    return "candidate invalid";
  }
  if (candidate.solved && !frontier.solved) {
    return "candidate ahead";
  }
  if (candidate.solved && frontier.solved) {
    return "both solved";
  }
  if (!candidate.solved && frontier.solved) {
    return "frontier ahead";
  }
  return "both failed";
}

function runningTaskStatusLabel(candidate, frontier) {
  if (candidate.finished && frontier.finished) {
    return "finished";
  }
  if (candidate.started || frontier.started) {
    return "running";
  }
  return "queued";
}

function summarizeTaskStatusCounts(taskStatuses) {
  const counts = {};
  for (const task of taskStatuses) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }
  return counts;
}

function statMtimeIso(targetPath) {
  const stat = fs.statSync(targetPath, { throwIfNoEntry: false });
  return stat?.mtime?.toISOString?.() || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadValidatorHealth(healthUrl) {
  if (!healthUrl) {
    return {
      configured: false,
      ok: null,
      checkedAt: null,
      payload: null,
      error: null
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const payload = await response.json();
    return {
      configured: true,
      ok: Boolean(response.ok && payload?.status === "ok"),
      checkedAt: new Date().toISOString(),
      payload,
      error: null
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      checkedAt: new Date().toISOString(),
      payload: null,
      error: error instanceof Error ? error.message : "unknown validator health error"
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function jobSortDate(job) {
  return job.finished_at || job.started_at || job.enqueued_at || "1970-01-01T00:00:00Z";
}

function summarizeQueueJob(job) {
  return {
    jobId: job.job_id,
    status: job.status,
    kataRepo: job.kata_repo || null,
    benchmarksRepo: job.benchmarks_repo || null,
    pullNumber: job.pull_number,
    headSha: job.head_sha || null,
    attempts: job.attempts,
    finalAction: job.final_action || null,
    enqueuedAt: job.enqueued_at || null,
    startedAt: job.started_at || null,
    finishedAt: job.finished_at || null,
    error: job.last_error || null
  };
}

function loadEventLeaderboard(eventLogPath) {
  const resolved = path.resolve(eventLogPath);
  if (!fs.existsSync(resolved)) {
    return {
      source: "events",
      rows: [],
      latestLaneWinners: {},
      error: `event log not found: ${resolved}`
    };
  }

  const byAuthor = new Map();
  const latestLaneWinners = new Map();
  const lines = fs
    .readFileSync(resolved, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const item = JSON.parse(line);
    const author = item.author || "unknown";
    const laneKey = `${item.repo_pack || "unknown"}::${item.mode || "unknown"}`;
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions += 1;
    if (item.final_action === "merge") {
      entry.wins += 1;
      latestLaneWinners.set(laneKey, {
        author,
        mergedAt: item.created_at,
        pullNumber: item.pull_number || null
      });
    } else if (item.final_action === "open") {
      entry.openSubmissions += 1;
    } else {
      entry.closedSubmissions += 1;
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, item.created_at);
    byAuthor.set(author, entry);
  }

  const rows = [...byAuthor.values()]
    .map((entry) => ({
      ...entry,
      currentFrontiers: [...latestLaneWinners.values()].filter(
        (winner) => winner.author === entry.author
      ).length,
      score: entry.wins * 100 + entry.openSubmissions * 5
    }))
    .sort((left, right) => right.score - left.score);

  return {
    source: "events",
    rows,
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function buildOverview(lanes, activity, leaderboard, validator) {
  const totals = lanes.reduce(
    (accumulator, lane) => {
      accumulator.publicLiveTasks += lane.publicPool.liveTasks;
      accumulator.privateLiveTasks += lane.privatePool.liveTasks;
      accumulator.publicTargetTasks += lane.publicPool.liveTasks;
      accumulator.privateTargetTasks += lane.privatePool.liveTasks;
      return accumulator;
    },
    {
      publicLiveTasks: 0,
      privateLiveTasks: 0,
      publicTargetTasks: 0,
      privateTargetTasks: 0
    }
  );

  return {
    activeRepoPacks: new Set(lanes.map((lane) => lane.repoPack)).size,
    activeLanes: lanes.length,
    publicLiveTasks: totals.publicLiveTasks,
    privateLiveTasks: totals.privateLiveTasks,
    publicTargetTasks: totals.publicTargetTasks,
    privateTargetTasks: totals.privateTargetTasks,
    recentChallenges: activity.length,
    leaderboardEntries: leaderboard.rows.length,
    validatorPendingJobs: validator.queue.counts.pending,
    validatorRunningJobs: validator.queue.counts.running,
    validatorCompletedJobs: validator.queue.counts.completed,
    validatorFailedJobs: validator.queue.counts.failed
  };
}

function summarizeReplicaStability(localReplicaScores) {
  const candidate = Array.isArray(localReplicaScores?.candidate)
    ? localReplicaScores.candidate
    : [];
  const frontier = Array.isArray(localReplicaScores?.frontier)
    ? localReplicaScores.frontier
    : Array.isArray(localReplicaScores?.king)
      ? localReplicaScores.king
      : [];
  return {
    candidate: summarizeScoreSeries(candidate),
    king: summarizeScoreSeries(frontier),
    delta: summarizeScoreSeriesDelta(candidate, frontier)
  };
}

function summarizeScoreSeries(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) {
    return {
      count: 0,
      min: null,
      max: null,
      average: null,
      spread: null
    };
  }
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const average = numbers.reduce((total, value) => total + value, 0) / numbers.length;
  return {
    count: numbers.length,
    min,
    max,
    average,
    spread: max - min
  };
}

function summarizeScoreSeriesDelta(candidate, frontier) {
  const candidateSummary = summarizeScoreSeries(candidate);
  const frontierSummary = summarizeScoreSeries(frontier);
  if (candidateSummary.average === null || frontierSummary.average === null) {
    return null;
  }
  return candidateSummary.average - frontierSummary.average;
}

function buildNotes({ leaderboard, validator, lanes }) {
  const notes = [];
  if (!leaderboard.rows.length) {
    notes.push(
      "Miner leaderboard is empty because no GitHub PR history or event log is configured yet."
    );
  }
  if (lanes.some((lane) => lane.privatePool.configured)) {
    notes.push(
      "Private holdout task names are intentionally hidden on this board. Only counts and pool status are shown."
    );
  }
  if (!validator.queue.available) {
    notes.push(
      "Validator queue state file was not found. Configure `KATA_QUEUE_STATE_PATH` to show resident bot activity."
    );
  }
  if (validator.health.configured && !validator.health.ok) {
    notes.push(
      `Validator health check is failing: ${validator.health.error || "service returned a non-ok status"}.`
    );
  }
  return notes;
}

function listDirectories(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  try {
    return fs
      .readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

function collectFiles(rootPath, fileName) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  const matches = [];
  walk(rootPath, (absolutePath) => {
    if (path.basename(absolutePath) === fileName) {
      matches.push(absolutePath);
    }
  });
  return matches;
}

function walk(rootPath, visitor) {
  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, visitor);
    } else {
      visitor(absolutePath);
    }
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readJsonSafe(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf-8");
}

function readTextSafe(filePath) {
  try {
    return readText(filePath);
  } catch {
    return "";
  }
}

function inferRepoPackFromManifest(manifestPath) {
  return path.basename(path.dirname(manifestPath));
}

function inferRepoPackFromSummary(summary) {
  const promotionReason = String(summary?.promotion_reason || "");
  if (promotionReason.startsWith("sn60__bitsec:") || promotionReason.includes("SN60")) {
    return "sn60__bitsec";
  }
  const candidateArtifact = String(summary?.candidate_artifact || "");
  const submissionMatch = candidateArtifact.match(/\/submissions\/([^/]+)\//);
  if (submissionMatch) {
    return submissionMatch[1];
  }
  return inferRepoPackFromManifest(summary?.manifest_path || "");
}

function displayRepoPack(repoPack) {
  const raw = repoPack?.split("__").at(-1) || repoPack || "repo";
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function createAuthorRow(author) {
  return {
    author,
    wins: 0,
    totalSubmissions: 0,
    openSubmissions: 0,
    closedSubmissions: 0,
    currentFrontiers: 0,
    score: 0,
    lastActivityAt: null,
    recentPulls: []
  };
}

function maxDate(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return new Date(left) > new Date(right) ? left : right;
}
