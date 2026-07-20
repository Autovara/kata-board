// Evaluator lane state, current-king detail, and recent-activity metrics.
// Extracted from status.mjs; imports only leaf utilities (no cycle back to status).

import path from "node:path";
import { dateIsAfter, numberOrNull } from "./status_utils.mjs";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";
import { collectFiles, listDirectories, readJsonSafe } from "./status/fsUtil.mjs";
import { resolveAuthorAlias } from "./status/identity.mjs";

export function loadEvaluatorLanes({ kataRoot, latestLaneWinners, identityAliases = new Map() }) {
  const lanesRoot = path.join(kataRoot, "lanes");
  const registry = readJsonSafe(path.join(lanesRoot, "registry.json"));
  const laneIds = Array.isArray(registry?.packs)
    ? registry.packs
        .filter((pack) => pack?.active === true)
        .map((pack) => pack?.lane_id)
        .filter(Boolean)
    : listDirectories(lanesRoot);
  return laneIds
    .map((laneId) => loadEvaluatorLane(kataRoot, laneId, latestLaneWinners, identityAliases))
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
    seeded: !state.king?.current_king_submission_id,
  };
  const latestWinnerIsNewer =
    latestWinner?.author && dateIsAfter(latestWinner.mergedAt, king.updatedAt);
  const latestWinnerDiffers =
    latestWinner?.author && king.author && latestWinner.author !== king.author;
  const displayKing =
    latestWinner && (latestWinnerIsNewer || latestWinnerDiffers || !king.author)
      ? {
          ...king,
          author: latestWinner.author,
          source: "latest merged winner",
          updatedAt: latestWinner.mergedAt || king.updatedAt,
          sourcePullRequest: latestWinner.pullNumber ?? null,
          staleLaneKing: king.author
            ? {
                author: king.author,
                submissionId: king.submissionId,
                updatedAt: king.updatedAt,
              }
            : null,
        }
      : king;
  const currentHolder =
    displayKing.author || latestWinner?.author || humanizeKingSource(displayKing.source);
  const latestWinnerMatchesKing =
    Boolean(latestWinner?.author) &&
    (!displayKing.author || latestWinner.author === displayKing.author);
  const selectedProjectsRaw = state.challengeState?.selected_project_keys;
  const selectedProjects = Array.isArray(selectedProjectsRaw) ? selectedProjectsRaw : [];
  return {
    id: `${subnetPack}:${mode}`,
    laneId,
    subnetPack,
    repoPack,
    repoName: displaySubnetPack(subnetPack),
    repoRef: null,
    mode,
    updatedAt: lane.updated_at || state.king?.updated_at || null,
    kingUpdatedAt: displayKing.updatedAt || state.king?.updated_at || lane.updated_at || null,
    currentHolder,
    currentHolderMergedAt: latestWinnerMatchesKing ? latestWinner.mergedAt : null,
    currentHolderPullNumber: latestWinnerMatchesKing ? latestWinner.pullNumber : null,
    king: displayKing,
    projects: selectedProjects.map((projectKey) => ({
      taskId: projectKey,
      title: projectKey,
      // Derived from the lane's pack so every subnet receives its own tags.
      tags: subnetPack.split("__").filter(Boolean),
    })),
    // Project only the derived state the UI consumes; the raw lane files
    // contain internal fields (server paths, full screening payloads) that
    // should not ship to unauthenticated clients.
    evaluatorState: {
      laneId: state.laneId,
      current: state.current,
    },
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
      identityAliases,
    }),
  };
}

function buildEvaluatorCurrentState({
  lane,
  king,
  benchmarkSnapshot,
  challengeState,
  promotionRecord,
  identityAliases = new Map(),
}) {
  if (!lane) {
    return null;
  }
  const screening = challengeState?.screening_result || null;
  const finalMetrics = promotionRecord?.final_metrics || {};
  const projectKeysRaw = challengeState?.selected_project_keys || benchmarkSnapshot?.project_keys;
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
        finalMetrics.candidate_total_found === undefined ||
        finalMetrics.king_total_found === undefined
          ? null
          : numberOrNull(
              Number(finalMetrics.candidate_total_found) - Number(finalMetrics.king_total_found)
            ),
    },
    totalExpected: {
      candidate: numberOrNull(finalMetrics.candidate_total_expected),
      king: numberOrNull(finalMetrics.king_total_expected),
      delta:
        finalMetrics.candidate_total_expected === undefined ||
        finalMetrics.king_total_expected === undefined
          ? null
          : numberOrNull(
              Number(finalMetrics.candidate_total_expected) -
                Number(finalMetrics.king_total_expected)
            ),
    },
    precision: {
      candidate: numberOrNull(finalMetrics.candidate_precision),
      king: numberOrNull(finalMetrics.king_precision),
      delta:
        finalMetrics.candidate_precision === undefined || finalMetrics.king_precision === undefined
          ? null
          : numberOrNull(
              Number(finalMetrics.candidate_precision) - Number(finalMetrics.king_precision)
            ),
    },
    f1Scores: {
      candidate: numberOrNull(finalMetrics.candidate_f1_score),
      king: numberOrNull(finalMetrics.king_f1_score),
      delta:
        finalMetrics.candidate_f1_score === undefined || finalMetrics.king_f1_score === undefined
          ? null
          : numberOrNull(
              Number(finalMetrics.candidate_f1_score) - Number(finalMetrics.king_f1_score)
            ),
    },
    invalidRuns: promotionRecord?.invalid_runs || {},
    localReplicaScores: promotionRecord?.local_replica_scores || {},
    finalWinner: promotionRecord?.final_winner || null,
    recordedAt: promotionRecord?.recorded_at || null,
    finalMetrics,
    scores: {
      candidate: numberOrNull(finalMetrics.candidate_aggregated_score),
      king: numberOrNull(finalMetrics.king_aggregated_score),
      delta: numberOrNull(finalMetrics.candidate_aggregated_score_delta),
    },
    stability: summarizeReplicaStability(promotionRecord?.local_replica_scores || {}),
    provenance: {
      freshnessFingerprint: challengeState?.freshness_fingerprint || null,
      sandboxCommit: finalMetrics.sandbox_commit || benchmarkSnapshot?.sandbox_commit_hash || null,
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
        null,
    },
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

