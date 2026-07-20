// Pure formatting + scoring helpers extracted from App.jsx (no JSX, no React).

export function screeningFailureDetails(source) {
  const screening = source?.screening_result;
  if (!screening || typeof screening !== "object") {
    return null;
  }
  const status = String(screening.status || "").toLowerCase();
  const stage = String(screening.stage || "").toLowerCase();
  if (stage !== "execution" || !["failed", "fail", "false"].includes(status)) {
    return null;
  }
  return {
    projectKey: screening.project_key || screening.projectKey || "",
    reasons: Array.isArray(screening.reasons)
      ? screening.reasons.map((reason) => String(reason).trim()).filter(Boolean)
      : [],
  };
}

export function compareEntrantsByRank(a, b, selectedProjectCount = 0) {
  // Same order the engine ranks by: pass score, projects passed, true positives,
  // fewer invalid runs, precision, then F1. Unscored entrants sort last.
  const key = (entrant) => [
    entrantPassScore(entrant, selectedProjectCount),
    entrantPassCount(entrant),
    entrant.true_positives ?? -1,
    -(entrant.invalid_runs ?? 0),
    entrant.precision ?? -1,
    entrant.f1_score ?? -1,
  ];
  const av = key(a);
  const bv = key(b);
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] !== bv[i]) {
      return bv[i] - av[i];
    }
  }
  return 0;
}

export function projectCountFromEntrant(entrant) {
  return Array.isArray(entrant?.projects) ? entrant.projects.length : 0;
}

export function selectedProjectKeysFromChallenge(challenge) {
  const candidates = [
    challenge?.liveProgress?.projectKeys,
    challenge?.projectKeys,
    challenge?.primary?.projectKeys,
    challenge?.evaluatorState?.current?.projectKeys,
  ];
  const keys = candidates.find((value) => Array.isArray(value) && value.length);
  return keys || [];
}

export function entrantPassCount(entrant) {
  if (entrant?.codebase_pass_count != null) {
    return Number(entrant.codebase_pass_count);
  }
  if (Array.isArray(entrant?.projects)) {
    return entrant.projects.filter((project) => project?.passed).length;
  }
  return -1;
}

export function entrantProjectTotal(entrant, selectedProjectCount = 0) {
  const selectedTotal = Number(selectedProjectCount || 0);
  if (selectedTotal > 0) {
    return selectedTotal;
  }
  return projectCountFromEntrant(entrant);
}

export function entrantPassScore(entrant, selectedProjectCount = 0) {
  const count = entrantPassCount(entrant);
  const total = entrantProjectTotal(entrant, selectedProjectCount);
  if (count < 0 || total <= 0) {
    return -1;
  }
  return count / total;
}

export function formatPassScore(entrant, selectedProjectCount = 0) {
  const passCount = entrantPassCount(entrant);
  const projectCount = entrantProjectTotal(entrant, selectedProjectCount);
  if (passCount < 0 || projectCount <= 0) {
    return "—";
  }
  return `${passCount}/${projectCount}`;
}

export function formatProjectsPassed(entrant) {
  const passCount = entrantPassCount(entrant);
  return passCount < 0 ? "—" : String(passCount);
}

export function inferReplicasPerProject(challenge) {
  const configured = Number(
    challenge?.liveProgress?.replicasPerProject || challenge?.replicasPerProject || 0
  );
  if (configured > 0) {
    return configured;
  }
  const projectCount = Number(challenge?.liveProgress?.projectKeys?.length || 0);
  const candidates = challenge?.liveProgress?.candidates || [];
  const firstTotal = Number(
    candidates.find((candidate) => Number(candidate?.total) > 0)?.total || 0
  );
  if (projectCount > 0 && firstTotal > 0) {
    return Math.max(1, Math.round(firstTotal / projectCount));
  }
  return 1;
}

export function projectPassThresholdLabel(replicasPerProject) {
  const replicas = Math.max(1, Number(replicasPerProject || 1));
  const required = Math.ceil((replicas * 2) / 3);
  return `${required}/${replicas}`;
}

export function projectPassCount(project) {
  if (!project) {
    return 0;
  }
  if (project.pass_count != null) {
    return Number(project.pass_count || 0);
  }
  const replicas = Array.isArray(project.replicas) ? project.replicas : [];
  return replicas.filter((replica) => replica?.passed || replica?.result === "PASS").length;
}

export function projectReplicaTotal(project, fallback = 0) {
  const fallbackTotal = Number(fallback || 0);
  if (!project) {
    return fallbackTotal;
  }
  const replicas = Array.isArray(project.replicas) ? project.replicas : [];
  const replicaRows = replicas.length;
  if (project.total_replicas != null) {
    return Math.max(Number(project.total_replicas || 0), fallbackTotal, replicaRows);
  }
  return Math.max(replicaRows, fallbackTotal);
}

