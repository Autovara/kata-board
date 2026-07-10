import { useEffect, useMemo, useState } from "react";
import GridBackground from "./GridBackground.jsx";

const STATUS_URL = import.meta.env.VITE_STATUS_URL || "/api/status";
const STREAM_URL = import.meta.env.VITE_STREAM_URL || "/api/stream";
const KATA_ASSET_BASE = import.meta.env.VITE_KATA_ASSET_BASE || "/kata-assets";
const POLL_INTERVAL_MS = 2000;
const DOC_ROUND_PROJECT_COUNT = 7;
const PAGES = [
  { path: "/", label: "Dashboard" },
  { path: "/arena", label: "Arena" },
  { path: "/winners", label: "Winners" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/docs", label: "Docs" }
];
const KATA_IMAGES = {
  heroDashboard: assetUrl("hero-dashboard.png"),
  proof: assetUrl("proof.png"),
  benchmarkProjects: assetUrl("BenchmarkProjects.png"),
  vulnerabilityFinding: assetUrl("VulnerabilityFinding.png"),
  currentKing: assetUrl("CurrentKing.png")
};

function assetUrl(filename) {
  return `${KATA_ASSET_BASE}/${encodeURIComponent(filename)}`;
}

export default function App() {
  const [pathname, setPathname] = useState(readCurrentRoute);
  const [selectedLaneId, setSelectedLaneId] = useState(null);
  const [state, setState] = useState({
    loading: true,
    error: null,
    payload: null
  });

  useEffect(() => {
    const onLocationChange = () => setPathname(readCurrentRoute());
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source = null;
    let pollId = null;
    let receivedAny = false;

    function applyPayload(payload) {
      if (cancelled) {
        return;
      }
      if (payload && payload.__error) {
        setState((current) => ({ loading: false, error: payload.__error, payload: current.payload }));
        return;
      }
      setState({ loading: false, error: null, payload });
    }

    function applyError(message) {
      if (cancelled) {
        return;
      }
      setState((current) => ({ loading: false, error: message, payload: current.payload }));
    }

    async function fetchOnce() {
      try {
        const response = await fetch(statusUrl());
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || "failed to load board status");
        }
        applyPayload(payload);
      } catch (error) {
        applyError(error instanceof Error ? error.message : "unknown error");
      }
    }

    function startPolling() {
      if (pollId) {
        return;
      }
      fetchOnce();
      pollId = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
    }

    // Prefer a live server-push stream; fall back to polling if EventSource is
    // unavailable or the stream never delivers a frame.
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        source = new EventSource(streamUrl());
        source.onmessage = (event) => {
          try {
            receivedAny = true;
            applyPayload(JSON.parse(event.data));
          } catch {
            // ignore a malformed frame; the next one will refresh state
          }
        };
        source.onerror = () => {
          if (!receivedAny && source) {
            source.close();
            source = null;
            startPolling();
          }
          // otherwise let EventSource auto-reconnect
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      cancelled = true;
      if (source) {
        source.close();
      }
      if (pollId) {
        window.clearInterval(pollId);
      }
    };
  }, []);

  const payload = state.payload;
  const lanes = payload?.lanes || [];
  const activity = payload?.activity || [];

  useEffect(() => {
    if (!lanes.length) {
      setSelectedLaneId(null);
      return;
    }
    if (!selectedLaneId || !lanes.some((lane) => lane.id === selectedLaneId)) {
      setSelectedLaneId(lanes[0].id);
    }
  }, [lanes, selectedLaneId]);

  const selectedLane = useMemo(
    () => lanes.find((lane) => lane.id === selectedLaneId) || lanes[0] || null,
    [lanes, selectedLaneId]
  );
  const laneActivity = useMemo(() => {
    if (!selectedLane) {
      return [];
    }
    return activity.filter((item) => item.laneId === selectedLane.id);
  }, [activity, selectedLane]);

  function navigate(nextPath) {
    if (nextPath === pathname) {
      return;
    }
    window.history.pushState({}, "", routeUrl(nextPath));
    setPathname(nextPath);
  }

  return (
    <div className="app">
      <GridBackground />
      <main className="page">
        <Header
          pathname={pathname}
          loading={state.loading}
          error={state.error}
          generatedAt={payload?.generatedAt}
          onNavigate={navigate}
        />

        {state.error ? <div className="alert">{state.error}</div> : null}
        {!payload && state.loading ? <div className="empty-page">Loading board...</div> : null}

        {payload && pathname === "/" ? (
          <Dashboard
            payload={payload}
            selectedLane={selectedLane}
            validator={payload.validator}
            publicProof={payload.publicProof}
            onNavigate={navigate}
          />
        ) : null}
        {payload && (pathname === "/arena" || pathname === "/live") ? (
          <Arena
            lanes={lanes}
            selectedLane={selectedLane}
            round={payload.round}
            roundHistory={payload.roundHistory}
            kataRepoSlug={payload.publicLinks?.kataRepo}
            setSelectedLaneId={setSelectedLaneId}
          />
        ) : null}
        {payload && (pathname === "/winners" || pathname === "/champions") ? (
          <Winners
            lanes={lanes}
            kataRepoSlug={payload.publicLinks?.kataRepo}
            publicProof={payload.publicProof}
          />
        ) : null}
        {payload && pathname === "/leaderboard" ? (
          <Leaderboard leaderboard={payload.leaderboard} />
        ) : null}
        {payload && pathname === "/docs" ? (
          <Docs selectedLane={selectedLane} kataRepoSlug={payload.publicLinks?.kataRepo} />
        ) : null}
      </main>
    </div>
  );
}

function Header({ pathname, loading, error, generatedAt, onNavigate }) {
  return (
    <header className="header">
      <button type="button" className="wordmark" onClick={() => onNavigate("/")}>
        Kata
      </button>
      <nav className="nav" aria-label="Primary">
        {PAGES.map((page) => (
          <button
            key={page.path}
            type="button"
            className={`nav-item ${pathname === page.path ? "active" : ""}`}
            onClick={() => onNavigate(page.path)}
          >
            {page.label}
          </button>
        ))}
      </nav>
      <div className="header-right">
        <div className="social-links" aria-label="Project links">
          <a
            className="social-link"
            href="https://github.com/Autovara/kata"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Kata on GitHub"
          >
            <GitHubIcon />
          </a>
          <a
            className="social-link"
            href="https://discord.com/users/1494519136800346174"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Kata Discord contact"
          >
            <DiscordIcon />
          </a>
        </div>
        <div className="header-status">
          <Status label={error ? "error" : loading ? "syncing" : "live"} tone={error ? "bad" : "ok"} />
          <span>{formatDateTime(generatedAt)}</span>
        </div>
      </div>
    </header>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56v-2.02c-3.2.7-3.88-1.38-3.88-1.38-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.76 2.72 1.25 3.38.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18A11.1 11.1 0 0 1 12 6.17c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.64 1.58.24 2.75.12 3.04.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.07.79 2.16v3.03c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.6 13.6 0 0 0-.64 1.32 18.5 18.5 0 0 0-5.44 0 13.6 13.6 0 0 0-.64-1.32 19.7 19.7 0 0 0-4.97 1.57C.53 9.1-.32 13.7.1 18.24a19.9 19.9 0 0 0 6.09 3.08c.49-.66.92-1.36 1.29-2.1-.71-.27-1.39-.6-2.02-.97.17-.12.33-.25.49-.38a14.2 14.2 0 0 0 12.1 0l.49.38c-.64.38-1.31.7-2.03.97.37.74.8 1.44 1.29 2.1a19.9 19.9 0 0 0 6.09-3.08c.5-5.27-.84-9.83-3.57-13.87ZM8.02 15.45c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z"
      />
    </svg>
  );
}

function Dashboard({ payload, selectedLane, validator, publicProof, onNavigate }) {
  const overview = payload.overview || {};
  const submissionStatus = payload.submissionStatus || null;
  const activeEvaluation = validator?.activeEvaluation || null;
  const recentActivity = payload.activity || [];
  const latestChallenge = recentActivity[0] || null;
  const latestStatus = buildDashboardLatestStatus(activeEvaluation, latestChallenge);

  return (
    <div className="dashboard-page">
      <DashboardHero
        overview={overview}
        selectedLane={selectedLane}
        publicProof={publicProof}
        onNavigate={onNavigate}
      />

      <DashboardProof
        publicProof={publicProof}
        kataRepoSlug={payload.publicLinks?.kataRepo}
      />

      <DashboardFlow onNavigate={onNavigate} />

      <DashboardOperations
        latestStatus={latestStatus}
        submissionStatus={submissionStatus}
        generatedAt={payload.generatedAt}
      />
    </div>
  );
}

function DashboardHero({ overview, selectedLane, publicProof, onNavigate }) {
  const round = publicProof?.latestRound || {};
  const king = publicProof?.currentKing || {};
  const projectCount = overview.selectedCodebases ?? overview.benchmarkProjects ?? 0;
  const kingName = king.author || selectedLane?.currentHolder || "seed king";
  const bestTp = round.bestTruePositives ?? "-";
  const candidateCount = round.candidateCount ?? overview.uniqueChallengers ?? "-";
  return (
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy">
        <p className="kicker">Built with Gittensor · Bittensor SN74</p>
        <h1 className="dashboard-hero-title">
          <span>Kata is an</span>{" "}
          <span className="dashboard-hero-title-mark">optimization engine</span>{" "}
          <span>for miner agents</span>
        </h1>
        <p>
          Kata runs open competition to build stronger miner agents for Bittensor
          subnets, promotes the best proven agent as king, and moves mining toward a
          simple one-click experience.
        </p>
        <div className="dashboard-hero-badges" aria-label="Kata network context">
          <span>Gittensor / SN74 supported</span>
          <span>Live target: SN60 Bitsec</span>
          <span>One-click mining roadmap</span>
        </div>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => onNavigate("/arena")}>
            Watch the Arena
          </button>
          <button type="button" className="button" onClick={() => onNavigate("/docs")}>
            Submit an agent
          </button>
        </div>
      </div>

      <div className="dashboard-hero-visual">
        <AssetImage src={KATA_IMAGES.heroDashboard} alt="Kata dashboard competition arena" tone="hero" />
        <div className="dashboard-live-panel">
          <Status label="live" tone="ok" />
          <DashboardMiniMetric label="King" value={kingName} />
          <DashboardMiniMetric label="Round" value={round.roundNumber ? `Round ${round.roundNumber}` : "waiting"} />
          <DashboardMiniMetric label="Projects" value={projectCount || "-"} />
          <DashboardMiniMetric label="Candidates" value={candidateCount} />
          <DashboardMiniMetric label="Best TP" value={bestTp} />
        </div>
      </div>
    </section>
  );
}

