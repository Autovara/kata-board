// Challenge live-progress: status/progress loading, staleness, screening + replica enrichment.
// Extracted from status.mjs.

import fs from "node:fs";
import path from "node:path";
import { f1Score, numberOrNull, numbersClose, positiveIntegerOrNull } from "./status_utils.mjs";
import { listDirectories, newestMtimeIso, readJsonSafe, statMtimeIso } from "./status/fsUtil.mjs";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";
import { maxDate } from "./leaderboardRows.mjs";

// Group the per-competition fields under the lane they belong to, keyed by `lane.id`
// (`<subnetPack>:<mode>`), so the client can read `byLane[selectedLaneId]`.
//
// One lane (the deployed case): that lane owns the already-computed single-global fields BY
// REFERENCE, so the top-level fields stay the byte-identical single-lane alias and the cache-hit
// liveProgress refresh propagates to both. Multiple lanes: each reads its own challenge + public proof
// from its lane-scoped bot state / public-results; the leaderboard and activity stay the shared
// cross-lane view for now.
// Refresh each lane's live challenge progress on a cache hit. The sole lane's byLane entry shares the
// top-level challenge object (already refreshed by the caller); additional lanes read their own
// lane-scoped state/<laneId>/challenge-progress.json so their live progress also advances every frame.
export function refreshByLaneChallengeProgress(status, roots) {
  if (!status || !status.byLane) {
    return;
  }
  const stateDir = path.dirname(roots.challengeStatusPath);
  for (const lane of status.lanes || []) {
    const entry = status.byLane[lane.id];
    if (!entry || !entry.challenge || entry.challenge === status.challenge) {
      continue;
    }
    entry.challenge.liveProgress = loadChallengeProgress(
      path.join(stateDir, lane.laneId, "challenge-progress.json"),
      roots.kataRoot
    );
  }
}

export function assignChallengeSequence(challenge, challengeHistory) {
  const numberedHistory = (Array.isArray(challengeHistory) ? challengeHistory : []).map(
    (entry, index, entries) => ({
      ...entry,
      challengeNumber: entries.length - index,
    })
  );
  if (!challenge) {
    return { challenge, challengeHistory: numberedHistory };
  }

  // challenge-status.json is written before the scorer generates the run_id, so during a
  // live challenge its run_id is null while the progress file already carries it. Fall
  // back to the progress run_id so the challenge is identified (and numbered) correctly.
  const runId = challenge.runId || challenge.liveProgress?.runId || null;
  const matchingHistoryChallenge = numberedHistory.find(
    (entry) => entry.runId && entry.runId === runId
  );
  const challengeNumber = matchingHistoryChallenge?.challengeNumber || numberedHistory.length + 1;
  const numberedChallenge = {
    ...challenge,
    runId,
    challengeNumber,
    liveProgress: challenge.liveProgress
      ? {
          ...challenge.liveProgress,
          challengeNumber,
        }
      : challenge.liveProgress,
  };
  return { challenge: numberedChallenge, challengeHistory: numberedHistory };
}

const DEFAULT_CHALLENGE_STALE_MS = 30 * 60 * 1000; // 30 min without a progress write => dead

