import fs from "node:fs";
import path from "node:path";

import { loadGithubLeaderboard } from "./github.mjs";

const CACHE_TTL_MS = 15_000;
let cachedStatus = null;
let cachedAt = 0;

export async function loadBoardStatus(env) {
  if (cachedStatus && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const roots = resolveRoots(env);
  const publicRegistry = loadBenchmarkRegistry(roots.benchmarksRoot);
  const privateRegistry = loadBenchmarkRegistry(roots.privateBenchmarksRoot);
  const leaderboard = await loadLeaderboard(env);
  const validator = await loadValidatorStatus(env, roots);
  const lanes = loadLanes({
    kataRoot: roots.kataRoot,
    publicRegistry,
    privateRegistry,
    latestLaneWinners: leaderboard.latestLaneWinners
  });
  const activity = loadRecentActivity(
    roots.kataRoot,
    env,
    publicRegistry.activeRepoPacks
  );
  const notes = buildNotes({
    leaderboard,
    validator,
    lanes,
    privateRegistry
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
      privateBenchmarks: Boolean(privateRegistry.exists),
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

function resolveRoots(env) {
  const boardRoot = env.KATA_BOARD_ROOT || path.resolve(process.cwd(), "..");
  const kataBotRoot = resolveExistingRoot(
    env.KATA_BOT_ROOT,
    path.join(boardRoot, "kata-bot")
  );
  return {
    boardRoot,
    kataRoot: resolveExistingRoot(env.KATA_ROOT, path.join(boardRoot, "kata")),
    benchmarksRoot: resolveExistingRoot(
      env.KATA_BENCHMARKS_ROOT,
      path.join(boardRoot, "kata-benchmarks")
    ),
    privateBenchmarksRoot: resolveExistingRoot(
      env.KATA_PRIVATE_BENCHMARKS_ROOT,
      path.join(boardRoot, "kata-benchmarks-private")
    ),
    kataBotRoot,
    queueStatePath: path.resolve(
      env.KATA_QUEUE_STATE_PATH || path.join(kataBotRoot, "state", "queue.json")
    )
  };
}

function resolveExistingRoot(explicitPath, fallbackPath) {
  return path.resolve(explicitPath || fallbackPath);
}

function loadBenchmarkRegistry(root) {
  const markerPath = path.join(root, "kata-benchmark-registry.json");
  const marker = readJson(markerPath);
  const benchmarksDir = path.join(root, marker?.benchmarks_dir || "benchmarks");
  return {
    root,
    exists: fs.existsSync(root),
    marker,
    benchmarksDir,
    activeRepoPacks: marker?.active_repo_packs || []
  };
}

function loadLanes({
  kataRoot,
  publicRegistry,
  privateRegistry,
  latestLaneWinners
}) {
  const repoPacks = publicRegistry.activeRepoPacks.length
    ? publicRegistry.activeRepoPacks
    : listDirectories(publicRegistry.benchmarksDir);

  return repoPacks.flatMap((repoPack) =>
    loadRepoPackLane({
      kataRoot,
      repoPack,
      publicRegistry,
      privateRegistry,
      latestLaneWinners
    })
  );
}

function loadRepoPackLane({
  kataRoot,
  repoPack,
  publicRegistry,
  privateRegistry,
  latestLaneWinners
}) {
  const packRoot = path.join(publicRegistry.benchmarksDir, repoPack);
  const frontier = readJson(path.join(packRoot, "frontier.json"));
  if (!frontier?.modes) {
    return [];
  }

  const benchkitPack = readJson(path.join(packRoot, "benchkit-pack.json")) || {};
  const publicTasks = listTaskDirectories(packRoot)
    .map((taskId) => loadTask(packRoot, taskId))
    .filter(Boolean);
  const publicTaskStats = summarizePublicTasks(publicTasks, benchkitPack);

  const privatePackRoot = path.join(privateRegistry.benchmarksDir, repoPack);
  const privateFrontier = readJson(path.join(privatePackRoot, "frontier.private.json"));
  const privateTaskStats = summarizePrivateTasks(privatePackRoot);

  return Object.entries(frontier.modes).map(([mode, modeConfig]) => {
    const laneKey = `${repoPack}::${mode}`;
    const latestWinner = latestLaneWinners?.[laneKey] || null;
    const privateModeConfig = privateFrontier?.modes?.[mode] || null;
    const king = loadKingInfo({
      kataRoot,
      repoPack,
      mode,
      modeConfig
    });

    const publicPool = {
      selection: modeConfig.primary_selection || inferPublicSelection(modeConfig),
      configuredTaskCount:
        modeConfig.primary_task_count ??
        (Array.isArray(modeConfig.primary_tasks) ? modeConfig.primary_tasks.length : 0),
      targetTaskCount:
        benchkitPack.target_visible_tasks ||
        modeConfig.primary_task_count ||
        publicTaskStats.liveTasks,
      liveTasks: publicTaskStats.liveTasks,
      totalTasks: publicTaskStats.totalTasks,
      fingerprint: modeConfig.primary_pool_fingerprint || null,
      tasks: publicTaskStats.tasks,
      categoryCounts: publicTaskStats.categoryCounts,
      categoryTargets: publicTaskStats.categoryTargets,
      similarityThreshold: publicTaskStats.similarityThreshold,
      maxScopeConcentration: publicTaskStats.maxScopeConcentration,
      notes: publicTaskStats.notes
    };

    const privatePool = {
      configured: Boolean(
        privateModeConfig ||
          modeConfig.holdout_is_private ||
          modeConfig.holdout_task_count
      ),
      hidden: Boolean(
        privateModeConfig?.holdout_is_private ?? modeConfig.holdout_is_private
      ),
      configuredTaskCount:
        privateModeConfig?.holdout_task_count ??
        modeConfig.holdout_task_count ??
        inferConfiguredHoldoutCount(privateModeConfig || modeConfig),
      targetTaskCount:
        benchkitPack.target_holdout_tasks ||
        privateModeConfig?.holdout_task_count ||
        modeConfig.holdout_task_count ||
        privateTaskStats.liveTasks,
      liveTasks: Math.max(
        privateTaskStats.liveTasks,
        privateModeConfig?.holdout_task_count || 0,
        modeConfig.holdout_task_count || 0,
        inferConfiguredHoldoutCount(privateModeConfig || modeConfig)
      ),
      totalTasks: Math.max(
        privateTaskStats.totalTasks,
        privateModeConfig?.holdout_task_count || 0,
        modeConfig.holdout_task_count || 0,
        inferConfiguredHoldoutCount(privateModeConfig || modeConfig)
      ),
      retiredWaitingTasks: privateTaskStats.retiredWaitingTasks,
      retiredTasks: privateTaskStats.retiredTasks,
      fingerprint:
        privateModeConfig?.holdout_pool_fingerprint ||
        modeConfig.holdout_pool_fingerprint ||
        null,
      updatedAt:
        privateModeConfig?.frontier_updated_at ||
        privateFrontier?.updated_at ||
        null,
      evaluatorVersion:
        privateModeConfig?.evaluator_version || modeConfig.evaluator_version || null
    };

    const currentHolder =
      latestWinner?.author || king.author || humanizeFrontierSource(modeConfig.frontier_source);

    return {
      id: `${repoPack}:${mode}`,
      repoPack,
      repoName: displayRepoPack(repoPack),
      repoRef: frontier.repo_ref,
      mode,
      updatedAt: frontier.updated_at,
      frontierUpdatedAt: modeConfig.frontier_updated_at || frontier.updated_at,
      currentHolder,
      currentHolderMergedAt: latestWinner?.mergedAt || null,
      currentHolderPullNumber: latestWinner?.pullNumber || null,
      king,
      duelRules: {
        publicSelection: publicPool.selection,
        publicTaskCount: publicPool.configuredTaskCount,
        privateTaskCount: privatePool.configuredTaskCount,
        promotionMarginPoints: modeConfig.promotion_margin_points ?? 0,
        holdoutPromotionMarginPoints:
          privateModeConfig?.holdout_promotion_margin_points ??
          modeConfig.holdout_promotion_margin_points ??
          0,
        promotionMarginTasks: marginAsTaskCount(
          modeConfig.promotion_margin_points ?? 0,
          publicPool.configuredTaskCount
        ),
        holdoutPromotionMarginTasks: marginAsTaskCount(
          privateModeConfig?.holdout_promotion_margin_points ??
            modeConfig.holdout_promotion_margin_points ??
            0,
          privatePool.configuredTaskCount
        ),
        holdoutRule: privatePool.configured
          ? "candidate must beat the king by the holdout margin"
          : "no holdout pool configured"
      },
      publicPool,
      privatePool
    };
  });
}

function loadTask(packRoot, taskId) {
  const taskRoot = path.join(packRoot, taskId);
  if (!fs.statSync(taskRoot, { throwIfNoEntry: false })?.isDirectory()) {
    return null;
  }
  const metadata = readJson(path.join(taskRoot, "benchkit.json")) || {};
  const taskText = readText(path.join(taskRoot, "task.md"));
  return {
    taskId,
    title: metadata.title || taskId,
    description: extractTaskDescription(taskText),
    visibility: metadata.visibility || "unknown",
    status: metadata.status || "unknown",
    qualityScore: metadata.quality_score || null,
    sourceRef: metadata.source_ref || null,
    tags: metadata.tags || []
  };
}

function summarizePublicTasks(tasks, benchkitPack) {
  const visibleTasks = tasks.filter((task) => task.visibility === "visible");
  const liveTasks = visibleTasks.filter((task) => task.status === "live");
  const categoryCounts = {};

  for (const task of visibleTasks) {
    for (const tag of task.tags) {
      categoryCounts[tag] = (categoryCounts[tag] || 0) + 1;
    }
  }

  return {
    totalTasks: visibleTasks.length,
    liveTasks: liveTasks.length,
    similarityThreshold: benchkitPack.similarity_threshold || null,
    maxScopeConcentration: benchkitPack.max_scope_concentration || null,
    categoryTargets: benchkitPack.category_targets || {},
    categoryCounts,
    notes: benchkitPack.notes || null,
    tasks: liveTasks
  };
}

function summarizePrivateTasks(packRoot) {
  const poolManifest = readJson(path.join(packRoot, "benchkit-pool.private.json")) || {};
  const manifestLiveTasks = Array.isArray(poolManifest.private_live_tasks)
    ? poolManifest.private_live_tasks.length
    : 0;
  const summary = {
    totalTasks: manifestLiveTasks,
    liveTasks: manifestLiveTasks,
    retiredWaitingTasks: 0,
    retiredTasks: 0
  };

  let scannedTasks = 0;
  let scannedLiveTasks = 0;
  for (const taskId of listTaskDirectories(packRoot)) {
    const metadata = readJson(path.join(packRoot, taskId, "benchkit.json")) || {};
    scannedTasks += 1;
    const status = metadata.status || "unknown";
    if (status === "live") {
      scannedLiveTasks += 1;
    } else if (status === "retired-waiting") {
      summary.retiredWaitingTasks += 1;
    } else if (status === "retired") {
      summary.retiredTasks += 1;
    }
  }

  summary.totalTasks = Math.max(summary.totalTasks, scannedTasks);
  summary.liveTasks = Math.max(summary.liveTasks, scannedLiveTasks);
  return summary;
}

function loadKingInfo({ kataRoot, repoPack, mode, modeConfig }) {
  const kingRoot = path.join(kataRoot, "kings", repoPack, mode);
  const kingManifest = readJson(path.join(kingRoot, "king.json")) || {};
  const submissionId = kingManifest.submission_id || null;
  return {
    submissionId,
    author: inferSubmissionAuthorFromId(submissionId),
    challengeRunId: kingManifest.challenge_run_id || null,
    artifactHash:
      kingManifest.candidate_artifact_hash ||
      kingManifest.frontier_artifact_hash ||
      modeConfig.frontier_artifact_hash ||
      null,
    source: modeConfig.frontier_source || null,
    updatedAt: modeConfig.frontier_updated_at || null,
    seeded: Boolean(submissionId?.startsWith("kata-init"))
  };
}

function inferPublicSelection(modeConfig) {
  if (Array.isArray(modeConfig.primary_tasks) && modeConfig.primary_tasks.length) {
    return "fixed_list";
  }
  return "unknown";
}

function inferConfiguredHoldoutCount(modeConfig) {
  return Array.isArray(modeConfig?.holdout_tasks) ? modeConfig.holdout_tasks.length : 0;
}

function marginAsTaskCount(marginPoints, taskCount) {
  const points = Number(marginPoints);
  const count = Number(taskCount);
  if (!Number.isFinite(points) || !Number.isFinite(count) || points <= 0 || count <= 0) {
    return null;
  }
  return points / (100 / count);
}

function inferSubmissionAuthorFromId(submissionId) {
  if (!submissionId) {
    return null;
  }
  if (submissionId.startsWith("kata-init")) {
    return "Kata Seed";
  }
  const match = submissionId.match(/^([a-zA-Z0-9-]+)-\d{8}-\d+$/);
  return match ? match[1] : submissionId;
}

function humanizeFrontierSource(value) {
  if (!value) {
    return "unknown";
  }
  if (value.startsWith("kata-init")) {
    return "Kata Seed";
  }
  return value;
}

function listTaskDirectories(rootPath) {
  return listDirectories(rootPath).filter(
    (name) => !["agents", "__pycache__"].includes(name)
  );
}

function loadRecentActivity(kataRoot, env, activeRepoPacks) {
  const runsRoot = path.join(kataRoot, "runs");
  const challengePaths = collectFiles(runsRoot, "challenge_summary.json");
  const limit = Number.parseInt(env.KATA_ACTIVITY_LIMIT || "18", 10);
  const activePackSet = new Set(activeRepoPacks || []);

  return challengePaths
    .map((filePath) => readJson(filePath))
    .filter(Boolean)
    .map((summary) => {
      const primaryCandidateScore = summary.primary?.variant_scores?.candidate ?? 0;
      const primaryFrontierScore = summary.primary?.variant_scores?.frontier ?? 0;
      const holdoutCandidateScore = summary.holdout?.variant_scores?.candidate ?? null;
      const holdoutFrontierScore = summary.holdout?.variant_scores?.frontier ?? null;
      return {
        runId: summary.run_id,
        createdAt: summary.created_at,
        laneId: `${inferRepoPackFromManifest(summary.manifest_path)}:${summary.mode}`,
        mode: summary.mode,
        repoPack: inferRepoPackFromManifest(summary.manifest_path),
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
          : null
      };
    })
    .filter((item) => {
      if (!activePackSet.size) {
        return true;
      }
      return activePackSet.has(item.repoPack);
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
  const queue = loadQueueStatus(roots.queueStatePath);
  const health = await loadValidatorHealth(env.KATA_VALIDATOR_HEALTH_URL);
  return {
    mode: "resident",
    queue,
    health
  };
}

function loadQueueStatus(queueStatePath) {
  const queuePayload = readJson(queueStatePath);
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
    latestJob: latestJob ? summarizeQueueJob(latestJob) : null
  };
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
    pullNumber: job.pull_number,
    attempts: job.attempts,
    finalAction: job.final_action || null,
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

function buildNotes({ leaderboard, validator, lanes, privateRegistry }) {
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
  if (!privateRegistry.exists) {
    notes.push(
      "Private benchmark root is not connected. Hidden holdout counts may be incomplete until `KATA_PRIVATE_BENCHMARKS_ROOT` is configured."
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
  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."));
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
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
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

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf-8");
}

function extractTaskDescription(taskText) {
  if (!taskText.trim()) {
    return "";
  }
  const lines = taskText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const goalIndex = lines.findIndex((line) => line.toLowerCase() === "## goal");
  if (goalIndex >= 0) {
    const goalLines = [];
    for (const line of lines.slice(goalIndex + 1)) {
      if (line.startsWith("## ")) {
        break;
      }
      goalLines.push(line.replace(/^- /, ""));
    }
    return goalLines.join(" ").slice(0, 420);
  }
  return lines.filter((line) => !line.startsWith("#")).join(" ").slice(0, 420);
}

function inferRepoPackFromManifest(manifestPath) {
  return path.basename(path.dirname(manifestPath));
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