export function projectReplicaPassLabel(project, fallback = 0) {
  const total = projectReplicaTotal(project, fallback);
  if (!project && !total) {
    return "—";
  }
  return `${projectPassCount(project)}/${total || 0} passed`;
}

export function challengeExtras(challenge) {
  const extras = [];
  if (challenge.screenedOut?.length) {
    extras.push(`${challenge.screenedOut.length} screened out`);
  }
  if (challenge.closedExtras?.length) {
    extras.push(`${challenge.closedExtras.length} extra PR closed — one open PR per contributor`);
  }
  if (challenge.skippedStale?.length) {
    extras.push(`${challenge.skippedStale.length} skipped — unchanged since last challenge`);
  }
  return extras;
}

export function replicaAwareProblemTotals(project, replicasPerProject = 0) {
  if (!project) {
    return null;
  }
  const actualReplicas = Array.isArray(project.replicas) ? project.replicas : [];
  const expectedPerReplica = Number(
    project.total_expected ?? actualReplicas[0]?.total_expected ?? 0
  );
  if (!actualReplicas.length) {
    return {
      truePositives: Number(project.true_positives ?? 0),
      totalExpected: expectedPerReplica,
      totalFound: Number(project.total_found ?? 0),
    };
  }
  const projectTruePositives = Number(project.true_positives ?? 0);
  const projectTotalExpected = Number(project.total_expected ?? 0);
  const projectTotalFound = Number(project.total_found ?? 0);
  const replicas = normalizeReplicaRows(project, replicasPerProject);
  const replicaTotals = replicas.reduce(
    (totals, replica) => ({
      truePositives: totals.truePositives + Number(replica.true_positives ?? 0),
      totalExpected: totals.totalExpected + Number(replica.total_expected ?? expectedPerReplica),
      totalFound: totals.totalFound + Number(replica.total_found ?? 0),
    }),
    { truePositives: 0, totalExpected: 0, totalFound: 0 }
  );
  return {
    truePositives: Math.max(replicaTotals.truePositives, projectTruePositives),
    totalExpected: Math.max(replicaTotals.totalExpected, projectTotalExpected),
    totalFound: Math.max(replicaTotals.totalFound, projectTotalFound),
  };
}

export function formatTpExpectedFound(project, replicasPerProject = 0) {
  if (!project) return "—";
  const totals = replicaAwareProblemTotals(project, replicasPerProject);
  return `${totals.truePositives}/${totals.totalExpected}/${totals.totalFound}`;
}

export function problemResult(project, replicasPerProject = 0) {
  if (!project) return { label: "scoring", tone: "warn" };
  if (project.finished === false || project.scoring) return { label: "scoring", tone: "warn" };
  if (project.passed) return { label: "pass", tone: "ok" };
  if ((replicaAwareProblemTotals(project, replicasPerProject)?.truePositives ?? 0) > 0) {
    return { label: "fail · partial", tone: "warn" };
  }
  return { label: "fail", tone: "bad" };
}

export function normalizeReplicaRows(project, replicasPerProject) {
  const total = projectReplicaTotal(project, replicasPerProject);
  const byIndex = new Map(
    (Array.isArray(project?.replicas) ? project.replicas : []).map((replica) => [
      Number(replica.replica_index || 0),
      replica,
    ])
  );
  return Array.from({ length: Math.max(1, total || replicasPerProject || 1) }, (_, index) => {
    const replicaIndex = index + 1;
    return {
      replica_index: replicaIndex,
      started: false,
      evaluated: false,
      passed: false,
      status: "queued",
      true_positives: 0,
      total_expected: project?.total_expected ?? 0,
      total_found: 0,
      ...(byIndex.get(replicaIndex) || {}),
    };
  });
}

export function formatReplicaFindings(replica) {
  if (!replica?.evaluated) {
    return "—";
  }
  return `${replica.true_positives ?? 0}/${replica.total_expected ?? 0}/${replica.total_found ?? 0}`;
}

export function replicaStatusTone(replica) {
  if (!replica?.started || !replica?.evaluated) {
    return "neutral";
  }
  if (replica.passed || replica.result === "PASS" || replica.status === "pass") {
    return "ok";
  }
  if (replica.status === "invalid") {
    return "warn";
  }
  return "bad";
}

export function replicaStatusLabel(replica) {
  if (!replica?.started) {
    return "queued";
  }
  if (!replica.evaluated) {
    return "running";
  }
  if (replica.passed || replica.result === "PASS" || replica.status === "pass") {
    return "pass";
  }
  if (replica.status === "invalid") {
    return "invalid";
  }
  return "fail";
}

