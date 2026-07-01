import { useEffect, useMemo, useState } from "react";

const STATUS_SOURCE = import.meta.env.VITE_STATUS_SOURCE || "api";
const IS_STATIC_STATUS = STATUS_SOURCE === "static";
const BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL || "/");
const STATUS_URL =
  import.meta.env.VITE_STATUS_URL ||
  (IS_STATIC_STATUS ? `${BASE_PATH}status.json` : "/api/status");
const POLL_INTERVAL_MS = IS_STATIC_STATUS ? 60000 : 5000;
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
        <Stat label="public tasks" value={overview.publicLiveTasks ?? 0} />
        <Stat label="hidden tasks" value={overview.privateLiveTasks ?? 0} />
        <Stat label="recent duels" value={overview.recentChallenges ?? 0} />
      </section>

      <section className="split">
        <div className="section-block">
          <SectionTitle title="Competition profile" />
          <KeyValue label="system" value="GitTensor-aligned agent arena" />
          <KeyValue label="submission" value="PR-only agent bundle" />
          <KeyValue label="reward idea" value="current king per repo lane" />
          <KeyValue label="evaluation" value="public primary + private holdout" />
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
          <KeyValue label="latest result" value={latestChallenge ? duelStatus(latestChallenge, selectedLane) : "no duel yet"} />
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
    activeEvaluation?.candidateAuthor ||
    activeEvaluation?.candidateSubmissionId ||
    latest?.candidateAuthor ||
    latest?.candidateSubmissionId ||
    "waiting";
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const publicTasks = selectedLane?.publicPool?.tasks || [];
  const publicTaskById = new Map(publicTasks.map((task) => [task.taskId, task]));
  const livePrimaryTasks = activeEvaluation?.primary?.taskStatuses || [];
  const liveTaskById = new Map(
    livePrimaryTasks
      .filter((task) => task.taskId)
      .map((task) => [task.taskId, task])
  );
  const liveTaskIds = livePrimaryTasks.map((task) => task.taskId).filter(Boolean);
  const duelTaskIds = liveTaskIds.length ? liveTaskIds : latest?.primary?.taskIds || [];
  const tasks = duelTaskIds.map(
    (taskId) =>
      ({
        ...(publicTaskById.get(taskId) || {
          taskId,
          title: taskId,
          description: "This task was part of the current duel draw.",
          status: "duel",
          tags: []
        }),
        runtime: liveTaskById.get(taskId) || null
      })
  );
  const fallbackTasks = latest?.primary?.taskIds?.length
    ? latest.primary.taskIds.map((taskId) => ({
        ...(publicTaskById.get(taskId) || {
          taskId,
          title: taskId,
          description: "This task was part of the current duel draw.",
          status: "duel",
          tags: []
        }),
        runtime: null
      }))
    : [];
  const visibleTasks = tasks.length ? tasks : fallbackTasks;
  const selectedTask =
    visibleTasks.find((task) => task.taskId === selectedTaskId) ||
    visibleTasks[0] ||
    null;
  const primaryProgress = poolProgress(activeEvaluation?.primary, selectedLane?.duelRules?.publicTaskCount);
  const holdoutProgress = poolProgress(activeEvaluation?.holdout, selectedLane?.duelRules?.privateTaskCount);
  const candidatePrimary = agentPoolScore(activeEvaluation?.primary, "candidate", latest?.primary?.candidateScore);
  const kingPrimary = agentPoolScore(activeEvaluation?.primary, "frontier", latest?.primary?.frontierScore);
  const candidateHoldout = agentPoolScore(activeEvaluation?.holdout, "candidate", latest?.holdout?.candidateScore);
  const kingHoldout = agentPoolScore(activeEvaluation?.holdout, "frontier", latest?.holdout?.frontierScore);
  const candidateTotal = agentSolvedTotal(activeEvaluation, latest, "candidate");
  const kingTotal = agentSolvedTotal(activeEvaluation, latest, "frontier");

  return (
    <div className="stack">
      <PageIntro
        eyebrow="Live Arena"
        title="king versus Candidate"
        text="Current duel state, score deltas, queue progress, and the public primary task draw."
      />

      <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />

      {selectedLane ? (
        <section className="battle">
          <BattleSide
            label="king"
            name={selectedLane.currentHolder}
            sub={selectedLane.king?.submissionId}
            primaryScore={kingPrimary}
            holdoutScore={kingHoldout}
            totalScore={kingTotal}
          />
          <div className="battle-mid">
            <div className="vs">VS</div>
            <Status
              label={
                activeEvaluation
                  ? activeEvaluationStatus(activeEvaluation)
                  : latest
                    ? duelStatus(latest, selectedLane)
                    : "idle"
              }
              tone={
                activeEvaluation
                  ? activeEvaluationTone(activeEvaluation)
                  : latest?.promotionReady
                    ? "ok"
                    : "neutral"
              }
            />
            <div className="score-mini">
              <span>primary</span>
              <strong>{primaryProgress.label}</strong>
              <ProgressBar value={primaryProgress.percent} />
            </div>
            <div className="score-mini">
              <span>holdout</span>
              <strong>{holdoutProgress.label}</strong>
              <ProgressBar value={holdoutProgress.percent} />
            </div>
          </div>
          <BattleSide
            label="candidate"
            name={candidateName}
            sub={
              activeEvaluation?.candidateSubmissionId ||
              latest?.candidateSubmissionId ||
              "no active duel"
            }
            primaryScore={candidatePrimary}
            holdoutScore={candidateHoldout}
            totalScore={candidateTotal}
          />
        </section>
      ) : null}

      <section className="arena-visual-grid">
        <ArenaProgressCard
          title="Primary progress"
          label={primaryProgress.label}
          percent={primaryProgress.percent}
          sub={selectedLane ? marginLabel(selectedLane, "primary") : "not configured"}
        />
        <ArenaProgressCard
          title="Holdout progress"
          label={holdoutProgress.label}
          percent={holdoutProgress.percent}
          sub={selectedLane ? marginLabel(selectedLane, "holdout") : "not configured"}
        />
        <ScoreCompareCard
          title="Primary score"
          king={kingPrimary}
          candidate={candidatePrimary}
          delta={latest?.primary?.candidateDelta}
        />
        <ScoreCompareCard
          title="Holdout score"
          king={kingHoldout}
          candidate={candidateHoldout}
          delta={latest?.holdout?.candidateDelta}
        />
      </section>

      <section className="split">
        <div className="section-block">
          <SectionTitle title="Duel snapshot" />
          <KeyValue label="phase" value={activeEvaluation ? activeEvaluationStatus(activeEvaluation) : latest ? duelStatus(latest, selectedLane) : "idle"} />
          <KeyValue label="candidate" value={candidateName} />
          <KeyValue label="pull" value={activeEvaluation?.pullNumber ? `#${activeEvaluation.pullNumber}` : "-"} />
          <KeyValue label="latest run" value={latest ? shortRunId(latest.runId) : "-"} />
          <KeyValue label="updated" value={formatDateTime(activeEvaluation?.updatedAt || latest?.createdAt)} />
        </div>
        <div className="section-block">
          <SectionTitle title="Live task status" />
          {activeEvaluation?.primary?.taskStatuses?.length ? (
            <div className="compact-list">
              {activeEvaluation.primary.taskStatuses.map((task) => (
                <TaskRuntimeRow key={task.taskId} task={task} />
              ))}
            </div>
          ) : (
            <Empty text="Task-level progress appears here during an active primary run." />
          )}
        </div>
      </section>

      {selectedLane ? (
        <section className="split task-browser">
          <div className="section-block">
            <SectionTitle title="Duel primary tasks" />
            <div className="task-select-list">
              {visibleTasks.length ? (
                visibleTasks.map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    className={`task-select ${selectedTask?.taskId === task.taskId ? "active" : ""}`}
                    onClick={() => setSelectedTaskId(task.taskId)}
                  >
                    <strong>{task.title}</strong>
                    <span>{task.taskId}</span>
                    <Status label={taskRuntimeLabel(task.runtime)} tone={taskRuntimeTone(task.runtime)} />
                  </button>
                ))
              ) : (
                <Empty text="No current duel task draw." />
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
                <KeyValue label="live duel" value={taskRuntimeLabel(selectedTask.runtime)} />
                <KeyValue label="candidate" value={variantRuntimeLabel(selectedTask.runtime?.candidate)} />
                <KeyValue label="frontier" value={variantRuntimeLabel(selectedTask.runtime?.frontier)} />
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
              <MinerIdentity name={row.author} sub={row.currentFrontiers?.length ? `${row.currentFrontiers.length} active lanes` : "miner"} />
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
        Kata is a GitTensor-aligned coding-agent competition system. Miners do
        not submit ordinary code fixes. They submit repo-specific agents that
        duel the current king under the same model, task pools, repo snapshot,
        and validator checks.
      </p>
      <DocCallout
        title="If you are new, start here"
        text="Think of Kata as a live tournament for coding-agent strategies. Your PR contains the agent. The validator gives your agent repo tasks. If it solves enough more tasks than the current king, your agent becomes the new king."
      />
      <DocCallout
        title="Mental model"
        text="A repo lane has one current king. A candidate PR wins only if its agent beats that king on public primary tasks and private hidden holdouts by the configured margins."
      />
      <DocGrid>
        <DocCard title="Kata" text="Public miner-facing repo. Holds submissions, current kings, evaluator commands, and promotion logic." />
        <DocCard title="kata-benchmarks" text="Public benchmark registry. Holds visible tasks and public frontier policy." />
        <DocCard title="kata-benchmarks-private" text="Private holdout registry. Holds hidden tasks and private frontier state." />
        <DocCard title="kata-bot" text="GitHub automation. Queues PRs, evaluates candidates, comments, closes, merges, and promotes winners." />
      </DocGrid>
      <div className="doc-metrics">
        <KeyValue label="current lane" value={selectedLane?.repoName || "not configured"} />
        <KeyValue label="repo-pack" value={selectedLane?.repoPack || "-"} />
        <KeyValue label="mode" value={selectedLane?.mode || "-"} />
        <KeyValue label="duel format" value={selectedLane ? duelFormat(selectedLane) : "20 primary / 10 hidden"} />
        <KeyValue label="promotion gate" value={selectedLane ? promotionGate(selectedLane) : "+10 primary, +10 holdout"} />
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
        <DocCard title="Evaluator" text="Kata runs candidate and king under the same task pools, model, API route, and timeouts." />
        <DocCard title="Decision" text="kata-bot turns the result into close-invalid, close-losing, rerun-stale, hold, or merge." />
        <DocCard title="Output" text="A verified winner is merged, copied into kings/, and registered as the new frontier." />
      </DocGrid>
      <DocSteps
        items={[
          ["Prepare pools", "Maintainers create public primary tasks and private holdout tasks with kata-benchkit."],
          ["Seed the lane", "The first king/frontier is initialized for a repo-pack and mode."],
          ["Open PR", "A miner opens one PR that touches exactly one submission directory."],
          ["Queue job", "kata-bot receives the GitHub webhook and writes a durable queue job."],
          ["Validate shape", "The bot checks changed paths before trusting PR contents."],
          ["Validate bundle", "Kata validates agent.py, agent_manifest.json, optional helpers, and submission.json."],
          ["Primary duel", "Candidate and king run on the same random public primary task draw."],
          ["Holdout duel", "Candidates that clear primary are checked on hidden holdouts."],
          ["Verify freshness", "Kata rejects stale wins if the king, pools, model, or evaluator changed."],
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
        directory under `submissions/`. Do not edit benchmark tasks, current
        king files, validator code, workflows, or unrelated docs.
      </p>
      <h2>// quick start</h2>
      <CodeBlock value={`mkdir -p submissions/e35ventura__taopedia-articles/contributor/<github-user>-YYYYMMDD-01\ncd submissions/e35ventura__taopedia-articles/contributor/<github-user>-YYYYMMDD-01\n\n# add these files\nagent.py\nagent_manifest.json\nsubmission.json\n# optional: helpers/*.py`} />
      <CodeBlock value={`submissions/<repo-pack>/<mode>/<submission-id>/\n  agent.py\n  agent_manifest.json\n  submission.json\n  helpers/*.py`} />
      <h2>Required metadata</h2>
      <CodeBlock value={`{\n  "schema_version": 2,\n  "repo_pack": "e35ventura__taopedia-articles",\n  "mode": "contributor",\n  "submission_id": "<github-user>-YYYYMMDD-01",\n  "created_at": "2026-07-01T00:00:00+00:00",\n  "author": "<github-user>",\n  "title": "short title",\n  "notes": "what changed in the agent"\n}`} />
      <RequirementList
        title="Validation rules"
        items={[
          "The PR targets the default competition branch.",
          "The PR touches exactly one submission directory.",
          "The target repo-pack is active in the benchmark registry.",
          "The target mode exists in that repo-pack frontier manifest.",
          "The bundle contains valid Python and a valid agent manifest.",
          "The candidate is not an exact copy of the current king.",
          "The bundle contains no symlinks, hardcoded secrets, or direct validator secret env reads."
        ]}
      />
      <DocGrid>
        <DocCard title="Good PR" text="Small, single submission directory, clear metadata, valid Python, and an agent that generalizes across repo tasks." />
        <DocCard title="Bad PR" text="Touches kings/, benchmark tasks, workflow files, multiple submissions, or copies the current king exactly." />
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
        Your `agent.py` must expose one function. The validator owns the model,
        API base, API key, task selection, timeouts, and scoring. Miners compete
        on agent behavior, prompting, context selection, patch generation, and
        robustness.
      </p>
      <CodeBlock value={`def solve(repo_path: str, issue: str, model: str, api_base: str, api_key: str) -> dict:\n    return {\n        "success": True,\n        "message": "short human-readable status",\n        "diff": "unified diff that applies with git apply"\n    }`} />
      <h2>// recommended agent loop</h2>
      <DocSteps
        items={[
          ["Parse task", "Extract the target path, requested behavior, and visible constraints from issue/task text."],
          ["Read repo context", "Load the target files and a small set of relevant examples from the repo."],
          ["Ask model once", "Use the validator-provided model/API route. Do not hardcode your own provider."],
          ["Normalize diff", "Return only a unified diff that can be applied with git apply."],
          ["Self-check", "Run git apply --check or equivalent syntax validation before returning."]
        ]}
      />
      <DocGrid>
        <DocCard title="repo_path" text="A checked-out target repo snapshot for the task." />
        <DocCard title="issue" text="The visible task.md text. This is intentionally task text, not GitHub issue data." />
        <DocCard title="model" text="Validator-owned base model, currently Qwen3-32B." />
        <DocCard title="api_base/api_key" text="Validator-owned routing credentials. Do not override or hardcode providers." />
      </DocGrid>
      <RequirementList
        title="Runtime boundaries and red lines"
        items={[
          "Do not read oracle.json or hidden task directories.",
          "Do not read KATA_EVAL_TASK_DIR, KATA_SCORE_FILE, KATA_ALLOWED_PATHS_FILE, or KATA_FORBIDDEN_PATHS_FILE.",
          "Do not hardcode provider endpoints or secret tokens.",
          "Do not override model, api_base, or api_key inside solve(...).",
          "Return a unified diff, not prose-only instructions.",
          "Keep edits scoped to the task and repo conventions.",
          "Do not use exact benchmark-answer maps or task-id-specific hacks."
        ]}
      />
      <DocLinks links={[["Submission contract", links.submissions], ["Benchmark contract", links.benchmarkEvaluation]]} />
    </section>
  );
}

function DocScoring({ selectedLane }) {
  const primaryTasks = selectedLane?.duelRules?.publicTaskCount || 20;
  const holdoutTasks = selectedLane?.duelRules?.privateTaskCount || 10;
  const primaryMargin = selectedLane?.duelRules?.promotionMarginPoints ?? 10;
  const holdoutMargin = selectedLane?.duelRules?.holdoutPromotionMarginPoints ?? 10;
  return (
    <section>
      <p className="kicker">Scoring</p>
      <h1>How a candidate wins</h1>
      <p>
        Candidate and king run on the same benchmark tasks under the same
        validator runtime. Scores are normalized independently for the primary
        and holdout pools, and both gates must pass.
      </p>
      <DocGrid>
        <DocCard title="Primary pool" text={`${primaryTasks} random live public tasks. Margin: king + ${formatNumber(primaryMargin)} points.`} />
        <DocCard title="Hidden holdout" text={`${holdoutTasks} private tasks. Margin: king + ${formatNumber(holdoutMargin)} points.`} />
        <DocCard title="Task value" text="With 20 public tasks, one binary public task is 5 points. With 10 hidden tasks, one hidden task is 10 points." />
        <DocCard title="Promotion" text="Current default means roughly +2 public tasks and +1 hidden task versus the king." />
      </DocGrid>
      <h2>Benchmark verification</h2>
      <p>
        A task is not judged by patch similarity. It is judged by checks. The
        strongest tasks use deterministic oracles: required files changed,
        required claims or behavior present, known wrong output absent, and
        repo validation still passing.
      </p>
      <DocCallout
        title="Why two pools?"
        text="Primary tasks are visible enough for miners to learn the repo. Hidden holdouts protect the system from agents that only memorize public task patterns."
      />
      <CodeBlock value={`pool_score = 100 * solved_weight / total_weight\n\npromote only if:\n  candidate_primary >= king_primary + ${formatNumber(primaryMargin)}\n  candidate_holdout >= king_holdout + ${formatNumber(holdoutMargin)}\n  no integrity disqualification`} />
      <RequirementList
        title="Invalid behavior collapses score"
        items={[
          "Changing forbidden paths.",
          "Changing files outside allowed task scope.",
          "Failing to produce an applicable diff.",
          "Failing repo-level validation or task oracle checks.",
          "Trying to use hidden validator metadata."
        ]}
      />
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
          ["Evaluate", "Kata compares candidate and king on primary and holdout pools."],
          ["Comment", "The bot posts a clear PR result with score deltas and reason."],
          ["Close", "Invalid and losing PRs are labeled and closed."],
          ["Rerun", "Stale results are rerun when the frontier or task pool changed."],
          ["Merge", "Only verified winners are labeled, merged, promoted, and cleaned from submissions/."]
        ]}
      />
      <DocGrid>
        <DocCard title="kata:invalid" text="Submission shape or bundle contract failed." />
        <DocCard title="kata:losing" text="Candidate did not clear promotion margins." />
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
          ["complete", "MVP lane live", "Taopedia contributor lane has public primary tasks, private holdouts, frontier manifests, and a first king."],
          ["complete", "Oracle-backed benchmark design", "Tasks now include visible task text plus validator-side deterministic oracle files."],
          ["complete", "PR-only submission contract", "Miners submit exactly one agent bundle under submissions/; issues are not used."],
          ["complete", "Dashboard public deployment", "kata-board supports GitHub Pages static deployment with generated status.json."],
          ["current", "Resident validator hardening", "Keep improving queue visibility, PR comments, stale reruns, labels, merge safety, and operational logs."],
          ["current", "Benchmark quality upgrade", "Improve task-specific oracles so checks prove semantic correctness, not only formatting validity."],
          ["next", "Multi-repo lanes", "Add more registered repos so each repo-pack can have its own king and benchmark pool."],
          ["next", "Pool rotation", "Reveal retired private tasks publicly and generate fresh hidden holdouts without leaking live validation data."],
          ["later", "Advanced analytics", "Track per-task solve rates, agent regressions, win history, cost, and benchmark coverage over time."]
        ]}
      />
      <DocCallout
        title="Current priority"
        text="The most important next step is benchmark reliability: every live task should have a clear, deterministic checker that accepts equivalent correct solutions and rejects shallow or irrelevant edits."
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
        Kata must be auditable without leaking the live holdout pool. The public
        system shows enough state for miners to understand the competition while
        keeping hidden validation material private.
      </p>
      <DocGrid>
        <DocCard title="Public" text="Current king code, public tasks, public frontier policy, pool counts, fingerprints, and retired holdout examples." />
        <DocCard title="Private" text="Live holdout task names, oracle files, private frontier task list, score files, validator credentials, and provider routing." />
        <DocCard title="Dashboard" text="Shows hidden counts and fingerprints, not hidden task content." />
        <DocCard title="Retirement" text="Hidden tasks should be revealed only after they leave all live pool versions." />
      </DocGrid>
      <DocCallout
        title="Important"
        text="Agents receive the visible task text only. Checks receive oracle and path-policy metadata after the agent has produced a patch."
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

function BattleSide({ label, name, sub, primaryScore, holdoutScore, totalScore }) {
  return (
    <div className="battle-side">
      <Avatar name={name} />
      <span>{label}</span>
      <h2>{name}</h2>
      <p>{sub}</p>
      <div className="agent-score-strip">
        <strong>{totalScore}</strong>
        <small>solved</small>
      </div>
      <div className="agent-score-pair">
        <span>primary {primaryScore}</span>
        <span>holdout {holdoutScore}</span>
      </div>
    </div>
  );
}

function ArenaProgressCard({ title, label, percent, sub }) {
  return (
    <div className="arena-visual-card">
      <div className="progress-ring" style={{ "--progress": `${percent}%` }}>
        <strong>{Math.round(percent)}%</strong>
      </div>
      <div>
        <span>{title}</span>
        <h3>{label}</h3>
        <p>{sub}</p>
      </div>
    </div>
  );
}

function ScoreCompareCard({ title, king, candidate, delta }) {
  return (
    <div className="arena-visual-card score-card">
      <span>{title}</span>
      <div className="score-bars">
        <ScoreBar label="king" value={king} />
        <ScoreBar label="candidate" value={candidate} />
      </div>
      <strong className={Number(delta || 0) >= 0 ? "score-delta positive" : "score-delta negative"}>
        delta {formatSigned(delta)}
      </strong>
    </div>
  );
}

function ScoreBar({ label, value }) {
  const numeric = scorePercent(value);
  return (
    <div className="score-bar-row">
      <span>{label}</span>
      <div className="score-bar-track">
        <i style={{ width: `${numeric}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="mini-progress" aria-hidden="true">
      <i style={{ width: `${value}%` }} />
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

function DuelRow({ duel, lane }) {
  return (
    <div className="duel-row">
      <div>
        <strong>{duel.candidateAuthor || duel.candidateSubmissionId || "unknown"}</strong>
        <span>{shortRunId(duel.runId)}</span>
      </div>
      <Status label={duelStatus(duel, lane)} tone={duel.promotionReady ? "ok" : "neutral"} />
    </div>
  );
}

function QueueJobRow({ job }) {
  return (
    <div className="duel-row">
      <div>
        <strong>PR #{job.pullNumber}</strong>
        <span>{job.finalAction || `attempt ${job.attempts}`}</span>
      </div>
      <Status label={job.status} tone={queueJobTone(job.status)} />
    </div>
  );
}

function TaskRuntimeRow({ task }) {
  return (
    <div className="duel-row">
      <div>
        <strong>{task.taskId || "hidden task"}</strong>
        <span>
          candidate {variantRuntimeLabel(task.candidate)} / frontier{" "}
          {variantRuntimeLabel(task.frontier)}
        </span>
      </div>
      <Status label={taskRuntimeLabel(task)} tone={taskRuntimeTone(task)} />
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
  if (!IS_STATIC_STATUS) {
    return STATUS_URL;
  }
  const separator = STATUS_URL.includes("?") ? "&" : "?";
  return `${STATUS_URL}${separator}t=${Date.now()}`;
}

function readCurrentRoute() {
  if (IS_STATIC_STATUS && window.location.hash.startsWith("#/")) {
    return normalizeRoute(window.location.hash.slice(1));
  }
  return normalizeRoute(stripBasePath(window.location.pathname));
}

function routeUrl(routePath) {
  const normalized = normalizeRoute(routePath);
  if (!IS_STATIC_STATUS) {
    return normalized;
  }
  if (normalized === "/") {
    return BASE_PATH;
  }
  return `${BASE_PATH}#${normalized}`;
}

function normalizeBasePath(value) {
  if (!value || value === ".") {
    return "/";
  }
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function stripBasePath(pathname) {
  if (BASE_PATH === "/" || !pathname.startsWith(BASE_PATH)) {
    return pathname;
  }
  return pathname.slice(BASE_PATH.length - 1) || "/";
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
  return `${lane.duelRules.publicTaskCount} primary / ${lane.duelRules.privateTaskCount} hidden`;
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

function duelStatus(duel, lane) {
  if (duel.promotionReady) {
    return "winner";
  }
  const primaryMargin = Number(
    duel.promotionMarginPoints ?? lane?.duelRules?.promotionMarginPoints ?? 0
  );
  const holdoutMargin = Number(
    duel.holdoutPromotionMarginPoints ??
      lane?.duelRules?.holdoutPromotionMarginPoints ??
      0
  );
  if ((duel.primary?.candidateDelta ?? Number.NEGATIVE_INFINITY) < primaryMargin) {
    return "primary short";
  }
  if (!duel.holdout && (lane?.duelRules?.privateTaskCount ?? 0) > 0) {
    return "holdout pending";
  }
  if ((duel.holdout?.candidateDelta ?? Number.NEGATIVE_INFINITY) < holdoutMargin) {
    return "holdout short";
  }
  return "blocked";
}

function promotionGate(lane) {
  if (!lane) {
    return "not configured";
  }
  return `primary +${formatNumber(lane.duelRules.promotionMarginPoints)} pts, holdout +${formatNumber(lane.duelRules.holdoutPromotionMarginPoints)} pts`;
}

function marginLabel(lane, pool) {
  const rules = lane?.duelRules || {};
  if (pool === "holdout") {
    return marginWithTasks(
      rules.holdoutPromotionMarginPoints,
      rules.holdoutPromotionMarginTasks
    );
  }
  return marginWithTasks(rules.promotionMarginPoints, rules.promotionMarginTasks);
}

function marginWithTasks(points, tasks) {
  const taskText =
    tasks === null || tasks === undefined ? "" : `, about ${formatNumber(tasks)} tasks`;
  return `king + ${formatNumber(points)} points${taskText}`;
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

function poolProgressLabel(pool, fallbackTotal) {
  if (!pool) {
    return "waiting";
  }
  const total = pool.totalTasks || fallbackTotal || 0;
  if (pool.live) {
    return `${pool.completedTasks || 0}/${total} tasks`;
  }
  return `${pool.completedTasks || total}/${total} complete`;
}

function poolProgress(pool, fallbackTotal) {
  if (!pool) {
    const total = Number(fallbackTotal || 0);
    return {
      completed: 0,
      total,
      percent: 0,
      label: total ? `0/${total}` : "waiting"
    };
  }
  const total = Number(pool.totalTasks || fallbackTotal || 0);
  const completed = Number(pool.completedTasks || (pool.live ? 0 : total));
  return {
    completed,
    total,
    percent: total > 0 ? clampPercent((completed / total) * 100) : 0,
    label: total > 0 ? `${completed}/${total}` : "waiting"
  };
}

function agentPoolScore(pool, variantName, fallbackScore) {
  const tasks = pool?.taskStatuses || [];
  if (tasks.length) {
    const solved = tasks.filter((task) => task?.[variantName]?.solved).length;
    return `${solved}/${tasks.length}`;
  }
  if (fallbackScore !== null && fallbackScore !== undefined) {
    return `${formatNumber(fallbackScore)} pts`;
  }
  if (pool?.totalTasks) {
    return `0/${pool.totalTasks}`;
  }
  return "-";
}

function agentSolvedTotal(activeEvaluation, latest, variantName) {
  const pools = [activeEvaluation?.primary, activeEvaluation?.holdout].filter(Boolean);
  let solved = 0;
  let total = 0;
  for (const pool of pools) {
    const tasks = pool.taskStatuses || [];
    if (!tasks.length) {
      continue;
    }
    solved += tasks.filter((task) => task?.[variantName]?.solved).length;
    total += tasks.length;
  }
  if (total > 0) {
    return `${solved}/${total}`;
  }
  const score =
    variantName === "candidate"
      ? latest?.primary?.candidateScore
      : latest?.primary?.frontierScore;
  return score !== null && score !== undefined ? `${formatNumber(score)} pts` : "-";
}

function scorePercent(value) {
  if (typeof value === "string" && value.includes("/")) {
    const [left, right] = value.split("/").map(Number);
    if (Number.isFinite(left) && Number.isFinite(right) && right > 0) {
      return clampPercent((left / right) * 100);
    }
  }
  const numeric = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return clampPercent(numeric);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function queueJobTone(status) {
  if (status === "running") {
    return "ok";
  }
  if (status === "failed") {
    return "bad";
  }
  return "neutral";
}

function taskRuntimeLabel(task) {
  if (!task) {
    return "waiting";
  }
  return task.status || "waiting";
}

function taskRuntimeTone(task) {
  if (!task) {
    return "neutral";
  }
  if (
    task.status === "candidate ahead" ||
    task.status === "both solved" ||
    task.status === "finished"
  ) {
    return "ok";
  }
  if (
    task.status === "candidate invalid" ||
    task.status === "frontier ahead" ||
    task.status === "both failed"
  ) {
    return "bad";
  }
  return "neutral";
}

function variantRuntimeLabel(variant) {
  if (!variant) {
    return "waiting";
  }
  if (typeof variant.success === "boolean") {
    if (variant.success) {
      return "solved";
    }
    if (variant.valid === false) {
      return "invalid";
    }
    return "failed";
  }
  if (variant.finished) {
    return "finished";
  }
  if (variant.started) {
    return "running";
  }
  return "waiting";
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
