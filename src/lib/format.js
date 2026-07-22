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

// "Projects passed" = projects with AT LEAST ONE passing replica (looser than the
// strict 2/3 `codebase_pass_count` that drives the pass score). Prefer the engine's
// loose_pass_count; otherwise count projects that either 2/3-passed or had any replica
// pass; otherwise fall back to the strict count.
export function entrantLoosePassCount(entrant) {
  if (entrant?.loose_pass_count != null) {
    return Number(entrant.loose_pass_count);
  }
  if (Array.isArray(entrant?.projects)) {
    return entrant.projects.filter((project) => {
      if (project?.passed) return true;
      if (Number(project?.pass_count || 0) >= 1) return true;
      const replicas = Array.isArray(project?.replicas) ? project.replicas : [];
      return replicas.some(
        (replica) => replica?.passed || replica?.result === "PASS" || replica?.status === "pass"
      );
    }).length;
  }
  return entrantPassCount(entrant);
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

export function formatTruePositives(entrant) {
  // A bare true-positive count is NOT comparable across challenges: each challenge
  // scores a fresh sample of projects with a different number of planted
  // vulnerabilities (total_expected), so "5" one challenge and "16" another can be
  // the SAME detection rate. Always show the count against its denominator so a
  // smaller sample never reads as a regression.
  const tp = entrant?.true_positives;
  if (tp == null) {
    return "—";
  }
  const expected = Number(entrant?.total_expected || 0);
  return expected > 0 ? `${Number(tp)} / ${expected}` : String(Number(tp));
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
  // A project is scored BEST-OF its replicas -- the single strongest run, never a sum.
  // When replica rows exist, take the best evaluated replica by true positives; only
  // when none has been evaluated yet do we fall back to the scorer's project value.
  // (This matters because a live candidate's replicas are not yet collapsed to best-of,
  // so trusting a raw per-replica total would over-count.)
  const bestReplicaTp = normalizeReplicaRows(project, replicasPerProject)
    .filter((replica) => replica.evaluated)
    .reduce((max, replica) => Math.max(max, Number(replica.true_positives ?? 0)), -1);
  return {
    truePositives: bestReplicaTp >= 0 ? bestReplicaTp : Number(project.true_positives ?? 0),
    totalExpected: Number(project.total_expected ?? expectedPerReplica),
    totalFound: Number(project.total_found ?? 0),
  };
}

export function sideDetectionTotals(side, replicasPerProject = 0) {
  // A side's (king or candidate) headline totals must equal the sum of its per-project
  // BEST-OF scores, so both sides are aggregated identically and the header always
  // matches the breakdown below it. The raw progress file writes a live candidate as
  // one entry per replica with a per-replica SUMMED header -- never trust that header.
  const projects = Array.isArray(side?.projects) ? side.projects : [];
  if (!projects.length) {
    return {
      truePositives: side?.true_positives == null ? null : Number(side.true_positives),
      totalExpected: Number(side?.total_expected ?? 0),
      totalFound: Number(side?.total_found ?? 0),
    };
  }
  // Score each DISTINCT project once, best-of. If a live candidate arrives as one entry
  // per replica, several entries share a project_key -- keep the strongest so the total
  // is a best-of sum, never a per-replica sum.
  const bestByKey = new Map();
  projects.forEach((project, index) => {
    const key = project?.project_key || project?.projectKey || `#${index}`;
    const totals = replicaAwareProblemTotals(project, replicasPerProject) || {
      truePositives: 0,
      totalExpected: 0,
      totalFound: 0,
    };
    const prev = bestByKey.get(key);
    if (!prev || Number(totals.truePositives || 0) > Number(prev.truePositives || 0)) {
      bestByKey.set(key, totals);
    }
  });
  return [...bestByKey.values()].reduce(
    (acc, totals) => ({
      truePositives: acc.truePositives + Number(totals.truePositives || 0),
      totalExpected: acc.totalExpected + Number(totals.totalExpected || 0),
      totalFound: acc.totalFound + Number(totals.totalFound || 0),
    }),
    { truePositives: 0, totalExpected: 0, totalFound: 0 }
  );
}

export function sideLadderSignals(side, replicasPerProject = 0, projectCount = 0) {
  // The six rank signals for one side, all from BEST-OF per-project scores so the king
  // and candidate are computed identically. Precision and F1 are recomputed from the
  // best-of totals -- never trust the raw fields, which for a live candidate are summed
  // across replicas (inflated found -> wrong precision/F1).
  const totals = sideDetectionTotals(side, replicasPerProject);
  const truePositives = Number(totals.truePositives || 0);
  const totalFound = Number(totals.totalFound || 0);
  const totalExpected = Number(totals.totalExpected || 0);
  const precision = totalFound > 0 ? truePositives / totalFound : 0;
  const recall = totalExpected > 0 ? truePositives / totalExpected : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const passCount = entrantPassCount(side);
  const loosePassCount = entrantLoosePassCount(side);
  const total = entrantProjectTotal(side, projectCount);
  const hasPass = passCount >= 0 && total > 0;
  return {
    // Pass score stays STRICT (2/3 majority); projects-passed is the LOOSE count.
    passRatio: hasPass ? passCount / total : -1,
    passScore: hasPass ? `${passCount}/${total}` : "—",
    projectsPassed: loosePassCount < 0 ? 0 : loosePassCount,
    // The strict 2/3 pass count, kept for the "project pass score" popup detail.
    projectsPassedStrict: passCount < 0 ? 0 : passCount,
    truePositives,
    totalExpected,
    totalFound,
    invalidRuns: Number(side?.invalid_runs || 0),
    precision,
    f1,
  };
}

export function formatSideTruePositives(side, replicasPerProject = 0) {
  const totals = sideDetectionTotals(side, replicasPerProject);
  if (totals.truePositives == null) {
    return "—";
  }
  return totals.totalExpected > 0
    ? `${totals.truePositives} / ${totals.totalExpected}`
    : String(totals.truePositives);
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

// Mirrors the kata-bot one-sided promotion gate. `margin` is that signal's promotion
// margin (0 by default): the challenger wins the signal only by beating the king by MORE
// than the margin; being behind hands it to the king; a lead within the margin (or a tie)
// is "too close to call" and defers to the next signal. At margin 0 this reduces to the
// strict comparison (behind -> king, ahead -> candidate, exact tie -> tie).
export function decisionWinner(step, margin = 0) {
  const candidate = normalizedDecisionValue(step.candidateValue);
  const king = normalizedDecisionValue(step.kingValue);
  if (candidate == null || king == null) {
    return "tie";
  }
  const m = Math.abs(Number(margin) || 0);
  // Direction-aware lead: how much BETTER the challenger is on this signal.
  const lead = step.higherIsBetter ? candidate - king : king - candidate;
  if (lead < 0) {
    return "king";
  }
  if (lead > m) {
    return "candidate";
  }
  return "tie";
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

export function formatPoolShare(value) {
  const share = Number(value);
  if (!Number.isFinite(share) || share <= 0) {
    return "-";
  }
  const pct = share * 100;
  return `${pct.toLocaleString(undefined, { maximumFractionDigits: pct < 10 ? 1 : 0 })}%`;
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
