// Public-results proof loading + live-winner enrichment. Extracted from status.mjs.

import path from "node:path";
import { dateIsAfter, uniqueStrings } from "./status_utils.mjs";
import { readJsonSafe } from "./status/fsUtil.mjs";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";

export function loadPublicProof(publicResultsCurrentPath, kataRoot) {
  const data = readJsonSafe(publicResultsCurrentPath);
  if (!data || typeof data !== "object") {
    return null;
  }
  const currentKing =
    data.current_king && typeof data.current_king === "object" ? data.current_king : {};
  const latestChallenge =
    data.latest_challenge && typeof data.latest_challenge === "object" ? data.latest_challenge : {};
  const benchmark = data.benchmark && typeof data.benchmark === "object" ? data.benchmark : {};
  const proofDetail = loadPublicProofChallengeDetail(kataRoot, latestChallenge.proof);
  return {
    schemaVersion: data.schema_version ?? null,
    updatedAt: data.updated_at || null,
    activePack: data.active_pack || null,
    activeMode: data.active_mode || null,
    dashboardUrl: data.dashboard_url || null,
    currentKing: {
      author: currentKing.author || inferSubmissionAuthorFromId(currentKing.submission_id),
      submissionId: currentKing.submission_id || null,
      sourcePullRequest: currentKing.source_pull_request ?? null,
      path: currentKing.path || null,
      artifactHash: currentKing.artifact_hash || null,
      promotedAt: currentKing.promoted_at || null,
    },
    latestChallenge: {
      challengeId: latestChallenge.challenge_id || null,
      challengeNumber: latestChallenge.challenge_number ?? null,
      competitionMode: latestChallenge.competition_mode || null,
      startedAt: latestChallenge.started_at || null,
      finishedAt: latestChallenge.finished_at || null,
      durationSeconds: latestChallenge.duration_seconds ?? null,
      candidateCount: latestChallenge.candidate_count ?? null,
      outcome: latestChallenge.outcome || null,
      winnerPullRequest: latestChallenge.winner_pull_request ?? null,
      winnerAuthor: latestChallenge.winner_author || null,
      winnerSubmissionId: latestChallenge.winner_submission_id || null,
      bestTruePositives: latestChallenge.best_true_positives ?? null,
      bestDetectionScore: latestChallenge.best_detection_score ?? null,
      proof: latestChallenge.proof || null,
    },
    benchmark: {
      name: benchmark.name || null,
      challengeSha256: benchmark.challenge_sha256 || null,
      sandboxCommit: benchmark.sandbox_commit || null,
      scorerVersion: benchmark.scorer_version || null,
    },
    selectedProjectCount: proofDetail.selectedProjectCount,
    selectedProjects: proofDetail.selectedProjects,
  };
}

function loadPublicProofChallengeDetail(kataRoot, proofPath) {
  const empty = { selectedProjectCount: null, selectedProjects: [] };
  if (!proofPath || !kataRoot) {
    return empty;
  }
  // The bot writes `proof` relative to KATA_ROOT (`public-results[/<lane_id>]/challenges/<id>.json`),
  // so resolve against kataRoot. For a root current.json this equals the old
  // dirname(dirname(currentPath)); for a per-lane `<lane_id>/current.json` it stays correct.
  const proofFile = path.resolve(kataRoot, proofPath);
  const proof = readJsonSafe(proofFile);
  if (!proof || typeof proof !== "object") {
    return empty;
  }
  const selectedProjects = extractProjectKeysFromChallengeProof(proof);
  return {
    selectedProjectCount: selectedProjects.length || null,
    selectedProjects,
  };
}

function extractProjectKeysFromChallengeProof(proof) {
  const direct = [
    proof.project_keys,
    proof.selected_project_keys,
    proof.selectedProjects,
    proof.selected_projects,
  ].find((value) => Array.isArray(value) && value.length);
  if (direct) {
    return uniqueStrings(direct);
  }
  const sources = [
    proof.king,
    ...(Array.isArray(proof.entrants) ? proof.entrants : []),
    ...(Array.isArray(proof.entries) ? proof.entries : []),
  ];
  for (const source of sources) {
    const projects = Array.isArray(source?.projects)
      ? source.projects
      : Array.isArray(source?.candidate?.projects)
        ? source.candidate.projects
        : [];
    const keys = uniqueStrings(
      projects.map((project) => project?.project_key || project?.projectKey)
    );
    if (keys.length) {
      return keys;
    }
  }
  return [];
}