export function loadRecentActivity(kataRoot, env) {
  const runsRoot = path.join(kataRoot, "runs");
  const challengePaths = collectFiles(runsRoot, "challenge_summary.json");
  const limit = Number.parseInt(env.KATA_ACTIVITY_LIMIT || "18", 10);

  return (
    challengePaths
      // readJsonSafe: a single mid-write or corrupt run artifact must not take
      // down the whole status endpoint.
      .map((filePath) => readJsonSafe(filePath))
      .filter(Boolean)
      .map((summary) => {
        const primaryCandidateScore = summary.primary?.variant_scores?.candidate ?? 0;
        const primaryKingScore = summary.primary?.variant_scores?.king ?? 0;
        const subnetPack = inferRepoPackFromSummary(summary);
        const mode = String(summary.mode || "").trim() || null;
        const evaluatorMetrics = loadEvaluatorActivityMetrics(summary);
        return {
          runId: summary.run_id,
          createdAt: summary.created_at,
          laneId: subnetPack && mode ? `${subnetPack}:${mode}` : null,
          mode,
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
              summary.primary?.candidate_score_delta ?? primaryCandidateScore - primaryKingScore,
          },
          evaluator: evaluatorMetrics,
        };
      })
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, limit)
  );
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

export function loadEvaluatorActivityMetrics(summary) {
  const manifestPath = summary.manifest_path || "";
  const runRoot = manifestPath ? path.dirname(manifestPath) : null;
  const screening = runRoot ? readJsonSafe(path.join(runRoot, "screening_result.json")) : null;
  const duel =
    path.basename(manifestPath) === "duel_summary.json" ? readJsonSafe(manifestPath) : null;
  return {
    screeningStatus:
      screening?.status || (manifestPath.endsWith("screening_result.json") ? "failed" : null),
    screeningStage: screening?.stage || null,
    screeningReasons: Array.isArray(screening?.reasons) ? screening.reasons : [],
    passCounts: summary.primary?.variant_successes || {},
    invalidRuns: summary.primary?.variant_invalid_runs || {},
    truePositives: {
      candidate: numberOrNull(duel?.candidate?.true_positives),
      king: numberOrNull(duel?.king?.true_positives),
    },
    totalFound: {
      candidate: numberOrNull(duel?.candidate?.total_found),
      king: numberOrNull(duel?.king?.total_found),
    },
    precision: {
      candidate: numberOrNull(duel?.candidate?.precision),
      king: numberOrNull(duel?.king?.precision),
    },
    f1Scores: {
      candidate: numberOrNull(duel?.candidate?.f1_score),
      king: numberOrNull(duel?.king?.f1_score),
    },
    replicaScores: {
      candidate: Array.isArray(duel?.candidate?.replica_results)
        ? duel.candidate.replica_results
            .map((result) => numberOrNull(result.score))
            .filter((value) => value !== null)
        : [],
      king: Array.isArray(duel?.king?.replica_results)
        ? duel.king.replica_results
            .map((result) => numberOrNull(result.score))
            .filter((value) => value !== null)
        : [],
    },
    provenance: {
      sandboxCommit: duel?.sandbox_source?.sandbox_commit || null,
      benchmarkSha256: duel?.sandbox_source?.benchmark_sha256 || null,
      scorerVersion: duel?.sandbox_source?.scorer_version || null,
      projectKeys: duel?.project_keys || summary.primary?.project_keys || [],
    },
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
    delta: summarizeScoreSeriesDelta(candidate, king),
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
      spread: null,
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
    spread: max - min,
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

function inferRepoPackFromManifest(manifestPath) {
  const value = String(manifestPath || "").trim();
  if (!value) {
    return null;
  }
  const repoPack = path.basename(path.dirname(value));
  return repoPack === "." ? null : repoPack;
}

function inferRepoPackFromSummary(summary) {
  const candidateArtifact = String(summary?.candidate_artifact || "");
  const submissionMatch = candidateArtifact.match(/\/submissions\/([^/]+)\//);
  if (submissionMatch) {
    return submissionMatch[1];
  }
  return inferRepoPackFromManifest(summary?.manifest_path || "") || null;
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