function readChallengeStaleMs(env) {
  const raw = Number.parseInt(env?.KATA_BOARD_CHALLENGE_STALE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHALLENGE_STALE_MS;
}

export function applyChallengeStalenessGuard(challenge, env) {
  // A challenge writes challenge-progress.json as it runs. If it was paused/killed
  // without a terminal write, challenge-status.json stays "executing" forever and the
  // dashboard would animate a phantom running challenge. Mark a challenge whose freshest
  // timestamp is older than the window as "paused" -- the client gates its animation on
  // state === "executing", so it stops animating -- but KEEP its live progress so the
  // last recorded status stays visible. The status is never deleted just because time
  // passed; it is replaced only when a new challenge starts.
  if (!challenge || challenge.state !== "executing") {
    return challenge;
  }
  const stamps = [challenge.liveProgress?.updatedAt, challenge.generatedAt]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (!stamps.length) {
    return challenge;
  }
  const freshest = Math.max(...stamps);
  if (Date.now() - freshest > readChallengeStaleMs(env)) {
    return { ...challenge, state: "paused", stale: true };
  }
  return challenge;
}

// The king's reign records (its per-defense rank signals) from the rank ledger, but
// only when the ledger is for THIS king. The board blends these with the king's LIVE
// this-challenge score so the average animates during the round, instead of only
// updating when the round completes and the score is written back into challenge-status.
function loadKingReignRecords(challengeStatusPath, kingHash) {
  if (!kingHash) {
    return [];
  }
  const ledger = readJsonSafe(
    path.join(path.dirname(challengeStatusPath), "king-rank-ledger.json")
  );
  if (!ledger || ledger.king_hash !== kingHash || !Array.isArray(ledger.records)) {
    return [];
  }
  return ledger.records.filter((record) => record && typeof record === "object");
}

export function loadChallengeStatus(challengeStatusPath) {
  // The competition challenge writes this file at start (executing) and end
  // (completed); the board renders every entrant until final results.
  const status = readJsonSafe(challengeStatusPath);
  if (!status || typeof status !== "object") {
    return null;
  }
  const kingHash = status.king?.artifact_hash || status.king?.king_artifact_hash || "";
  return {
    kingReignRecords: loadKingReignRecords(challengeStatusPath, kingHash),
    state: status.state || "idle",
    note: status.note || null,
    generatedAt: status.generated_at || null,
    runId: status.run_id || null,
    repo: status.repo || null,
    laneId: status.lane_id || null,
    competitionMode: status.competition_mode || "king_duel",
    king: status.king || null,
    kingAuthor: status.king_author || status.king?.author || null,
    kingSubmissionId: status.king_submission_id || status.king?.submission_id || null,
    kingRankAverage:
      status.king_rank_average && typeof status.king_rank_average === "object"
        ? status.king_rank_average
        : null,
    kingRankSamples: Number(status.king_rank_samples || 0),
    winnerSubmissionId: status.winner_submission_id || null,
    entrants: (Array.isArray(status.entrants) ? status.entrants : []).map((entrant) => ({
      ...entrant,
      author: entrant.author || inferSubmissionAuthorFromId(entrant.submission_id),
    })),
    screenedOut: Array.isArray(status.screened_out) ? status.screened_out : [],
    closedExtras: Array.isArray(status.closed_extras) ? status.closed_extras : [],
    skippedStale: Array.isArray(status.skipped_stale) ? status.skipped_stale : [],
    externalBaseline:
      status.external_baseline && typeof status.external_baseline === "object"
        ? status.external_baseline
        : null,
    preflight: status.preflight && typeof status.preflight === "object" ? status.preflight : null,
  };
}

export function loadChallengeProgress(challengeProgressPath, kataRoot = null) {
  // Live per-candidate progress written by the scoring engine as each candidate
  // and problem finishes; used to animate the challenge while it is executing.
  const data = readJsonSafe(challengeProgressPath);
  if (!data || typeof data !== "object") {
    return null;
  }
  return enrichChallengeProgressWithReplicas(
    {
      state: data.state || null,
      runId: data.run_id || null,
      competitionMode: data.competition_mode || "king_duel",
      updatedAt: data.updated_at || null,
      projectKeys: Array.isArray(data.project_keys) ? data.project_keys : [],
      replicasPerProject: inferChallengeReplicasPerProject(data),
      king: data.king && typeof data.king === "object" ? data.king : null,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
    },
    kataRoot
  );
}

function inferChallengeReplicasPerProject(progress) {
  const explicit = positiveIntegerOrNull(progress?.replicas_per_project);
  if (explicit) {
    return explicit;
  }
  const projectCount = Array.isArray(progress?.project_keys) ? progress.project_keys.length : 0;
  if (projectCount <= 0) {
    return null;
  }
  const totals = [
    progress?.king?.total,
    ...(Array.isArray(progress?.candidates)
      ? progress.candidates.map((candidate) => candidate?.total)
      : []),
  ];
  for (const total of totals) {
    const parsedTotal = positiveIntegerOrNull(total);
    if (parsedTotal && parsedTotal % projectCount === 0) {
      return parsedTotal / projectCount;
    }
  }
  return null;
}

function enrichChallengeProgressWithReplicas(progress, kataRoot) {
  if (!progress?.runId || !kataRoot) {
    return progress;
  }
  const runRoot = path.join(kataRoot, "runs", progress.runId);
  if (!fs.existsSync(runRoot)) {
    return progress;
  }
  const projectKeys = Array.isArray(progress.projectKeys) ? progress.projectKeys : [];
  const expectedReplicas = positiveIntegerOrNull(progress.replicasPerProject);
  const screening = summarizeChallengeScreeningProgress(progress, runRoot);
  return {
    ...progress,
    updatedAt: maxDate(progress.updatedAt, screening?.updatedAt),
    screening,
    king: progress.king
      ? enrichChallengeProgressSide({
          side: progress.king,
          runRoot,
          variantName: "king",
          projectKeys,
          pullNumber: null,
          expectedReplicas,
        })
      : progress.king,
    candidates: (progress.candidates || []).map((candidate) => {
      const pullNumber = pullNumberFromProgressId(candidate?.submission_id);
      return enrichChallengeProgressSide({
        side: candidate,
        runRoot,
        variantName: "candidate",
        projectKeys,
        pullNumber,
        expectedReplicas,
      });
    }),
  };
}

function summarizeChallengeScreeningProgress(progress, runRoot) {
  const candidates = Array.isArray(progress?.candidates) ? progress.candidates : [];
  if (!candidates.length) {
    return null;
  }
  const entries = candidates
    .map((candidate) =>
      summarizeChallengeScreeningCandidate({
        candidate,
        runRoot,
        fallbackProjectKey: progress.projectKeys?.[0] || null,
      })
    )
    .filter(Boolean);
  if (!entries.length) {
    return null;
  }
  const counts = entries.reduce(
    (acc, entry) => {
      acc[entry.state] = (acc[entry.state] || 0) + 1;
      return acc;
    },
    { passed: 0, failed: 0, running: 0, queued: 0 }
  );
  const terminal = counts.passed + counts.failed;
  const updatedAt = entries.reduce((latest, entry) => maxDate(latest, entry.updatedAt), null);
  return {
    state: terminal >= entries.length ? "complete" : "screening",
    total: entries.length,
    passed: counts.passed || 0,
    failed: counts.failed || 0,
    running: counts.running || 0,
    queued: counts.queued || 0,
    current:
      entries.find((entry) => entry.state === "running") ||
      entries.find((entry) => entry.state === "queued") ||
      null,
    updatedAt,
    entries,
  };
}

function summarizeChallengeScreeningCandidate({ candidate, runRoot, fallbackProjectKey = null }) {
  const pullNumber = pullNumberFromProgressId(candidate?.submission_id);
  if (!pullNumber) {
    return null;
  }
  const screeningRoot = path.join(runRoot, `pr-${pullNumber}`, "screening");
  const base = {
    pullNumber,
    submission_id: candidate.submission_id || `pr-${pullNumber}`,
    projectKey: fallbackProjectKey,
    runId: null,
    startedAt: null,
    updatedAt: null,
    screening_result: null,
  };
  if (!fs.existsSync(screeningRoot)) {
    return {
      ...base,
      state: "queued",
    };
  }
  const latestRunRoot = latestDirectoryPath(screeningRoot);
  if (!latestRunRoot) {
    return {
      ...base,
      state: "running",
      updatedAt: newestMtimeIso(screeningRoot) || statMtimeIso(screeningRoot),
    };
  }
  const result = readJsonSafe(path.join(latestRunRoot, "screening_result.json"));
  const projectKey =
    result?.project_key ||
    result?.projectKey ||
    inferScreeningProjectKey(latestRunRoot) ||
    fallbackProjectKey;
  const updatedAt =
    result?.created_at ||
    newestMtimeIso(latestRunRoot) ||
    statMtimeIso(path.join(latestRunRoot, "screening_result.json")) ||
    statMtimeIso(latestRunRoot);
  return {
    ...base,
    state: screeningResultState(result),
    runId: result?.run_id || path.basename(latestRunRoot),
    projectKey,
    startedAt: statMtimeIso(latestRunRoot),
    updatedAt,
    screening_result: publicChallengeScreeningResult(result),
  };
}

function latestDirectoryPath(rootPath) {
  return (
    listDirectories(rootPath)
      .map((name) => path.join(rootPath, name))
      .sort((left, right) => {
        const byMtime = new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0);
        return byMtime || right.localeCompare(left);
      })[0] || null
  );
}

