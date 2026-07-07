import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { githubRequest, loadGithubLeaderboard } from "./github.mjs";
import {
  createAuthorRow,
  finalizeLeaderboardRows,
  maxDate
} from "./leaderboardRows.mjs";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";

const DEFAULT_CACHE_TTL_MS = 3_000;
// The GitHub leaderboard fans out one files-request per PR, so it gets its
// own, much longer TTL than the cheap filesystem status.
const DEFAULT_LEADERBOARD_CACHE_TTL_MS = 60_000;
let cachedStatus = null;
let cachedAt = 0;
let cachedLeaderboard = null;
let cachedLeaderboardAt = 0;

export async function loadBoardStatus(env) {
  const cacheTtlMs = readCacheTtlMs(env);
  const roots = resolveRoots(env);
  if (cachedStatus && Date.now() - cachedAt < cacheTtlMs) {
    // Live round progress is a cheap local-file read that moves fast during a
    // round, while the rest of the payload (GitHub PRs, leaderboard) is slow and
    // rate-limited. Refresh just the progress on a cache hit so the dashboard
    // animates smoothly every stream frame without re-hitting GitHub.
    if (cachedStatus.round) {
      cachedStatus.round.liveProgress = loadRoundProgress(roots.roundProgressPath);
    }
    return cachedStatus;
  }
  const validator = await loadValidatorStatus(env, roots);
  let round = loadRoundStatus(roots.roundStatusPath);
  if (round) {
    round.liveProgress = loadRoundProgress(roots.roundProgressPath);
  }
  const roundHistory = loadRoundHistory(roots.roundHistoryPath);
  const activity = loadRecentActivity(roots.kataRoot, env);
  const identityAliases = buildIdentityAliases({ validator, round });
  round = applyRoundIdentityAliases(round, identityAliases);
  const baseLeaderboard = augmentLeaderboardWithRound(
    await loadLeaderboard(env),
    round,
    identityAliases
  );
  const leaderboard = augmentLeaderboardWithActivity(
    baseLeaderboard,
    activity,
    identityAliases
  );
  round = enrichRoundKingIdentity(round, leaderboard);
  const lanes = loadEvaluatorLanes({
    kataRoot: roots.kataRoot,
    latestLaneWinners: leaderboard.latestLaneWinners,
    identityAliases
  });
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
    round,
    roundHistory,
    lanes,
    activity,
    leaderboard,
    notes
  };
  cachedAt = Date.now();
  return cachedStatus;
}

function readCacheTtlMs(env) {
  return readTtlMs(env.KATA_STATUS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
}

function readTtlMs(rawValue, defaultMs) {
  const value = Number.parseInt(rawValue || "", 10);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  return defaultMs;
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
    sn60BenchmarkFile: env.KATA_SN60_BENCHMARK_FILE
      ? path.resolve(env.KATA_SN60_BENCHMARK_FILE)
      : null,
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
    ),
    roundStatusPath: path.resolve(
      env.KATA_ROUND_STATUS_PATH ||
        path.join(
          path.dirname(
            env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
          ),
          "round-status.json"
        )
    ),
    roundHistoryPath: path.resolve(
      env.KATA_ROUND_HISTORY_PATH ||
        path.join(
          path.dirname(
            env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
          ),
          "round-history.json"
        )
    ),
    roundProgressPath: path.resolve(
      env.KATA_ROUND_PROGRESS_PATH ||
        path.join(
          path.dirname(
            env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
          ),
          "round-progress.json"
        )
    )
  };
}

function loadRoundHistory(roundHistoryPath) {
  // Public feed of completed rounds + achievements (most recent first).
  const data = readJsonSafe(roundHistoryPath);
  const rounds = data && Array.isArray(data.rounds) ? data.rounds : [];
  return rounds
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      runId: entry.run_id || null,
      generatedAt: entry.generated_at || null,
      candidateCount: entry.candidate_count ?? 0,
      winnerSubmissionId: entry.winner_submission_id || null,
      kingDetection: entry.king_detection ?? null,
      bestDetection: entry.best_detection ?? null,
      bestTruePositives: entry.best_true_positives ?? 0,
      achievements: Array.isArray(entry.achievements) ? entry.achievements : [],
      headline: entry.headline || null
    }))
    .reverse();
}

function loadRoundStatus(roundStatusPath) {
  // The competition round writes this file at start (executing) and end
  // (completed); the board renders every entrant until final results.
  const status = readJsonSafe(roundStatusPath);
  if (!status || typeof status !== "object") {
    return null;
  }
  return {
    state: status.state || "idle",
    note: status.note || null,
    generatedAt: status.generated_at || null,
    runId: status.run_id || null,
    repo: status.repo || null,
    king: status.king || null,
    kingAuthor: status.king_author || status.king?.author || null,
    kingSubmissionId: status.king_submission_id || status.king?.submission_id || null,
    winnerSubmissionId: status.winner_submission_id || null,
    entrants: (Array.isArray(status.entrants) ? status.entrants : []).map((entrant) => ({
      ...entrant,
      author: entrant.author || inferSubmissionAuthorFromId(entrant.submission_id)
    })),
    screenedOut: Array.isArray(status.screened_out) ? status.screened_out : [],
    closedExtras: Array.isArray(status.closed_extras) ? status.closed_extras : [],
    skippedStale: Array.isArray(status.skipped_stale) ? status.skipped_stale : []
  };
}

function loadRoundProgress(roundProgressPath) {
  // Live per-candidate progress written by the scoring engine as each candidate
  // and problem finishes; used to animate the round while it is executing.
  const data = readJsonSafe(roundProgressPath);
  if (!data || typeof data !== "object") {
    return null;
  }
  return {
    state: data.state || null,
    runId: data.run_id || null,
    updatedAt: data.updated_at || null,
    projectKeys: Array.isArray(data.project_keys) ? data.project_keys : [],
    king: data.king && typeof data.king === "object" ? data.king : null,
    candidates: Array.isArray(data.candidates) ? data.candidates : []
  };
}

function resolveExistingRoot(explicitPath, fallbackPath) {
  return path.resolve(explicitPath || fallbackPath);
}



function loadEvaluatorLanes({ kataRoot, latestLaneWinners, identityAliases = new Map() }) {
  const lanesRoot = path.join(kataRoot, "lanes");
  const registry = readJsonSafe(path.join(lanesRoot, "registry.json"));
  const laneIds = Array.isArray(registry?.packs)
    ? registry.packs
        .filter((pack) => pack?.active === true)
        .map((pack) => pack?.lane_id)
        .filter(Boolean)
    : listDirectories(lanesRoot);
  return laneIds
    .map((laneId) =>
      loadEvaluatorLane(kataRoot, laneId, latestLaneWinners, identityAliases)
    )
    .filter(Boolean);
}

function loadEvaluatorLane(kataRoot, laneId, latestLaneWinners, identityAliases) {
  const state = loadEvaluatorLaneState(kataRoot, laneId, identityAliases);
  const lane = state?.lane || null;
  if (!lane?.active) {
    return null;
  }
  const subnetPack = lane.subnet_pack || lane.repo_pack || laneId;
  const repoPack = subnetPack;
  const mode = lane.mode || "miner";
  const latestWinner = latestLaneWinners?.[`${subnetPack}::${mode}`] || null;
  const kingAuthor = resolveAuthorAlias(
    inferSubmissionAuthorFromId(state.king?.current_king_submission_id),
    identityAliases
  );
  const king = {
    submissionId: state.king?.current_king_submission_id || null,
    author: kingAuthor,
    challengeRunId: null,
    artifactHash: state.king?.current_king_artifact_hash || null,
    source: state.king?.promotion_source_pr || "evaluator lane",
    updatedAt: state.king?.promotion_timestamp || state.king?.updated_at || null,
    seeded: !state.king?.current_king_submission_id
  };
  // Lane state is authoritative for who holds the king; PR history is only a
  // fallback (it can be incomplete, pending promotion recovery, or stale
  // after a manual lane repair).
  const currentHolder =
    king.author || latestWinner?.author || humanizeKingSource(king.source);
  const latestWinnerMatchesKing =
    Boolean(latestWinner?.author) &&
    (!king.author || latestWinner.author === king.author);
  const selectedProjectsRaw = state.challengeState?.selected_project_keys;
  const selectedProjects = Array.isArray(selectedProjectsRaw)
    ? selectedProjectsRaw
    : [];
  return {
    id: `${subnetPack}:${mode}`,
    subnetPack,
    repoPack,
    repoName: displaySubnetPack(subnetPack),
    repoRef: null,
    mode,
    updatedAt: lane.updated_at || state.king?.updated_at || null,
    kingUpdatedAt: state.king?.updated_at || lane.updated_at || null,
    currentHolder,
    currentHolderMergedAt: latestWinnerMatchesKing ? latestWinner.mergedAt : null,
    currentHolderPullNumber: latestWinnerMatchesKing ? latestWinner.pullNumber : null,
    king,
    projects: selectedProjects.map((projectKey) => ({
      taskId: projectKey,
      title: projectKey,
      tags: ["sn60", "bitsec"]
    })),
    // Project only the derived state the UI consumes; the raw lane files
    // contain internal fields (server paths, full screening payloads) that
    // should not ship to unauthenticated clients.
    evaluatorState: {
      laneId: state.laneId,
      current: state.current
    }
  };
}

