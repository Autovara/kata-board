import { useEffect, useMemo, useState } from "react";

const STATUS_URL = import.meta.env.VITE_STATUS_URL || "/api/status";
const STREAM_URL = import.meta.env.VITE_STREAM_URL || "/api/stream";
const POLL_INTERVAL_MS = 4000;
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
            kataRepoSlug={payload.publicLinks?.kataRepo}
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
          <p className="kicker">King of the hill · AI agents</p>
          <h1>Build the best agent for a subnet. Take the crown.</h1>
          <p>
            Contributors submit agents by pull request. Each one duels the reigning
            king on a fixed benchmark — win, and your agent becomes the new king
            anyone can mine with.
          </p>
          <div className="actions">
            <button type="button" className="button primary" onClick={() => onNavigate("/arena")}>
              Watch the Arena
            </button>
            <button type="button" className="button" onClick={() => onNavigate("/docs")}>
              Submit an agent
            </button>
          </div>
        </div>
        <div className="hero-terminal" aria-label="Live summary">
          <div className="terminal-top">
            <span />
            <span />
            <span />
          </div>
          <TerminalLine label="engine" value="SN60 · king vs candidate" />
          <TerminalLine label="live subnet" value={selectedLane?.repoName || "SN60 Bitsec"} />
          <TerminalLine label="reigning king" value={selectedLane?.currentHolder || "seed king"} />
          <TerminalLine label="selected set" value={`${overview.benchmarkProjects ?? 0} smart-contract codebases`} />
          <TerminalLine label="promotions" value={`${totalKings || 0} king${totalKings === 1 ? "" : "s"} crowned`} />
          <TerminalLine label="goal" value="one-click mining" />
        </div>
      </section>

      <section className="stat-row">
        <Stat label="live subnets" value={overview.activeSubnetPacks ?? overview.activeRepoPacks} />
        <Stat label="selected codebases" value={overview.benchmarkProjects ?? 0} />
        <Stat label="challengers seen" value={overview.leaderboardEntries ?? 0} />
        <Stat label="recent duels" value={overview.recentChallenges ?? 0} />
      </section>

      <section className="section-block how-block">
        <SectionTitle title="How it works" />
        <div className="how-row">
          <HowStep step="01" title="Submit" text="Open one pull request that adds a single agent under submissions/." />
          <HowStep step="02" title="Duel" text="Your agent runs head-to-head against the current king on the fixed benchmark." />
          <HowStep step="03" title="Take the crown" text="Beat the king and your agent is merged and published as the new king." />
        </div>
      </section>

      <section className="split">
        <div className="section-block">
          <SectionTitle title="Reigning king" />
          <MinerIdentity
            name={selectedLane?.currentHolder || "Seed king"}
            sub={selectedLane?.king?.submissionId || "current king"}
            size="large"
          />
          <KeyValue label="subnet" value={selectedLane?.repoName || "-"} />
          <KeyValue label="mode" value={selectedLane?.mode || "-"} />
          <KeyValue label="benchmark" value={selectedLane ? duelFormat(selectedLane) : "-"} />
          <KeyValue label="crowned" value={formatDateTime(selectedLane?.king?.updatedAt)} />
        </div>
        <div className="section-block">
          <SectionTitle title="Latest challenge" />
          <KeyValue label="challenger" value={latestChallenge?.candidateAuthor || latestChallenge?.candidateSubmissionId || "none yet"} />
          <KeyValue label="result" value={latestChallenge ? duelStatus(latestChallenge) : "no duel yet"} />
          <KeyValue label="top miner" value={topMiner?.author || "not ranked yet"} />
          <KeyValue label="updated" value={formatDateTime(payload.generatedAt)} />
        </div>
      </section>
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