export function enrichPublicProofWithLiveWinner(
  publicProof,
  { challenge, challengeHistory, leaderboard, activeLane }
) {
  const proof = publicProof
    ? {
        ...publicProof,
        currentKing: { ...(publicProof.currentKing || {}) },
        latestChallenge: { ...(publicProof.latestChallenge || {}) },
      }
    : {
        schemaVersion: 1,
        updatedAt: null,
        activePack: activeLane?.subnetPack || null,
        activeMode: activeLane?.mode || null,
        dashboardUrl: null,
        currentKing: {},
        latestChallenge: {},
        benchmark: {},
      };
  const activePack = proof.activePack || activeLane?.subnetPack || null;
  const activeMode = proof.activeMode || activeLane?.mode || null;
  const activeLaneKey = activePack && activeMode ? `${activePack}::${activeMode}` : null;
  const latestWinner = activeLaneKey
    ? leaderboard?.latestLaneWinners?.[activeLaneKey] || null
    : null;
  const completedChallenge = challenge?.state === "completed" && challenge.winnerSubmissionId ? challenge : null;
  const latestChallenge =
    completedChallenge ||
    (Array.isArray(challengeHistory) ? challengeHistory.find((item) => item?.winnerSubmissionId) : null);
  const winnerPullNumber =
    latestWinner?.pullNumber || prNumberFromSubmissionId(latestChallenge?.winnerSubmissionId);
  const winnerEntrant = findWinnerEntrant(latestChallenge, winnerPullNumber);
  const winnerSubmissionId =
    latestWinner?.submissionId ||
    winnerEntrant?.submission_id ||
    winnerEntrant?.submissionId ||
    latestChallenge?.winnerSubmissionId ||
    null;
  const winnerAuthor =
    latestWinner?.author ||
    winnerEntrant?.author ||
    inferSubmissionAuthorFromId(winnerSubmissionId) ||
    proof.currentKing.author ||
    null;
  const promotedAt =
    latestWinner?.mergedAt ||
    latestChallenge?.generatedAt ||
    latestChallenge?.finishedAt ||
    proof.currentKing.promotedAt ||
    null;
  const proofPromotionTime = proof.currentKing.promotedAt || proof.latestChallenge.finishedAt;
  const shouldReplaceKing =
    winnerAuthor &&
    (!proof.currentKing.author ||
      proof.currentKing.author !== winnerAuthor ||
      dateIsAfter(promotedAt, proofPromotionTime));

  if (shouldReplaceKing) {
    proof.currentKing = {
      ...proof.currentKing,
      author: winnerAuthor,
      submissionId: winnerSubmissionId || null,
      sourcePullRequest: winnerPullNumber ?? null,
      path:
        proof.currentKing.path ||
        (activePack && activeMode ? `kings/${activePack}/${activeMode}` : null),
      promotedAt,
    };
  }

  if (latestChallenge?.runId || latestChallenge?.winnerSubmissionId) {
    const entrants = Array.isArray(latestChallenge.entrants) ? latestChallenge.entrants : [];
    const sameProofChallenge = latestChallenge.runId && latestChallenge.runId === proof.latestChallenge.challengeId;
    proof.latestChallenge = {
      ...proof.latestChallenge,
      challengeId: latestChallenge.runId || proof.latestChallenge.challengeId || null,
      challengeNumber: latestChallenge.challengeNumber ?? proof.latestChallenge.challengeNumber ?? null,
      competitionMode: latestChallenge.competitionMode || proof.latestChallenge.competitionMode || null,
      startedAt: latestChallenge.startedAt || (sameProofChallenge ? proof.latestChallenge.startedAt : null),
      finishedAt:
        latestChallenge.finishedAt ||
        latestChallenge.generatedAt ||
        (sameProofChallenge ? proof.latestChallenge.finishedAt : null) ||
        null,
      durationSeconds:
        latestChallenge.durationSeconds ?? (sameProofChallenge ? proof.latestChallenge.durationSeconds : null),
      candidateCount:
        latestChallenge.candidateCount ??
        (entrants.length ? entrants.length : (proof.latestChallenge.candidateCount ?? null)),
      outcome: latestChallenge.winnerSubmissionId ? "king_promoted" : proof.latestChallenge.outcome,
      winnerPullRequest: winnerPullNumber ?? proof.latestChallenge.winnerPullRequest ?? null,
      winnerAuthor: winnerAuthor || proof.latestChallenge.winnerAuthor || null,
      winnerSubmissionId: winnerSubmissionId || proof.latestChallenge.winnerSubmissionId || null,
      bestTruePositives:
        maxEntrantMetric(entrants, "true_positives") ??
        latestChallenge.bestTruePositives ??
        proof.latestChallenge.bestTruePositives ??
        null,
      bestDetectionScore:
        maxEntrantMetric(entrants, "aggregated_score") ??
        latestChallenge.bestDetection ??
        proof.latestChallenge.bestDetectionScore ??
        null,
      proof: sameProofChallenge ? proof.latestChallenge.proof : null,
    };
  }
  return proof;
}

export function findWinnerEntrant(challenge, winnerPullNumber) {
  const entrants = Array.isArray(challenge?.entrants) ? challenge.entrants : [];
  return (
    entrants.find((entrant) => entrant?.selected_winner === true || entrant?.status === "winner") ||
    entrants.find(
      (entrant) => Number(entrant?.pull_number ?? entrant?.pullNumber) === Number(winnerPullNumber)
    ) ||
    null
  );
}

export function prNumberFromSubmissionId(submissionId) {
  const match = /^pr-(\d+)$/.exec(String(submissionId || ""));
  return match ? Number(match[1]) : null;
}

function maxEntrantMetric(entrants, key) {
  if (!Array.isArray(entrants) || !entrants.length) {
    return null;
  }
  const values = entrants
    .map((entrant) => Number(entrant?.[key] ?? 0))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