function loadEvaluatorLaneState(kataRoot, laneId, identityAliases = new Map()) {
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
      promotionRecord,
      identityAliases
    })
  };
}

function buildEvaluatorCurrentState({
  lane,
  king,
  benchmarkSnapshot,
  challengeState,
  promotionRecord,
  identityAliases = new Map()
}) {
  if (!lane) {
    return null;
  }
  const screening = challengeState?.screening_result || null;
  const finalMetrics = promotionRecord?.final_metrics || {};
  const projectKeysRaw =
    challengeState?.selected_project_keys || benchmarkSnapshot?.project_keys;
  const projectKeys = Array.isArray(projectKeysRaw) ? projectKeysRaw : [];
  return {
    candidateSubmissionId: challengeState?.candidate_submission_id || null,
    candidateAuthor: inferSubmissionAuthorFromId(challengeState?.candidate_submission_id),
    kingSubmissionId: king?.current_king_submission_id || null,
    kingAuthor: resolveAuthorAlias(
      inferSubmissionAuthorFromId(king?.current_king_submission_id),
      identityAliases
    ),
    screeningStatus: screening?.status || null,
    screeningStage: screening?.stage || null,
    screeningReasons: Array.isArray(screening?.reasons) ? screening.reasons : [],
    projectKeys,
    codebasesPassed: promotionRecord?.pass_counts || {},
    truePositives: promotionRecord?.true_positives || {},
    totalFound: {
      candidate: numberOrNull(finalMetrics.candidate_total_found),
      king: numberOrNull(finalMetrics.king_total_found),
      delta:
        finalMetrics.candidate_total_found === undefined || finalMetrics.king_total_found === undefined
          ? null
          : numberOrNull(Number(finalMetrics.candidate_total_found) - Number(finalMetrics.king_total_found))
    },
    totalExpected: {
      candidate: numberOrNull(finalMetrics.candidate_total_expected),
      king: numberOrNull(finalMetrics.king_total_expected),
      delta:
        finalMetrics.candidate_total_expected === undefined || finalMetrics.king_total_expected === undefined
          ? null
          : numberOrNull(Number(finalMetrics.candidate_total_expected) - Number(finalMetrics.king_total_expected))
    },
    precision: {
      candidate: numberOrNull(finalMetrics.candidate_precision),
      king: numberOrNull(finalMetrics.king_precision),
      delta:
        finalMetrics.candidate_precision === undefined || finalMetrics.king_precision === undefined
          ? null
          : numberOrNull(Number(finalMetrics.candidate_precision) - Number(finalMetrics.king_precision))
    },
    f1Scores: {
      candidate: numberOrNull(finalMetrics.candidate_f1_score),
      king: numberOrNull(finalMetrics.king_f1_score),
      delta:
        finalMetrics.candidate_f1_score === undefined || finalMetrics.king_f1_score === undefined
          ? null
          : numberOrNull(Number(finalMetrics.candidate_f1_score) - Number(finalMetrics.king_f1_score))
    },
    invalidRuns: promotionRecord?.invalid_runs || {},
    localReplicaScores: promotionRecord?.local_replica_scores || {},
    finalWinner: promotionRecord?.final_winner || null,
    rewardLabelApplied: promotionRecord?.reward_label_applied || null,
    recordedAt: promotionRecord?.recorded_at || null,
    finalMetrics,
    scores: {
      candidate: numberOrNull(finalMetrics.candidate_aggregated_score),
      king: numberOrNull(finalMetrics.king_aggregated_score),
      delta: numberOrNull(finalMetrics.candidate_aggregated_score_delta)
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
    // readJsonSafe: a single mid-write or corrupt run artifact must not take
    // down the whole status endpoint.
    .map((filePath) => readJsonSafe(filePath))
    .filter(Boolean)
    .map((summary) => {
      const primaryCandidateScore = summary.primary?.variant_scores?.candidate ?? 0;
      const primaryKingScore = summary.primary?.variant_scores?.king ?? 0;
      const subnetPack = inferRepoPackFromSummary(summary);
      const sn60Metrics = loadSn60ActivityMetrics(summary);
      return {
        runId: summary.run_id,
        createdAt: summary.created_at,
        laneId: `${subnetPack}:${summary.mode}`,
        mode: summary.mode,
        subnetPack,
        repoPack: subnetPack,
        promotionReady: Boolean(summary.promotion_ready),
        promotionReason: summary.promotion_reason || null,
        candidateArtifactHash: summary.candidate_artifact_hash || null,
        candidateSubmissionId: inferSubmissionId(summary.candidate_artifact),
        candidateAuthor: inferSubmissionAuthor(summary.candidate_artifact),
        kingArtifactHash: summary.king_artifact_hash || null,
        primary: {
          taskIds: summary.primary?.project_keys || [],
          candidateScore: primaryCandidateScore,
          kingScore: primaryKingScore,
          candidateDelta:
            summary.primary?.candidate_score_delta ??
            primaryCandidateScore - primaryKingScore
        },
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
    invalidRuns: summary.primary?.variant_invalid_runs || {},
    truePositives: {
      candidate: numberOrNull(duel?.candidate?.true_positives),
      king: numberOrNull(duel?.king?.true_positives)
    },
    totalFound: {
      candidate: numberOrNull(duel?.candidate?.total_found),
      king: numberOrNull(duel?.king?.total_found)
    },
    precision: {
      candidate: numberOrNull(duel?.candidate?.precision),
      king: numberOrNull(duel?.king?.precision)
    },
    f1Scores: {
      candidate: numberOrNull(duel?.candidate?.f1_score),
      king: numberOrNull(duel?.king?.f1_score)
    },
    replicaScores: {
      candidate: Array.isArray(duel?.candidate?.replica_results)
        ? duel.candidate.replica_results.map((result) => numberOrNull(result.score)).filter((value) => value !== null)
        : [],
      king: Array.isArray(duel?.king?.replica_results)
        ? duel.king.replica_results.map((result) => numberOrNull(result.score)).filter((value) => value !== null)
        : []
    },
    provenance: {
      sandboxCommit: duel?.sandbox_source?.sandbox_commit || null,
      benchmarkSha256: duel?.sandbox_source?.benchmark_sha256 || null,
      scorerVersion: duel?.sandbox_source?.scorer_version || null,
      projectKeys: duel?.project_keys || summary.primary?.project_keys || []
    }
  };
}

async function loadLeaderboard(env) {
  const cacheTtlMs = readTtlMs(
    env.KATA_LEADERBOARD_CACHE_TTL_MS,
    DEFAULT_LEADERBOARD_CACHE_TTL_MS
  );
  if (cachedLeaderboard && Date.now() - cachedLeaderboardAt < cacheTtlMs) {
    return cachedLeaderboard;
  }
  const leaderboard = await computeLeaderboard(env);
  cachedLeaderboard = leaderboard;
  cachedLeaderboardAt = Date.now();
  return leaderboard;
}

async function computeLeaderboard(env) {
  if (env.KATA_BOARD_EVENT_LOG) {
    try {
      return loadEventLeaderboard(env.KATA_BOARD_EVENT_LOG);
    } catch (error) {
      return {
        source: "unavailable",
        error: error instanceof Error ? error.message : "unknown leaderboard error",
        rows: [],
        latestLaneWinners: {}
      };
    }
  }

  try {
    const leaderboard = await loadGithubLeaderboard({
      repoSlug: env.KATA_REPO_SLUG,
      githubToken: env.KATA_GITHUB_TOKEN
    });
    const localLeaderboard = loadLocalGitWinnerLeaderboard(env.KATA_ROOT);
    if (
      localLeaderboard.rows.length &&
      (leaderboard.source === "github-not-configured" || !leaderboard.rows.length)
    ) {
      return localLeaderboard;
    }
    return leaderboard;
  } catch (error) {
    const localLeaderboard = loadLocalGitWinnerLeaderboard(env.KATA_ROOT);
    if (localLeaderboard.rows.length) {
      return {
        ...localLeaderboard,
        githubError: error instanceof Error ? error.message : "unknown leaderboard error"
      };
    }
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
  const benchmarkExpectedCounts = loadSn60BenchmarkExpectedCounts(roots.sn60BenchmarkFile);
  const visibleJob = queue.activeJob || queue.latestJob;
  const activeEvaluation = loadActiveEvaluationProgress(
    roots.liveStatusPath,
    roots.workRoot,
    visibleJob,
    benchmarkExpectedCounts
  );
  const activePullAuthor = await loadActivePullAuthor(env, visibleJob);
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
    const pull = await githubRequest(
      `/repos/${activeJob.kataRepo}/pulls/${activeJob.pullNumber}`,
      env.KATA_GITHUB_TOKEN
    );
    const user = pull?.user || {};
    const head = pull?.head || {};
    const headRepo = head.repo || {};
    return {
      login: typeof user.login === "string" ? user.login : null,
      avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
      htmlUrl: typeof user.html_url === "string" ? user.html_url : null,
      pullUrl: typeof pull.html_url === "string" ? pull.html_url : null,
      headRepo: typeof headRepo.full_name === "string" ? headRepo.full_name : null,
      headSha: typeof head.sha === "string" ? head.sha : null
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
    candidatePullUrl: pullAuthor.pullUrl,
    candidateAgentUrl: buildCandidateAgentUrl(activeEvaluation, pullAuthor),
    candidateAuthor: pullAuthor.login
  };
}

function buildCandidateAgentUrl(activeEvaluation, pullAuthor) {
  if (
    !pullAuthor?.headRepo ||
    !pullAuthor?.headSha ||
    !activeEvaluation?.candidateSubmissionId
  ) {
    return null;
  }
  const agentPath = [
    "submissions",
    activeEvaluation.subnetPack || activeEvaluation.repoPack || "sn60__bitsec",
    activeEvaluation.mode || "miner",
    activeEvaluation.candidateSubmissionId,
    "agent.py"
  ].join("/");
  return `https://github.com/${pullAuthor.headRepo}/blob/${pullAuthor.headSha}/${agentPath}`;
}

function loadQueueStatus(queueStatePath, healthQueuePayload = null) {
  const queuePayload = readJsonSafe(queueStatePath);
  if (!queuePayload) {
    return queueStatusFromHealth(healthQueuePayload);
  }
  const jobs = Array.isArray(queuePayload?.jobs)
    ? queuePayload.jobs.filter((job) => job && typeof job === "object")
    : [];
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

function loadActiveEvaluationProgress(
  liveStatusPath,
  workRoot,
  activeJob,
  benchmarkExpectedCounts = new Map()
) {
  const baseState = evaluationJobState(activeJob);
  const base = {
    available: Boolean(activeJob),
    state: baseState,
    phase: baseState,
    workspacePath: null,
    updatedAt: null,
    subnetPack: null,
    repoPack: null,
    mode: null,
    candidateSubmissionId: null,
    candidateAuthor: null,
    kataRepo: activeJob?.kataRepo || null,
    pullNumber: activeJob?.pullNumber || null,
    startedAt: activeJob?.startedAt || null,
    finishedAt: activeJob?.finishedAt || null,
    enqueuedAt: activeJob?.enqueuedAt || null,
    attempts: activeJob?.attempts || 0,
    finalAction: activeJob?.finalAction || null,
    finalReason: activeJob?.finalReason || null,
    primary: null
  };
  if (!activeJob) {
    return base;
  }

  const liveStatus = loadLiveEvaluationProgress(liveStatusPath, activeJob);
  const workspace = findActiveWorkspaceProgress(
    workRoot,
    activeJob,
    liveStatus,
    benchmarkExpectedCounts
  );
  const workspaceRoot = workspace?.workspaceRoot || null;
  const lane = workspace?.lane || null;
  const phaseProgress = workspace?.phaseProgress || null;
  const sn60Final = phaseProgress?.sn60 || null;
  const phaseScreeningFailed = sn60Final?.screeningStatus === "failed";
  if (liveStatus || phaseProgress || lane) {
    return {
      ...base,
      ...(liveStatus || {}),
      workspacePath: liveStatus?.workspacePath || workspaceRoot || null,
      updatedAt:
        liveStatus?.updatedAt ||
        phaseProgress?.updatedAt ||
        (workspaceRoot ? statMtimeIso(workspaceRoot) : null) ||
        activeJob.startedAt ||
        activeJob.enqueuedAt,
      subnetPack:
        liveStatus?.subnetPack || lane?.subnetPack || lane?.repoPack || null,
      repoPack:
        liveStatus?.repoPack || lane?.subnetPack || lane?.repoPack || null,
      mode: liveStatus?.mode || lane?.mode || null,
      candidateSubmissionId:
        liveStatus?.candidateSubmissionId || lane?.submissionId || null,
      candidateAuthor:
        liveStatus?.candidateAuthor ||
        (lane?.submissionId ? inferSubmissionAuthorFromId(lane.submissionId) : null),
      screeningStatus: liveStatus?.screeningStatus || sn60Final?.screeningStatus || null,
      screeningStage: liveStatus?.screeningStage || sn60Final?.screeningStage || null,
      screeningReasons: liveStatus?.screeningReasons?.length
        ? liveStatus.screeningReasons
        : sn60Final?.screeningReasons || [],
      finalReason:
        (phaseScreeningFailed ? phaseProgress?.promotionReason : null) ||
        liveStatus?.finalReason ||
        phaseProgress?.promotionReason ||
        activeJob.finalReason ||
        null,
      primary: liveStatus?.primary || phaseProgress?.primary || null
    };
  }
  return base;
}

function evaluationJobState(job) {
  if (!job) {
    return "idle";
  }
  if (job.status === "completed") {
    return "completed";
  }
  if (job.status === "failed") {
    return "failed";
  }
  if (job.status === "pending") {
    return "queued";
  }
  return "running";
}

function loadLiveEvaluationProgress(liveStatusPath, activeJob) {
  const payload = readJsonSafe(liveStatusPath);
  if (
    !payload ||
    typeof payload !== "object" ||
    !payload.job ||
    typeof payload.job !== "object" ||
    payload.job.job_id !== activeJob.jobId
  ) {
    return null;
  }
  const primary = normalizeLivePool(payload.pools?.primary, true);
  const laneId = payload.lane_id || null;
  return {
    available: true,
    state: payload.state || "running",
    phase: payload.phase || "running",
    workspacePath: null,
    updatedAt: payload.updated_at || null,
    laneId,
    subnetPack: payload.subnet_pack || payload.repo_pack || laneId,
    repoPack: payload.subnet_pack || payload.repo_pack || laneId,
    mode: payload.mode || (laneId === "sn60__bitsec" ? "miner" : null),
    candidateSubmissionId: payload.candidate_submission_id || null,
    candidateGithubLogin: payload.candidate_github_login || null,
    candidateAvatarUrl: payload.candidate_avatar_url || null,
    candidateGithubUrl: payload.candidate_github_url || null,
    screening: {
      projectKey: payload.screening_project_key || null,
      startedAt: payload.screening_started_at || null,
      timeoutSeconds: numberOrNull(payload.screening_timeout_seconds),
      timeoutAt: payload.screening_timeout_at || null
    },
    screeningStatus: payload.screening_status || null,
    screeningStage: payload.screening_stage || null,
    screeningReasons: Array.isArray(payload.screening_reasons) ? payload.screening_reasons : [],
    candidateAuthor:
      payload.candidate_github_login ||
      payload.candidate_author ||
      inferSubmissionAuthorFromId(payload.candidate_submission_id),
    projectKeys: Array.isArray(payload.project_keys) ? payload.project_keys : [],
    replicasPerProject: Number(payload.replicas_per_project || 0) || null,
    finalAction: payload.final_action || activeJob.finalAction || null,
    finalReason: payload.final_reason || null,
    kataRepo: payload.job.kata_repo || activeJob.kataRepo || null,
    pullNumber: payload.job.pull_number || activeJob.pullNumber || null,
    startedAt: payload.job.started_at || activeJob.startedAt || null,
    finishedAt: payload.job.finished_at || activeJob.finishedAt || null,
    enqueuedAt: payload.job.enqueued_at || activeJob.enqueuedAt || null,
    attempts: payload.job.attempts ?? activeJob.attempts ?? 0,
    primary
  };
}

function normalizeLivePool(pool, revealTaskIds) {
  if (!pool) {
    return null;
  }
  const rawTasks = Array.isArray(pool.task_statuses) ? pool.task_statuses : [];
  const taskStatuses = rawTasks
    .filter((task) => task && typeof task === "object")
    .map((task) => ({
      taskId: revealTaskIds ? task.task_id || null : null,
      status: task.status || "queued",
      completed: Boolean(task.completed),
      candidate: normalizeLiveVariant(task.candidate),
      king: normalizeLiveVariant(task.king)
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
    scores: normalizeVariantNumberMap(pool.scores),
    passCounts: normalizeVariantNumberMap(pool.pass_counts),
    truePositives: normalizeVariantNumberMap(pool.true_positives),
    totalFound: normalizeVariantNumberMap(pool.total_found),
    invalidRuns: normalizeVariantNumberMap(pool.invalid_runs),
    replicaProgress: normalizeReplicaProgress(pool.replica_progress),
    projectKeys: Array.isArray(pool.project_keys) ? pool.project_keys : [],
    updatedAt: pool.updated_at || null
  };
}

function normalizeVariantNumberMap(value) {
  const payload = value && typeof value === "object" ? value : {};
  return {
    king: numberOrNull(payload.king),
    candidate: numberOrNull(payload.candidate),
    delta: numberOrNull(payload.delta)
  };
}

function normalizeReplicaProgress(value) {
  const payload = value && typeof value === "object" ? value : {};
  return {
    king: normalizeReplicaProgressSide(payload.king),
    candidate: normalizeReplicaProgressSide(payload.candidate)
  };
}

function normalizeReplicaProgressSide(value) {
  const payload = value && typeof value === "object" ? value : {};
  return {
    completed: Number(payload.completed || 0),
    total: Number(payload.total || 0)
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
    weightedTaskScore: numberOrNull(variant?.weighted_task_score),
    completedReplicas: Number(variant?.completed_replicas ?? variant?.completedReplicas ?? 0),
    totalReplicas: Number(variant?.total_replicas ?? variant?.totalReplicas ?? 0)
  };
}

function findActiveWorkspaceProgress(
  workRoot,
  activeJob,
  liveStatus,
  benchmarkExpectedCounts = new Map()
) {
  const workspaces = listActiveWorkspaces(workRoot);
  if (!workspaces.length) {
    return null;
  }

  const candidates = workspaces.map((workspaceRoot) => {
    const lane = inferLaneFromWorkspace(workspaceRoot);
    const phaseProgress =
      inspectChallengePhase(
        path.join(workspaceRoot, "runs-confirm"),
        "confirm",
        liveStatus?.projectKeys || [],
        liveStatus?.replicasPerProject,
        benchmarkExpectedCounts
      ) ||
      inspectChallengePhase(
        path.join(workspaceRoot, "runs-initial"),
        "initial",
        liveStatus?.projectKeys || [],
        liveStatus?.replicasPerProject,
        benchmarkExpectedCounts
      );
    return {
      workspaceRoot,
      lane,
      phaseProgress,
      score: activeWorkspaceScore({ workspaceRoot, lane, phaseProgress, activeJob, liveStatus }),
      updatedAt:
        phaseProgress?.updatedAt ||
        newestMtimeIso(workspaceRoot) ||
        statMtimeIso(workspaceRoot)
    };
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
  });
  return candidates[0] || null;
}

function listActiveWorkspaces(workRoot) {
  if (!fs.existsSync(workRoot)) {
    return [];
  }
  try {
    return fs
      .readdirSync(workRoot, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("kata-bot-job-")
      )
      .map((entry) => path.join(workRoot, entry.name));
  } catch {
    return [];
  }
}

function activeWorkspaceScore({ workspaceRoot, lane, phaseProgress, activeJob, liveStatus }) {
  let score = 0;
  if (phaseProgress?.primary) {
    score += 100;
  }
  if (phaseProgress) {
    score += 25;
  }
  if (
    liveStatus?.candidateSubmissionId &&
    lane?.submissionId === liveStatus.candidateSubmissionId
  ) {
    score += 1000;
  }
  if (
    liveStatus?.subnetPack &&
    lane?.subnetPack === liveStatus.subnetPack &&
    (!liveStatus.mode || lane?.mode === liveStatus.mode)
  ) {
    score += 200;
  }
  const latest = newestMtimeIso(workspaceRoot) || statMtimeIso(workspaceRoot);
  if (
    activeJob?.startedAt &&
    latest &&
    new Date(latest).getTime() >= new Date(activeJob.startedAt).getTime() - 60_000
  ) {
    score += 10;
  }
  return score;
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
      subnetPack: match[1],
      repoPack: match[1],
      mode: match[2],
      submissionId: match[3]
    };
  }
  return null;
}

function inspectChallengePhase(
  phaseRoot,
  phase,
  selectedProjectKeys = [],
  replicasPerProject = null,
  benchmarkExpectedCounts = new Map()
) {
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
      primary: null
    };
  }
  const challengeRoot = challengeRoots[0];
  const summaryPath = path.join(challengeRoot, "challenge_summary.json");
  const summary = readJsonSafe(summaryPath);
  const sn60Progress = inspectSn60Progress(
    challengeRoot,
    summary,
    selectedProjectKeys,
    replicasPerProject,
    benchmarkExpectedCounts
  );
  const sn60Metrics = summary ? loadSn60ActivityMetrics(summary) : null;
  if (sn60Progress) {
    return {
      state: summary ? "verifying" : "running",
      phase,
      runId: path.basename(challengeRoot),
      promotionReason: summary?.promotion_reason || null,
      sn60: sn60Metrics,
      updatedAt:
        summary?.created_at ||
        sn60Progress.updatedAt ||
        statMtimeIso(summaryPath) ||
        statMtimeIso(challengeRoot),
      primary: sn60Progress
    };
  }
  return {
    state: summary ? "verifying" : "running",
    phase,
    runId: path.basename(challengeRoot),
    promotionReason: summary?.promotion_reason || null,
    sn60: sn60Metrics,
    updatedAt:
      summary?.created_at ||
      statMtimeIso(summaryPath) ||
      statMtimeIso(challengeRoot),
    primary: inspectPoolProgress(path.join(challengeRoot, "primary"), true)
  };
}

function inspectSn60Progress(
  runRoot,
  summary,
  selectedProjectKeys = [],
  replicasPerProject = null,
  benchmarkExpectedCounts = new Map()
) {
  const runId = path.basename(runRoot);
  if (runId.startsWith("sn60-screening-")) {
    const screening = readJsonSafe(path.join(runRoot, "screening_result.json"));
    const screeningProjectKey = screening?.project_key || selectedProjectKeys[0] || "screening";
    const screeningStatus = screening
      ? screening.status === "passed"
        ? "screening passed"
        : "screening failed"
      : "screening running";
    return {
      live: !summary,
      totalTasks: 1,
      completedTasks: screening ? 1 : 0,
      taskStatuses: [
        {
          taskId: screeningProjectKey,
          status: screeningStatus,
          completed: Boolean(screening),
          candidate: {
            started: true,
            finished: Boolean(screening),
            solved: screening?.status === "passed",
            valid: screening?.status === "passed",
            success: screening?.status === "passed",
            verifierScore: null,
            weightedTaskScore: null
          },
          king: {
            started: false,
            finished: false,
            solved: false,
            valid: false,
            success: false,
            verifierScore: null,
            weightedTaskScore: null
          }
        }
      ],
      counts: screening
        ? { [screening.status === "passed" ? "screening passed" : "screening failed"]: 1 }
        : { screening: 1 },
      scores: { king: null, candidate: null, delta: null },
      passCounts: { king: 0, candidate: 0, delta: 0 },
      truePositives: { king: 0, candidate: 0, delta: 0 },
      totalFound: { king: 0, candidate: 0, delta: 0 },
      invalidRuns: { king: 0, candidate: screening?.status === "failed" ? 1 : 0, delta: null },
      replicaProgress: {
        king: { completed: 0, total: 0 },
        candidate: { completed: screening ? 1 : 0, total: 1 }
      },
      projectKeys: screeningProjectKey === "screening" ? [] : [screeningProjectKey],
      updatedAt: statMtimeIso(path.join(runRoot, "screening_result.json")) || statMtimeIso(runRoot)
    };
  }
  if (!runId.startsWith("sn60-duel-")) {
    return null;
  }
  if (summary?.primary) {
    return summarizeSn60SummaryPrimary(summary, runRoot);
  }
  return summarizeRunningSn60Duel(
    runRoot,
    selectedProjectKeys,
    replicasPerProject,
    benchmarkExpectedCounts
  );
}

function summarizeSn60SummaryPrimary(summary, runRoot) {
  const primary = summary.primary || {};
  const duel = readJsonSafe(resolveRunManifestPath(summary, runRoot));
  const candidate = duel?.candidate || {};
  const king = duel?.king || {};
  const candidateScore = numberOrNull(primary.variant_scores?.candidate);
  const kingScore = numberOrNull(primary.variant_scores?.king);
  const passCounts = primary.variant_successes || {};
  const invalidRuns = primary.variant_invalid_runs || {};
  const projectKeys = Array.isArray(primary.project_keys) ? primary.project_keys : [];
  return {
    live: false,
    totalTasks: projectKeys.length,
    completedTasks: projectKeys.length,
    taskStatuses: [],
    counts: {},
    scores: {
      king: kingScore === null ? null : kingScore / 100,
      candidate: candidateScore === null ? null : candidateScore / 100,
      delta:
        candidateScore === null || kingScore === null
          ? null
          : (candidateScore - kingScore) / 100
    },
    passCounts: {
      king: numberOrNull(passCounts.king),
      candidate: numberOrNull(passCounts.candidate),
      delta: null
    },
    truePositives: {
      king: numberOrNull(king.true_positives),
      candidate: numberOrNull(candidate.true_positives),
      delta: numberDelta(candidate.true_positives, king.true_positives)
    },
    totalFound: {
      king: numberOrNull(king.total_found),
      candidate: numberOrNull(candidate.total_found),
      delta: numberDelta(candidate.total_found, king.total_found)
    },
    totalExpected: {
      king: numberOrNull(king.total_expected),
      candidate: numberOrNull(candidate.total_expected),
      delta: numberDelta(candidate.total_expected, king.total_expected)
    },
    precision: {
      king: numberOrNull(king.precision),
      candidate: numberOrNull(candidate.precision),
      delta: numberDelta(candidate.precision, king.precision)
    },
    f1Scores: {
      king: numberOrNull(king.f1_score),
      candidate: numberOrNull(candidate.f1_score),
      delta: numberDelta(candidate.f1_score, king.f1_score)
    },
    invalidRuns: {
      king: numberOrNull(invalidRuns.king),
      candidate: numberOrNull(invalidRuns.candidate),
      delta: null
    },
    replicaProgress: {
      king: { completed: 0, total: 0 },
      candidate: { completed: 0, total: 0 }
    },
    projectKeys,
    updatedAt: summary.created_at || statMtimeIso(runRoot)
  };
}

function summarizeRunningSn60Duel(
  runRoot,
  selectedProjectKeys = [],
  replicasPerProject = null,
  benchmarkExpectedCounts = new Map()
) {
  const expectedReplicas = positiveIntegerOrNull(replicasPerProject);
  const king = summarizeSn60VariantProgress(
    path.join(runRoot, "king"),
    selectedProjectKeys,
    expectedReplicas,
    benchmarkExpectedCounts
  );
  const candidate = summarizeSn60VariantProgress(
    path.join(runRoot, "candidate"),
    selectedProjectKeys,
    expectedReplicas,
    benchmarkExpectedCounts
  );
  const projectKeys = [
    ...new Set([...selectedProjectKeys, ...king.projectKeys, ...candidate.projectKeys])
  ].sort();
  const totalProjects = projectKeys.length || Math.max(king.projectCount, candidate.projectCount, 1);
  const taskStatuses = projectKeys.map((projectKey) => {
    const kingProject = king.projects.get(projectKey) || emptySn60ProjectProgress(projectKey);
    const candidateProject =
      candidate.projects.get(projectKey) || emptySn60ProjectProgress(projectKey);
    return {
      taskId: projectKey,
      status:
        candidateProject.finished && kingProject.finished
          ? exactTaskStatusLabel(candidateProject, kingProject)
          : runningTaskStatusLabel(candidateProject, kingProject),
      completed: candidateProject.finished && kingProject.finished,
      candidate: sn60ProjectToLiveVariant(candidateProject),
      king: sn60ProjectToLiveVariant(kingProject)
    };
  });
  const completedTasks = taskStatuses.filter((task) => task.completed);
  const completedCandidatePasses = completedTasks.filter((task) => task.candidate.solved).length;
  const completedKingPasses = completedTasks.filter((task) => task.king.solved).length;
  const completedCandidateTruePositives = completedTasks.reduce(
    (total, task) => total + Number(task.candidate.truePositives || 0),
    0
  );
  const completedKingTruePositives = completedTasks.reduce(
    (total, task) => total + Number(task.king.truePositives || 0),
    0
  );
  const completedCandidateExpected = completedTasks.reduce(
    (total, task) => total + Number(task.candidate.totalExpected || 0),
    0
  );
  const completedKingExpected = completedTasks.reduce(
    (total, task) => total + Number(task.king.totalExpected || 0),
    0
  );
  const completedCandidateFound = completedTasks.reduce(
    (total, task) => total + Number(task.candidate.totalFound || 0),
    0
  );
  const completedKingFound = completedTasks.reduce(
    (total, task) => total + Number(task.king.totalFound || 0),
    0
  );
  const candidateScore = completedCandidateExpected
    ? completedCandidateTruePositives / completedCandidateExpected
    : 0;
  const kingScore = completedKingExpected
    ? completedKingTruePositives / completedKingExpected
    : 0;
  const candidatePrecision = completedCandidateFound
    ? completedCandidateTruePositives / completedCandidateFound
    : 0;
  const kingPrecision = completedKingFound
    ? completedKingTruePositives / completedKingFound
    : 0;
  const candidateF1 = f1Score(candidateScore, candidatePrecision);
  const kingF1 = f1Score(kingScore, kingPrecision);
  return {
    live: true,
    totalTasks: totalProjects,
    completedTasks: completedTasks.length,
    taskStatuses,
    counts: summarizeTaskStatusCounts(taskStatuses),
    scores: {
      king: kingScore,
      candidate: candidateScore,
      delta: candidateScore - kingScore
    },
    passCounts: {
      king: completedKingPasses,
      candidate: completedCandidatePasses,
      delta: completedCandidatePasses - completedKingPasses
    },
    truePositives: {
      king: completedKingTruePositives,
      candidate: completedCandidateTruePositives,
      delta: completedCandidateTruePositives - completedKingTruePositives
    },
    totalFound: {
      king: completedKingFound,
      candidate: completedCandidateFound,
      delta: completedCandidateFound - completedKingFound
    },
    totalExpected: {
      king: completedKingExpected,
      candidate: completedCandidateExpected,
      delta: completedCandidateExpected - completedKingExpected
    },
    precision: {
      king: kingPrecision,
      candidate: candidatePrecision,
      delta: candidatePrecision - kingPrecision
    },
    f1Scores: {
      king: kingF1,
      candidate: candidateF1,
      delta: candidateF1 - kingF1
    },
    invalidRuns: {
      king: king.invalidRuns,
      candidate: candidate.invalidRuns,
      delta: candidate.invalidRuns - king.invalidRuns
    },
    replicaProgress: {
      king: { completed: king.completedReplicas, total: king.totalReplicas },
      candidate: {
        completed: candidate.completedReplicas,
        total: candidate.totalReplicas
      }
    },
    projectKeys,
    updatedAt: newestMtimeIso(runRoot) || statMtimeIso(runRoot)
  };
}

function summarizeSn60VariantProgress(
  variantRoot,
  selectedProjectKeys = [],
  expectedReplicas = null,
  benchmarkExpectedCounts = new Map()
) {
  const projects = new Map();
  for (const projectKey of selectedProjectKeys) {
    projects.set(
      projectKey,
      summarizeSn60ProjectProgress(
        path.join(variantRoot, projectKey),
        projectKey,
        expectedReplicas,
        benchmarkExpectedCounts
      )
    );
  }
  if (!fs.existsSync(variantRoot)) {
    const projectList = [...projects.values()];
    return {
      projectKeys: projectList.map((project) => project.projectKey),
      projectCount: projectList.length,
      projects,
      codebasesPassed: 0,
      truePositives: 0,
      invalidRuns: 0,
      completedReplicas: 0,
      totalReplicas: projectList.reduce(
        (total, project) => total + project.totalReplicas,
        0
      )
    };
  }
  for (const projectKey of listDirectories(variantRoot).sort()) {
    const project = summarizeSn60ProjectProgress(
      path.join(variantRoot, projectKey),
      projectKey,
      expectedReplicas,
      benchmarkExpectedCounts
    );
    projects.set(projectKey, project);
  }
  const projectList = [...projects.values()];
  return {
    projectKeys: projectList.map((project) => project.projectKey),
    projectCount: projectList.length,
    projects,
    codebasesPassed: projectList.filter((project) => project.solved).length,
    truePositives: projectList.reduce(
      (total, project) => total + project.truePositives,
      0
    ),
    invalidRuns: projectList.reduce(
      (total, project) => total + project.invalidRuns,
      0
    ),
    completedReplicas: projectList.reduce(
      (total, project) => total + project.completedReplicas,
      0
    ),
    totalReplicas: projectList.reduce(
      (total, project) => total + project.totalReplicas,
      0
    )
  };
}

function summarizeSn60ProjectProgress(
  projectRoot,
  projectKey,
  expectedReplicas = null,
  benchmarkExpectedCounts = new Map()
) {
  const replicaRoots = listDirectories(projectRoot)
    .filter((name) => name.startsWith("replica-"))
    .map((name) => path.join(projectRoot, name))
    .sort();
  const replicas = replicaRoots.map((replicaRoot) =>
    summarizeSn60ReplicaProgress(replicaRoot, projectKey, benchmarkExpectedCounts)
  );
  const completedReplicas = replicas.filter((replica) => replica.finished).length;
  const passCount = replicas.filter((replica) => replica.result === "PASS").length;
  const totalReplicas = expectedReplicas || replicas.length;
  const truePositives = replicas.reduce(
    (total, replica) => total + replica.truePositives,
    0
  );
  const totalExpected = replicas.reduce(
    (total, replica) => total + replica.totalExpected,
    0
  );
  const totalFound = replicas.reduce(
    (total, replica) => total + replica.totalFound,
    0
  );
  const detectionRate = totalExpected ? truePositives / totalExpected : 0;
  const precision = totalFound ? truePositives / totalFound : 0;
  return {
    projectKey,
    started: replicas.some((replica) => replica.started),
    finished: totalReplicas > 0 && completedReplicas >= totalReplicas,
    solved: projectPasses(passCount, totalReplicas),
    valid: replicas.every((replica) => replica.valid),
    success: replicas.some((replica) => replica.success),
    verifierScore: totalExpected ? detectionRate : null,
    weightedTaskScore: totalExpected ? detectionRate : null,
    truePositives,
    totalExpected,
    totalFound,
    precision,
    f1Score: f1Score(detectionRate, precision),
    invalidRuns: replicas.filter((replica) => replica.finished && !replica.valid).length,
    completedReplicas,
    totalReplicas
  };
}

function summarizeSn60ReplicaProgress(
  replicaRoot,
  projectKey,
  benchmarkExpectedCounts = new Map()
) {
  const reportPath = findFirstExistingFile([
    path.join(replicaRoot, "reports", projectKey, "report.json"),
    path.join(replicaRoot, "report.json")
  ]);
  const evaluationPath = findFirstExistingFile([
    path.join(replicaRoot, "reports", projectKey, "evaluation.json"),
    path.join(replicaRoot, "evaluation.json")
  ]);
  const evaluation = evaluationPath ? readJsonSafe(evaluationPath) : null;
  const status = normalizeEvaluationStatus(evaluation?.status);
  const result = evaluation?.result && typeof evaluation.result === "object"
    ? evaluation.result
    : {};
  const valid = !evaluation || status === "success";
  const fallbackExpected = Number(benchmarkExpectedCounts.get(projectKey) || 0);
  return {
    started: Boolean(reportPath || evaluationPath || fs.existsSync(replicaRoot)),
    finished: Boolean(evaluation),
    valid,
    success: status === "success",
    result: status === "success" ? String(result.result || "") : null,
    truePositives:
      status === "success" ? Number(result.true_positives || 0) || 0 : 0,
    totalExpected:
      status === "success"
        ? Number(result.total_expected || 0) || 0
        : fallbackExpected,
    totalFound:
      status === "success" ? Number(result.total_found || 0) || 0 : 0
  };
}

function emptySn60ProjectProgress(projectKey) {
  return {
    projectKey,
    started: false,
    finished: false,
    solved: false,
    valid: false,
    success: false,
    verifierScore: null,
    weightedTaskScore: null,
    truePositives: 0,
    totalExpected: 0,
    totalFound: 0,
    precision: 0,
    f1Score: 0,
    invalidRuns: 0,
    completedReplicas: 0,
    totalReplicas: 0
  };
}

function sn60ProjectToLiveVariant(project) {
  return {
    started: Boolean(project.started),
    finished: Boolean(project.finished),
    solved: Boolean(project.solved),
    valid: Boolean(project.valid),
    success: Boolean(project.success),
    verifierScore: numberOrNull(project.verifierScore),
    weightedTaskScore: numberOrNull(project.weightedTaskScore),
    truePositives: Number(project.truePositives || 0),
    totalExpected: Number(project.totalExpected || 0),
    totalFound: Number(project.totalFound || 0),
    precision: numberOrNull(project.precision),
    f1Score: numberOrNull(project.f1Score),
    completedReplicas: Number(project.completedReplicas || 0),
    totalReplicas: Number(project.totalReplicas || 0)
  };
}

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function projectPasses(passCount, replicaCount) {
  if (!replicaCount) {
    return false;
  }
  return passCount * 3 >= replicaCount * 2;
}

function f1Score(detectionRate, precision) {
  const recall = Number(detectionRate || 0);
  const precise = Number(precision || 0);
  return recall + precise > 0 ? (2 * recall * precise) / (recall + precise) : 0;
}

function normalizeEvaluationStatus(value) {
  return String(value || "pending").toLowerCase().split(".").pop();
}

function findFirstExistingFile(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) || null;
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
    const king = summarizeTaskVariant(task, "king");
    return {
      taskId: revealTaskIds ? task.task_id : null,
      status: exactTaskStatusLabel(candidate, king),
      completed: true,
      candidate,
      king
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
  const king = summarizeRunningVariant(path.join(taskRoot, "king"));
  const taskId = path.basename(taskRoot);
  return {
    taskId: revealTaskIds ? taskId : null,
    status: runningTaskStatusLabel(candidate, king),
    completed: candidate.finished && king.finished,
    candidate,
    king
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

function exactTaskStatusLabel(candidate, king) {
  if (!candidate.valid) {
    return "candidate invalid";
  }
  if (candidate.solved && !king.solved) {
    return "candidate leads";
  }
  if (candidate.solved && king.solved) {
    return "both verified";
  }
  if (!candidate.solved && king.solved) {
    return "king leads";
  }
  return "no verified findings";
}

function runningTaskStatusLabel(candidate, king) {
  if (candidate.finished && !candidate.valid) {
    return "candidate invalid";
  }
  if (king.finished && !king.valid) {
    return "king invalid";
  }
  if (candidate.finished && king.finished) {
    return "finished";
  }
  if (candidate.started || king.started) {
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

function newestMtimeIso(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return null;
  }
  let newest = fs.statSync(rootPath, { throwIfNoEntry: false })?.mtimeMs || 0;
  walk(rootPath, (absolutePath) => {
    const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (stat?.mtimeMs && stat.mtimeMs > newest) {
      newest = stat.mtimeMs;
    }
  });
  return newest ? new Date(newest).toISOString() : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberDelta(left, right) {
  const leftNumber = numberOrNull(left);
  const rightNumber = numberOrNull(right);
  return leftNumber === null || rightNumber === null ? null : leftNumber - rightNumber;
}

function resolveRunManifestPath(summary, runRoot) {
  const manifestPath = String(summary?.manifest_path || "");
  if (!manifestPath) {
    return path.join(runRoot, "duel_summary.json");
  }
  return path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(runRoot, manifestPath);
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
      payload: sanitizeValidatorHealthPayload(payload),
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

function sanitizeValidatorHealthPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const queue = payload.queue && typeof payload.queue === "object" ? payload.queue : null;
  return {
    status: typeof payload.status === "string" ? payload.status : null,
    service: typeof payload.service === "string" ? payload.service : null,
    queue: queue
      ? {
          total_jobs: numberOrNull(queue.total_jobs) ?? 0,
          pending_jobs: numberOrNull(queue.pending_jobs) ?? 0,
          running_jobs: numberOrNull(queue.running_jobs) ?? 0,
          completed_jobs: numberOrNull(queue.completed_jobs) ?? 0,
          failed_jobs: numberOrNull(queue.failed_jobs) ?? 0
        }
      : null
  };
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
    finalReason: job.final_reason || null,
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
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      // Skip partial or corrupt lines (e.g. the tail of an in-progress
      // append) instead of failing the whole leaderboard.
      continue;
    }
    // A parseable-but-non-object line (e.g. literal `null`) must not take out
    // the whole leaderboard either.
    if (!item || typeof item !== "object") {
      continue;
    }
    const author = item.author || "unknown";
    const laneKey = `${item.subnet_pack || item.repo_pack || "unknown"}::${item.mode || "unknown"}`;
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions += 1;
    if (item.final_action === "merge") {
      entry.wins += 1;
      entry.winnerPulls.push({
        pullNumber: item.pull_number || null,
        mergedAt: item.created_at
      });
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

  return {
    source: "events",
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function loadLocalGitWinnerLeaderboard(kataRoot) {
  const resolvedRoot = kataRoot ? path.resolve(kataRoot) : null;
  if (!resolvedRoot || !fs.existsSync(path.join(resolvedRoot, ".git"))) {
    return {
      source: "local-git",
      rows: [],
      latestLaneWinners: {}
    };
  }

  const commits = loadLocalGitCommits(resolvedRoot);
  if (!commits.length) {
    return {
      source: "local-git",
      rows: [],
      latestLaneWinners: {}
    };
  }

  const mergeCommitsByPull = new Map();
  for (const commit of commits) {
    const pullNumber = extractPullNumberFromSquashSubject(commit.subject);
    if (!pullNumber) {
      continue;
    }
    const existing = mergeCommitsByPull.get(pullNumber);
    if (!existing || new Date(commit.authorDate) > new Date(existing.authorDate)) {
      mergeCommitsByPull.set(pullNumber, commit);
    }
  }

  const byAuthor = new Map();
  const latestLaneWinners = new Map();
  for (const promotion of commits) {
    const pullNumber = extractPromotedPullNumber(promotion.subject);
    if (!pullNumber) {
      continue;
    }
    const mergeCommit = mergeCommitsByPull.get(pullNumber);
    if (!mergeCommit) {
      continue;
    }
    const author = inferGitHubAuthorFromCommit(mergeCommit);
    if (!author) {
      continue;
    }

    const mergedAt = normalizeIsoDate(mergeCommit.authorDate) || normalizeIsoDate(promotion.authorDate);
    const laneKey = "sn60__bitsec::miner";
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions = Math.max(entry.totalSubmissions || 0, 1);
    entry.wins += 1;
    entry.winnerPulls.push({ pullNumber, mergedAt });
    entry.lastActivityAt = maxDate(entry.lastActivityAt, mergedAt);
    if (entry.recentPulls.length < 4) {
      entry.recentPulls.push({
        number: pullNumber,
        title: mergeCommit.subject,
        htmlUrl: null,
        state: "merged",
        updatedAt: mergedAt
      });
    }
    byAuthor.set(author, entry);

    const current = latestLaneWinners.get(laneKey);
    if (!current || new Date(mergedAt) > new Date(current.mergedAt || 0)) {
      latestLaneWinners.set(laneKey, {
        author,
        mergedAt,
        pullNumber
      });
    }
  }

  return {
    source: "local-git",
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function loadLocalGitCommits(kataRoot) {
  try {
    const output = execFileSync(
      "git",
      [
        "-C",
        kataRoot,
        "log",
        "--all",
        "--date=iso-strict",
        "--pretty=format:%H%x1f%aI%x1f%cI%x1f%an%x1f%ae%x1f%s%x1e"
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    return output
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map(parseLocalGitCommit)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseLocalGitCommit(record) {
  const parts = record.split("\x1f");
  if (parts.length < 6) {
    return null;
  }
  return {
    hash: parts[0],
    authorDate: parts[1],
    committerDate: parts[2],
    authorName: parts[3],
    authorEmail: parts[4],
    subject: parts.slice(5).join("\x1f")
  };
}

function extractPromotedPullNumber(subject) {
  const match = String(subject || "").match(/^chore: promote king from PR #(\d+)\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractPullNumberFromSquashSubject(subject) {
  const match = String(subject || "").match(/\(#(\d+)\)\s*$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferGitHubAuthorFromCommit(commit) {
  const emailLogin = String(commit.authorEmail || "").match(
    /^\d+\+([^@]+)@users\.noreply\.github\.com$/i
  );
  if (emailLogin?.[1]) {
    return emailLogin[1];
  }
  const plainNoreplyLogin = String(commit.authorEmail || "").match(
    /^([^@]+)@users\.noreply\.github\.com$/i
  );
  if (plainNoreplyLogin?.[1] && plainNoreplyLogin[1] !== "kata-bot") {
    return plainNoreplyLogin[1];
  }
  const submissionId = String(commit.subject || "").match(
    /([A-Za-z0-9][A-Za-z0-9_-]*-\d{8}-\d+)/
  );
  if (submissionId?.[1]) {
    return inferSubmissionAuthorFromId(submissionId[1]);
  }
  const authorName = String(commit.authorName || "").trim();
  return authorName ? authorName.replace(/\s+/g, "-").toLowerCase() : null;
}

function normalizeIsoDate(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function buildIdentityAliases({ validator, round }) {
  const aliases = new Map();
  const active = validator?.activeEvaluation || null;
  const login = active?.candidateGithubLogin || active?.candidateAuthor || null;
  const pullNumber = active?.pullNumber || null;
  if (!login || !pullNumber || active?.finalAction !== "merge") {
    return aliases;
  }
  const winnerEntrant = (round?.entrants || []).find(
    (entrant) => entrant?.pull_number === pullNumber
  );
  if (!winnerEntrant?.submission_id) {
    return aliases;
  }
  addIdentityAlias(aliases, winnerEntrant.submission_id, login);
  addIdentityAlias(
    aliases,
    inferSubmissionAuthorFromId(winnerEntrant.submission_id),
    login
  );
  return aliases;
}

function addIdentityAlias(aliases, from, to) {
  const source = String(from || "").trim();
  const target = String(to || "").trim();
  if (!source || !target || source === target) {
    return;
  }
  aliases.set(source, target);
  aliases.set(source.toLowerCase(), target);
}

function resolveAuthorAlias(author, aliases = new Map()) {
  const value = String(author || "").trim();
  if (!value) {
    return author;
  }
  return aliases.get(value) || aliases.get(value.toLowerCase()) || author;
}

function applyRoundIdentityAliases(round, identityAliases = new Map()) {
  if (!round) {
    return round;
  }
  return {
    ...round,
    kingAuthor: resolveAuthorAlias(round.kingAuthor, identityAliases),
    entrants: (round.entrants || []).map((entrant) => ({
      ...entrant,
      author: resolveAuthorAlias(entrant.author, identityAliases)
    }))
  };
}

function enrichRoundKingIdentity(round, leaderboard) {
  if (!round || round.kingAuthor || round.kingSubmissionId) {
    return round;
  }
  const winner = latestWinnerBefore(
    leaderboard?.rows || [],
    round.generatedAt || new Date().toISOString()
  );
  if (!winner) {
    return round;
  }
  return {
    ...round,
    kingAuthor: winner.author,
    kingSubmissionId: winner.submissionId || null
  };
}

function latestWinnerBefore(rows, cutoffIso) {
  const cutoff = new Date(cutoffIso || 0).getTime();
  if (!Number.isFinite(cutoff) || cutoff <= 0) {
    return null;
  }
  let latest = null;
  for (const row of rows || []) {
    for (const pull of row.winnerPulls || []) {
      const mergedAt = new Date(pull.mergedAt || 0).getTime();
      if (!Number.isFinite(mergedAt) || mergedAt > cutoff) {
        continue;
      }
      if (!latest || mergedAt > latest.mergedAtMs) {
        latest = {
          author: row.author,
          mergedAtMs: mergedAt,
          submissionId: submissionIdFromWinnerPull(row, pull)
        };
      }
    }
  }
  return latest;
}

function submissionIdFromWinnerPull(row, pull) {
  const pullNumber = Number(pull?.pullNumber || 0);
  const detail = (row?.recentPulls || []).find(
    (item) => Number(item?.number || 0) === pullNumber
  );
  return extractSubmissionIdFromText(detail?.title) || null;
}

function extractSubmissionIdFromText(value) {
  const match = String(value || "").match(/([A-Za-z0-9][A-Za-z0-9_-]*-\d{8}-\d+)/);
  return match?.[1] || null;
}

function augmentLeaderboardWithRound(leaderboard, round, identityAliases = new Map()) {
  const source = String(leaderboard.source || "");
  if (
    !round?.entrants?.length ||
    (!source.startsWith("unavailable") &&
      source !== "github-not-configured" &&
      source !== "local-git")
  ) {
    return leaderboard;
  }
  const byAuthor = new Map(
    (leaderboard.rows || []).map((row) => [
      resolveAuthorAlias(row.author, identityAliases),
      { ...row, author: resolveAuthorAlias(row.author, identityAliases) }
    ])
  );
  const latestLaneWinners = new Map(
    Object.entries(leaderboard.latestLaneWinners || {})
  );
  const activityAt = round.generatedAt || new Date().toISOString();
  const laneKey = "sn60__bitsec::miner";

  for (const entrant of round.entrants) {
    const author =
      resolveAuthorAlias(entrant.author, identityAliases) ||
      inferSubmissionAuthorFromId(entrant.submission_id) ||
      "unknown";
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions = Math.max(entry.totalSubmissions || 0, 1);
    if (entrant.status === "winner") {
      entry.wins = Math.max(entry.wins || 0, 1);
      if (!(entry.winnerPulls || []).length) {
        entry.winnerPulls = [
          {
            pullNumber: entrant.pull_number || null,
            mergedAt: activityAt
          }
        ];
      }
      const current = latestLaneWinners.get(laneKey);
      if (!current || new Date(activityAt) > new Date(current.mergedAt || 0)) {
        latestLaneWinners.set(laneKey, {
          author,
          mergedAt: activityAt,
          pullNumber: entrant.pull_number || null
        });
      }
    } else if (entrant.status === "pending" || entrant.status === "executing") {
      entry.openSubmissions = Math.max(entry.openSubmissions || 0, 1);
    } else {
      entry.closedSubmissions = Math.max(entry.closedSubmissions || 0, 1);
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, activityAt);
    byAuthor.set(author, entry);
  }

  return {
    ...leaderboard,
    source: `${leaderboard.source}+round`,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function augmentLeaderboardWithActivity(leaderboard, activity, identityAliases = new Map()) {
  const byAuthor = new Map(
    (leaderboard.rows || []).map((row) => [
      resolveAuthorAlias(row.author, identityAliases),
      { ...row, author: resolveAuthorAlias(row.author, identityAliases) }
    ])
  );
  const latestLaneWinners = new Map(
    Object.entries(leaderboard.latestLaneWinners || {})
  );
  const activityByAuthor = new Map();

  for (const item of activity || []) {
    const laneKey = item.laneId ? item.laneId.replace(":", "::") : null;
    const knownLaneWinner =
      item.promotionReady && laneKey ? latestLaneWinners.get(laneKey) : null;
    const author =
      knownLaneWinner?.author ||
      resolveAuthorAlias(item.candidateAuthor, identityAliases) ||
      resolveAuthorAlias(
        inferSubmissionAuthorFromId(item.candidateSubmissionId),
        identityAliases
      ) ||
      item.candidateAuthor ||
      inferSubmissionAuthorFromId(item.candidateSubmissionId) ||
      "unknown";
    const entry = activityByAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions += 1;
    if (item.promotionReady) {
      entry.wins += 1;
      if (!knownLaneWinner?.pullNumber) {
        entry.winnerPulls.push({
          pullNumber: null,
          mergedAt: item.createdAt
        });
      }
    } else {
      entry.closedSubmissions += 1;
    }
    entry.lastActivityAt = maxDate(entry.lastActivityAt, item.createdAt);
    activityByAuthor.set(author, entry);

    if (item.promotionReady && laneKey) {
      const current = latestLaneWinners.get(laneKey);
      if (!current || new Date(item.createdAt) > new Date(current.mergedAt || 0)) {
        latestLaneWinners.set(laneKey, {
          author,
          mergedAt: item.createdAt,
          pullNumber: null
        });
      }
    }
  }

  for (const [author, activityEntry] of activityByAuthor.entries()) {
    const entry = byAuthor.get(author) || createAuthorRow(author);
    entry.totalSubmissions = Math.max(
      entry.totalSubmissions || 0,
      activityEntry.totalSubmissions
    );
    entry.wins = Math.max(entry.wins || 0, activityEntry.wins);
    const mergedWinnerKeys = new Set(
      (entry.winnerPulls || []).map((pull) => `${pull.pullNumber || "run"}:${pull.mergedAt}`)
    );
    entry.winnerPulls = [...(entry.winnerPulls || [])];
    for (const pull of activityEntry.winnerPulls || []) {
      const key = `${pull.pullNumber || "run"}:${pull.mergedAt}`;
      if (!mergedWinnerKeys.has(key)) {
        entry.winnerPulls.push(pull);
        mergedWinnerKeys.add(key);
      }
    }
    entry.closedSubmissions = Math.max(
      entry.closedSubmissions || 0,
      activityEntry.closedSubmissions
    );
    entry.lastActivityAt = maxDate(entry.lastActivityAt, activityEntry.lastActivityAt);
    byAuthor.set(author, entry);
  }

  return {
    ...leaderboard,
    source: activity?.length ? `${leaderboard.source}+runs` : leaderboard.source,
    rows: finalizeLeaderboardRows(byAuthor, latestLaneWinners),
    latestLaneWinners: Object.fromEntries(latestLaneWinners)
  };
}

function buildOverview(lanes, activity, leaderboard, validator) {
  const projectCount = lanes.reduce(
    (accumulator, lane) => accumulator + (lane.projects?.length || 0),
    0
  );
  const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : [];
  const totalSubmissions = rows.reduce(
    (total, row) => total + Number(row.totalSubmissions || 0),
    0
  );
  const totalGittensorScore = rows.reduce(
    (total, row) => total + Number(row.gittensorScore || row.score || 0),
    0
  );

  return {
    activeSubnetPacks: new Set(lanes.map((lane) => lane.subnetPack || lane.repoPack)).size,
    activeRepoPacks: new Set(lanes.map((lane) => lane.subnetPack || lane.repoPack)).size,
    activeLanes: lanes.length,
    benchmarkProjects: projectCount,
    selectedCodebases: projectCount,
    recentChallenges: activity.length,
    recentDuels: activity.length,
    leaderboardEntries: rows.length,
    uniqueChallengers: rows.length,
    totalSubmissions,
    totalGittensorScore: Number(totalGittensorScore.toFixed(4)),
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
  const king = Array.isArray(localReplicaScores?.king) ? localReplicaScores.king : [];
  return {
    candidate: summarizeScoreSeries(candidate),
    king: summarizeScoreSeries(king),
    delta: summarizeScoreSeriesDelta(candidate, king)
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

function summarizeScoreSeriesDelta(candidate, king) {
  const candidateSummary = summarizeScoreSeries(candidate);
  const kingSummary = summarizeScoreSeries(king);
  if (candidateSummary.average === null || kingSummary.average === null) {
    return null;
  }
  return candidateSummary.average - kingSummary.average;
}

function buildNotes({ leaderboard, validator, lanes }) {
  const notes = [];
  if (!leaderboard.rows.length) {
    notes.push(
      "Miner leaderboard is empty because no GitHub PR history or event log is configured yet."
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
  if (!filePath) {
    return null;
  }
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

function loadSn60BenchmarkExpectedCounts(filePath) {
  const payload = readJsonSafe(filePath);
  const counts = new Map();
  if (!Array.isArray(payload)) {
    return counts;
  }
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const projectKey = String(entry.project_id || entry.id || "").trim();
    if (!projectKey) {
      continue;
    }
    counts.set(
      projectKey,
      Array.isArray(entry.vulnerabilities) ? entry.vulnerabilities.length : 0
    );
  }
  return counts;
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

function displaySubnetPack(subnetPack) {
  const raw = subnetPack || "subnet";
  return raw
    .split(/__/)
    .flatMap((segment) => segment.split(/[-_]/))
    .filter(Boolean)
    .map((part) =>
      /^sn\d+$/i.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
    )
    .join(" ");
}