function Arena({ lanes, selectedLane, laneActivity, validator, kataRepoSlug, setSelectedLaneId }) {
  const latest = laneActivity[0] || null;
  const activeEvaluation = laneActiveEvaluation(validator?.activeEvaluation, selectedLane);
  const activeJob = validator?.queue?.activeJob || null;
  const current = selectedLane?.evaluatorState?.current || null;
  const displayState = mergeActiveEvaluationState(current, activeEvaluation, selectedLane);
  const phase = activeEvaluation
    ? activeEvaluationStatus(activeEvaluation)
    : displayState?.finalWinner
      ? "completed"
      : latest
        ? latest.promotionReady
          ? "winner"
          : "completed"
        : "idle";
  const tone = activeEvaluation
    ? activeEvaluationTone(activeEvaluation)
    : displayState?.finalWinner === "candidate" || latest?.promotionReady
      ? "ok"
      : "neutral";
  const updatedLabel = formatDateTime(activeEvaluation?.updatedAt || latest?.createdAt);

  return (
    <div className="stack">
      {lanes.length > 1 ? (
        <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />
      ) : null}

      <section className="arena-hero">
        <div className="arena-topline">
          <div className="arena-hero-status">
            <Status label={phase} tone={tone} />
            <span>{selectedLane?.repoName || "SN60 Bitsec"}</span>
            {activeJob?.pullNumber ? <span>PR #{activeJob.pullNumber}</span> : null}
            <span>updated {updatedLabel}</span>
          </div>
        </div>
        {displayState || activeEvaluation ? (
          <Battle
            state={displayState}
            activeEvaluation={activeEvaluation}
            activeJob={activeJob}
            selectedLane={selectedLane}
            kataRepoSlug={kataRepoSlug}
          />
        ) : (
          <Empty text="No duel yet for this lane. Waiting for the first challenger." />
        )}
      </section>

      {displayState ? (
        <Sn60LanePanel state={displayState} activeEvaluation={activeEvaluation} activeJob={activeJob} />
      ) : (
        <Empty text="No duel results yet for this subnet." />
      )}
    </div>
  );
}

function Battle({ state, activeEvaluation, activeJob, selectedLane, kataRepoSlug }) {
  const candidateName =
    activeEvaluation?.candidateGithubLogin ||
    state?.candidateAuthor ||
    state?.candidateSubmissionId ||
    "waiting";
  const kingName = state?.kingAuthor || state?.kingSubmissionId || "Seed king";
  const candidateScore = percentScore(state?.scores?.candidate);
  const kingScore = percentScore(state?.scores?.king);
  const winner = state?.finalWinner || null;
  const scoreDelta = Number(state?.scores?.delta ?? 0);
  const activeTask = currentTask(state);
  const candidateSub =
    activeJob?.pullNumber
      ? `PR #${activeJob.pullNumber} · ${state?.candidateSubmissionId || "candidate"}`
      : state?.candidateSubmissionId || "candidate";
  const candidateLinks = candidateActionLinks(activeJob, activeEvaluation);
  const kingSub = state?.kingSubmissionId || "current king";
  const kingLinks = kingActionLinks(selectedLane, kataRepoSlug);

  return (
    <div className="battle-wrap">
      <div className="battle">
        <BattleSide
          role="king"
          crown
          name={kingName}
          sub={kingSub}
          score={kingScore}
          actions={kingLinks}
          won={winner === "king"}
        />
        <div className="battle-mid">
          <div className="vs">VS</div>
          <div className="battle-current-task">
            <span>current problem</span>
            <strong>{activeTask ? formatTaskName(activeTask.taskId) : "Waiting for next codebase"}</strong>
          </div>
          <div className="battle-decision">
            <span>{scoreLeadLabel(scoreDelta)}</span>
            <strong className={scoreDelta > 0 ? "positive" : scoreDelta < 0 ? "negative" : ""}>
              {formatSignedPoints(scoreDelta)}
            </strong>
            <small>candidate vs king</small>
          </div>
        </div>
        <BattleSide
          role="candidate"
          name={candidateName}
          sub={candidateSub}
          avatarUrl={activeEvaluation?.candidateAvatarUrl}
          score={candidateScore}
          actions={candidateLinks}
          won={winner === "candidate"}
        />
      </div>
      <div className="battle-compare">
        <BattleReplicaBar label="king replicas" progress={state?.replicaProgress?.king} tone="king" />
        <BattleReplicaBar label="candidate replicas" progress={state?.replicaProgress?.candidate} tone="candidate" />
      </div>
    </div>
  );
}

function BattleSide({ role, name, sub, score, avatarUrl, crown, won, actions = [] }) {
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
        <small>aggregated score</small>
      </div>
      {actions.length ? (
        <div className="battle-actions">
          {actions.map((action) => (
            <a key={action.href} href={action.href} target="_blank" rel="noreferrer">
              {action.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BattleReplicaBar({ label, progress, tone }) {
  return (
    <div className={`battle-bar battle-bar-${tone}`}>
      <div className="battle-bar-head">
        <span>{label}</span>
        <strong>{formatReplicaSide(progress)}</strong>
      </div>
      <div className="battle-bar-track">
        <i style={{ width: `${progressPercent(progress)}%` }} />
      </div>
    </div>
  );
}

function Sn60LanePanel({ state, activeEvaluation, activeJob }) {
  const winner = state.finalWinner;
  const result = state.live
    ? "Duel running"
    : winner === "candidate"
      ? "Challenger wins"
      : winner === "king"
        ? "King holds"
        : "In progress";
  const delta = state.scores?.delta;
  const marginLabel =
    delta == null ? "-" : `${Number(delta) >= 0 ? "+" : ""}${formatNumber(Number(delta) * 100)} pts`;
  const marginTone = delta != null && Number(delta) > 0 ? "ok" : "neutral";
  const livePhase = readablePhase(activeEvaluation?.phase || state.liveProgress?.phase);
  const outcome = duelOutcomeMessage(state);

  return (
    <section className="lane-card">
      <div className="lane-card-head">
        <div>
          <p className="kicker">SN60 · Bitsec security</p>
          <h2>{state.live ? "Live validator run" : "Latest duel result"}</h2>
          <p className="lane-card-sub">
            {outcome}
          </p>
        </div>
        <Status
          label={result}
          tone={winner === "candidate" ? "ok" : winner === "king" ? "neutral" : "neutral"}
        />
      </div>

      <DuelRunGraph state={state} livePhase={livePhase} activeJob={activeJob} />

      <div className="lane-metrics">
        <LaneMetric label="Score margin" value={marginLabel} sub="challenger − king" tone={marginTone} />
        <LaneMetric
          label="Codebases passed"
          value={`${state.codebasesPassed?.candidate ?? "-"} vs ${state.codebasesPassed?.king ?? "-"}`}
          sub="challenger vs king"
        />
        <LaneMetric
          label="Vulnerabilities found"
          value={`${state.truePositives?.candidate ?? "-"} vs ${state.truePositives?.king ?? "-"}`}
          sub="challenger vs king"
        />
        <LaneMetric
          label="Invalid runs"
          value={`${state.invalidRuns?.candidate ?? "-"} vs ${state.invalidRuns?.king ?? "-"}`}
          sub="challenger vs king"
          tone={Number(state.invalidRuns?.candidate) > 0 ? "bad" : "neutral"}
        />
      </div>

      {state.screeningReasons?.length ? (
        <div className="lane-notes">
          {state.screeningReasons.slice(0, 3).map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      ) : null}

      <LiveTaskProgress state={state} />
    </section>
  );
}

function DuelRunGraph({ state, livePhase, activeJob }) {
  const taskProgress = taskCompletion(state);
  const scoreProgress = clampPercent(Number(state.scores?.candidate ?? 0) * 100);
  const invalidCount = Number(state.invalidRuns?.candidate || 0);
  const healthProgress = invalidCount > 0 ? 100 : taskProgress.percent;

  return (
    <div className="duel-run-graph">
      <div className="duel-run-graph-head">
        <div>
          <span>run progress</span>
          <strong>{livePhase}</strong>
        </div>
        <small>{activeJob?.pullNumber ? `PR #${activeJob.pullNumber}` : "validator run"}</small>
      </div>
      <div className="duel-graph-rails">
        <GraphRail
          label="codebases"
          value={`${taskProgress.completed}/${taskProgress.total}`}
          progress={taskProgress.percent}
        />
        <GraphRail
          label="score"
          value={percentScore(state.scores?.candidate)}
          progress={scoreProgress}
          tone="score"
        />
        <GraphRail
          label="health"
          value={invalidCount > 0 ? "invalid" : "clean"}
          progress={healthProgress}
          tone={invalidCount > 0 ? "bad" : "ok"}
        />
      </div>
    </div>
  );
}

function GraphRail({ label, value, progress, tone = "neutral" }) {
  return (
    <div className={`graph-rail graph-rail-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <i>
        <b style={{ width: `${clampPercent(progress)}%` }} />
      </i>
    </div>
  );
}

function ArenaInsight({ label, value, sub, progress, tone = "neutral" }) {
  return (
    <article className={`arena-insight arena-insight-${tone}`}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
      <small>{sub}</small>
      {typeof progress === "number" ? (
        <div className="arena-insight-progress">
          <i style={{ width: `${clampPercent(progress)}%` }} />
        </div>
      ) : null}
    </article>
  );
}

function LiveTaskProgress({ state }) {
  const tasks = Array.isArray(state.liveProgress?.taskStatuses)
    ? state.liveProgress.taskStatuses
    : [];
  if (!tasks.length) {
    return null;
  }
  const totalTasks = state.liveProgress?.totalTasks ?? tasks.length;
  const completedTasks =
    state.liveProgress?.completedTasks ?? tasks.filter((task) => task.completed).length;
  const candidateReplicas = state.replicaProgress?.candidate || {};
  const kingReplicas = state.replicaProgress?.king || {};

  return (
    <div className="live-task-progress">
      <div className="live-task-progress-head">
        <div>
          <span>problem list</span>
          <strong>
            {completedTasks}/{totalTasks} complete
          </strong>
          <small>Clean view of every selected benchmark codebase and both agents' replica status.</small>
        </div>
        <div>
          <span>all replicas</span>
          <strong>
            C {formatReplicaSide(candidateReplicas)} · K {formatReplicaSide(kingReplicas)}
          </strong>
        </div>
      </div>
      <div className="live-task-table-head">
        <span>problem</span>
        <span>state</span>
        <span>candidate</span>
        <span>king</span>
      </div>
      <div className="live-task-list">
        {tasks.map((task) => (
          <LiveTaskRow key={task.taskId || task.status} task={task} />
        ))}
      </div>
    </div>
  );
}

function LiveTaskRow({ task }) {
  const candidate = task.candidate || {};
  const king = task.king || {};
  return (
    <div className={`live-task-row live-task-row-${taskStatusTone(task.status)}`}>
      <div className="live-task-main">
        <strong>{formatTaskName(task.taskId || "hidden task")}</strong>
        <span>{task.taskId || "hidden task"}</span>
      </div>
      <Status label={task.status || "queued"} tone={taskStatusTone(task.status)} />
      <div className={`live-task-side live-task-side-${variantTone(candidate)}`}>
        <span>C · {variantResultLabel(candidate)}</span>
        <strong>{formatVariantReplicas(candidate)}</strong>
      </div>
      <div className={`live-task-side live-task-side-${variantTone(king)}`}>
        <span>K · {variantResultLabel(king)}</span>
        <strong>{formatVariantReplicas(king)}</strong>
      </div>
    </div>
  );
}

function LaneMetric({ label, value, sub, tone = "neutral" }) {
  return (
    <div className={`lane-metric lane-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
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
        eyebrow="Hall of Kings"
        title="Reigning champions"
        text="Each live subnet keeps one current king — the best agent so far. Beat it in the Arena to take its place."
      />

      <section className="winner-grid">
        {lanes.length ? (
          lanes.map((lane) => {
            const agent = kingAgentLink(lane, kataRepoSlug);
            return (
              <article className="winner-card" key={lane.id}>
                <div className="winner-crown" aria-hidden="true">
                  ♔
                </div>
                <Avatar name={lane.currentHolder} />
                <h2>{lane.currentHolder || "Seed king"}</h2>
                <p className="winner-sub">{lane.king?.submissionId || "current king"}</p>
                <div className="winner-tags">
                  <span>{lane.repoName}</span>
                  <span>{lane.mode}</span>
                  <Status
                    label={lane.king?.seeded ? "seed king" : "promoted"}
                    tone={lane.king?.seeded ? "neutral" : "ok"}
                  />
                </div>
                <div className="winner-foot">
                  <span>crowned {formatDateTime(lane.king?.updatedAt)}</span>
                  {typeof agent === "string" && agent.startsWith("https://") ? (
                    <a className="winner-link" href={agent} target="_blank" rel="noreferrer">
                      View agent →
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <Empty text="No kings crowned yet." />
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
        title="Top challengers"
        text="Ranked by crowns won. Kings are verified merged wins; submissions counts every candidate PR seen."
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
              <strong className="lb-score">{row.score}</strong>
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
  return ["🥇", "🥈", "🥉"][index] || index + 1;
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
        Kata is a Gittensor-aligned security-agent competition system. Miners do
        not submit ordinary code fixes. They submit vulnerability-hunting agents
        that duel the current king in the same pinned Bitsec sandbox, on the
        same selected benchmark codebases, under the same validator checks.
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
        <DocCard title="Bitsec sandbox" text="Pinned SN60 evaluation mirror. Agents run in Docker against selected projects from the pinned benchmark snapshot." />
        <DocCard title="kata-bot" text="GitHub automation. Queues PRs, evaluates candidates, comments, closes, merges, and promotes winners." />
      </DocGrid>
      <div className="doc-metrics">
        <KeyValue label="current lane" value={selectedLane?.repoName || "not configured"} />
        <KeyValue label="subnet pack" value={selectedLane?.subnetPack || selectedLane?.repoPack || "-"} />
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
        <DocCard title="Evaluator" text="Kata runs candidate and king through the same selected Bitsec benchmark projects with repeated replica runs." />
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
          ["Screening", "Static checks and one screener sandbox run must pass before the full duel."],
          ["Sandbox duel", "Candidate and king run repeated replicas per selected benchmark codebase in the Bitsec sandbox."],
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
      <CodeBlock value={`submissions/<subnet-pack>/<mode>/<submission-id>/\n  agent.py\n  agent_manifest.json\n  submission.json`} />
      <h2>Required metadata</h2>
      <CodeBlock value={`{\n  "schema_version": 2,\n  "subnet_pack": "sn60__bitsec",\n  "mode": "miner",\n  "submission_id": "<github-user>-YYYYMMDD-01",\n  "created_at": "2026-07-01T00:00:00+00:00",\n  "author": "<github-user>",\n  "title": "short title",\n  "notes": "what changed in the agent"\n}`} />
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
          "Return a top-level `vulnerabilities` list with at least one useful finding during screening, not prose-only output.",
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
        Candidate and king run through the same selected projects from the
        pinned Bitsec benchmark snapshot with repeated replicas per codebase.
        A codebase passes only if at least 2 of 3 runs pass; the aggregated
        score is passed codebases divided by selected codebases.
      </p>
      <DocGrid>
        <DocCard title="Benchmark" text={`${projectCount} selected SN60 project${projectCount === 1 ? "" : "s"} from the pinned snapshot.`} />
        <DocCard title="Codebase pass" text="A codebase passes when at least 2 of 3 replica runs pass." />
        <DocCard title="Aggregated score" text="Passed codebases divided by selected codebases in the round." />
        <DocCard title="Promotion order" text="Aggregated score, then codebases passed, then true positives." />
      </DocGrid>
      <h2>Screening</h2>
      <p>
        Every candidate is screened before the duel. Static checks reject
        no-op agents, helper files, leaked benchmark-answer hints, and secret
        references. The screener run must return at least one useful finding
        with a title and description. Candidates with invalid replica runs are
        never promoted.
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
          ["Evaluate", "Kata runs candidate and king through selected pinned Bitsec benchmark projects with repeated replicas."],
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
        Kata is being built in layers: first objective subnet-pack duels,
        then robust automation, benchmark hardening, and multi-pack expansion.
      </p>
      <MilestoneList
        items={[
          ["complete", "SN60 lane live", "The sn60__bitsec/miner lane has a pinned benchmark snapshot and a seeded king."],
          ["complete", "Pinned benchmark scoring", "Duels score against the pinned Bitsec benchmark snapshot with deterministic replica rules."],
          ["complete", "PR-only submission contract", "Miners submit exactly one agent bundle under submissions/; issues are not used."],
          ["complete", "Live dashboard deployment", "kata-board runs as a Node service behind ngrok and reads the live validator API."],
          ["current", "Resident validator hardening", "Keep improving queue visibility, PR comments, stale reruns, labels, merge safety, and operational logs."],
          ["next", "Multi-pack lanes", "Add more registered subnet packs so each subnet pack can have its own king and benchmark snapshot."],
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
  // Point every link at a doc that actually exists in the kata repo today.
  return {
    kataReadme: `${kataBase}/README.md`,
    systemWorkflow: `${kataBase}/README.md`,
    submissions: `${kataBase}/docs/submissions.md`,
    scoring: `${kataBase}/docs/submissions.md`,
    benchmarkEvaluation: `${kataBase}/docs/submissions.md`,
    githubAutomation: `${kataBase}/README.md`,
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
  return `${count} selected SN60 project${count === 1 ? "" : "s"}`;
}

function laneActiveEvaluation(activeEvaluation, lane) {
  if (!activeEvaluation || !lane) {
    return null;
  }
  if (activeEvaluation.laneId && activeEvaluation.laneId === lane.evaluatorState?.laneId) {
    return activeEvaluation;
  }
  if (
    (activeEvaluation.subnetPack || activeEvaluation.repoPack) &&
    activeEvaluation.mode &&
    (activeEvaluation.subnetPack || activeEvaluation.repoPack) === (lane.subnetPack || lane.repoPack) &&
    activeEvaluation.mode === lane.mode
  ) {
    return activeEvaluation;
  }
  return null;
}

function mergeActiveEvaluationState(current, activeEvaluation, lane) {
  if (!activeEvaluation || activeEvaluation.state === "idle") {
    return current;
  }
  const primary = activeEvaluation.primary || {};
  return {
    ...(current || {}),
    live: true,
    candidateSubmissionId:
      activeEvaluation.candidateSubmissionId || current?.candidateSubmissionId || null,
    candidateAuthor:
      activeEvaluation.candidateAuthor ||
      activeEvaluation.candidateGithubLogin ||
      current?.candidateAuthor ||
      null,
    kingSubmissionId: current?.kingSubmissionId || lane?.king?.submissionId || null,
    kingAuthor: current?.kingAuthor || lane?.king?.author || lane?.currentHolder || null,
    screeningStatus: current?.screeningStatus || (activeEvaluation.phase === "sn60-screening" ? "running" : null),
    screeningStage: current?.screeningStage || (activeEvaluation.phase === "sn60-screening" ? "screening" : null),
    screeningReasons: current?.screeningReasons || [],
    projectKeys: primary.projectKeys?.length
      ? primary.projectKeys
      : activeEvaluation.projectKeys?.length
        ? activeEvaluation.projectKeys
        : current?.projectKeys || [],
    codebasesPassed: livePair(primary.passCounts, current?.codebasesPassed),
    truePositives: livePair(primary.truePositives, current?.truePositives),
    invalidRuns: livePair(primary.invalidRuns, current?.invalidRuns),
    scores: liveScores(primary.scores, current?.scores),
    replicaProgress: primary.replicaProgress || current?.replicaProgress || null,
    finalWinner: null,
    liveProgress: {
      phase: activeEvaluation.phase,
      state: activeEvaluation.state,
      totalTasks: primary.totalTasks ?? null,
      completedTasks: primary.completedTasks ?? null,
      taskStatuses: primary.taskStatuses || [],
      counts: primary.counts || {},
      updatedAt: activeEvaluation.updatedAt || primary.updatedAt || null
    }
  };
}

function livePair(liveValue, fallback) {
  return {
    king: liveValue?.king ?? fallback?.king ?? null,
    candidate: liveValue?.candidate ?? fallback?.candidate ?? null
  };
}

function liveScores(liveValue, fallback) {
  return {
    king: liveValue?.king ?? fallback?.king ?? null,
    candidate: liveValue?.candidate ?? fallback?.candidate ?? null,
    delta: liveValue?.delta ?? fallback?.delta ?? null
  };
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
  const path = `kings/${lane.subnetPack || lane.repoPack}/${lane.mode}/agent.py`;
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
  if (source === "events+runs") {
    return "event log + run artifacts";
  }
  if (source === "github+runs") {
    return "GitHub PR history + run artifacts";
  }
  if (source === "github-not-configured+runs" || source === "unavailable+runs") {
    return "run artifacts";
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

function formatReplicaProgress(progress) {
  const candidate = progress?.candidate || {};
  const king = progress?.king || {};
  const candidateText =
    candidate.total > 0 ? `${candidate.completed}/${candidate.total}` : "-";
  const kingText = king.total > 0 ? `${king.completed}/${king.total}` : "-";
  return {
    value: `${candidateText} vs ${kingText}`,
    sub: "challenger vs king"
  };
}

function formatReplicaSide(progress) {
  const completed = Number(progress?.completed || 0);
  const total = Number(progress?.total || 0);
  return total > 0 ? `${completed}/${total}` : "-";
}

function progressPercent(progress) {
  const completed = Number(progress?.completed || 0);
  const total = Number(progress?.total || 0);
  return total > 0 ? clampPercent((completed / total) * 100) : 0;
}

function formatVariantReplicas(variant) {
  const completed = Number(variant?.completedReplicas || 0);
  const total = Number(variant?.totalReplicas || 0);
  const solved = variant?.solved ? "pass" : variant?.finished ? "fail" : "";
  const suffix = solved ? ` · ${solved}` : "";
  return total > 0 ? `${completed}/${total}${suffix}` : "-";
}

function variantResultLabel(variant) {
  if (variant?.finished && !variant?.valid) {
    return "invalid";
  }
  if (!variant?.finished) {
    return variant?.started ? "running" : "waiting";
  }
  return variant?.solved ? "passed" : "failed";
}

function variantTone(variant) {
  if (variant?.finished && !variant?.valid) {
    return "bad";
  }
  if (!variant?.finished) {
    return variant?.started ? "active" : "neutral";
  }
  return variant?.solved ? "ok" : "bad";
}

function taskCompletion(state) {
  const tasks = Array.isArray(state.liveProgress?.taskStatuses)
    ? state.liveProgress.taskStatuses
    : [];
  const total = Number(state.liveProgress?.totalTasks ?? tasks.length ?? 0);
  const completed = Number(
    state.liveProgress?.completedTasks ?? tasks.filter((task) => task.completed).length ?? 0
  );
  return {
    completed,
    total,
    percent: total > 0 ? (completed / total) * 100 : 0
  };
}

function currentTask(state) {
  const tasks = Array.isArray(state?.liveProgress?.taskStatuses)
    ? state.liveProgress.taskStatuses
    : [];
  return (
    tasks.find((task) => String(task.status || "").toLowerCase().includes("running")) ||
    tasks.find((task) => task.candidate?.started && !task.candidate?.finished) ||
    tasks.find((task) => task.king?.started && !task.king?.finished) ||
    tasks.find((task) => !task.completed) ||
    null
  );
}

function candidateActionLinks(activeJob, activeEvaluation) {
  if (!activeJob?.kataRepo || !activeJob?.pullNumber) {
    return [];
  }
  const pullUrl =
    activeEvaluation?.candidatePullUrl ||
    `https://github.com/${activeJob.kataRepo}/pull/${activeJob.pullNumber}`;
  return [
    { label: "Open PR", href: pullUrl },
    {
      label: "Agent code",
      href: activeEvaluation?.candidateAgentUrl || `${pullUrl}/files`
    }
  ];
}

function kingActionLinks(lane, kataRepoSlug) {
  if (!lane) {
    return [];
  }
  const repoSlug = kataRepoSlug || "Autovara/kata";
  const actions = [];
  if (lane.currentHolderPullNumber) {
    actions.push({
      label: "Open PR",
      href: `https://github.com/${repoSlug}/pull/${lane.currentHolderPullNumber}`
    });
  }
  const agent = kingAgentLink(lane, repoSlug);
  if (typeof agent === "string" && agent.startsWith("https://")) {
    actions.push({ label: "Agent code", href: agent });
  }
  return actions;
}

function scoreLeadLabel(value) {
  const numeric = Number(value || 0);
  if (numeric > 0) {
    return "candidate ahead";
  }
  if (numeric < 0) {
    return "king ahead";
  }
  return "even score";
}

function readablePhase(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("screen")) {
    return "Screen gate";
  }
  if (normalized.includes("duel")) {
    return "Full duel";
  }
  if (normalized.includes("confirm")) {
    return "Confirming win";
  }
  if (normalized.includes("queued")) {
    return "Queued";
  }
  if (!normalized || normalized === "null") {
    return "Waiting";
  }
  return value;
}

function duelOutcomeMessage(state) {
  if (state.live) {
    const invalidCandidate = Number(state.invalidRuns?.candidate || 0);
    if (invalidCandidate > 0) {
      return "Candidate has an invalid run. The validator should stop this duel and close the PR as invalid.";
    }
    const delta = Number(state.scores?.delta || 0);
    if (delta > 0) {
      return "Candidate is currently ahead. Final promotion still depends on all selected codebases finishing cleanly.";
    }
    if (delta < 0) {
      return "King is currently ahead. Candidate needs more passed codebases or true positives to recover.";
    }
    return "Duel is running. Early numbers can change until all replicas finish.";
  }
  if (state.finalWinner === "candidate") {
    return "Candidate beat the king and is ready for promotion.";
  }
  if (state.finalWinner === "king") {
    return "King held the lane. The candidate did not beat the promotion gate.";
  }
  return "Waiting for enough results to decide the duel.";
}

function formatSignedPoints(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${formatNumber(numeric * 100)} pts`;
}

function formatTaskName(value) {
  const raw = String(value || "hidden task");
  return raw
    .replace(/^(code4rena|sherlock|cantina)_/, "")
    .replace(/_\d{4}_\d{2}$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function taskStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("invalid")) {
    return "bad";
  }
  if (normalized.includes("candidate ahead") || normalized.includes("both solved")) {
    return "ok";
  }
  if (normalized.includes("running")) {
    return "active";
  }
  return "neutral";
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