function inferScreeningProjectKey(screeningRunRoot) {
  const reportRoot = path.join(screeningRunRoot, "reports");
  return listDirectories(reportRoot).sort()[0] || null;
}

function screeningResultState(result) {
  if (!result || typeof result !== "object") {
    return "running";
  }
  const status = String(result.status || "").toLowerCase();
  if (["passed", "pass", "success", "true"].includes(status)) {
    return "passed";
  }
  if (["failed", "fail", "error", "false"].includes(status)) {
    return "failed";
  }
  return "running";
}

function publicChallengeScreeningResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  return {
    run_id: result.run_id || null,
    status: result.status || null,
    stage: result.stage || null,
    project_key: result.project_key || result.projectKey || null,
    reasons: Array.isArray(result.reasons)
      ? result.reasons.map((reason) => String(reason)).filter(Boolean)
      : [],
    created_at: result.created_at || null,
  };
}

function enrichChallengeProgressSide({
  side,
  runRoot,
  variantName,
  projectKeys,
  pullNumber,
  expectedReplicas = null,
}) {
  if (!side || typeof side !== "object") {
    return side;
  }
  const existingProjects = Array.isArray(side.projects) ? side.projects : [];
  const existingProjectKeys = existingProjects
    .map((project) => project?.project_key || project?.projectKey)
    .filter(Boolean);
  const projectByKey = new Map(
    existingProjects
      .filter((project) => project && typeof project === "object")
      .map((project) => [project.project_key || project.projectKey, project])
  );
  const keys =
    variantName === "candidate"
      ? [...new Set(existingProjectKeys)]
      : [...new Set([...projectKeys, ...existingProjectKeys])];
  const enrichedProjects = [];
  for (const projectKey of keys) {
    const existingProject = projectByKey.get(projectKey) || null;
    const replicaProject = findChallengeReplicaProject({
      runRoot,
      variantName,
      pullNumber,
      side,
      projectKey,
      expectedReplicas,
      allowGenericDuelRoot: variantName !== "candidate" || side.state === "scoring",
    });
    if (!existingProject && !replicaProject?.started) {
      continue;
    }
    enrichedProjects.push(
      mergeChallengeProjectReplicaProgress(existingProject, replicaProject, projectKey)
    );
  }
  return {
    ...side,
    projects: enrichedProjects.length ? enrichedProjects : existingProjects,
  };
}

