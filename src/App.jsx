import { useEffect, useMemo, useState } from "react";
import { inferSubmissionAuthorFromId } from "../shared/submissionAuthor.mjs";

const STATUS_URL = import.meta.env.VITE_STATUS_URL || "/api/status";
const POLL_INTERVAL_MS = 5000;
const PAGES = [
  { path: "/", label: "Dashboard" },
  { path: "/arena", label: "Arena" },
  { path: "/winners", label: "Winners" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/docs", label: "Docs" }
];

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

    async function fetchStatus() {
      try {
        const response = await fetch(statusUrl());
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || "failed to load board status");
        }
        if (!cancelled) {
          setState({ loading: false, error: null, payload });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            loading: false,
            error: error instanceof Error ? error.message : "unknown error",
            payload: current.payload
          }));
        }
      }
    }

    fetchStatus();
    const intervalId = window.setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
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
            onNavigate={navigate}
          />
        ) : null}
        {payload && (pathname === "/arena" || pathname === "/live") ? (
          <Arena
            lanes={lanes}
            selectedLane={selectedLane}
            laneActivity={laneActivity}
            validator={payload.validator}
            setSelectedLaneId={setSelectedLaneId}
          />
        ) : null}
        {payload && (pathname === "/winners" || pathname === "/champions") ? (
          <Winners lanes={lanes} kataRepoSlug={payload.publicLinks?.kataRepo} />
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

function Dashboard({ payload, selectedLane, validator, onNavigate }) {
  const overview = payload.overview || {};
  const activeEvaluation = validator?.activeEvaluation || null;
  const recentActivity = payload.activity || [];
  const latestChallenge = recentActivity[0] || null;
  const topMiner = payload.leaderboard?.rows?.[0] || null;
  const totalKings = payload.leaderboard?.rows?.reduce(
    (total, row) => total + Number(row.wins || 0),
    0
  );

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Subnet 74 / Gittensor</p>
          <h1>Kata is the agent arena for Gittensor Subnet 74.</h1>
          <p>
            Miners submit coding agents by pull request. The validator runs
            live SN60 sandbox duels against a pinned benchmark. Only a verified
            winner is merged and promoted.
          </p>
          <div className="actions">
            <button type="button" className="button primary" onClick={() => onNavigate("/arena")}>
              Watch Arena
            </button>
            <button type="button" className="button" onClick={() => onNavigate("/docs")}>
              Miner Guide
            </button>
          </div>
        </div>
        <div className="hero-terminal" aria-label="Live lane summary">
          <div className="terminal-top">
            <span />
            <span />
            <span />
          </div>
          <TerminalLine label="subnet" value="SN74 Gittensor" />
          <TerminalLine label="profile" value="repo-specific coding agents" />
          <TerminalLine label="repos" value={`${overview.activeRepoPacks || 0} active packs`} />
          <TerminalLine label="kings" value={`${totalKings || 0} verified promotions`} />
          <TerminalLine label="duel" value={selectedLane ? duelFormat(selectedLane) : "not configured"} />
          <TerminalLine label="live lane" value={selectedLane?.repoName || "waiting"} />
        </div>
      </section>

      <section className="stat-row">
        <Stat label="repo packs" value={overview.activeRepoPacks} />
        <Stat label="active lanes" value={overview.activeLanes} />
        <Stat label="benchmark projects" value={overview.benchmarkProjects ?? 0} />
        <Stat label="recent duels" value={overview.recentChallenges ?? 0} />
      </section>

      <section className="split">
        <div className="section-block">
          <SectionTitle title="Competition profile" />
          <KeyValue label="system" value="GitTensor-aligned agent arena" />
          <KeyValue label="submission" value="PR-only agent bundle" />
          <KeyValue label="reward idea" value="current king per repo lane" />
          <KeyValue label="evaluation" value="SN60 Bitsec sandbox" />
          <KeyValue label="current state" value={activeEvaluationStatus(activeEvaluation)} />
        </div>
        <div className="section-block">
          <SectionTitle title="Current lane" />
          <KeyValue label="repo" value={selectedLane?.repoName || "not configured"} />
          <KeyValue label="mode" value={selectedLane?.mode || "-"} />
          <KeyValue label="king" value={selectedLane?.currentHolder || "-"} />
          <KeyValue label="tasks" value={selectedLane ? duelFormat(selectedLane) : "-"} />
          <KeyValue label="gate" value={selectedLane ? promotionGate(selectedLane) : "-"} />
        </div>
      </section>

      <section className="split">
        <div className="section-block">
          <SectionTitle title="How it works" />
          <div className="process-list">
            <ProcessItem step="01" title="Submit" text="Miner opens one agent PR under submissions/." />
            <ProcessItem step="02" title="Duel" text="Candidate runs against the current king." />
            <ProcessItem step="03" title="Promote" text="Winner moves to kings/ and submissions/ is cleaned." />
          </div>
        </div>
        <div className="section-block">
          <SectionTitle title="Network summary" />
          <KeyValue label="top miner" value={topMiner?.author || "not ranked yet"} />
          <KeyValue label="leaderboard miners" value={overview.leaderboardEntries ?? 0} />
          <KeyValue label="latest challenger" value={latestChallenge?.candidateAuthor || latestChallenge?.candidateSubmissionId || "none"} />
          <KeyValue label="latest result" value={latestChallenge ? duelStatus(latestChallenge) : "no duel yet"} />
          <KeyValue label="updated" value={formatDateTime(payload.generatedAt)} />
        </div>
      </section>
    </div>
  );
}

function Arena({ lanes, selectedLane, laneActivity, validator, setSelectedLaneId }) {
  const latest = laneActivity[0] || null;
  const activeEvaluation = laneActiveEvaluation(validator?.activeEvaluation, selectedLane);
  const candidateName =
    activeEvaluation?.candidateGithubLogin ||
    activeEvaluation?.candidateAuthor ||
    activeEvaluation?.candidateSubmissionId ||
    latest?.candidateAuthor ||
    latest?.candidateSubmissionId ||
    "waiting";
  const arenaPhase = activeEvaluation
    ? activeEvaluationStatus(activeEvaluation)
    : latest
      ? latest.promotionReady
        ? "winner"
        : "completed"
      : "idle";
  const arenaTone = activeEvaluation
    ? activeEvaluationTone(activeEvaluation)
    : latest?.promotionReady
      ? "ok"
      : "neutral";
  const pullLabel = activeEvaluation?.pullNumber ? `#${activeEvaluation.pullNumber}` : "-";
  const updatedLabel = formatDateTime(activeEvaluation?.updatedAt || latest?.createdAt);

  return (
    <div className="stack">
      <PageIntro
        eyebrow="Live Arena"
        title="King versus Candidate"
        text="Current duel state and SN60 sandbox scoring for the selected lane."
      />

      <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />

      <section className="arena-meta-grid">
        <ArenaMetaCard
          label="phase"
          value={arenaPhase}
          sub={activeEvaluation?.phase || "validator state"}
          tone={arenaTone}
        />
        <ArenaMetaCard
          label="candidate"
          value={candidateName}
          sub={activeEvaluation?.candidateSubmissionId || latest?.candidateSubmissionId || "waiting for challenger"}
        />
        <ArenaMetaCard
          label="pull request"
          value={pullLabel}
          sub={activeEvaluation?.candidateGithubLogin ? `GitHub @${activeEvaluation.candidateGithubLogin}` : "no active PR"}
        />
        <ArenaMetaCard
          label="updated"
          value={updatedLabel}
          sub={latest?.runId ? shortRunId(latest.runId) : "live validator feed"}
        />
      </section>

      {selectedLane?.evaluatorState?.current ? (
        <Sn60LanePanel state={selectedLane.evaluatorState.current} />
      ) : (
        <Empty text="No SN60 duel state yet for this lane." />
      )}
    </div>
  );
}

function Sn60LanePanel({ state }) {
  const candidateScore = percentScore(state.scores?.candidate);
  const kingScore = percentScore(state.scores?.king);
  return (
    <section className="sn60-panel">
      <div className="sn60-panel-head">
        <div>
          <p className="kicker">SN60 Bitsec lane</p>
          <h2>{state.candidateSubmissionId || "waiting for challenger"}</h2>
        </div>
        <Status label={state.screeningStatus || "no screening"} tone={screeningTone(state.screeningStatus)} />
      </div>

      <div className="sn60-grid">
        <Sn60Metric label="candidate miner" value={state.candidateAuthor || state.candidateSubmissionId || "-"} sub={state.candidateSubmissionId || "no active candidate"} />
        <Sn60Metric label="king miner" value={state.kingAuthor || state.kingSubmissionId || "-"} sub={state.kingSubmissionId || "seed king"} />
        <Sn60Metric label="candidate score" value={candidateScore} sub={`king ${kingScore}`} />
        <Sn60Metric label="final winner" value={state.finalWinner || "-"} sub={state.rewardLabelApplied || "reward label pending"} />
        <Sn60Metric label="codebases passed" value={sn60Pair(state.codebasesPassed)} sub={`${state.projectKeys?.length || 0} selected projects`} />
        <Sn60Metric label="true positives" value={sn60Pair(state.truePositives)} sub="candidate vs king" />
        <Sn60Metric label="invalid runs" value={sn60Pair(state.invalidRuns)} sub="candidate vs king" />
        <Sn60Metric label="replica spread" value={formatNumber(state.stability?.candidate?.spread)} sub={`king ${formatNumber(state.stability?.king?.spread)}`} />
      </div>

      <div className="sn60-detail-grid">
        <div className="sn60-detail-block">
          <span>local validator replica scores</span>
          <ReplicaStrip label="candidate" values={state.localReplicaScores?.candidate} />
          <ReplicaStrip label="king" values={state.localReplicaScores?.king} />
        </div>
        <div className="sn60-detail-block">
          <span>benchmark snapshot provenance</span>
          <KeyValue label="freshness" value={shortHash(state.provenance?.freshnessFingerprint)} />
          <KeyValue label="sandbox" value={shortHash(state.provenance?.sandboxCommit)} />
          <KeyValue label="benchmark" value={shortHash(state.provenance?.benchmarkSha256)} />
          <KeyValue label="scorer" value={state.provenance?.scorerVersion || "-"} />
        </div>
      </div>

      {state.screeningReasons?.length ? (
        <div className="sn60-screening-notes">
          {state.screeningReasons.slice(0, 3).map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Sn60Metric({ label, value, sub }) {
  return (
    <div className="sn60-metric">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
      <small>{sub}</small>
    </div>
  );
}

function ReplicaStrip({ label, values }) {
  const normalized = Array.isArray(values) ? values : [];
  return (
    <div className="replica-strip">
      <span>{label}</span>
      <div>
        {normalized.length ? (
          normalized.map((value, index) => (
            <i key={`${label}-${index}`} style={{ "--replica-score": `${clampPercent(Number(value) * 100)}%` }}>
              {formatNumber(Number(value) * 100)}
            </i>
          ))
        ) : (
          <em>no replica scores</em>
        )}
      </div>
    </div>
  );
}

function Winners({ lanes, kataRepoSlug }) {
  return (
    <div className="stack">
      <PageIntro
        eyebrow="Winners"
        title="Kings by repository."
        text="As more repos are added, each lane keeps its own current king."
      />

      <section className="winner-grid">
        {lanes.length ? (
          lanes.map((lane) => (
            <article className="winner-card" key={lane.id}>
              <div className="winner-head">
                <span>{lane.mode}</span>
                <Status label={lane.king?.seeded ? "seed" : "promoted"} tone={lane.king?.seeded ? "neutral" : "ok"} />
              </div>
              <MinerIdentity
                name={lane.currentHolder}
                sub={lane.king?.submissionId || "current king"}
                size="large"
              />
              <h2>{lane.repoName}</h2>
              <p>{lane.repoPack}</p>
              <KeyValue label="miner" value={lane.currentHolder} />
              <KeyValue
                label="agent"
                value={kingAgentLink(lane, kataRepoSlug)}
              />
              <KeyValue label="duel gate" value={promotionGate(lane)} />
              <KeyValue label="updated" value={formatDateTime(lane.king?.updatedAt)} />
            </article>
          ))
        ) : (
          <Empty text="No winners yet." />
        )}
      </section>
    </div>
  );
}

function Leaderboard({ leaderboard }) {
  const rows = leaderboard?.rows || [];

  return (
    <div className="stack">
      <PageIntro
        eyebrow="Leaderboard"
        title="Miner ranking."
        text={`Source: ${leaderboardSource(leaderboard?.source)}. Kings are verified merged wins; submissions is total candidate PRs seen.`}
      />

      <section className="table-section">
        <div className="table-head">
          <span>rank</span>
          <span>miner</span>
          <span>kings</span>
          <span>submissions</span>
          <span>open</span>
          <span>score</span>
        </div>
        {rows.length ? (
          rows.slice(0, 20).map((row, index) => (
            <div className="table-row" key={row.author}>
              <span>{index + 1}</span>
              <MinerIdentity name={row.author} sub={row.currentKings ? `${row.currentKings} active lane${row.currentKings === 1 ? "" : "s"}` : "miner"} />
              <span>{row.wins}</span>
              <span>{row.totalSubmissions}</span>
              <span>{row.openSubmissions}</span>
              <strong>{row.score}</strong>
            </div>
          ))
        ) : (
          <Empty text="Connect GitHub PR history or event log to populate rankings." />
        )}
      </section>
    </div>
  );
}

function Docs({ selectedLane, kataRepoSlug }) {
  const [activeTab, setActiveTab] = useState("overview");
  const links = sourceLinks(kataRepoSlug);
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "workflow", label: "Workflow" },
    { id: "submit", label: "Submit" },
    { id: "agent", label: "Agent" },
    { id: "scoring", label: "Scoring" },
    { id: "bot", label: "Bot" },
    { id: "milestones", label: "Milestones" },
    { id: "privacy", label: "Privacy" }
  ];

  return (
    <div className="docs-layout">
      <aside className="docs-side">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </aside>

      <article className="docs-content">
        {activeTab === "overview" ? (
          <DocOverview selectedLane={selectedLane} links={links} />
        ) : null}
        {activeTab === "workflow" ? <DocWorkflow links={links} /> : null}
        {activeTab === "submit" ? <DocSubmit links={links} /> : null}
        {activeTab === "agent" ? <DocAgent links={links} /> : null}
        {activeTab === "scoring" ? <DocScoring selectedLane={selectedLane} /> : null}
        {activeTab === "bot" ? <DocBot /> : null}
        {activeTab === "milestones" ? <DocMilestones /> : null}
        {activeTab === "privacy" ? <DocPrivacy /> : null}
      </article>
    </div>
  );
}

function DocOverview({ selectedLane, links }) {
  return (
    <section>
      <p className="kicker">Newcomer Guide</p>
      <h1>How Kata competition works</h1>
      <p>
        Kata is a GitTensor-aligned security-agent competition system. Miners do
        not submit ordinary code fixes. They submit vulnerability-hunting agents
        that duel the current king in the same pinned Bitsec sandbox, on the
        same benchmark codebases, under the same validator checks.
      </p>
      <DocCallout
        title="If you are new, start here"
        text="Think of Kata as a live tournament for security-agent strategies. Your PR contains the agent. The validator runs it against benchmark smart-contract projects. If it finds vulnerabilities better than the current king, your agent becomes the new king."
      />
      <DocCallout
        title="Mental model"
        text="Each subnet pack has one current king. A candidate PR wins only if its agent beats that king in the SN60 sandbox duel on aggregated score, codebases passed, and true positives."
      />
      <DocGrid>
        <DocCard title="Kata" text="Public miner-facing repo. Holds submissions, current kings, evaluator commands, and promotion logic." />
        <DocCard title="Pack registry" text="Central registry of subnet packs. Each pack pins its own benchmark snapshot, scoring rules, and current king." />
        <DocCard title="Bitsec sandbox" text="Pinned SN60 evaluation mirror. Agents run in Docker against the pinned benchmark snapshot." />
        <DocCard title="kata-bot" text="GitHub automation. Queues PRs, evaluates candidates, comments, closes, merges, and promotes winners." />
      </DocGrid>
      <div className="doc-metrics">
        <KeyValue label="current lane" value={selectedLane?.repoName || "not configured"} />
        <KeyValue label="repo-pack" value={selectedLane?.repoPack || "-"} />
        <KeyValue label="mode" value={selectedLane?.mode || "-"} />
        <KeyValue label="duel format" value={selectedLane ? duelFormat(selectedLane) : "SN60 sandbox replicas"} />
        <KeyValue label="promotion gate" value={selectedLane ? promotionGate(selectedLane) : "score, passes, true positives"} />
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

function DocWorkflow({ links }) {
  return (
    <section>
      <p className="kicker">End-to-end Flow</p>
      <h1>From PR to king</h1>
      <p>
        Kata is PR-only. The validator does not create issues for miners. It
        only accepts candidate agent PRs, evaluates them, and promotes verified
        winners.
      </p>
      <DocGrid>
        <DocCard title="Input" text="One PR with one agent bundle under submissions/." />
        <DocCard title="Evaluator" text="Kata runs candidate and king through the same pinned Bitsec sandbox snapshot with repeated replica runs." />
        <DocCard title="Decision" text="kata-bot turns the result into close-invalid, close-losing, rerun-stale, hold, or merge." />
        <DocCard title="Output" text="A verified winner is merged, copied into kings/, and recorded as the new lane king." />
      </DocGrid>
      <DocSteps
        items={[
          ["Register the pack", "Maintainers register the subnet pack in the central registry and pin its benchmark snapshot."],
          ["Seed the lane", "The first king agent is seeded under kings/<pack>/<mode>/."],
          ["Open PR", "A miner opens one PR that touches exactly one submission directory."],
          ["Queue job", "kata-bot receives the GitHub webhook and writes a durable queue job."],
          ["Validate shape", "The bot checks changed paths before trusting PR contents."],
          ["Validate bundle", "Kata validates agent.py, agent_manifest.json, and submission.json against the SN60 contract."],
          ["Screening", "One screener sandbox run must finish cleanly before the full duel."],
          ["Sandbox duel", "Candidate and king run repeated replicas per benchmark codebase in the Bitsec sandbox."],
          ["Verify freshness", "Kata rejects stale wins if the king or the pinned benchmark snapshot changed."],
          ["Apply action", "Invalid and losing PRs close. Verified winners get labels, merge, and promote."]
        ]}
      />
      <DocCallout
        title="Why stale results matter"
        text="A candidate only beats the current king if it was evaluated against the current king and current task-pool fingerprints. If either changed during evaluation, the PR must rerun."
      />
      <DocLinks links={[["Full workflow doc", links.systemWorkflow], ["GitHub automation", links.githubAutomation]]} />
    </section>
  );
}

function DocSubmit({ links }) {
  return (
    <section>
      <p className="kicker">Miner Submission</p>
      <h1>Submit one candidate agent</h1>
      <p>
        A submission PR must be narrow. It should add or update exactly one
        directory under `submissions/`. Do not edit lane state, current
        king files, validator code, workflows, or unrelated docs.
      </p>
      <h2>// quick start</h2>
      <CodeBlock value={`mkdir -p submissions/sn60__bitsec/miner/<github-user>-YYYYMMDD-01\ncd submissions/sn60__bitsec/miner/<github-user>-YYYYMMDD-01\n\n# add these files (SN60 miner bundle is self-contained)\nagent.py\nagent_manifest.json\nsubmission.json`} />
      <CodeBlock value={`submissions/<repo-pack>/<mode>/<submission-id>/\n  agent.py\n  agent_manifest.json\n  submission.json`} />
      <h2>Required metadata</h2>
      <CodeBlock value={`{\n  "schema_version": 2,\n  "repo_pack": "sn60__bitsec",\n  "mode": "miner",\n  "submission_id": "<github-user>-YYYYMMDD-01",\n  "created_at": "2026-07-01T00:00:00+00:00",\n  "author": "<github-user>",\n  "title": "short title",\n  "notes": "what changed in the agent"\n}`} />
      <RequirementList
        title="Validation rules"
        items={[
          "The PR targets the default competition branch.",
          "The PR touches exactly one submission directory.",
          "The lane is registered and active in the central pack registry.",
          "The bundle contains valid Python and a valid agent manifest.",
          "The candidate is not an exact copy of the current king.",
          "The bundle contains no symlinks, hardcoded secrets, or direct validator secret env reads."
        ]}
      />
      <DocGrid>
        <DocCard title="Good PR" text="Small, single submission directory, clear metadata, valid Python, and a self-contained agent_main that finds real vulnerabilities." />
        <DocCard title="Bad PR" text="Touches kings/, lane state, workflow files, multiple submissions, or copies the current king exactly." />
      </DocGrid>
      <DocLinks links={[["Detailed submission docs", links.submissions]]} />
    </section>
  );
}

function DocAgent({ links }) {
  return (
    <section>
      <p className="kicker">Agent Contract</p>
      <h1>What your agent receives</h1>
      <p>
        Your `agent.py` must expose one synchronous function. The validator owns
        the sandbox, the pinned benchmark snapshot, replica counts, timeouts,
        and scoring. Miners compete on vulnerability-hunting behavior,
        prompting, context selection, and robustness.
      </p>
      <CodeBlock value={`def agent_main(\n    project_dir: str | None = None,\n    inference_api: str | None = None,\n) -> dict:\n    return {\n        "vulnerabilities": [\n            # Bitsec-compatible findings for the target project\n        ]\n    }`} />
      <h2>// recommended agent loop</h2>
      <DocSteps
        items={[
          ["Read the project", "Walk the smart-contract project mounted in the sandbox and pick the high-risk contracts."],
          ["Ask the model", "Use the sandbox inference API with the injected INFERENCE_API_KEY. Do not hardcode your own provider."],
          ["Hunt critical/high issues", "Focus on critical and high severity vulnerabilities; noisy findings hurt your detection rate."],
          ["Normalize the report", "Return a JSON dict with a top-level `vulnerabilities` list in the Bitsec report schema."],
          ["Self-check", "Make sure agent_main() works with no arguments and returns JSON-serializable data before opening the PR."]
        ]}
      />
      <DocGrid>
        <DocCard title="project_dir" text="The target smart-contract project checkout inside the sandbox container." />
        <DocCard title="inference_api" text="The sandbox inference endpoint. Authenticate with the INFERENCE_API_KEY env var injected for your run." />
        <DocCard title="Sync only" text="agent_main must be a synchronous function callable with no arguments; the sandbox runner does not await coroutines." />
        <DocCard title="Self-contained" text="V1 miner bundles must stay self-contained in agent.py. Helper modules are rejected." />
      </DocGrid>
      <RequirementList
        title="Runtime boundaries and red lines"
        items={[
          "Do not reference validator scoring secrets such as CHUTES_API_KEY or KATA_VALIDATOR_API_KEY.",
          "Do not hardcode provider endpoints or secret tokens.",
          "Do not set model sampling parameters (temperature, top_p, seed, ...).",
          "Do not embed benchmark-answer maps or dataset leakage tokens.",
          "Return a top-level `vulnerabilities` list, not prose-only output.",
          "Do not copy the current king bundle; exact copies are rejected."
        ]}
      />
      <DocLinks links={[["Submission contract", links.submissions], ["Benchmark contract", links.benchmarkEvaluation]]} />
    </section>
  );
}

function DocScoring({ selectedLane }) {
  const projectCount =
    selectedLane?.projects?.length ||
    selectedLane?.evaluatorState?.current?.projectKeys?.length ||
    0;
  return (
    <section>
      <p className="kicker">Scoring</p>
      <h1>How a candidate wins</h1>
      <p>
        Candidate and king run through the same pinned Bitsec sandbox snapshot
        with repeated replicas per benchmark codebase. A codebase passes only if
        at least 2 of 3 runs pass; the aggregated score is passed codebases
        divided by total codebases.
      </p>
      <DocGrid>
        <DocCard title="Benchmark" text={`${projectCount} SN60 project${projectCount === 1 ? "" : "s"} from the pinned snapshot.`} />
        <DocCard title="Codebase pass" text="A codebase passes when at least 2 of 3 replica runs pass." />
        <DocCard title="Aggregated score" text="Passed codebases divided by total codebases in the round." />
        <DocCard title="Promotion order" text="Aggregated score, then codebases passed, then true positives." />
      </DocGrid>
      <h2>Screening</h2>
      <p>
        Every candidate is screened before the duel: static checks plus one
        sandbox execution that must finish cleanly. Candidates with invalid
        replica runs are never promoted.
      </p>
      <CodeBlock value={`aggregated_score = passed_codebases / total_codebases\n\npromote only if:\n  screening passed\n  no invalid replica runs\n  candidate outranks king on (score, passes, true positives)`} />
    </section>
  );
}

function DocBot() {
  return (
    <section>
      <p className="kicker">Automation</p>
      <h1>What kata-bot does</h1>
      <p>
        kata-bot is intentionally thin. It does not own scoring. It receives PR
        events, queues jobs, calls Kata commands, and applies the GitHub outcome.
      </p>
      <DocSteps
        items={[
          ["Enqueue", "Webhook events become durable queue jobs keyed by repo, PR number, and head SHA."],
          ["Drain", "The resident validator continuously processes pending jobs."],
          ["Inspect", "Changed paths are checked before untrusted PR content is evaluated."],
          ["Evaluate", "Kata runs candidate and king through the pinned Bitsec sandbox with repeated replicas."],
          ["Comment", "The bot posts a clear PR result with score deltas and reason."],
          ["Close", "Invalid and losing PRs are labeled and closed."],
          ["Rerun", "Stale results are rerun when the king or the pinned benchmark snapshot changed."],
          ["Merge", "Only verified winners are labeled, merged, promoted, and cleaned from submissions/."]
        ]}
      />
      <DocGrid>
        <DocCard title="kata:invalid" text="Submission shape or bundle contract failed." />
        <DocCard title="kata:losing" text="Candidate did not beat the current king under the promotion rules." />
        <DocCard title="kata:stale" text="Result is not current and must rerun." />
        <DocCard title="kata:hold" text="Winner is verified but merge or promotion is held for operator attention." />
      </DocGrid>
      <DocCallout
        title="Important operator rule"
        text="kata-bot should stay thin. If a rule changes, it should change in Kata first, then the bot should call the new Kata command or read the new Kata result."
      />
    </section>
  );
}

function DocMilestones() {
  return (
    <section>
      <p className="kicker">Roadmap</p>
      <h1>Milestones</h1>
      <p>
        Kata is being built in layers: first objective repo-specific duels,
        then robust automation, benchmark hardening, and multi-repo expansion.
      </p>
      <MilestoneList
        items={[
          ["complete", "SN60 lane live", "The sn60__bitsec/miner lane has a pinned benchmark snapshot and a seeded king."],
          ["complete", "Pinned benchmark scoring", "Duels score against the pinned Bitsec benchmark snapshot with deterministic replica rules."],
          ["complete", "PR-only submission contract", "Miners submit exactly one agent bundle under submissions/; issues are not used."],
          ["complete", "Live dashboard deployment", "kata-board runs as a Node service behind ngrok and reads the live validator API."],
          ["current", "Resident validator hardening", "Keep improving queue visibility, PR comments, stale reruns, labels, merge safety, and operational logs."],
          ["next", "Multi-pack lanes", "Add more registered subnet packs so each repo-pack can have its own king and benchmark snapshot."],
          ["next", "Snapshot refresh", "Resync the pinned Bitsec sandbox snapshot as the subnet benchmark evolves."],
          ["later", "Advanced analytics", "Track per-codebase pass rates, agent regressions, win history, cost, and benchmark coverage over time."]
        ]}
      />
      <DocCallout
        title="Current priority"
        text="The most important next step is operational reliability: every winning PR should merge, promote, and publish its king deterministically, with stale results detected and rerun automatically."
      />
    </section>
  );
}

function DocPrivacy() {
  return (
    <section>
      <p className="kicker">Visibility</p>
      <h1>What is public and private</h1>
      <p>
        Kata must be auditable while keeping the validator scoring key and any
        hidden benchmark material private. The dashboard shows enough state for
        miners to understand the competition without exposing secrets.
      </p>
      <DocGrid>
        <DocCard title="Lane state" text="Central pack registry, per-lane king, benchmark snapshot, challenge state, and promotion record." />
        <DocCard title="Validator" text="Pinned Bitsec sandbox mirror, scorer, and the validator scoring key — kept separate from miner execution keys." />
        <DocCard title="Dashboard" text="Shows duel metrics, provenance hashes, and fingerprints, not scoring keys or raw benchmark answers." />
        <DocCard title="Benchmark answers" text="Expected findings live validator-side in the pinned snapshot; agents that embed answer maps are rejected at screening." />
      </DocGrid>
      <DocCallout
        title="Important"
        text="Agents receive the project contents and an inference endpoint only. Scoring runs validator-side against the pinned benchmark with the validator-owned key."
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
  return {
    kataReadme: `${kataBase}/README.md`,
    systemWorkflow: `${kataBase}/docs/system-workflow.md`,
    submissions: `${kataBase}/docs/submissions.md`,
    scoring: `${kataBase}/docs/SCORING.md`,
    benchmarkEvaluation: `${kataBase}/docs/benchmark-evaluation.md`,
    githubAutomation: `${kataBase}/docs/github-automation.md`,
    botDeployment: `${botBase}/docs/deployment.md`,
    botChecklist: `${botBase}/docs/production-checklist.md`,
    botConfig: `${botBase}/docs/config-reference.md`
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

function ProcessItem({ step, title, text }) {
  return (
    <div className="process-item">
      <span>{step}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function ArenaMetaCard({ label, value, sub, tone = "neutral" }) {
  return (
    <article className={`arena-meta-card arena-meta-card-${tone}`}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
      <small>{sub}</small>
    </article>
  );
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

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
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

function TerminalLine({ label, value }) {
  return (
    <div className="terminal-line">
      <span>{label}</span>
      <strong>{value}</strong>
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
  return `${count} SN60 project${count === 1 ? "" : "s"}`;
}

function laneActiveEvaluation(activeEvaluation, lane) {
  if (!activeEvaluation || !lane) {
    return null;
  }
  if (
    activeEvaluation.repoPack &&
    activeEvaluation.mode &&
    activeEvaluation.repoPack === lane.repoPack &&
    activeEvaluation.mode === lane.mode
  ) {
    return activeEvaluation;
  }
  return null;
}

function duelStatus(duel) {
  return duel.promotionReady ? "winner" : "completed";
}

function promotionGate(lane) {
  if (!lane) {
    return "not configured";
  }
  return "screening pass, no invalid runs, candidate outranks king";
}

function kingAgentLink(lane, repoSlug) {
  const path = `kings/${lane.repoPack}/${lane.mode}/agent.py`;
  if (!repoSlug) {
    return path;
  }
  return `https://github.com/${repoSlug}/blob/main/${path}`;
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

function leaderboardSource(source) {
  if (source === "github") {
    return "GitHub PR history";
  }
  if (source === "events") {
    return "event log";
  }
  if (source === "github-not-configured") {
    return "not configured";
  }
  return source || "unknown";
}

function shortHash(value) {
  if (!value) {
    return "-";
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function shortRunId(value) {
  if (!value) {
    return "unknown";
  }
  return value.replace(/^challenge-/, "").slice(0, 28);
}

function percentScore(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${formatNumber(Number(value) * 100)} pts`;
}

function sn60Pair(value) {
  const candidate = value?.candidate ?? "-";
  const king = value?.king ?? "-";
  return `${candidate} / ${king}`;
}

function screeningTone(status) {
  if (status === "passed" || status === "pass" || status === true) {
    return "ok";
  }
  if (status === "failed" || status === "fail" || status === false) {
    return "bad";
  }
  return "neutral";
}

function activeEvaluationStatus(activeEvaluation) {
  if (!activeEvaluation || activeEvaluation.state === "idle") {
    return "idle";
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

function activeEvaluationTone(activeEvaluation) {
  if (!activeEvaluation || activeEvaluation.state === "idle") {
    return "neutral";
  }
  if (activeEvaluation.phase === "confirm" || activeEvaluation.state === "verifying") {
    return "ok";
  }
  return "neutral";
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
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