export function decisionWinner(step) {
  const candidate = normalizedDecisionValue(step.candidateValue);
  const king = normalizedDecisionValue(step.kingValue);
  if (candidate == null || king == null || candidate === king) {
    return "tie";
  }
  if (step.higherIsBetter) {
    return candidate > king ? "candidate" : "king";
  }
  return candidate < king ? "candidate" : "king";
}

export function normalizedDecisionValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  const numeric = Number(value);
  return numeric < 0 ? null : numeric;
}

export function formatMetricNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return formatNumber(value);
}

export function percentMetric(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${formatNumber(Number(value) * 100)}%`;
}

export function formatProjectName(key) {
  return String(key || "").replace(/_/g, " ");
}

export function formatPackLabel(value) {
  if (!value) {
    return "-";
  }
  // Generic for any subnet pack: "sn60__bitsec" -> "SN60 Bitsec", "sn22__desearch" -> "SN22
  // Desearch". Split on the pack separators, upper-case the SNxx token and title-case the rest.
  const normalized = String(value).replace(/__/g, " ").replace(/_/g, " ").trim();
  return normalized.replace(/\bsn(\d+)\b/gi, "SN$1").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function screeningHeadline(screening) {
  if (!screening) {
    return "Waiting for screening";
  }
  if (screening.failed > 0) {
    return `${screening.failed} PR${screening.failed === 1 ? "" : "s"} failed screening`;
  }
  if (screening.state === "complete") {
    return "Screening complete";
  }
  const current = screening.current;
  if (current?.state === "running") {
    return `Screening PR #${current.pullNumber}`;
  }
  if (current?.state === "queued") {
    return `PR #${current.pullNumber} is next`;
  }
  return "Waiting for screening";
}

export function nextScreeningEntry(screening) {
  return (screening?.entries || []).find((entry) => entry.state === "queued") || null;
}

export function screeningStatusLabel(entry, { short = false } = {}) {
  if (!entry) {
    return short ? "wait" : "waiting";
  }
  if (entry.state === "passed") {
    return short ? "clear" : "cleared";
  }
  if (entry.state === "failed") {
    return "failed";
  }
  if (entry.state === "running") {
    return short ? "now" : "screening now";
  }
  return short ? "wait" : "waiting";
}

export function formatDetection(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

export function rankBadge(index) {
  return ["🥇", "🥈", "🥉"][index] || String(index + 1);
}

export function duelStatus(duel) {
  return duel.promotionReady ? "winner" : "completed";
}

export function buildDashboardLatestStatus(activeEvaluation, latestChallenge) {
  if (activeEvaluation?.available && activeEvaluation.state !== "idle") {
    return {
      challenger:
        activeEvaluation.candidateGithubLogin ||
        activeEvaluation.candidateAuthor ||
        activeEvaluation.candidateSubmissionId ||
        "active challenger",
      status: activeEvaluationStatus(activeEvaluation),
      source: activeEvaluation.pullNumber
        ? `PR #${activeEvaluation.pullNumber}`
        : "validator queue",
      updatedAt: activeEvaluation.updatedAt || activeEvaluation.startedAt,
    };
  }
  if (latestChallenge) {
    return {
      challenger:
        latestChallenge.candidateAuthor ||
        latestChallenge.candidateSubmissionId ||
        "completed challenger",
      status: duelStatus(latestChallenge),
      source: latestChallenge.runId || "run artifact",
      updatedAt: latestChallenge.createdAt,
    };
  }
  return {
    challenger: "none yet",
    status: "no duel yet",
    source: "waiting",
    updatedAt: null,
  };
}

export function kingAgentLink(lane, repoSlug) {
  const path = `kings/${lane.subnetPack || lane.repoPack}/${lane.mode}/agent.py`;
  if (!repoSlug) {
    return path;
  }
  return `https://github.com/${repoSlug}/blob/main/${path}`;
}

export function avatarUrl(name) {
  if (!name || /\s/.test(name) || name === "waiting" || name === "Kata Seed") {
    return null;
  }
  return `https://github.com/${name}.png?size=160`;
}

export function initials(value) {
  return String(value || "?")
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function activeEvaluationStatus(activeEvaluation) {
  if (!activeEvaluation || activeEvaluation.state === "idle") {
    return "idle";
  }
  if (activeEvaluation.state === "completed") {
    return activeEvaluation.finalAction === "merge" ? "winner" : "completed";
  }
  if (activeEvaluation.state === "failed") {
    return "failed";
  }
  if (activeEvaluation.phase === "confirm") {
    return "confirming";
  }
  if (activeEvaluation.state === "verifying") {
    return "verifying";
  }
  if (activeEvaluation.state === "queued") {
    return "queued";
  }
  return "evaluating";
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
  });
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