function pullNumberFromProgressId(submissionId) {
  const match = /^pr-(\d+)$/.exec(String(submissionId || ""));
  return match ? Number(match[1]) : null;
}

function findChallengeReplicaProject({
  runRoot,
  variantName,
  pullNumber,
  side = null,
  projectKey,
  expectedReplicas = null,
  allowGenericDuelRoot = true,
}) {
  const directRoots = [];
  if (pullNumber) {
    directRoots.push(path.join(runRoot, `pr-${pullNumber}`, variantName, projectKey));
  }
  // Per-label challenge layout (plugin orchestrator): each variant runs under its own
  // label dir -> runRoot/<label>/<variant>/<project>. The king's label is "king"
  // (so runRoot/king/king/...); candidates use the pr-<n> path above.
  directRoots.push(path.join(runRoot, variantName, variantName, projectKey));
  // Legacy single-run layout: runRoot/<variant>/<project>.
  directRoots.push(path.join(runRoot, variantName, projectKey));
  for (const projectRoot of directRoots) {
    if (fs.existsSync(projectRoot)) {
      return summarizeEvaluatorProjectProgress(projectRoot, projectKey, expectedReplicas);
    }
  }

  if (!allowGenericDuelRoot) {
    const matchedDuelRoot =
      variantName === "candidate" ? findMatchingCompletedCandidateDuelRoot(runRoot, side) : null;
    if (matchedDuelRoot) {
      const projectRoot = path.join(matchedDuelRoot, variantName, projectKey);
      if (fs.existsSync(projectRoot)) {
        return summarizeEvaluatorProjectProgress(projectRoot, projectKey, expectedReplicas);
      }
    }
    return null;
  }

  const duelRoots = findDuelRoots(runRoot).sort(
    (left, right) => new Date(statMtimeIso(right) || 0) - new Date(statMtimeIso(left) || 0)
  );
  for (const duelRoot of duelRoots) {
    const projectRoot = path.join(duelRoot, variantName, projectKey);
    if (fs.existsSync(projectRoot)) {
      return summarizeEvaluatorProjectProgress(projectRoot, projectKey, expectedReplicas);
    }
  }
  return null;
}

