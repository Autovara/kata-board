import { useEffect, useMemo, useState } from "react";

const POLL_INTERVAL_MS = 5000;
const PAGES = [
  { path: "/", label: "Dashboard" },
  { path: "/arena", label: "Arena" },
  { path: "/winners", label: "Winners" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/docs", label: "Docs" }
];

export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [selectedLaneId, setSelectedLaneId] = useState(null);
  const [state, setState] = useState({
    loading: true,
    error: null,
    payload: null
  });

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const response = await fetch("/api/status");
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
    window.history.pushState({}, "", nextPath);
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
          <Dashboard payload={payload} selectedLane={selectedLane} onNavigate={navigate} />
        ) : null}
        {payload && (pathname === "/arena" || pathname === "/live") ? (
          <Arena
            lanes={lanes}
            selectedLane={selectedLane}
            laneActivity={laneActivity}
            setSelectedLaneId={setSelectedLaneId}
          />
        ) : null}
        {payload && (pathname === "/winners" || pathname === "/champions") ? (
          <Winners lanes={lanes} kataRepoSlug={payload.publicLinks?.kataRepo} />
        ) : null}
        {payload && pathname === "/leaderboard" ? (
          <Leaderboard leaderboard={payload.leaderboard} />
        ) : null}
        {payload && pathname === "/docs" ? <Docs selectedLane={selectedLane} /> : null}
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
      <div className="header-status">
        <Status label={error ? "error" : loading ? "syncing" : "live"} tone={error ? "bad" : "ok"} />
        <span>{formatDateTime(generatedAt)}</span>
      </div>
    </header>
  );
}

function Dashboard({ payload, selectedLane, onNavigate }) {
  const overview = payload.overview || {};

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Subnet 74 / Gittensor</p>
          <h1>Kata is the agent arena for Gittensor Subnet 74.</h1>
          <p>
            Miners submit coding agents by pull request. The validator runs
            live duels against public tasks and hidden holdouts. Only a verified
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
          <TerminalLine label="repo" value={selectedLane?.repoName || "none"} />
          <TerminalLine label="king" value={selectedLane?.currentHolder || "none"} />
          <TerminalLine label="duel" value={selectedLane ? duelFormat(selectedLane) : "not configured"} />
          <TerminalLine label="gate" value={selectedLane ? `public +${selectedLane.duelRules.promotionMarginPoints}, holdout >= king` : "none"} />
        </div>
      </section>

      <section className="stat-row">
        <Stat label="repo packs" value={overview.activeRepoPacks} />
        <Stat label="active lanes" value={overview.activeLanes} />
        <Stat label="public tasks" value={`${overview.publicLiveTasks || 0}/${overview.publicTargetTasks || 0}`} />
        <Stat label="hidden tasks" value={`${overview.privateLiveTasks || 0}/${overview.privateTargetTasks || 0}`} />
        <Stat label="queued PRs" value={overview.validatorPendingJobs || 0} />
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
          <SectionTitle title="Current system" />
          <KeyValue label="king source" value="kata/kings" />
          <KeyValue label="public pool" value="kata-benchmarks" />
          <KeyValue label="hidden pool" value="kata-benchmarks-private" />
          <KeyValue label="validator" value="kata-bot resident worker" />
        </div>
      </section>
    </div>
  );
}