function DashboardProof({ publicProof, kataRepoSlug }) {
  if (!publicProof) {
    return null;
  }
  const round = publicProof.latestRound || {};
  const king = publicProof.currentKing || {};
  const proofHref = proofFileLink(round.proof, kataRepoSlug);
  const kingHref = proofFileLink(king.path, kataRepoSlug);
  const packName = formatPackLabel(publicProof.activePack || publicProof.active_pack || "SN60 Bitsec");
  const winner = round.winnerAuthor || king.author || "Current king";
  return (
    <section className="dashboard-proof">
      <div className="dashboard-proof-image">
        <AssetImage src={KATA_IMAGES.proof} alt="Verified public proof artifact" tone="proof" />
      </div>
      <div className="dashboard-proof-copy">
        <span className="showcase-kicker">Public proof</span>
        <h2>{winner} is the current {packName} king</h2>
        <p>
          The proof file records the round, benchmark selection, true-positive score,
          candidate count, and timing without exposing private validator secrets.
        </p>
        <div className="dashboard-proof-metrics">
          <ProofFact label="True positives" value={round.bestTruePositives ?? "-"} />
          <ProofFact label="Detection" value={formatPercent(round.bestDetectionScore)} />
          <ProofFact label="Candidates" value={round.candidateCount ?? "-"} />
          <ProofFact label="Duration" value={formatDuration(round.durationSeconds)} />
        </div>
        <div className="proof-actions">
          {proofHref ? <a href={proofHref} target="_blank" rel="noreferrer">View public proof</a> : null}
          {kingHref ? (
            <a href={kingHref} target="_blank" rel="noreferrer" className="proof-secondary-action">
              Open winning agent
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DashboardFlow({ onNavigate }) {
  return (
    <section className="dashboard-flow">
      <div className="dashboard-section-head">
        <span className="showcase-kicker">How Kata works</span>
        <h2>One PR enters. One verified king comes out.</h2>
      </div>
      <div className="dashboard-flow-grid">
        <DashboardFlowCard
          image={KATA_IMAGES.vulnerabilityFinding}
          step="01"
          title="Submit one agent PR"
          text="A contributor adds exactly one miner agent bundle and follows the submission rules."
          action="Submission guide"
          onClick={() => onNavigate("/docs")}
        />
        <DashboardFlowCard
          image={KATA_IMAGES.benchmarkProjects}
          step="02"
          title="Compete on the same set"
          text="Qualified agents are scored against the current king on identical sampled problems."
          action="Open arena"
          onClick={() => onNavigate("/arena")}
        />
        <DashboardFlowCard
          image={KATA_IMAGES.currentKing}
          step="03"
          title="Promote the strongest king"
          text="The top challenger that objectively beats the king is merged and published."
          action="See winners"
          onClick={() => onNavigate("/winners")}
        />
      </div>
    </section>
  );
}

function DashboardFlowCard({ image, step, title, text, action, onClick }) {
  return (
    <article className="dashboard-flow-card">
      <AssetImage src={image} alt="" tone="flow" />
      <span>{step}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button type="button" className="showcase-link" onClick={onClick}>
        {action}
      </button>
    </article>
  );
}

function DashboardOperations({ latestStatus, submissionStatus, generatedAt }) {
  return (
    <section className="dashboard-ops">
      <div className="dashboard-section-head">
        <span className="showcase-kicker">Operational status</span>
        <h2>Live queue and review state.</h2>
      </div>
      <div className="dashboard-ops-grid">
        <div className="dashboard-latest-card">
          <SectionTitle title="Latest activity" />
          <KeyValue label="challenger" value={latestStatus.challenger} />
          <KeyValue label="status" value={latestStatus.status} />
          <KeyValue label="source" value={latestStatus.source} />
          <KeyValue label="updated" value={formatDateTime(latestStatus.updatedAt || generatedAt)} />
        </div>
        <SubmissionStatusPanel submissionStatus={submissionStatus} />
      </div>
    </section>
  );
}

function DashboardMiniMetric({ label, value }) {
  return (
    <div className="dashboard-mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AssetImage({ src, alt, tone = "default" }) {
  return (
    <figure className={`asset-image asset-image-${tone}`}>
      <img src={src} alt={alt} loading="lazy" />
    </figure>
  );
}

function ProofFact({ label, value }) {
  return (
    <div className="proof-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SubmissionStatusPanel({ submissionStatus }) {
  const counts = submissionStatus?.counts || {};
  const reviewPulls = submissionStatus?.reviewPulls || [];
  const invalidPulls = submissionStatus?.invalidPulls || [];
  const approvals = submissionStatus?.reviewApprovals?.recent || [];
  return (
    <section className="section-block submission-status-panel">
      <SectionTitle title="Submission screening status" />
      <div className="submission-status-grid">
        <StatusMetric label="pending" value={counts.pending || 0} tone="ok" />
        <StatusMetric label="review" value={counts.review || 0} tone="warn" />
        <StatusMetric label="approved reviews" value={counts.approvedReview || 0} tone="ok" />
        <StatusMetric label="invalid" value={counts.invalid || 0} tone="bad" />
      </div>
      <div className="submission-status-lists">
        <StatusPullList
          title="Held for review"
          emptyText="No PRs are currently visible with kata:review."
          items={reviewPulls}
        />
        <StatusPullList
          title="Recently invalid"
          emptyText="No recent submission PRs are visible with kata:invalid."
          items={invalidPulls}
        />
        <StatusApprovalList approvals={approvals} />
      </div>
    </section>
  );
}

function StatusMetric({ label, value, tone }) {
  return (
    <div className={`status-metric status-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPullList({ title, emptyText, items }) {
  return (
    <div className="status-list-card">
      <strong>{title}</strong>
      {items.length ? (
        items.slice(0, 4).map((item) => (
          <a
            className="status-list-row"
            href={item.htmlUrl || undefined}
            key={`${item.statusLabel}-${item.pullNumber}-${item.author}`}
            target={item.htmlUrl ? "_blank" : undefined}
            rel={item.htmlUrl ? "noreferrer" : undefined}
          >
            <span>{item.pullNumber ? `#${item.pullNumber}` : "PR"}</span>
            <small>{item.author || "unknown"}</small>
          </a>
        ))
      ) : (
        <p>{emptyText}</p>
      )}
    </div>
  );
}

function StatusApprovalList({ approvals }) {
  return (
    <div className="status-list-card">
      <strong>Review approvals</strong>
      {approvals.length ? (
        approvals.slice(0, 4).map((approval) => (
          <div
            className="status-list-row"
            key={`${approval.repo}-${approval.pullNumber}-${approval.approvedAt}`}
          >
            <span>{approval.pullNumber ? `#${approval.pullNumber}` : "PR"}</span>
            <small>{approval.approvedBy || "reviewer"}</small>
          </div>
        ))
      ) : (
        <p>No review approvals are recorded yet.</p>
      )}
    </div>
  );
}

function HowStep({ step, title, text }) {
  return (
    <div className="how-step">
      <span className="how-step-num">{step}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

const ROUND_STATE_BANNER = {
  idle: {
    label: "idle",
    tone: "neutral",
    text: "Waiting for the next round to start."
  },
  executing: {
    label: "scoring now",
    tone: "warn",
    text: "Every candidate is being scored against the king right now."
  },
  completed: {
    label: "round complete",
    tone: "ok",
    text: "Scoring finished — see the result below."
  },
  skipped: {
    label: "round skipped",
    tone: "warn",
    text: "The round did not run. See the reason below."
  },
  failed: {
    label: "round failed",
    tone: "bad",
    text: "The round stopped before validation. See the reason below."
  }
};

const ROUND_STATUS_LABEL = {
  pending: "pending",
  executing: "scoring",
  winner: "winner",
  losing: "did not beat king",
  invalid: "invalid",
  stale: "stale",
  hold: "on hold"
};

function RoundStatusPill({ status }) {
  const label = ROUND_STATUS_LABEL[status] || status || "—";
  return <span className={`rstat rstat-${status || "neutral"}`}>{label}</span>;
}

function BeatsKingBadge({ beats }) {
  if (beats == null) {
    return <span className="beat-badge beat-pending">—</span>;
  }
  return beats ? (
    <span className="beat-badge beat-yes">beats king</span>
  ) : (
    <span className="beat-badge beat-no">no</span>
  );
}

function compareEntrantsByRank(a, b, selectedProjectCount = 0) {
  // Same order the engine ranks by: pass score, projects passed, true positives,
  // fewer invalid runs, precision, then F1. Unscored entrants sort last.
  const key = (entrant) => [
    entrantPassScore(entrant, selectedProjectCount),
    entrantPassCount(entrant),
    entrant.true_positives ?? -1,
    -(entrant.invalid_runs ?? 0),
    entrant.precision ?? -1,
    entrant.f1_score ?? -1
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

function projectCountFromEntrant(entrant) {
  return Array.isArray(entrant?.projects) ? entrant.projects.length : 0;
}

function selectedProjectKeysFromRound(round) {
  const candidates = [
    round?.liveProgress?.projectKeys,
    round?.projectKeys,
    round?.primary?.projectKeys,
    round?.evaluatorState?.current?.projectKeys
  ];
  const keys = candidates.find((value) => Array.isArray(value) && value.length);
  return keys || [];
}

function entrantPassCount(entrant) {
  if (entrant?.codebase_pass_count != null) {
    return Number(entrant.codebase_pass_count);
  }
  if (Array.isArray(entrant?.projects)) {
    return entrant.projects.filter((project) => project?.passed).length;
  }
  return -1;
}

function entrantProjectTotal(entrant, selectedProjectCount = 0) {
  const selectedTotal = Number(selectedProjectCount || 0);
  if (selectedTotal > 0) {
    return selectedTotal;
  }
  return projectCountFromEntrant(entrant);
}

function entrantPassScore(entrant, selectedProjectCount = 0) {
  const count = entrantPassCount(entrant);
  const total = entrantProjectTotal(entrant, selectedProjectCount);
  if (count < 0 || total <= 0) {
    return -1;
  }
  return count / total;
}

function formatPassScore(entrant, selectedProjectCount = 0) {
  const passCount = entrantPassCount(entrant);
  const projectCount = entrantProjectTotal(entrant, selectedProjectCount);
  if (passCount < 0 || projectCount <= 0) {
    return "—";
  }
  return `${passCount}/${projectCount}`;
}

function formatProjectsPassed(entrant) {
  const passCount = entrantPassCount(entrant);
  return passCount < 0 ? "—" : String(passCount);
}

function inferReplicasPerProject(round) {
  const projectCount = Number(round?.liveProgress?.projectKeys?.length || 0);
  const candidates = round?.liveProgress?.candidates || [];
  const firstTotal = Number(candidates.find((candidate) => Number(candidate?.total) > 0)?.total || 0);
  if (projectCount > 0 && firstTotal > 0) {
    return Math.max(1, Math.round(firstTotal / projectCount));
  }
  return 1;
}

function projectPassThresholdLabel(replicasPerProject) {
  const replicas = Math.max(1, Number(replicasPerProject || 1));
  const required = Math.ceil((replicas * 2) / 3);
  return `${required}/${replicas}`;
}

function projectPassCount(project) {
  if (!project) {
    return 0;
  }
  if (project.pass_count != null) {
    return Number(project.pass_count || 0);
  }
  const replicas = Array.isArray(project.replicas) ? project.replicas : [];
  return replicas.filter((replica) => replica?.passed || replica?.result === "PASS").length;
}

function projectReplicaTotal(project, fallback = 0) {
  if (!project) {
    return fallback;
  }
  if (project.total_replicas != null) {
    return Number(project.total_replicas || 0) || fallback;
  }
  const replicas = Array.isArray(project.replicas) ? project.replicas : [];
  return replicas.length || fallback;
}

function projectReplicaPassLabel(project, fallback = 0) {
  const total = projectReplicaTotal(project, fallback);
  if (!project && !total) {
    return "—";
  }
  return `${projectPassCount(project)}/${total || 0} passed`;
}

function roundExtras(round) {
  const extras = [];
  if (round.screenedOut?.length) {
    extras.push(`${round.screenedOut.length} screened out`);
  }
  if (round.closedExtras?.length) {
    extras.push(`${round.closedExtras.length} extra PR closed — one open PR per contributor`);
  }
  if (round.skippedStale?.length) {
    extras.push(`${round.skippedStale.length} skipped — unchanged since last round`);
  }
  return extras;
}

function RoundRuleCard({ candidateOnly, passThreshold, replicasPerProject }) {
  return (
    <div className="round-rule-card">
      <div>
        <span>promotion rule</span>
        <strong>{candidateOnly ? "Top candidate with at least one true positive" : "Strictly beat the king"}</strong>
        <p>
          A project passes when enough replicas pass. This round uses {replicasPerProject} run
          {replicasPerProject === 1 ? "" : "s"} per project, so the pass threshold is {passThreshold}.
        </p>
      </div>
      <ol>
        <li>Pass score</li>
        <li>Projects passed</li>
        <li>True positives</li>
        <li>Fewer invalid runs</li>
        <li>Precision</li>
        <li>F1 score</li>
      </ol>
    </div>
  );
}

function ExternalBaselineCard({ baseline, projectCount }) {
  if (!baseline) {
    return null;
  }
  const manifest = baseline.artifact_manifest || {};
  const entry = baseline.entry || baseline;
  const label =
    manifest.baseline_id ||
    (manifest.agent_id ? `SN60 Agent ${manifest.agent_id}` : baseline.submission_id || "SN60 baseline");
  const status = baseline.status || "unknown";
  const statusTone = status === "completed" ? "ok" : status === "failed" ? "bad" : "warn";
  return (
    <div className="baseline-card">
      <div className="baseline-card-main">
        <span>external baseline · proof only</span>
        <strong>{label}</strong>
        <p>
          Scored after the round on the same selected projects. It is not a Kata candidate
          and cannot be promoted.
        </p>
      </div>
      <div className="baseline-card-metrics">
        <MetricChip label="status" value={status} tone={statusTone} />
        <MetricChip label="pass score" value={formatPassScore(entry, projectCount)} tone="ok" />
        <MetricChip label="TP" value={String(entry.true_positives ?? baseline.true_positives ?? "—")} />
        <MetricChip label="precision" value={percentMetric(entry.precision ?? baseline.precision)} />
        <MetricChip label="f1" value={percentMetric(entry.f1_score ?? baseline.f1_score)} />
        <MetricChip
          label="vs king"
          value={entry.beats_king === true ? "beat king" : entry.beats_king === false ? "did not beat" : "—"}
          tone={entry.beats_king === true ? "ok" : entry.beats_king === false ? "bad" : "neutral"}
        />
      </div>
    </div>
  );
}

function RoundPanel({ round, kataRepoSlug, kingAuthor, kingSubmissionId, selectedPull, setSelectedPull }) {
  const entrants = round?.entrants || [];
  const state = round?.state || "idle";
  const hasRound = Boolean(round && (state !== "idle" || entrants.length || round.runId));
  const roundTitle = round?.roundNumber ? `Current round · Round ${round.roundNumber}` : "Current round";
  const candidateOnly =
    round?.competitionMode === "candidate_only" ||
    round?.liveProgress?.competitionMode === "candidate_only";
  const kingSkippedReason =
    round?.kingSkippedReason ||
    round?.liveProgress?.kingSkippedReason ||
    "Candidate-only recovery mode is enabled. The current king was not evaluated in this round.";
  const roundKingAuthor = round?.kingAuthor || kingAuthor;
  const roundKingSubmissionId = round?.kingSubmissionId || kingSubmissionId;
  const selectedEntrant = entrants.find((entrant) => entrant.pull_number === selectedPull) || null;
  // Live progress only while the round is actively scoring; ignore a stale
  // snapshot left over from a previous round.
  const live =
    state === "executing" && round?.liveProgress?.state === "executing"
      ? round.liveProgress
      : null;
  const progressByPull = {};
  if (live) {
    live.candidates.forEach((candidate) => {
      const match = /^pr-(\d+)$/.exec(candidate.submission_id || "");
      if (match) {
        progressByPull[Number(match[1])] = candidate;
      }
    });
  }

  // Per-PR result feed (published as each PR finishes, and after the round ends) —
  // used by the detail page so a finished PR keeps its full result. Not gated on
  // "executing", so it survives to the completed snapshot.
  const resultByPull = {};
  (round?.liveProgress?.candidates || []).forEach((candidate) => {
    const match = /^pr-(\d+)$/.exec(candidate.submission_id || "");
    if (match) {
      resultByPull[Number(match[1])] = candidate;
    }
  });
  const kingResult = candidateOnly ? null : round?.liveProgress?.king || round?.king || null;
  const projectKeys = selectedProjectKeysFromRound(round);
  const selectedProjectCount = projectKeys.length;
  const replicasPerProject = inferReplicasPerProject(round);
  const passThreshold = projectPassThresholdLabel(replicasPerProject);

  // Live-merge each entrant with its published result, then rank by the engine's
  // comparator so the table is a live leaderboard (winner on top).
  const rankedEntrants = entrants
    .map((entrant) => {
      const result = resultByPull[entrant.pull_number];
      if (!result) {
        return entrant;
      }
      return {
        ...entrant,
        aggregated_score: result.aggregated_score ?? entrant.aggregated_score,
        true_positives: result.true_positives ?? entrant.true_positives,
        precision: result.precision ?? entrant.precision,
        f1_score: result.f1_score ?? entrant.f1_score,
        invalid_runs: result.invalid_runs ?? entrant.invalid_runs,
        beats_king: result.beats_king ?? entrant.beats_king,
        codebase_pass_count: result.codebase_pass_count ?? entrant.codebase_pass_count,
        projects: result.projects ?? entrant.projects
      };
    })
    .sort((left, right) => compareEntrantsByRank(left, right, selectedProjectCount));

  // Clicking a row opens a full-width duel page (not a modal), matching the
  // original arena duel layout.
  if (hasRound && selectedPull === "king" && !candidateOnly) {
    return (
      <KingDetail
        king={kingResult}
        progress={round?.liveProgress?.king || null}
        kingAuthor={roundKingAuthor}
        kingSubmissionId={roundKingSubmissionId}
        projectKeys={projectKeys}
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold}
        onBack={() => setSelectedPull(null)}
      />
    );
  }
  if (hasRound && selectedEntrant) {
    const result = resultByPull[selectedEntrant.pull_number] || null;
    const candidate = {
      ...selectedEntrant,
      ...(result
        ? {
            aggregated_score: result.aggregated_score ?? selectedEntrant.aggregated_score,
            true_positives: result.true_positives ?? selectedEntrant.true_positives,
            precision: result.precision,
            f1_score: result.f1_score,
            total_found: result.total_found,
            total_expected: result.total_expected,
            invalid_runs: result.invalid_runs,
            beats_king: result.beats_king ?? selectedEntrant.beats_king,
            projects: result.projects
          }
        : {})
    };
    return (
      <DuelDetail
        entrant={candidate}
        king={kingResult}
        kingAuthor={roundKingAuthor}
        progress={result}
        projectKeys={projectKeys}
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold}
        kataRepoSlug={kataRepoSlug}
        onBack={() => setSelectedPull(null)}
      />
    );
  }

  return (
    <div className="round-block">
      <div className="round-block-head">
        <SectionTitle title={roundTitle} />
        <p className="section-lead round-lead">
          {candidateOnly
            ? "Recovery round: the current king is skipped, and candidates are scored against each other on the same secret Bitsec problems."
            : "Live round status: candidates are scored against the current king on the same secret Bitsec problems."}
        </p>
      </div>

      {!hasRound ? (
        <div className="round-empty">
          <Status label="no round running" tone="neutral" />
          <p>
            No round is running. Once started, live candidate scores and results will appear here.
          </p>
        </div>
      ) : (
        <section className="table-section round-table">
          <div className="round-banner">
            <div className="round-banner-state">
              <Status
                label={(ROUND_STATE_BANNER[state] || ROUND_STATE_BANNER.idle).label}
                tone={(ROUND_STATE_BANNER[state] || ROUND_STATE_BANNER.idle).tone}
              />
              <p>{(ROUND_STATE_BANNER[state] || ROUND_STATE_BANNER.idle).text}</p>
            </div>
            <div className="round-banner-meta">
              {round.roundNumber ? <RoundMeta label="round" value={`#${round.roundNumber}`} /> : null}
              {kingResult && kingResult.aggregated_score != null ? (
                <RoundMeta label="king detection" value={formatDetection(kingResult.aggregated_score)} />
              ) : null}
              {candidateOnly ? <RoundMeta label="mode" value="candidate-only recovery" /> : null}
              <RoundMeta label="project pass" value={`${passThreshold} replicas`} />
              <RoundMeta label="candidates" value={entrants.length} />
              {round.generatedAt ? (
                <RoundMeta
                  label={state === "executing" ? "started" : "finished"}
                  value={formatDateTime(round.generatedAt)}
                />
              ) : null}
            </div>
          </div>

          {round.note ? (
            <div className={`round-note round-note-${state === "skipped" || state === "failed" ? "warn" : "info"}`}>
              {round.note}
            </div>
          ) : null}

          {candidateOnly ? (
            <div className="round-note round-note-warn">
              King skipped: {kingSkippedReason}
            </div>
          ) : null}

          {round.winnerSubmissionId ? (
            <div className="round-verdict round-verdict-win">
              <span className="round-verdict-crown" aria-hidden="true">♔</span>
              <div>
                <strong>New king: {round.winnerSubmissionId}</strong>
                <p>
                  {candidateOnly
                    ? "Won the candidate-only recovery round and is being promoted."
                    : "Beat the king this round and is being promoted."}
                </p>
              </div>
            </div>
          ) : state === "completed" ? (
            <div className="round-verdict round-verdict-hold">
              <span className="round-verdict-crown" aria-hidden="true">♔</span>
              <div>
                <strong>King held the crown</strong>
                <p>
                  {candidateOnly
                    ? "No candidate-only winner was selected."
                    : "No candidate strictly beat the king this round."}
                </p>
              </div>
            </div>
          ) : null}

          <RoundRuleCard
            candidateOnly={candidateOnly}
            passThreshold={passThreshold}
            replicasPerProject={replicasPerProject}
          />

          <ExternalBaselineCard baseline={round.externalBaseline} projectCount={projectKeys.length} />

          <div className="table-head round-grid">
            <span>PR</span>
            <span>{state === "completed" ? "rank · entrant" : "entrant"}</span>
            <span>pass score</span>
            <span>projects passed</span>
            <span>TP</span>
            <span>{candidateOnly ? "round result" : "beats king"}</span>
            <span>status</span>
          </div>

          {!candidateOnly && (kingResult || (live && live.king)) ? (
            <div
              className="table-row round-grid round-row-king round-row-clickable"
              role="button"
              tabIndex={0}
              title="Open the king's scoring detail"
              onClick={() => setSelectedPull("king")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedPull("king");
                }
              }}
            >
              <span aria-hidden="true">♔</span>
              <span className="entrant-cell">
                <EntrantIdentity author={roundKingAuthor} submissionId={roundKingSubmissionId || "current king"} />
              </span>
              <span>{formatPassScore(kingResult, selectedProjectCount)}</span>
              <span>{formatProjectsPassed(kingResult)}</span>
              <span>{kingResult?.true_positives ?? "—"}</span>
              <span>—</span>
              <span>
                {live && live.king && live.king.state === "scoring" ? (
                  <ProgressBar done={live.king.done} total={live.king.total} tone="king" />
                ) : (
                  <span className="rstat rstat-king">king</span>
                )}
              </span>
            </div>
          ) : null}

          {rankedEntrants.length ? (
            rankedEntrants.map((entrant, index) => (
              <div
                className="table-row round-grid round-row-clickable"
                key={entrant.pull_number}
                role="button"
                tabIndex={0}
                title="Open the detailed duel for this PR"
                onClick={() => setSelectedPull(entrant.pull_number)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedPull(entrant.pull_number);
                  }
                }}
              >
                <span>{prLabel(kataRepoSlug, entrant.pull_number)}</span>
                <span className="entrant-cell">
                  {entrant.aggregated_score != null ? (
                    <span className={`entrant-rank ${index === 0 ? "entrant-rank-top" : ""}`}>
                      #{index + 1}
                    </span>
                  ) : null}
                  <EntrantIdentity author={entrant.author} submissionId={entrant.submission_id} />
                </span>
                <span>{formatPassScore(entrant, selectedProjectCount)}</span>
                <span>{formatProjectsPassed(entrant)}</span>
                <span>{entrant.true_positives ?? "—"}</span>
                <span>
                  {candidateOnly ? (
                    entrant.status === "winner" || entrant.selected_winner ? (
                      <span className="beat-badge beat-yes">top candidate</span>
                    ) : (
                      <span className="beat-badge beat-no">not selected</span>
                    )
                  ) : (
                    <BeatsKingBadge beats={entrant.beats_king} />
                  )}
                </span>
                <span>{renderEntrantStatus(entrant, progressByPull[entrant.pull_number])}</span>
              </div>
            ))
          ) : (
            <Empty text="No candidates entered this round." />
          )}

          {roundExtras(round).length ? (
            <div className="round-extras">
              {roundExtras(round).map((text) => (
                <span key={text}>{text}</span>
              ))}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

// One problem row's score, read as tp / expected / found:
//   tp       = real vulnerabilities the agent matched
//   expected = real vulnerabilities in that codebase
//   found    = total findings the agent reported (tp + false positives)
// `project.passed` is the engine verdict after applying the replica threshold.
function formatTpExpectedFound(project) {
  if (!project) return "—";
  return `${project.true_positives}/${project.total_expected}/${project.total_found}`;
}

function problemResult(project) {
  if (!project) return { label: "scoring", tone: "warn" };
  if (project.finished === false || project.scoring) return { label: "scoring", tone: "warn" };
  if (project.passed) return { label: "pass", tone: "ok" };
  if ((project.true_positives ?? 0) > 0) return { label: "fail · partial", tone: "warn" };
  return { label: "fail", tone: "bad" };
}

function ProblemBreakdown({
  projectKeys,
  primaryByKey,
  primaryLabel,
  secondaryByKey = {},
  secondaryLabel = null,
  replicasPerProject,
  passThreshold,
  mode = "duel"
}) {
  const [openProjectKey, setOpenProjectKey] = useState(null);
  if (!projectKeys.length) {
    return <Empty text="Per-problem detail appears once scoring starts." />;
  }
  const single = mode === "single";
  return (
    <div className="live-task-progress">
      <div className="live-task-progress-head">
        <div>
          <span>per-problem breakdown</span>
          <strong>{projectKeys.length} benchmark projects</strong>
          <small>
            Click a problem to inspect replica runs. Project pass rule:{" "}
            {passThreshold || projectPassThresholdLabel(replicasPerProject)} replicas.
          </small>
        </div>
      </div>
      <div
        className={`live-task-table-head ${single ? "live-task-table-head-single" : ""}`}
        aria-hidden="true"
      >
        <span>problem</span>
        <span>replicas</span>
        <span>result</span>
        <span>{primaryLabel}</span>
        {single ? null : <span>{secondaryLabel || "comparison"}</span>}
      </div>
      <div className="live-task-list">
        {projectKeys.map((key) => {
          const project = primaryByKey[key];
          const secondaryProject = secondaryByKey[key];
          const pending = !project;
          const result = problemResult(pending ? null : project);
          const open = openProjectKey === key;
          return (
            <div
              className={`problem-accordion problem-accordion-${
                pending ? "neutral" : project.passed ? "ok" : result.tone === "warn" ? "active" : "bad"
              } ${open ? "problem-accordion-open" : ""}`}
              key={key}
            >
              <button
                type="button"
                className={`live-task-row problem-row-button live-task-row-${
                  pending ? "neutral" : project.passed ? "ok" : result.tone === "warn" ? "active" : "bad"
                } ${single ? "live-task-row-single" : ""}`}
                onClick={() => setOpenProjectKey(open ? null : key)}
                aria-expanded={open}
              >
                <div className="live-task-main">
                  <div className="live-task-icon problem-expand-icon" aria-hidden="true">
                    {open ? "⌄" : "›"}
                  </div>
                  <div>
                    <strong>{formatProjectName(key)}</strong>
                    <span>{key}</span>
                  </div>
                </div>
                <span className="problem-replica-pill">
                  {projectReplicaPassLabel(project, replicasPerProject)}
                </span>
                <Status label={result.label} tone={result.tone} />
                <div
                  className={`live-task-side ${
                    pending ? "" : project.passed ? "live-task-side-ok" : "live-task-side-bad"
                  }`}
                >
                  <span>{primaryLabel}</span>
                  <strong>{pending ? "—" : formatTpExpectedFound(project)}</strong>
                  <small>tp / expected / found</small>
                </div>
                {single ? null : (
                  <div className="live-task-side">
                    <span>{secondaryLabel || "secondary"}</span>
                    <strong>{formatTpExpectedFound(secondaryProject)}</strong>
                    <small>tp / expected / found</small>
                  </div>
                )}
              </button>
              {open ? (
                <div className="replica-dropdown">
                  <ReplicaTable
                    title={`${primaryLabel} replicas`}
                    project={project}
                    replicasPerProject={replicasPerProject}
                  />
                  {single ? null : (
                    <ReplicaTable
                      title={`${secondaryLabel || "secondary"} replicas`}
                      project={secondaryProject}
                      replicasPerProject={replicasPerProject}
                      compact
                    />
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReplicaTable({ title, project, replicasPerProject, compact = false }) {
  const replicas = normalizeReplicaRows(project, replicasPerProject);
  const tone = project?.passed ? "ok" : project ? "bad" : "neutral";
  return (
    <div className={`replica-table replica-table-${tone} ${compact ? "replica-table-compact" : ""}`}>
      <div className="replica-table-title">
        <strong>{title}</strong>
        <span>{projectReplicaPassLabel(project, replicasPerProject)}</span>
      </div>
      <div className="replica-table-head" aria-hidden="true">
        <span>#</span>
        <span>evaluated</span>
        <span>findings</span>
        <span>status</span>
      </div>
      {replicas.map((replica) => (
        <div className="replica-row" key={replica.replica_index}>
          <strong>{replica.replica_index}</strong>
          <span>{replica.evaluated ? "✓" : replica.started ? "running" : "queued"}</span>
          <span>{formatReplicaFindings(replica)}</span>
          <span className={`replica-status replica-status-${replicaStatusTone(replica)}`}>
            {replicaStatusLabel(replica)}
          </span>
        </div>
      ))}
    </div>
  );
}

function normalizeReplicaRows(project, replicasPerProject) {
  const total = projectReplicaTotal(project, replicasPerProject);
  const byIndex = new Map(
    (Array.isArray(project?.replicas) ? project.replicas : []).map((replica) => [
      Number(replica.replica_index || 0),
      replica
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
      ...(byIndex.get(replicaIndex) || {})
    };
  });
}

function formatReplicaFindings(replica) {
  if (!replica?.evaluated) {
    return "—";
  }
  return `${replica.true_positives ?? 0}/${replica.total_expected ?? 0}`;
}

function replicaStatusTone(replica) {
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

function replicaStatusLabel(replica) {
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

function KingDetail({
  king,
  progress,
  kingAuthor,
  kingSubmissionId,
  projectKeys,
  replicasPerProject,
  passThreshold,
  onBack
}) {
  const projects = king?.projects || [];
  const done = progress?.done ?? projects.length;
  const total = progress?.total ?? projects.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const scoring = progress?.state === "scoring";
  // Show every sampled problem up front; scored ones fill in, the rest stay pending.
  const kingByKey = {};
  projects.forEach((project) => {
    kingByKey[project.project_key] = project;
  });
  const problemKeys =
    projectKeys && projectKeys.length ? projectKeys : projects.map((project) => project.project_key);
  const name = kingAuthor || kingSubmissionId || "Current king";
  return (
    <div className="round-block duel-page">
      <div className="duel-detail-topbar">
        <button type="button" className="button" onClick={onBack}>
          ← Back to round
        </button>
        <div className="duel-detail-title">
          <span className="rstat rstat-king">♔ current king</span>
          {scoring ? (
            <Status label="scoring now" tone="warn" />
          ) : (
            <Status label="cached for this round" tone="ok" />
          )}
        </div>
      </div>

      <section className="arena-hero">
        <div className="battle-wrap">
          <div className="battle battle-solo">
            <BattleSide
              role="king"
              crown
              name={name}
              sub={kingAuthor ? "reigning king" : "current king"}
              avatarUrl={
                kingAuthor ? `https://github.com/${encodeURIComponent(kingAuthor)}.png?size=96` : null
              }
              score={formatPassScore(king, problemKeys.length)}
              scoreLabel="project pass score"
              won={false}
            />
          </div>
        </div>
      </section>

      {total > 0 ? (
        <div className="duel-task-bar">
          <div className="duel-task-bar-head">
            <span>problem progress</span>
            <strong>{done}/{total} problems scored</strong>
            <small>
              {scoring
                ? "Scoring the king on all problems — then cached for the whole round."
                : "King scored and cached; candidates are compared to this."}
            </small>
          </div>
          <div className="progress-track duel-task-track" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="duel-snapshot">
        <MetricChip label="project pass score" value={formatPassScore(king, problemKeys.length)} tone="ok" />
        <MetricChip label="detection" value={formatDetection(king?.aggregated_score)} />
        <MetricChip label="precision" value={percentMetric(king?.precision)} />
        <MetricChip label="f1 score" value={percentMetric(king?.f1_score)} />
        <MetricChip
          label="matched / reported"
          value={`${king?.true_positives ?? "—"} / ${king?.total_found ?? "—"}`}
        />
        <MetricChip label="invalid" value={String(Number(king?.invalid_runs || 0))} />
        <MetricChip label="project pass rule" value={passThreshold || projectPassThresholdLabel(replicasPerProject)} />
      </div>

      <ProblemBreakdown
        projectKeys={problemKeys}
        primaryByKey={kingByKey}
        primaryLabel="king"
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold}
        mode="single"
      />
    </div>
  );
}

function DuelDetail({
  entrant,
  king,
  kingAuthor,
  kataRepoSlug,
  progress,
  projectKeys,
  replicasPerProject,
  passThreshold,
  onBack
}) {
  const won = entrant.beats_king === true;
  const decided = entrant.status !== "executing" && entrant.aggregated_score != null;
  const scoring = progress && progress.state === "scoring";
  const kingProjects = {};
  (king?.projects || []).forEach((project) => {
    kingProjects[project.project_key] = project;
  });
  const projects = entrant.projects || [];
  const candidateInvalid = Number(entrant.invalid_runs || 0);
  const taskDone = progress?.done ?? projects.length;
  const taskTotal = progress?.total ?? projects.length;
  const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;
  // Show ALL sampled problems up front; scored ones fill in, the rest stay "scoring".
  const candidateByKey = {};
  projects.forEach((project) => {
    candidateByKey[project.project_key] = project;
  });
  const candidateByKey_count = projects.length;
  const problemKeys =
    projectKeys && projectKeys.length ? projectKeys : projects.map((project) => project.project_key);
  const candidatePassScore = formatPassScore(entrant, problemKeys.length);
  const kingPassScore = formatPassScore(king, problemKeys.length);
  const candidatePassRatio = entrantPassScore(entrant, problemKeys.length);
  const kingPassRatio = entrantPassScore(king, problemKeys.length);

  return (
    <div className="round-block duel-page">
      <div className="duel-detail-topbar">
        <button type="button" className="button" onClick={onBack}>
          ← Back to round
        </button>
        <div className="duel-detail-title">
          <EntrantIdentity author={entrant.author} submissionId={entrant.submission_id} />
          {prLabel(kataRepoSlug, entrant.pull_number)}
          <RoundStatusPill status={entrant.status} />
        </div>
      </div>

      {scoring ? (
        <div className="duel-live-banner">
          <Status label="scoring now" tone="warn" />
          <span>{progress.done}/{progress.total} problems scored — live metrics fill in as the round completes.</span>
        </div>
      ) : null}

      <section className="arena-hero">
        <div className="battle-wrap">
          <div className="battle">
            <BattleSide
              role="king"
              crown
              name={kingAuthor || "Current king"}
              sub={kingAuthor ? "reigning king" : "current king"}
              avatarUrl={
                kingAuthor ? `https://github.com/${encodeURIComponent(kingAuthor)}.png?size=96` : null
              }
              score={kingPassScore}
              scoreLabel="project pass score"
              won={decided && !won}
            />
            <div className="battle-mid">
              <div className="vs">VS</div>
              <div className="battle-decision">
                <span>
                  {candidatePassRatio > kingPassRatio
                    ? "challenger leads"
                    : candidatePassRatio < kingPassRatio
                      ? "king leads"
                      : "level"}
                </span>
                <strong className={candidatePassRatio > kingPassRatio ? "positive" : candidatePassRatio < kingPassRatio ? "negative" : ""}>
                  {candidatePassScore} vs {kingPassScore}
                </strong>
                <small>project pass score</small>
              </div>
            </div>
            <BattleSide
              role="candidate"
              name={entrant.author || entrant.submission_id}
              sub={`PR #${entrant.pull_number}`}
              avatarUrl={
                entrant.author ? `https://github.com/${encodeURIComponent(entrant.author)}.png?size=96` : null
              }
              score={candidatePassScore}
              scoreLabel="project pass score"
              won={won}
            />
          </div>
        </div>
      </section>

      {taskTotal > 0 ? (
        <div className="duel-task-bar">
          <div className="duel-task-bar-head">
            <span>problem progress</span>
            <strong>{taskDone}/{taskTotal} problems scored</strong>
            <small>
              {scoring
                ? "Scoring in progress — the bar fills as each problem finishes."
                : "All sampled problems scored."}
            </small>
          </div>
          <div className="progress-track duel-task-track" aria-hidden="true">
            <i style={{ width: `${taskPct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="duel-compare-panel">
          <div className="duel-panel-head">
            <span>candidate vs king</span>
            <div className="comparison-legend">
              <small><i className="legend-candidate" />Candidate</small>
              <small><i className="legend-king" />King</small>
            </div>
          </div>
          <ComparisonBar label="detection" candidate={entrant.aggregated_score} king={king?.aggregated_score} />
          <ComparisonBar label="precision" candidate={entrant.precision} king={king?.precision} />
          <ComparisonBar label="f1 score" candidate={entrant.f1_score} king={king?.f1_score} />
          <ComparisonBar label="project pass score" candidate={candidatePassRatio} king={kingPassRatio} />
        </div>

        <div className="duel-snapshot">
          <MetricChip label="candidate project pass" value={candidatePassScore} tone="ok" />
          <MetricChip label="king project pass" value={kingPassScore} />
          <MetricChip label="project pass rule" value={passThreshold || projectPassThresholdLabel(replicasPerProject)} />
          <MetricChip
            label="candidate matched / reported"
            value={`${entrant.true_positives ?? "—"} / ${entrant.total_found ?? "—"}`}
          />
          <MetricChip
            label="king matched / reported"
            value={`${king?.true_positives ?? "—"} / ${king?.total_found ?? "—"}`}
          />
          <MetricChip
            label="invalid"
            value={`C ${candidateInvalid} · K ${Number(king?.invalid_runs || 0)}`}
            tone={candidateInvalid > 0 ? "bad" : "ok"}
          />
        </div>

        <ProblemBreakdown
          projectKeys={problemKeys}
          primaryByKey={candidateByKey}
          primaryLabel="candidate"
          secondaryByKey={kingProjects}
          secondaryLabel="king"
          replicasPerProject={replicasPerProject}
          passThreshold={passThreshold}
        />
    </div>
  );
}

function BattleSide({ role, name, sub, score, scoreLabel = "detection score", avatarUrl, crown, won }) {
  return (
    <div className={`battle-side battle-side-${role} ${won ? "battle-side-won" : ""}`}>
      {crown ? (
        <span className="battle-crown" aria-hidden="true">
          ♔
        </span>
      ) : null}
      <Avatar name={name} avatarUrl={avatarUrl} />
      <span className="battle-role">{won ? `${role} · winner` : role}</span>
      <h2>{name}</h2>
      <p>{sub}</p>
      <div className="battle-score">
        <strong>{score}</strong>
        <small>{scoreLabel}</small>
      </div>
    </div>
  );
}

function ComparisonBar({ label, candidate, king }) {
  return (
    <div className="comparison-bar">
      <div className="comparison-bar-head">
        <strong>{label}</strong>
        <span>C {percentMetric(candidate)} · K {percentMetric(king)}</span>
      </div>
      <div className="comparison-track">
        <div className="comparison-lane">
          <span>C</span>
          <b><i className="comparison-fill-candidate" style={{ width: `${ratioWidth(candidate)}%` }} /></b>
        </div>
        <div className="comparison-lane">
          <span>K</span>
          <b><i className="comparison-fill-king" style={{ width: `${ratioWidth(king)}%` }} /></b>
        </div>
      </div>
    </div>
  );
}

function MetricChip({ label, value, tone = "neutral" }) {
  return (
    <div className={`metric-chip metric-chip-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function percentScore(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${formatNumber(Number(value) * 100)} pts`;
}

function percentMetric(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${formatNumber(Number(value) * 100)}%`;
}

function ratioWidth(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value) * 100));
}

function formatProjectName(key) {
  return String(key || "").replace(/_/g, " ");
}

function formatPackLabel(value) {
  if (!value) {
    return "-";
  }
  const normalized = String(value).replace(/__/g, " ").replace(/_/g, " ").trim();
  if (/^sn60 bitsec$/i.test(normalized)) {
    return "SN60 Bitsec";
  }
  return normalized.replace(/\bsn(\d+)\b/gi, "SN$1").replace(/\b\w/g, (char) => char.toUpperCase());
}

function RoundMeta({ label, value }) {
  return (
    <div className="round-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProgressBar({ done, total, label, tone = "candidate" }) {
  const safeTotal = total > 0 ? total : 0;
  const pct = safeTotal > 0 ? Math.round((done / safeTotal) * 100) : 0;
  return (
    <div className={`progress-cell progress-${tone}`}>
      <div className="progress-track" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span>{label ?? `${done}/${safeTotal}`}</span>
    </div>
  );
}

function EntrantIdentity({ author, submissionId }) {
  const name = author || submissionId || "unknown";
  const avatarUrl = author
    ? `https://github.com/${encodeURIComponent(author)}.png?size=48`
    : null;
  return (
    <span className="entrant-identity">
      <Avatar name={name} avatarUrl={avatarUrl} />
      <span className="entrant-name">{name}</span>
    </span>
  );
}

function renderEntrantStatus(entrant, progress) {
  if (progress) {
    if (progress.state === "queued") {
      return <span className="rstat rstat-pending">queued</span>;
    }
    const label =
      progress.state === "done"
        ? `${progress.done}/${progress.total}`
        : `scoring ${progress.done}/${progress.total}`;
    return <ProgressBar done={progress.done} total={progress.total} label={label} />;
  }
  return <RoundStatusPill status={entrant.status} />;
}

function formatDetection(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

function prLabel(kataRepoSlug, pullNumber) {
  if (!pullNumber) {
    return "—";
  }
  if (!kataRepoSlug) {
    return `#${pullNumber}`;
  }
  return (
    <a href={`https://github.com/${kataRepoSlug}/pull/${pullNumber}`} target="_blank" rel="noreferrer">
      #{pullNumber}
    </a>
  );
}

function RoundHistory({ rounds }) {
  if (!rounds || !rounds.length) {
    return null;
  }
  return (
    <div className="round-block">
      <div className="round-block-head">
        <SectionTitle title="Recent rounds" />
        <p className="section-lead">Highlights from completed competition rounds.</p>
      </div>
      <section className="table-section">
        <div className="table-head round-hist-grid">
          <span>round</span>
          <span>highlights</span>
          <span>best detection</span>
          <span>finished</span>
        </div>
        {rounds.slice(0, 12).map((round, index) => (
          <div className="table-row round-hist-grid" key={round.runId || index}>
            <span className="round-hist-title">
              <strong>{round.roundNumber ? `Round ${round.roundNumber}` : "Round"}</strong>
              <small>{round.headline || "Competition round"}</small>
            </span>
            <span className="round-hist-badges">
              {round.achievements?.length ? (
                round.achievements.map((item) => (
                  <span className="rstat rstat-winner" key={item}>
                    {item}
                  </span>
                ))
              ) : (
                <span className="round-hist-quiet">no new king</span>
              )}
            </span>
            <span>{formatDetection(round.bestDetection)}</span>
            <span>{formatDateTime(round.generatedAt)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Arena({
  lanes,
  selectedLane,
  round,
  roundHistory,
  kataRepoSlug,
  setSelectedLaneId
}) {
  const [selectedPull, setSelectedPull] = useState(null);
  const entrants = round?.entrants || [];
  // A duel detail page is open — hide everything else (lanes, recent rounds) so
  // the page shows only that PR's duel.
  const detailOpen =
    selectedPull === "king" ||
    (selectedPull != null && entrants.some((e) => e.pull_number === selectedPull));

  return (
    <div className="stack">
      {!detailOpen && lanes.length > 1 ? (
        <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />
      ) : null}

      <RoundPanel
        round={round}
        kataRepoSlug={kataRepoSlug}
        kingAuthor={selectedLane?.king?.author || null}
        kingSubmissionId={selectedLane?.king?.submissionId || null}
        selectedPull={selectedPull}
        setSelectedPull={setSelectedPull}
      />

      {!detailOpen ? <RoundHistory rounds={roundHistory} /> : null}
    </div>
  );
}

function Winners({ lanes, kataRepoSlug, publicProof }) {
  const round = publicProof?.latestRound || {};
  const king = publicProof?.currentKing || {};
  const activePack = publicProof?.activePack || publicProof?.active_pack;
  const activeLane =
    lanes.find((lane) => lane.subnetPack === activePack || lane.repoPack === activePack) ||
    lanes[0] ||
    {};
  const visibleLanes = lanes.length ? lanes : [activeLane];
  return (
    <section className="winners-page">
      <div className="king-grid">
        {visibleLanes.map((lane, index) => (
          <KingCard
            key={lane.id || activePack || index}
            lane={lane}
            kataRepoSlug={kataRepoSlug}
            publicProof={index === 0 ? publicProof : null}
            round={index === 0 ? round : {}}
            king={index === 0 ? king : {}}
          />
        ))}
      </div>
    </section>
  );
}

function KingCard({ lane, kataRepoSlug, publicProof, round, king }) {
  const winner = king.author || lane.currentHolder || "Seed king";
  const packName = formatPackLabel(
    publicProof?.activePack ||
      publicProof?.active_pack ||
      lane.subnetPack ||
      lane.repoPack ||
      lane.repoName ||
      "SN60 Bitsec"
  );
  const agentHref =
    proofFileLink(king.path, kataRepoSlug) ||
    (lane.id ? kingAgentLink(lane, kataRepoSlug) : null);
  const proofHref = proofFileLink(round.proof, kataRepoSlug);
  const roundLabel = round.roundNumber ? `Round ${round.roundNumber}` : "Latest round";
  const mode = lane.mode || publicProof?.activeMode || publicProof?.active_mode || "miner";
  return (
    <article className="king-card">
      <div className="king-card-body">
        <div className="king-card-crown" aria-hidden="true">
          ♔
        </div>
        <div className="king-card-identity">
          <Avatar name={winner} />
          <div>
            <h1>{winner}</h1>
            <p>{king.submissionId || lane.king?.submissionId || "current king"}</p>
          </div>
        </div>
        <div className="king-card-tags">
          <span>{packName}</span>
          <span>{mode}</span>
          <Status label={lane.king?.seeded ? "seed king" : "promoted"} tone={lane.king?.seeded ? "neutral" : "ok"} />
        </div>
        <div className="king-card-facts">
          <ProofFact label="Round" value={roundLabel} />
          <ProofFact label="TP" value={round.bestTruePositives ?? "-"} />
          <ProofFact label="Detection" value={formatPercent(round.bestDetectionScore)} />
          <ProofFact label="Promoted" value={formatDateTime(king.promotedAt || lane.king?.updatedAt)} />
        </div>
        <div className="king-card-actions">
          {typeof agentHref === "string" && agentHref ? (
            <a className="king-card-action king-card-action-primary" href={agentHref} target="_blank" rel="noreferrer">
              Open agent
            </a>
          ) : null}
          {typeof proofHref === "string" && proofHref ? (
            <a className="king-card-action" href={proofHref} target="_blank" rel="noreferrer">
              View proof
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Leaderboard({ leaderboard }) {
  const rows = leaderboard?.rows || [];

  return (
    <div className="stack">
      <PageIntro
        eyebrow="Leaderboard"
        title="Top challengers"
        text="Track miners, crowned kings, submissions, and the current ranking across Kata challenges."
      />

      <section className="table-section">
        <div className="table-head">
          <span>rank</span>
          <span>miner</span>
          <span>kings</span>
          <span>submissions</span>
          <span>open</span>
          <span>pending</span>
          <span>review</span>
          <span>invalid</span>
          <span>score</span>
        </div>
        {rows.length ? (
          rows.map((row, index) => (
            <div
              className={`table-row ${index < 3 ? `lb-top lb-top-${index + 1}` : ""}`}
              key={row.author}
            >
              <span className="lb-rank">{rankBadge(index)}</span>
              <MinerIdentity
                name={row.author}
                sub={
                  row.currentKings
                    ? `${row.currentKings} active king${row.currentKings === 1 ? "" : "s"}`
                    : "challenger"
                }
              />
              <span className="lb-num">{row.wins}</span>
              <span className="lb-num">{row.totalSubmissions}</span>
              <span className="lb-num">{row.openSubmissions}</span>
              <span className="lb-num">{row.pendingSubmissions || 0}</span>
              <span className="lb-num">{row.reviewSubmissions || 0}</span>
              <span className="lb-num">{row.invalidSubmissions || 0}</span>
              <strong className="lb-score">
                {formatNumber(row.gittensorScore ?? row.score)}
              </strong>
            </div>
          ))
        ) : (
          <Empty text="No ranked challengers yet." />
        )}
      </section>
    </div>
  );
}

function rankBadge(index) {
  return ["🥇", "🥈", "🥉"][index] || String(index + 1);
}

function Docs({ selectedLane, kataRepoSlug }) {
  const [activeTab, setActiveTab] = useState("overview");
  const links = sourceLinks(kataRepoSlug);
  const tabs = [
    { id: "overview", label: "Start", description: "What Kata is and how to compete." },
    { id: "miner", label: "Submit", description: "Build one valid agent PR." },
    { id: "validator", label: "Round", description: "What happens after pending." },
    { id: "scoring", label: "Scoring", description: "How your agent is ranked." },
    { id: "milestones", label: "Results", description: "What progress is visible." },
    { id: "privacy", label: "Rules", description: "What is allowed and blocked." }
  ];

  return (
    <div className="docs-layout">
      <aside className="docs-side">
        <div className="docs-tab-list" role="tablist" aria-label="Documentation sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="docs-tab-label">{tab.label}</span>
              <span className="docs-tab-desc">{tab.description}</span>
            </button>
          ))}
        </div>
      </aside>

      <article className="docs-content" aria-live="polite">
        {activeTab === "overview" ? (
          <DocOverview selectedLane={selectedLane} links={links} />
        ) : null}
        {activeTab === "miner" ? <DocMiner links={links} /> : null}
        {activeTab === "validator" ? (
          <DocValidator links={links} selectedLane={selectedLane} />
        ) : null}
        {activeTab === "scoring" ? <DocScoring selectedLane={selectedLane} /> : null}
        {activeTab === "milestones" ? <DocMilestones /> : null}
        {activeTab === "privacy" ? <DocPrivacy /> : null}
      </article>
    </div>
  );
}

function DocOverview({ selectedLane, links }) {
  return (
    <section>
      <p className="kicker">Start Here</p>
      <h1>Kata builds optimized miner agents through open competition</h1>
      <p>
        Kata is a public competition for building stronger miner agents. You submit one
        agent in a pull request. Kata screens it, runs it in the same environment as every
        other agent, and promotes the best challenger that strictly beats the current
        <strong> king</strong>. The goal is simple: make high-quality mining easier for
        everyone.
      </p>
      <DocCallout
        title="Built with Gittensor / Bittensor SN74"
        text="Kata is developed through Gittensor, the open-source-software subnet on Bittensor. Gittensor coordinates and rewards contributors who improve this repository. The competition target today is different: SN60 / Bitsec."
      />
      <DocGrid>
        <DocCard title="Current target" text="The live competition builds a vulnerability-audit miner agent for Bitsec / SN60." />
        <DocCard title="Current king" text="The best promoted agent is published under kings/. Your PR must strictly beat it to become the new king." />
        <DocCard title="Fair round" text={`All candidates face the same ${DOC_ROUND_PROJECT_COUNT} selected benchmark projects, same sandbox, same pinned model, and same scoring rules.`} />
        <DocCard title="Public proof" text="Round summaries, current king metadata, labels, and leaderboard results are published so contributors can inspect the outcome." />
      </DocGrid>
      <DocCallout
        title="SN74 and SN60 have different roles"
        text="SN74 / Gittensor powers development of Kata itself. Bitsec / SN60 is the first target Kata is optimizing a miner agent for. Future targets can use the same competition loop with their own benchmark and king."
      />
      <div className="doc-metrics">
        <KeyValue label="current target" value={selectedLane?.repoName || "Bitsec / SN60"} />
        <KeyValue label="agent type" value="miner" />
        <KeyValue label="round format" value={docsRoundFormat()} />
        <KeyValue label="promotion rule" value={selectedLane ? promotionGate(selectedLane) : "project pass score first"} />
      </div>
      <DocLinks
        links={[
          ["System workflow", links.systemWorkflow],
          ["Submission contract", links.submissions],
          ["Scoring spec", links.scoring]
        ]}
      />
    </section>
  );
}

function DocMiner({ links }) {
  return (
    <section>
      <p className="kicker">Submit</p>
      <h1>Submit one honest agent and beat the king</h1>
      <p>
        A competition PR is one agent bundle under <code>submissions/</code>. If it passes
        screening, it waits as <code>kata:pending</code> until the next round. In the round,
        it competes against the current king on the same 7 selected benchmark projects.
        Better real vulnerability detection wins; hardcoded answers and static report
        banks are blocked before scoring.
      </p>

      <h2>Contributor checklist</h2>
      <DocSteps
        items={[
          ["Create a branch", "Work in the public Kata repo. A miner PR should only touch one submission directory."],
          ["Add one bundle", "Create submissions/sn60__bitsec/miner/<github-user>-YYYYMMDD-NN/ with agent.py, agent_manifest.json, and submission.json."],
          ["Validate locally", "Run `uv run kata submission validate --path submissions/sn60__bitsec/miner/<submission-id>` before opening the PR."],
          ["Open one PR", "One open PR per contributor. The submission ID and author must match the GitHub account that opens the PR."],
          ["Pass screening", "Valid PRs become kata:pending. Hard failures close kata:invalid. Suspicious but non-conclusive PRs pause as kata:review."],
          ["Compete in a round", "Pending PRs are locked at the current commit, checked against the screened commit, smoke-tested on one real project, labeled kata:executing, and scored on the same sampled problems as the king."],
          ["Get an outcome", "Winner becomes king. Runner-up that beat the king stays pending. Candidate that did not beat the king closes kata:losing."]
        ]}
      />
      <h2>1. Bundle layout</h2>
      <p>
        A submission PR must be narrow: add or update exactly one directory under{" "}
        <code>submissions/</code>. Do not edit king files, benchmark files, workflows,
        engine code, or unrelated docs.
      </p>
      <CodeBlock value={`submissions/sn60__bitsec/miner/<github-user>-YYYYMMDD-01/\n  agent.py             # your entrypoint\n  agent_manifest.json  # runtime contract\n  submission.json      # who submitted the agent`} />
      <CodeBlock value={`{\n  "schema_version": 2,\n  "subnet_pack": "sn60__bitsec",\n  "mode": "miner",\n  "submission_id": "<github-user>-YYYYMMDD-01",\n  "created_at": "2026-07-01T00:00:00+00:00",\n  "author": "<github-user>",\n  "title": "short title",\n  "notes": "what changed in the agent"\n}`} />
      <DocCallout
        title="Identity must match your GitHub account"
        text="The <github-user> prefix in the directory name, submission_id, and submission.json author must match the GitHub account that opens the PR. If the PR author is jonathanchang31, then jonathan-20260707-01 is invalid. kata-bot closes mismatches as kata:invalid before adding kata:pending, so they never enter a round."
      />

      <h2>2. Your agent (agent.py)</h2>
      <p>
        Expose one synchronous function. Kata owns the sandbox, benchmark snapshot,
        replica count, timeouts, model relay, and scoring. You compete on the agent
        behavior: project reading, context selection, prompting, parsing, and robustness.
      </p>
      <CodeBlock value={`def agent_main(\n    project_dir: str | None = None,\n    inference_api: str | None = None,\n) -> dict:\n    return {\n        "vulnerabilities": [\n            # Bitsec-compatible findings for the target project\n        ]\n    }`} />
      <DocGrid>
        <DocCard title="project_dir" text="The target smart-contract project checkout mounted inside the sandbox container." />
        <DocCard title="inference_api" text="The sandbox inference endpoint. Call POST <inference_api>/inference with x-inference-api-key from INFERENCE_API_KEY." />
        <DocCard title="Sync only" text="agent_main must be synchronous and callable with no arguments; the runner does not await coroutines." />
        <DocCard title="Small bundle" text="Use agent.py plus optional Python helpers under helpers/. Limit: 16 files, 128 KiB per file, 256 KiB total." />
      </DocGrid>

      <h2>3. Talking to the model</h2>
      <DocListCard
        title="Model and inference budget"
        items={[
          "The relay forces qwen/qwen3.6-35b-a3b for every agent, including king and candidates.",
          "Agents compete on strategy, not private model access or a bigger budget.",
          "Per project: up to 3 successful model calls.",
          "Per project: up to 150,000 input tokens and 24,000 output tokens.",
          "Each call is capped at 32,000 output tokens.",
          "After a budget is spent, extra calls return HTTP 429.",
          "Failed or transient calls do not count against the successful-call budget.",
          "Fields like model, temperature, top_p, top_k, and seed are ignored or stripped.",
          "Read the final answer from choices[0].message.content."
        ]}
      />
      <CodeBlock value={`import json, os, urllib.request\n\ndef ask_model(inference_api, prompt):\n    endpoint = (inference_api or os.environ.get("INFERENCE_API") or "").rstrip("/")\n    body = json.dumps({\n        "messages": [{"role": "user", "content": prompt}],\n        "max_tokens": 4000,\n    }).encode()\n    req = urllib.request.Request(\n        endpoint + "/inference",\n        data=body, method="POST",\n        headers={\n            "Content-Type": "application/json",\n            "x-inference-api-key": os.environ["INFERENCE_API_KEY"],\n        },\n    )\n    with urllib.request.urlopen(req, timeout=120) as r:\n        data = json.loads(r.read().decode())\n    return data["choices"][0]["message"]["content"]`} />

      <h2>4. What closes a PR — and what does not</h2>
      <DocListCard
        title="How a PR can stop"
        items={[
          "Static screening fails: the PR closes early with a clear reason and no scoring cost.",
          "Round-start smoke test fails: the PR closes as kata:invalid before scoring.",
          "Main scoring runs but the agent does not beat the king: the PR closes as kata:losing.",
          "A bad, empty, slow, or unparsable project result during main scoring scores 0 for that project."
        ]}
      />
      <DocCallout
        title="Review is a hold, not a score"
        text="kata:review means screening found suspicious but non-conclusive evidence. The PR cannot enter a round yet. Push a clean update if the issue is obvious, or wait for project review. Hard failures such as identity mismatch, invalid PR shape, concrete benchmark replay, and exact king copy cannot be approved around."
      />
      <RequirementList
        title="Validation rules"
        items={[
          "agent.py is valid Python and defines a synchronous agent_main callable with no arguments.",
          "agent_main returns a dict with a top-level `vulnerabilities` list — not a stub that returns an empty list without any analysis.",
          "The candidate bundle stays within the size cap: max 16 files, max 128 KiB per file, and max 256 KiB total.",
          "agent_manifest.json uses schema_version 1, runtime python, entrypoint agent.py.",
          "submission.json uses schema_version 2, subnet_pack sn60__bitsec, mode miner, and a unique submission_id.",
          "The submission directory/id prefix and submission.json author match the PR author's GitHub username.",
          "The PR targets the default branch, touches exactly one submission directory, and changes at least one agent bundle file."
        ]}
      />
      <RequirementList
        title="Red lines (rejected at static screening)"
        items={[
          "No scoring secrets such as CHUTES_API_KEY or KATA_VALIDATOR_API_KEY.",
          "No hardcoded provider endpoints, API keys, or secret tokens (sk-..., ghp_..., cpk_...).",
          "Do not rely on model or sampling overrides. The relay pins the model and strips/ignores model, temperature, top_p, top_k, seed, and similar fields.",
          "No benchmark answers, dataset leakage tokens, or hardcoded benchmark replay (project IDs, finding IDs, known report titles, or prewritten project-specific findings).",
          "Python helpers are allowed only under helpers/. Symlinks and unsupported files are rejected.",
          "No exact or AST-equivalent copy of the current king bundle."
        ]}
      />
      <DocLinks links={[["Full submission contract", links.submissions], ["End-to-end workflow", links.systemWorkflow]]} />
    </section>
  );
}

function DocScoring() {
  const projectCount = DOC_ROUND_PROJECT_COUNT;
  const benchmarkText = projectCount
    ? `${projectCount} selected benchmark project${projectCount === 1 ? "" : "s"} from the pinned snapshot.`
    : `${DOC_ROUND_PROJECT_COUNT} selected benchmark projects from the pinned snapshot.`;
  const promotionOrder = [
    ["1", "Project pass score", "Passed projects divided by selected projects. This is the first ranking signal."],
    ["2", "Passed project count", "A direct count of projects where the agent met the pass rule."],
    ["3", "True positives", "Confirmed benchmark vulnerabilities found across the round."],
    ["4", "Fewer invalid runs", "Agents with fewer broken, timeout, or scorer-error runs rank higher."],
    ["5", "Precision", "True positives divided by all reported findings. Cleaner reports rank higher."],
    ["6", "F1", "Final tie-breaker balancing detection and precision."]
  ];
  return (
    <section>
      <p className="kicker">Scoring</p>
      <h1>Real findings decide the winner</h1>
      <p>
        Candidate and king run through the same {DOC_ROUND_PROJECT_COUNT} selected benchmark projects. Kata ranks
        agents by objective scorer metrics. Your agent must strictly outrank the king;
        tying the king is not enough.
      </p>

      <div className="doc-score-summary">
        <DocCard title="Benchmark" text={benchmarkText} />
        <DocCard title="Replica rule" text="Each project runs 3 times. A project passes when at least 2 of 3 replicas pass." />
        <DocCard title="Strict promotion" text="A candidate must rank above the current king. Same score is not enough." />
      </div>

      <h2>Promotion order</h2>
      <p>
        Kata compares candidates and the king in this order. Earlier rows matter first,
        so stable project performance beats noisy one-off luck.
      </p>
      <div className="doc-rank-order">
        {promotionOrder.map(([rank, title, text]) => (
          <div className="doc-rank-item" key={rank}>
            <span>{rank}</span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>

      <h2>Core scoring terms</h2>
      <DocGrid>
        <DocCard title="True positive" text="An expected benchmark vulnerability that the scorer matched to one of the agent's findings." />
        <DocCard title="Detection score" text="True positives divided by expected vulnerabilities across the selected projects." />
        <DocCard title="Precision" text="True positives divided by all reported findings. Noisy reports lower it." />
        <DocCard title="F1 score" text="A balance between detection score and precision." />
        <DocCard title="Invalid/error" text="A run or scorer result that did not complete successfully. It scores zero for that project." />
        <DocCard title="PASS project" text="A project passes when enough replicas find the required benchmark vulnerabilities." />
      </DocGrid>
      <h2>Result labels</h2>
      <p>After a round, your PR gets a clear label so you can understand what happened.</p>
      <DocGrid>
        <DocCard title="kata:pending" text="Screened and waiting for the next round, or kept open because it beat the king but was not the top winner." />
        <DocCard title="kata:winner" text="Won the round, merged, and promoted as the new king." />
        <DocCard title="kata:losing" text="Entered scoring but did not beat the king." />
        <DocCard title="kata:invalid" text="Failed a hard screening rule, failed the smoke test, or broke the one-open-PR rule." />
      </DocGrid>
      <h2>Screening</h2>
      <p>
        Static screening runs at PR intake/update and uses cheap source-only checks: no
        model calls and no scoring cost. It rejects invalid shape, secret leakage, no-op
        stubs, exact king copies, unsupported files, and concrete benchmark-answer replay.
        The round-start executable smoke test then runs the agent once on a real project
        and checks that it returns a valid vulnerabilities report. During main scoring, a
        bad, empty, slow, or unparsable project result simply scores 0 for that project.
      </p>
      <CodeBlock value={`project_pass_score = passed_projects / selected_projects\n\ndetection_score = total_true_positives / total_expected_vulnerabilities\n\npromote only if:\n  intake static screening passed\n  round-start executable smoke test passed\n  candidate strictly outranks king on:\n    project pass score\n    passed project count\n    true positives\n    fewer invalid/error evaluations\n    precision\n    f1 score`} />
      <h2>Reading the live board</h2>
      <p>
        The Arena view shows the current round — every candidate and the king — as it runs,
        plus a highlights feed of past rounds. A few terms map straight to the scoring above.
      </p>
      <DocGrid>
        <DocCard title="matched / reported" text="Per agent: matched = true positives the scorer confirmed; reported = every finding the agent submitted. reported is the denominator of precision — a big gap means noisy output." />
        <DocCard title="expected vulnerabilities" text="One number for the sampled problem set: how many real benchmark vulnerabilities exist to be found. It is the denominator of detection score, and it is the same target for both king and candidate." />
        <DocCard title="detection / precision / F1 bars" text="The three per-agent quality bars. Detection = matched / expected; precision = matched / reported; F1 balances the two." />
        <DocCard title="invalid" text="Projects where a run or the scorer did not complete successfully. Each invalid run scores 0 for that project and is a tie-breaker against the agent — but never closes the PR." />
      </DocGrid>
    </section>
  );
}

function DocListCard({ title, items }) {
  return (
    <div className="doc-list-card">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function DocValidator({ links }) {
  const projectCount = DOC_ROUND_PROJECT_COUNT;
  return (
    <section>
      <p className="kicker">Round</p>
      <h1>What happens after your PR becomes pending</h1>
      <p>
        Kata does not score every PR immediately. A valid PR waits for the next scheduled
        round. When the round starts, all pending candidates compete under the same rules,
        same 7 selected projects, same model, and same scoring budget.
      </p>

      <h2>Round checklist</h2>
      <DocSteps
        items={[
          ["Pending only", "Only PRs with kata:pending can enter scoring. PRs in kata:review or kata:invalid do not compete."],
          ["Commit locked", "The PR's latest commit must be the same commit that passed screening. If new commits were pushed and not screened, the PR is held out."],
          ["Smoke tested", "Before scoring, the agent runs once on a real project. It must run cleanly and return a valid vulnerabilities report shape. It does not need to find a bug in this smoke test."],
          ["Scored fairly", "Every candidate and the current king use the same 7 selected benchmark projects, same pinned model, same relay, and same inference budget."],
          ["3 replicas", "Each selected project runs 3 times. A project passes when at least 2 of 3 runs pass."],
          ["Winner promoted", "The top candidate that strictly beats the king is merged and becomes the new king. If nobody beats the king, the king stays."]
        ]}
      />

      <h2>Round constraints</h2>
      <p>
        These constraints are the same for every candidate, so the round measures agent
        strategy instead of private infrastructure.
      </p>
      <DocGrid>
        <DocCard title="Pinned model" text="qwen/qwen3.6-35b-a3b is forced by the relay for everyone." />
        <DocCard title="Model calls" text="Up to 3 successful model calls per problem." />
        <DocCard title="Token budget" text="Up to 150,000 input tokens and 24,000 output tokens per problem." />
        <DocCard title="No bypass" text="Agents must use the provided relay. Direct provider calls and private APIs are blocked." />
      </DocGrid>

      <h2>Selected projects</h2>
      <p>
        Each round uses a selected benchmark set. Every candidate sees the same set, and
        the result page shows the selected project names after the round.
      </p>
      <p>
        Each round samples{" "}
        <strong>
          {projectCount ? `${projectCount} project${projectCount === 1 ? "" : "s"}` : "a benchmark project set"}
        </strong>
        ; the exact set is not something contributors should hardcode against.
      </p>

      <h2>What you can see</h2>
      <p>The Arena page shows live progress during a round and final proof after it ends.</p>
      <DocGrid>
        <DocCard title="Live status" text="Which PRs are executing, screened out, complete, or waiting." />
        <DocCard title="Per-project detail" text="Replica pass counts, true positives, reported findings, and invalid/error runs." />
        <DocCard title="Final ranking" text="Who won, who beat the king, who lost, and why." />
        <DocCard title="Proof" text="Round timing, selected projects, aggregate metrics, and public result files." />
      </DocGrid>

      <DocLinks links={[["End-to-end workflow", links.systemWorkflow], ["Arena", "/arena"]]} />
    </section>
  );
}

function DocMilestones() {
  return (
    <section>
      <p className="kicker">Results</p>
      <h1>How Kata shows progress</h1>
      <p>
        Kata should not ask contributors to trust vague claims. The dashboard and public
        proof files show what happened in each round: who competed, which agent won, how
        many true positives were found, and whether the current king improved.
      </p>
      <MilestoneList
        items={[
          ["complete", "Current king", "The promoted best agent is visible on the winners page and in the public repository."],
          ["complete", "Round proof", "Completed rounds publish selected projects, candidate counts, true positives, precision, duration, and winner status."],
          ["complete", "Live arena", "During a round, contributors can watch execution status and per-project progress."],
          ["current", "Baseline comparison", "Kata can compare the winner against an external baseline under the same selected round conditions."],
          ["next", "Run the king", "Package the promoted agent so miners can fetch and run it directly."],
          ["next", "More targets", "Add more agent-based subnet targets using the same contributor workflow."],
          ["later", "One-click mining", "Pick a supported target and mine with its optimized king agent without needing ML expertise."]
        ]}
      />
      <DocCallout
        title="What contributors should look at"
        text="Use the Arena for round details, the Leaderboard for historical ranking, and the Winners page for the current king. If a claim is real, it should show up there with numbers."
      />
    </section>
  );
}

function DocPrivacy() {
  return (
    <section>
      <p className="kicker">Rules</p>
      <h1>What is allowed and what gets blocked</h1>
      <p>
        Build a real general agent. Kata welcomes better prompting, better project
        reading, smarter triage, better parsing, and stronger reporting. Kata blocks
        shortcut submissions that try to replay answers or bypass the shared environment.
      </p>
      <DocGrid>
        <DocCard title="Allowed" text="General code analysis, static heuristics, model-assisted auditing, project summarization, ranking risky files, and deduping findings." />
        <DocCard title="Blocked" text="Hardcoded benchmark answers, known project fingerprints, finding IDs, static report banks, and canned project-specific reports." />
        <DocCard title="Blocked" text="Private external APIs, direct provider calls, secret/key access, and attempts to choose a different model or budget." />
        <DocCard title="Required" text="Return a JSON-serializable dict with a top-level vulnerabilities list. If calls fail or budget runs out, return the best findings already collected." />
      </DocGrid>
      <DocCallout
        title="Simple rule"
        text="If the logic would still make sense on a brand-new unseen project, it is probably fine. If it depends on knowing the benchmark answer in advance, it is not."
      />
    </section>
  );
}

function MilestoneList({ items }) {
  return (
    <div className="milestone-list">
      {items.map(([status, title, text]) => (
        <div className={`milestone milestone-${status}`} key={title}>
          <span>{status}</span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocGrid({ children }) {
  return <div className="doc-grid">{children}</div>;
}

function DocCard({ title, text }) {
  return (
    <div className="doc-card">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function DocCallout({ title, text }) {
  return (
    <div className="doc-callout">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function DocSteps({ items }) {
  return (
    <div className="doc-steps">
      {items.map(([title, text], index) => (
        <div className="doc-step" key={title}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RequirementList({ title, items }) {
  return (
    <div className="doc-requirements">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function DocLinks({ links }) {
  return (
    <div className="doc-links">
      {links.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      ))}
    </div>
  );
}

function sourceLinks(kataRepoSlug) {
  const kataBase = kataRepoSlug
    ? `https://github.com/${kataRepoSlug}/blob/main`
    : "https://github.com/Autovara/kata/blob/main";
  const botBase = "https://github.com/Autovara/kata-bot/blob/main";
  // Point every link at a doc that actually exists in the kata repo today.
  return {
    kataReadme: `${kataBase}/README.md`,
    systemWorkflow: `${kataBase}/docs/workflow.md`,
    submissions: `${kataBase}/docs/submissions.md`,
    scoring: `${kataBase}/docs/submissions.md`,
    benchmarkEvaluation: `${kataBase}/docs/submissions.md`,
    githubAutomation: `${botBase}/README.md`,
    milestones: `${kataBase}/docs/milestones.md`,
    botDeployment: `${botBase}/README.md`,
    botChecklist: `${botBase}/README.md`,
    botConfig: `${botBase}/README.md`
  };
}

function PageIntro({ eyebrow, title, text }) {
  return (
    <section className="page-intro">
      <p className="kicker">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

function LaneSelector({ lanes, selectedLane, onSelect }) {
  if (!lanes.length) {
    return <Empty text="No active lanes." />;
  }
  return (
    <div className="lane-tabs">
      {lanes.map((lane) => (
        <button
          type="button"
          className={`lane-tab ${selectedLane?.id === lane.id ? "active" : ""}`}
          key={lane.id}
          onClick={() => onSelect(lane.id)}
        >
          <strong>{lane.repoName}</strong>
          <span>{lane.mode}</span>
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ title }) {
  return <h2 className="section-title">{title}</h2>;
}

function Avatar({ name, avatarName, avatarUrl: explicitAvatarUrl }) {
  const src = explicitAvatarUrl || avatarUrl(avatarName || name);
  if (src) {
    return <img className="avatar" src={src} alt={name ? `${name} avatar` : ""} />;
  }
  return <div className="avatar avatar-fallback">{initials(name || "?")}</div>;
}

function MinerIdentity({ name, sub, size = "compact" }) {
  return (
    <div className={`miner-identity miner-identity-${size}`}>
      <Avatar name={name} />
      <div>
        <strong>{name || "unknown"}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub = null }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function KeyValue({ label, value }) {
  const isLink = typeof value === "string" && value.startsWith("https://");
  return (
    <div className="key-value">
      <span>{label}</span>
      {isLink ? (
        <a href={value} target="_blank" rel="noreferrer">
          agent.py
        </a>
      ) : (
        <strong>{value ?? "-"}</strong>
      )}
    </div>
  );
}

function Status({ label, tone }) {
  return <span className={`status status-${tone}`}>{label}</span>;
}

function CodeBlock({ value }) {
  return <pre className="code-block">{value}</pre>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function statusUrl() {
  return STATUS_URL;
}

function streamUrl() {
  return STREAM_URL;
}

function readCurrentRoute() {
  return normalizeRoute(window.location.pathname);
}

function routeUrl(routePath) {
  return normalizeRoute(routePath);
}

function normalizeRoute(value) {
  const path = value || "/";
  const withoutQuery = path.split("?")[0].split("#")[0] || "/";
  const withLeading = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withLeading === "" ? "/" : withLeading;
}

function duelFormat(lane) {
  if (!lane) {
    return "not configured";
  }
  const count =
    lane.projects?.length || lane.evaluatorState?.current?.projectKeys?.length || 0;
  return `${count} selected benchmark project${count === 1 ? "" : "s"}`;
}

function docsRoundFormat() {
  return `${DOC_ROUND_PROJECT_COUNT} selected benchmark projects`;
}

function duelStatus(duel) {
  return duel.promotionReady ? "winner" : "completed";
}

function buildDashboardLatestStatus(activeEvaluation, latestChallenge) {
  if (activeEvaluation?.available && activeEvaluation.state !== "idle") {
    return {
      challenger:
        activeEvaluation.candidateGithubLogin ||
        activeEvaluation.candidateAuthor ||
        activeEvaluation.candidateSubmissionId ||
        "active challenger",
      status: activeEvaluationStatus(activeEvaluation),
      source: activeEvaluation.pullNumber ? `PR #${activeEvaluation.pullNumber}` : "validator queue",
      updatedAt: activeEvaluation.updatedAt || activeEvaluation.startedAt
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
      updatedAt: latestChallenge.createdAt
    };
  }
  return {
    challenger: "none yet",
    status: "no duel yet",
    source: "waiting",
    updatedAt: null
  };
}

function promotionGate(lane) {
  if (!lane) {
    return "not configured";
  }
  return "project pass score, passed projects, TP, invalid runs, precision, F1";
}

function kingAgentLink(lane, repoSlug) {
  const path = `kings/${lane.subnetPack || lane.repoPack}/${lane.mode}/agent.py`;
  if (!repoSlug) {
    return path;
  }
  return `https://github.com/${repoSlug}/blob/main/${path}`;
}

function proofFileLink(relativePath, repoSlug) {
  if (!relativePath) {
    return null;
  }
  if (String(relativePath).startsWith("https://")) {
    return relativePath;
  }
  if (!repoSlug) {
    return relativePath;
  }
  return `https://github.com/${repoSlug}/blob/main/${relativePath}`;
}

function humanizeOutcome(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyMode(value) {
  if (value === "candidate_only") {
    return "Candidate-only recovery";
  }
  if (value === "king_duel") {
    return "King duel";
  }
  return humanizeOutcome(value || "Completed round");
}

function friendlyBenchmarkName(value) {
  if (!value) {
    return "Benchmark";
  }
  if (String(value).includes("curated-highs-only")) {
    return "Curated highs benchmark";
  }
  return String(value)
    .replace(/\.json$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function percentValue(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value) * 100));
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) {
    return "-";
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  if (hours) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function avatarUrl(name) {
  if (!name || /\s/.test(name) || name === "waiting" || name === "Kata Seed") {
    return null;
  }
  return `https://github.com/${name}.png?size=160`;
}

function initials(value) {
  return String(value || "?")
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function activeEvaluationStatus(activeEvaluation) {
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

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}