function findMatchingCompletedCandidateDuelRoot(runRoot, side) {
  if (!side || typeof side !== "object" || side.state !== "done") {
    return null;
  }
  const duelRoots = findDuelRoots(runRoot).sort();
  for (const duelRoot of duelRoots) {
    const summary = readJsonSafe(path.join(duelRoot, "duel_summary.json"));
    if (completedCandidateSummaryMatchesProgress(summary?.candidate, side)) {
      return duelRoot;
    }
  }
  return null;
}

function findDuelRoots(runRoot) {
  return listDirectories(runRoot)
    .map((name) => path.join(runRoot, name))
    .filter(
      (candidateRoot) =>
        fs.existsSync(path.join(candidateRoot, "duel_summary.json")) ||
        fs.existsSync(path.join(candidateRoot, "candidate")) ||
        fs.existsSync(path.join(candidateRoot, "king"))
    );
}

function completedCandidateSummaryMatchesProgress(candidate, progress) {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const exactFields = [
    ["true_positives", "true_positives"],
    ["total_expected", "total_expected"],
    ["total_found", "total_found"],
    ["invalid_runs", "invalid_runs"],
    ["codebase_pass_count", "codebase_pass_count"],
  ];
  for (const [summaryKey, progressKey] of exactFields) {
    const progressValue = progress[progressKey];
    if (progressValue == null) {
      continue;
    }
    if (Number(candidate[summaryKey] ?? 0) !== Number(progressValue ?? 0)) {
      return false;
    }
  }
  return (
    numbersClose(candidate.aggregated_score, progress.aggregated_score) &&
    numbersClose(candidate.precision, progress.precision) &&
    numbersClose(candidate.f1_score, progress.f1_score)
  );
}

function mergeChallengeProjectReplicaProgress(existingProject, replicaProject, projectKey) {
  const base =
    existingProject && typeof existingProject === "object"
      ? { ...existingProject }
      : {
          project_key: projectKey,
          passed: Boolean(replicaProject?.solved),
          detection_rate: numberOrNull(replicaProject?.verifierScore),
          true_positives: Number(replicaProject?.truePositives || 0),
          total_expected: Number(replicaProject?.totalExpected || 0),
          total_found: Number(replicaProject?.totalFound || 0),
          precision: numberOrNull(replicaProject?.precision),
          f1_score: numberOrNull(replicaProject?.f1Score),
        };
  if (!replicaProject) {
    return base;
  }
  return {
    ...base,
    project_key: base.project_key || base.projectKey || projectKey,
    started: Boolean(replicaProject.started),
    finished: Boolean(replicaProject.finished),
    passed: Boolean(replicaProject.solved),
    completed_replicas: Number(replicaProject.completedReplicas || 0),
    total_replicas: Number(replicaProject.totalReplicas || 0),
    pass_count: Number(replicaProject.passCount || 0),
    invalid_runs: Number(replicaProject.invalidRuns || 0),
    replicas: Array.isArray(replicaProject.replicas)
      ? replicaProject.replicas.map(challengeReplicaPayload)
      : [],
  };
}