function Arena({ lanes, selectedLane, laneActivity, setSelectedLaneId }) {
  const latest = laneActivity[0] || null;
  const candidateName = latest?.candidateAuthor || latest?.candidateSubmissionId || "waiting";
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const tasks = selectedLane?.publicPool?.tasks || [];
  const selectedTask =
    tasks.find((task) => task.taskId === selectedTaskId) || tasks[0] || null;

  return (
    <div className="stack">
      <PageIntro
        eyebrow="Live Arena"
        title="King versus candidate."
        text="Useful live state while a duel is running."
      />

      <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />

      {selectedLane ? (
        <section className="battle">
          <BattleSide
            label="king"
            name={selectedLane.currentHolder}
            sub={selectedLane.king?.submissionId}
          />
          <div className="battle-mid">
            <div className="vs">VS</div>
            <Status label={latest ? duelStatus(latest) : "idle"} tone={latest?.promotionReady ? "ok" : "neutral"} />
            <div className="score-mini">
              <span>public</span>
              <strong>
                {latest
                  ? `${formatNumber(latest.primary?.candidateScore)}:${formatNumber(latest.primary?.frontierScore)}`
                  : "no run"}
              </strong>
            </div>
            <div className="score-mini">
              <span>holdout</span>
              <strong>
                {latest?.holdout
                  ? `${formatNumber(latest.holdout?.candidateScore)}:${formatNumber(latest.holdout?.frontierScore)}`
                  : "hidden"}
              </strong>
            </div>
          </div>
          <BattleSide
            label="candidate"
            name={candidateName}
            sub={latest?.candidateSubmissionId || "no active duel"}
          />
        </section>
      ) : null}

      <section className="split">
        <div className="section-block">
          <SectionTitle title="Duel gate" />
          {selectedLane ? (
            <>
              <KeyValue label="public draw" value={`${selectedLane.duelRules.publicTaskCount} random live tasks`} />
              <KeyValue label="hidden holdout" value={`${selectedLane.duelRules.privateTaskCount} private tasks`} />
              <KeyValue label="promotion margin" value={`king + ${selectedLane.duelRules.promotionMarginPoints}`} />
              <KeyValue label="holdout rule" value="candidate must not regress" />
            </>
          ) : (
            <Empty text="No lane selected." />
          )}
        </div>
        <div className="section-block">
          <SectionTitle title="Recent duels" />
          {laneActivity.length ? (
            <div className="compact-list">
              {laneActivity.slice(0, 6).map((duel) => (
                <DuelRow key={duel.runId} duel={duel} />
              ))}
            </div>
          ) : (
            <Empty text="No duel history yet." />
          )}
        </div>
      </section>

      {selectedLane ? (
        <section className="split task-browser">
          <div className="section-block">
            <SectionTitle title="Public tasks" />
            <div className="task-select-list">
              {tasks.length ? (
                tasks.map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    className={`task-select ${selectedTask?.taskId === task.taskId ? "active" : ""}`}
                    onClick={() => setSelectedTaskId(task.taskId)}
                  >
                    <strong>{task.title}</strong>
                    <span>{task.taskId}</span>
                  </button>
                ))
              ) : (
                <Empty text="No public tasks." />
              )}
            </div>
          </div>
          <div className="section-block">
            <SectionTitle title="Task detail" />
            {selectedTask ? (
              <div className="task-detail">
                <p className="kicker">visible benchmark</p>
                <h2>{selectedTask.title}</h2>
                <p>{selectedTask.description || "No public task description available."}</p>
                <KeyValue label="task id" value={selectedTask.taskId} />
                <KeyValue label="status" value={selectedTask.status} />
                <KeyValue label="tags" value={(selectedTask.tags || []).slice(0, 5).join(", ")} />
              </div>
            ) : (
              <Empty text="Select a task." />
            )}
          </div>
        </section>
      ) : null}
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
              <h2>{lane.repoName}</h2>
              <p>{lane.repoPack}</p>
              <KeyValue label="current king" value={lane.currentHolder} />
              <KeyValue
                label="agent"
                value={kingAgentLink(lane, kataRepoSlug)}
              />
              <KeyValue label="duel gate" value={duelFormat(lane)} />
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
        text={`Source: ${leaderboardSource(leaderboard?.source)}.`}
      />

      <section className="table-section">
        <div className="table-head">
          <span>rank</span>
          <span>miner</span>
          <span>wins</span>
          <span>kings</span>
          <span>open</span>
          <span>score</span>
        </div>
        {rows.length ? (
          rows.slice(0, 20).map((row, index) => (
            <div className="table-row" key={row.author}>
              <span>{index + 1}</span>
              <strong>{row.author}</strong>
              <span>{row.wins}</span>
              <span>{row.currentFrontiers}</span>
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

function Docs({ selectedLane }) {
  const [activeTab, setActiveTab] = useState("overview");
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "submit", label: "Submit" },
    { id: "agent", label: "Agent" },
    { id: "scoring", label: "Scoring" },
    { id: "promotion", label: "Promotion" },
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
        {activeTab === "overview" ? <DocOverview selectedLane={selectedLane} /> : null}
        {activeTab === "submit" ? <DocSubmit /> : null}
        {activeTab === "agent" ? <DocAgent /> : null}
        {activeTab === "scoring" ? <DocScoring selectedLane={selectedLane} /> : null}
        {activeTab === "promotion" ? <DocPromotion /> : null}
        {activeTab === "privacy" ? <DocPrivacy /> : null}
      </article>
    </div>
  );
}

function DocOverview({ selectedLane }) {
  return (
    <section>
      <p className="kicker">Miner Guide</p>
      <h1>Compete on Subnet 74</h1>
      <p>
        Kata is the Gittensor SN74 agent competition system. Each repo has a
        current king. Your PR submits a candidate agent that must defeat that
        king under the validator's live task pools.
      </p>
      <KeyValue label="current lane" value={selectedLane?.repoName || "not configured"} />
      <KeyValue label="duel format" value={selectedLane ? duelFormat(selectedLane) : "10 public / 10 hidden"} />
    </section>
  );
}

function DocSubmit() {
  return (
    <section>
      <h1>Submit one PR</h1>
      <p>Your PR should only touch one submission directory. Do not edit benchmark tasks, king files, validator code, or unrelated docs.</p>
      <CodeBlock value={`submissions/<repo-pack>/<mode>/<submission-id>/\n  agent.py\n  agent_manifest.json\n  submission.json\n  helpers/*.py`} />
    </section>
  );
}

function DocAgent() {
  return (
    <section>
      <h1>Agent contract</h1>
      <p>Your `agent.py` must define `solve(...)`. The validator provides the model, API base, API key, repo path, issue text, timeouts, and benchmark tasks.</p>
      <CodeBlock value={`def solve(repo_path: str, issue: str, model: str, api_base: str, api_key: str) -> dict:\n    return {\"patch\": \"...\"}`} />
    </section>
  );
}

function DocScoring({ selectedLane }) {
  return (
    <section>
      <h1>Duel scoring</h1>
      <p>
        Current lane: {selectedLane ? duelFormat(selectedLane) : "10 public / 10 hidden"}.
        Public tasks are randomly drawn from live public tasks. Hidden holdouts
        are private.
      </p>
      <ul>
        <li>Public pool: candidate must beat king by at least 2.</li>
        <li>Hidden holdout: candidate must score at least the king.</li>
        <li>Invalid task runs block promotion.</li>
      </ul>
    </section>
  );
}

function DocPromotion() {
  return (
    <section>
      <h1>Promotion</h1>
      <p>
        If your agent wins, the bot merges the PR, copies your agent into
        `kings/`, updates frontier state, and clears the merged submission
        directory from `main`.
      </p>
    </section>
  );
}

function DocPrivacy() {
  return (
    <section>
      <h1>Visibility</h1>
      <ul>
        <li>Miners can see current king code under `kings/`.</li>
        <li>Miners can see public benchmark tasks.</li>
        <li>Miners can see public pool counts and fingerprints.</li>
        <li>Hidden holdout task names are never shown publicly.</li>
      </ul>
    </section>
  );
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

function BattleSide({ label, name, sub }) {
  return (
    <div className="battle-side">
      <Avatar name={name} />
      <span>{label}</span>
      <h2>{name}</h2>
      <p>{sub}</p>
    </div>
  );
}

function Avatar({ name }) {
  const src = avatarUrl(name);
  if (src) {
    return <img className="avatar" src={src} alt="" />;
  }
  return <div className="avatar avatar-fallback">{initials(name || "?")}</div>;
}

function DuelRow({ duel }) {
  return (
    <div className="duel-row">
      <div>
        <strong>{duel.candidateAuthor || duel.candidateSubmissionId || "unknown"}</strong>
        <span>{shortRunId(duel.runId)}</span>
      </div>
      <Status label={duelStatus(duel)} tone={duel.promotionReady ? "ok" : "neutral"} />
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

function duelFormat(lane) {
  if (!lane) {
    return "not configured";
  }
  return `${lane.duelRules.publicTaskCount} public / ${lane.duelRules.privateTaskCount} hidden`;
}

function duelStatus(duel) {
  if (duel.promotionReady) {
    return "winner";
  }
  if ((duel.primary?.candidateDelta ?? 0) <= 0) {
    return "king held";
  }
  if ((duel.holdout?.candidateDelta ?? 0) < 0) {
    return "holdout failed";
  }
  return "blocked";
}

function selectionLabel(value) {
  if (value === "random_live") {
    return "random live draw";
  }
  return value || "unknown";
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

function humanizeSource(value) {
  if (!value) {
    return "unknown";
  }
  if (String(value).startsWith("kata-init")) {
    return "Kata seed";
  }
  return value;
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

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2
  });
}

function formatSigned(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${formatNumber(number)}`;
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