export function challengeReplicaPayload(replica) {
  return {
    replica_index: Number(replica.replicaIndex || 0),
    started: Boolean(replica.started),
    evaluated: Boolean(replica.finished),
    finished: Boolean(replica.finished),
    valid: Boolean(replica.valid),
    success: Boolean(replica.success),
    result: replica.result || null,
    passed: replica.result === "PASS",
    status: replicaStatusLabel(replica),
    true_positives: Number(replica.truePositives || 0),
    total_expected: Number(replica.totalExpected || 0),
    total_found: Number(replica.totalFound || 0),
    updated_at: replica.updatedAt || null,
  };
}

function replicaStatusLabel(replica) {
  if (!replica?.started) {
    return "queued";
  }
  if (!replica.finished) {
    return "running";
  }
  if (!replica.valid || !replica.success) {
    return "invalid";
  }
  return replica.result === "PASS" ? "pass" : "fail";
}

export function summarizeEvaluatorProjectProgress(
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
    summarizeEvaluatorReplicaProgress(replicaRoot, projectKey, benchmarkExpectedCounts)
  );
  const completedReplicas = replicas.filter((replica) => replica.finished).length;
  const passCount = replicas.filter((replica) => replica.result === "PASS").length;
  const totalReplicas = expectedReplicas || replicas.length;
  const truePositives = replicas.reduce((total, replica) => total + replica.truePositives, 0);
  const totalExpected = replicas.reduce((total, replica) => total + replica.totalExpected, 0);
  const totalFound = replicas.reduce((total, replica) => total + replica.totalFound, 0);
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
    passCount,
    completedReplicas,
    totalReplicas,
    replicas,
  };
}

function summarizeEvaluatorReplicaProgress(
  replicaRoot,
  projectKey,
  benchmarkExpectedCounts = new Map()
) {
  const reportPath = findFirstExistingFile([
    path.join(replicaRoot, "reports", projectKey, "report.json"),
    path.join(replicaRoot, "report.json"),
  ]);
  const evaluationPath = findFirstExistingFile([
    path.join(replicaRoot, "reports", projectKey, "evaluation.json"),
    path.join(replicaRoot, "evaluation.json"),
  ]);
  const evaluation = evaluationPath ? readJsonSafe(evaluationPath) : null;
  const status = normalizeEvaluationStatus(evaluation?.status);
  const result =
    evaluation?.result && typeof evaluation.result === "object" ? evaluation.result : {};
  const valid = !evaluation || status === "success";
  const fallbackExpected = Number(benchmarkExpectedCounts.get(projectKey) || 0);
  const updatedAt =
    (evaluationPath ? statMtimeIso(evaluationPath) : null) ||
    (reportPath ? statMtimeIso(reportPath) : null) ||
    statMtimeIso(replicaRoot);
  return {
    replicaIndex: replicaIndexFromRoot(replicaRoot),
    started: Boolean(reportPath || evaluationPath || fs.existsSync(replicaRoot)),
    finished: Boolean(evaluation),
    valid,
    success: status === "success",
    result: status === "success" ? String(result.result || "") : null,
    truePositives: status === "success" ? Number(result.true_positives || 0) || 0 : 0,
    totalExpected:
      status === "success" ? Number(result.total_expected || 0) || 0 : fallbackExpected,
    totalFound: status === "success" ? Number(result.total_found || 0) || 0 : 0,
    updatedAt,
  };
}

function replicaIndexFromRoot(replicaRoot) {
  const match = /replica-(\d+)/.exec(path.basename(replicaRoot));
  return match ? Number(match[1]) : 0;
}

function projectPasses(passCount, replicaCount) {
  if (!replicaCount) {
    return false;
  }
  return passCount * 3 >= replicaCount * 2;
}

function normalizeEvaluationStatus(value) {
  return String(value || "pending")
    .toLowerCase()
    .split(".")
    .pop();
}

function findFirstExistingFile(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) || null;
}
