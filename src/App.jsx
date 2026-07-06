import { useEffect, useMemo, useState } from "react";
import GridBackground from "./GridBackground.jsx";

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
            onNavigate={navigate}
          />
        ) : null}
        {payload && (pathname === "/arena" || pathname === "/live") ? (
          <Arena
            lanes={lanes}
            selectedLane={selectedLane}
            laneActivity={laneActivity}
            validator={payload.validator}
            round={payload.round}
            roundHistory={payload.roundHistory}
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
  const latestStatus = buildDashboardLatestStatus(activeEvaluation, latestChallenge);
  const topMiner = payload.leaderboard?.rows?.[0] || null;

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Kata · Gittensor SN74 supported</p>
          <h1 className="hero-title">
            <span>Kata is the</span>{" "}
            <span className="hero-title-mark">objective competition engine</span>{" "}
            <span>for subnet agents.</span>
          </h1>
          <p>
            Miners submit one candidate agent by pull request. Kata screens it
            cheaply, then scores it against the current king in scheduled competition
            rounds on the active subnet benchmark, and promotes only objective winners
            to the public king lane. SN60 Bitsec is the first live lane.
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
          <TerminalLine label="engine" value="Gittensor SN74 · SN60 Bitsec" />
          <TerminalLine label="live subnet" value={selectedLane?.repoName || "SN60 Bitsec"} />
          <TerminalLine label="reigning king" value={selectedLane?.currentHolder || "seed king"} />
          <TerminalLine label="eval set" value={`${overview.selectedCodebases ?? overview.benchmarkProjects ?? 0} sampled codebases`} />
          <TerminalLine label="gittensor" value={`${formatNumber(overview.totalGittensorScore || 0)} winner score`} />
          <TerminalLine label="goal" value="one-click mining" />
        </div>
      </section>

      <section className="stat-row">
        <Stat
          label="live subnets"
          value={overview.activeSubnetPacks ?? overview.activeRepoPacks}
          sub="active Kata lanes connected to this board"
        />
        <Stat
          label="eval codebases"
          value={overview.selectedCodebases ?? overview.benchmarkProjects ?? 0}
          sub="sampled SN60 projects in the current lane"
        />
        <Stat
          label="challengers"
          value={overview.uniqueChallengers ?? overview.leaderboardEntries ?? 0}
          sub={`${overview.totalSubmissions ?? 0} submission PRs seen`}
        />
        <Stat
          label="recent rounds"
          value={overview.recentDuels ?? overview.recentChallenges ?? 0}
          sub="visible completed run artifacts"
        />
        <Stat
          label="winner score"
          value={formatNumber(overview.totalGittensorScore || 0)}
          sub="merged winner score after local time decay"
        />
      </section>

      <section className="section-block how-block">
        <SectionTitle title="How it works" />
        <div className="how-row">
          <HowStep step="01" title="Submit" text="Open one pull request that adds a single agent under submissions/. It is screened and labeled pending." />
          <HowStep step="02" title="Compete" text="In each scheduled round, every pending agent is scored against the current king on the same sampled problems." />
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
          <KeyValue label="challenger" value={latestStatus.challenger} />
          <KeyValue label="status" value={latestStatus.status} />
          <KeyValue label="source" value={latestStatus.source} />
          <KeyValue label="top miner" value={topMiner?.author || "not ranked yet"} />
          <KeyValue label="updated" value={formatDateTime(latestStatus.updatedAt || payload.generatedAt)} />
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

const ROUND_STATE_BANNER = {
  idle: {
    label: "idle",
    tone: "neutral",
    text: "Waiting for the maintainer to start the next round."
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

function RoundPanel({ round, kataRepoSlug }) {
  const entrants = round?.entrants || [];
  const state = round?.state || "idle";
  const hasRound = Boolean(round && (state !== "idle" || entrants.length || round.runId));

  return (
    <div className="round-block">
      <div className="round-block-head">
        <SectionTitle title="Current round" />
        <p className="section-lead">
          A round locks every open candidate pull request and scores each one against the
          reigning king on the same secret-sampled Bitsec problems. The maintainer starts
          each round; only a candidate that strictly beats the king is promoted.
        </p>
      </div>

      {!hasRound ? (
        <div className="round-empty">
          <Status label="no round running" tone="neutral" />
          <p>
            No competition round has run yet. When the maintainer starts one, every candidate
            appears here with its live detection score, true-positive count, and result.
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
              {round.king ? (
                <RoundMeta label="king detection" value={formatDetection(round.king.aggregated_score)} />
              ) : null}
              <RoundMeta label="candidates" value={entrants.length} />
              {round.runId ? <RoundMeta label="round id" value={round.runId} /> : null}
            </div>
          </div>

          {round.winnerSubmissionId ? (
            <div className="round-verdict round-verdict-win">
              <span className="round-verdict-crown" aria-hidden="true">♔</span>
              <div>
                <strong>New king: {round.winnerSubmissionId}</strong>
                <p>Beat the king this round and is being promoted.</p>
              </div>
            </div>
          ) : state === "completed" ? (
            <div className="round-verdict round-verdict-hold">
              <span className="round-verdict-crown" aria-hidden="true">♔</span>
              <div>
                <strong>King held the crown</strong>
                <p>No candidate strictly beat the king this round.</p>
              </div>
            </div>
          ) : null}

          <div className="table-head round-grid">
            <span>PR</span>
            <span>entrant</span>
            <span>detection</span>
            <span>true positives</span>
            <span>beats king</span>
            <span>status</span>
          </div>

          {round.king ? (
            <div className="table-row round-grid round-row-king">
              <span aria-hidden="true">♔</span>
              <span>current king</span>
              <span>{formatDetection(round.king.aggregated_score)}</span>
              <span>{round.king.true_positives ?? "—"}</span>
              <span>—</span>
              <span><span className="rstat rstat-king">king</span></span>
            </div>
          ) : null}

          {entrants.length ? (
            entrants.map((entrant) => (
              <div className="table-row round-grid" key={entrant.pull_number}>
                <span>{prLabel(kataRepoSlug, entrant.pull_number)}</span>
                <span>{entrant.submission_id}</span>
                <span>{formatDetection(entrant.aggregated_score)}</span>
                <span>{entrant.true_positives ?? "—"}</span>
                <span><BeatsKingBadge beats={entrant.beats_king} /></span>
                <span><RoundStatusPill status={entrant.status} /></span>
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

function RoundMeta({ label, value }) {
  return (
    <div className="round-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
            <span>{round.headline || `Round ${round.runId || ""}`}</span>
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
  laneActivity,
  validator,
  round,
  roundHistory,
  kataRepoSlug,
  setSelectedLaneId
}) {
  const latest = laneActivity[0] || null;
  const activeEvaluation = laneActiveEvaluation(validator?.activeEvaluation, selectedLane);
  const activeJob = validator?.queue?.activeJob || null;
  const displayJob = activeJob || (activeEvaluation?.available ? validator?.queue?.latestJob || null : null);
  const current = selectedLane?.evaluatorState?.current || null;
  const displayState = mergeActiveEvaluationState(current, activeEvaluation, selectedLane);
  // The 1v1 view only makes sense while a round winner is actually being
  // re-verified and merged; otherwise the round table above tells the story.
  const promotionLive = Boolean(activeJob) || Boolean(activeEvaluation?.available);
  const updatedLabel = formatDateTime(activeEvaluation?.updatedAt || latest?.createdAt);

  return (
    <div className="stack">
      {lanes.length > 1 ? (
        <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />
      ) : null}

      <RoundPanel round={round} kataRepoSlug={kataRepoSlug} />

      {promotionLive && displayState ? (
        <div className="round-block">
          <div className="round-block-head">
            <SectionTitle title="Winner promotion" />
            <p className="section-lead">
              The round winner is re-verified against the king one final time, then merged and
              published as the new king. This runs automatically after a round selects a winner.
            </p>
          </div>
          <section className="arena-hero">
            <div className="arena-topline">
              <div className="arena-hero-status">
                <Status label="promoting" tone="ok" />
                <span>{selectedLane?.repoName || "SN60 Bitsec"}</span>
                {displayJob?.pullNumber ? <span>PR #{displayJob.pullNumber}</span> : null}
                <span>updated {updatedLabel}</span>
              </div>
            </div>
            <Battle
              state={displayState}
              activeEvaluation={activeEvaluation}
              activeJob={displayJob}
              selectedLane={selectedLane}
              kataRepoSlug={kataRepoSlug}
            />
          </section>
          <Sn60LanePanel state={displayState} activeEvaluation={activeEvaluation} activeJob={displayJob} />
        </div>
      ) : null}

      <RoundHistory rounds={roundHistory} />
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
        <small>detection score</small>
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
  const screeningFailed = state.screeningStatus === "failed";
  const showProblemList = shouldShowProblemList(state, activeEvaluation);
  const result = screeningFailed
    ? "Screening failed"
    : state.live
      ? state.screeningStatus === "running"
        ? "Screening"
        : "Duel running"
      : winner === "candidate"
        ? "Challenger wins"
        : winner === "king"
          ? "King holds"
          : "In progress";
  return (
    <section className="lane-card">
      <div className="lane-card-head">
        <div>
          <p className="kicker">SN60 · Bitsec security</p>
          <h2>{state.live ? "Live validator run" : "Latest validator result"}</h2>
        </div>
        <Status
          label={result}
          tone={screeningFailed ? "bad" : winner === "candidate" ? "ok" : winner === "king" ? "neutral" : "neutral"}
        />
      </div>

      <LatestDuelResult state={state} activeEvaluation={activeEvaluation} />

      {showProblemList ? <LiveTaskProgress state={state} /> : null}
    </section>
  );
}

function shouldShowProblemList(state, activeEvaluation) {
  if (state.screeningStatus === "running" || state.screeningStatus === "failed") {
    return false;
  }
  const tasks = Array.isArray(state.liveProgress?.taskStatuses)
    ? state.liveProgress.taskStatuses
    : [];
  if (!tasks.length) {
    return false;
  }
  const phase = String(activeEvaluation?.phase || state.liveProgress?.phase || "").toLowerCase();
  if (phase.includes("duel")) {
    return true;
  }
  return tasks.length > 1 || tasks.some((task) => task.king?.started || task.king?.finished);
}

function LatestDuelResult({ state, activeEvaluation }) {
  const taskProgress = taskCompletion(state);
  const winner = state.finalWinner;
  const progress = taskProgress.total > 0 ? taskProgress.completed / taskProgress.total : 0;
  const invalidCandidate = Number(state.invalidRuns?.candidate || 0);
  const resultLabel =
    state.screeningStatus === "failed"
      ? "Screen gate failed"
      : state.live
        ? readablePhase(activeEvaluation?.phase || state.liveProgress?.phase || "running")
        : winner === "candidate"
          ? "Candidate won"
          : winner === "king"
            ? "King held"
            : "No decision yet";
  const scoreDelta = state.scores?.delta;
  const deltaTone = Number(scoreDelta || 0) > 0 ? "positive" : Number(scoreDelta || 0) < 0 ? "negative" : "neutral";
  return (
    <div className="duel-result-card">
      <div className="duel-command-top">
        <div className="duel-verdict">
          <span>current state</span>
          <strong>{resultLabel}</strong>
          <p>{duelOutcomeMessage(state)}</p>
        </div>
        <div className={`duel-gap duel-gap-${deltaTone}`}>
          <span>candidate gap</span>
          <strong>{formatSignedPoints(scoreDelta)}</strong>
          <small>candidate minus king</small>
        </div>
      </div>

      <div className="duel-snapshot">
        <div className="duel-progress-chip">
          <div>
            <span>codebases</span>
            <strong>{taskProgress.completed}/{taskProgress.total}</strong>
          </div>
          <div className="duel-progress-line" aria-hidden="true">
            <i style={{ width: `${clampPercent(progress * 100)}%` }} />
          </div>
        </div>
        <MetricChip
          label="candidate matched / reported"
          value={`${formatNumber(state.truePositives?.candidate)} / ${formatNumber(state.totalFound?.candidate)}`}
        />
        <MetricChip
          label="king matched / reported"
          value={`${formatNumber(state.truePositives?.king)} / ${formatNumber(state.totalFound?.king)}`}
        />
        <MetricChip
          label="invalid"
          value={`C ${formatNumber(invalidCandidate)} · K ${formatNumber(state.invalidRuns?.king || 0)}`}
          tone={invalidCandidate > 0 ? "bad" : "ok"}
        />
      </div>

      <div className="duel-main-grid">
        <div className="duel-compare-panel">
          <div className="duel-panel-head">
            <span>candidate vs king</span>
            <div className="comparison-legend">
              <small><i className="legend-candidate" />Candidate</small>
              <small><i className="legend-king" />King</small>
            </div>
          </div>
          <ComparisonBar
            label="detection"
            candidate={state.scores?.candidate}
            king={state.scores?.king}
          />
          <ComparisonBar
            label="precision"
            candidate={state.precision?.candidate}
            king={state.precision?.king}
          />
          <ComparisonBar
            label="f1 score"
            candidate={state.f1Scores?.candidate}
            king={state.f1Scores?.king}
          />
        </div>

        <div className="duel-next-panel">
          <span>what matters now</span>
          <strong>{decisionCue(state)}</strong>
          <p>
            {formatNumber(
              Math.max(
                Number(state.totalExpected?.candidate || 0),
                Number(state.totalExpected?.king || 0)
              )
            )}{" "}
            known vulnerabilities to find across the {taskProgress.completed} scored
            problem{taskProgress.completed === 1 ? "" : "s"} so far.
          </p>
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

function decisionCue(state) {
  if (state.screeningStatus === "failed") {
    return "Fix the screen gate first.";
  }
  if (Number(state.invalidRuns?.candidate || 0) > 0) {
    return "Candidate has an invalid run.";
  }
  if (state.live) {
    const delta = Number(state.scores?.delta || 0);
    if (delta > 0) {
      return "Candidate is ahead right now.";
    }
    if (delta < 0) {
      return "King is ahead right now.";
    }
    return "Duel is still even.";
  }
  if (state.finalWinner === "candidate") {
    return "Candidate is promotion-ready.";
  }
  if (state.finalWinner === "king") {
    return "King kept the crown.";
  }
  return "Waiting for validator results.";
}

function LiveTaskProgress({ state }) {
  const tasks = Array.isArray(state.liveProgress?.taskStatuses)
    ? state.liveProgress.taskStatuses
    : [];
  if (!tasks.length) {
    return null;
  }
  // Always show every sampled problem in a stable order; the duel evaluates all
  // of them (it never early-stops), so we only update each row's status as it
  // finishes rather than hiding the ones that are still queued or running.
  const visibleTasks = [...tasks].sort((left, right) =>
    String(left?.taskId || "").localeCompare(String(right?.taskId || ""))
  );
  const totalTasks = state.liveProgress?.totalTasks ?? tasks.length;
  const completedTasks =
    state.liveProgress?.completedTasks ?? tasks.filter((task) => task.completed).length;
  const candidateReplicas = state.replicaProgress?.candidate || {};
  const kingReplicas = state.replicaProgress?.king || {};

  return (
    <div className="live-task-progress">
      <div className="live-task-progress-head">
        <div>
          <span>codebase progress</span>
          <strong>
            {completedTasks}/{totalTasks} complete
          </strong>
          <small>
            Each row is one selected benchmark codebase. Pass means verified findings matched the benchmark.
          </small>
        </div>
        <div>
          <span>replicas</span>
          <strong>
            C {formatReplicaSide(candidateReplicas)} · K {formatReplicaSide(kingReplicas)}
          </strong>
        </div>
      </div>
      <div className="live-task-table-head" aria-hidden="true">
        <span>problem</span>
        <span>state</span>
        <span>candidate</span>
        <span>king</span>
      </div>
      <div className="live-task-list">
        {visibleTasks.map((task) => (
          <LiveTaskRow key={task.taskId || task.status} task={task} />
        ))}
      </div>
    </div>
  );
}

function LiveTaskRow({ task }) {
  const candidate = task.candidate || {};
  const king = task.king || {};
  const tone = taskStatusTone(task.status);
  return (
    <div className={`live-task-row live-task-row-${tone}`}>
      <div className="live-task-main">
        <div className="live-task-icon" aria-hidden="true">{taskStatusIcon(task.status)}</div>
        <div>
          <strong>{formatTaskName(task.taskId || "hidden task")}</strong>
          <span>{task.taskId || "hidden task"}</span>
        </div>
      </div>
      <Status label={formatTaskStatus(task.status)} tone={tone} />
      <AgentTaskCell label="candidate" variant={candidate} />
      <AgentTaskCell label="king" variant={king} />
    </div>
  );
}

function AgentTaskCell({ label, variant }) {
  return (
    <div className={`live-task-side live-task-side-${variantTone(variant)}`}>
      <span>{label}</span>
      <strong>{variantResultLabel(variant)}</strong>
      <small>{formatVariantReplicas(variant)}</small>
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
        text="Track miners, crowned kings, submissions, and the current ranking across Kata challenges."
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
    { id: "overview", label: "Overview" },
    { id: "miner", label: "For Miners" },
    { id: "validator", label: "For Validators" },
    { id: "scoring", label: "Scoring" },
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
      <p className="kicker">Newcomer Guide</p>
      <h1>How Kata competition works</h1>
      <p>
        Kata is a <strong>subnet-agnostic</strong>, competition-based way to build
        the best mining agent for a Bittensor subnet. Contributors do not submit
        ordinary code fixes — they submit one autonomous agent. Scoring runs in{" "}
        <strong>scheduled rounds</strong>: each round scores every pending agent against the
        current <strong>king</strong> in the same pinned sandbox, on the same
        secretly-sampled benchmark problems, under the same validator checks, and the best
        one that beats the king becomes the new king. One subnet is live today:{" "}
        <strong>SN60 / Bitsec</strong>, where agents hunt critical- and high-severity
        smart-contract vulnerabilities. More competition targets will be added over time.
      </p>
      <DocCallout
        title="⚡ Built with Gittensor (Bittensor Subnet 74)"
        text="Kata's development is powered by Gittensor, the open-source-software subnet on Bittensor (SN74). This repository is registered on Gittensor, which coordinates and rewards the contributors who build and improve it. You don't need to use Bittensor or Discord to take part — but that's where the work comes from and how contributors get credit."
      />
      <DocCallout
        title="Two subnets — keep them straight"
        text="SN74 / Gittensor funds and coordinates development of THIS repository. SN60 / Bitsec is the competition TARGET — the subnet Kata currently builds an agent for. The framework is subnet-agnostic; SN60 is simply the first live lane."
      />
      <DocCallout
        title="If you are new, start here"
        text="Think of Kata as a live tournament for mining-agent strategies. Your PR contains the agent. The validator runs it against the benchmark. If it strictly beats the current king, your agent is merged and becomes the new king — agent quality becomes a merge decision, not a review opinion."
      />
      <DocCallout
        title="Mental model"
        text="Each subnet pack has one current king. A candidate PR wins only if its agent strictly beats that king on the pack's scoring rules — for SN60: detection score, then true positives, precision, F1, and fewer invalid/error evaluations."
      />
      <DocGrid>
        <DocCard title="Kata" text="Public miner-facing repo. Holds submissions, current kings, evaluator commands, and promotion logic." />
        <DocCard title="Pack registry" text="Central registry of subnet packs. Each pack pins its own benchmark snapshot, scoring rules, and current king." />
        <DocCard title="Bitsec sandbox" text="Pinned SN60 evaluation mirror. Agents run in Docker against selected projects from the pinned benchmark snapshot." />
        <DocCard title="kata-bot" text="GitHub automation. Intakes PRs (screen + label kata:pending), runs competition rounds that score all pending agents against the king, and merges + promotes the winner." />
      </DocGrid>
      <div className="doc-metrics">
        <KeyValue label="current lane" value={selectedLane?.repoName || "not configured"} />
        <KeyValue label="subnet pack" value={selectedLane?.subnetPack || selectedLane?.repoPack || "-"} />
        <KeyValue label="mode" value={selectedLane?.mode || "-"} />
        <KeyValue label="duel format" value={selectedLane ? duelFormat(selectedLane) : "SN60 sampled validation"} />
        <KeyValue label="promotion gate" value={selectedLane ? promotionGate(selectedLane) : "detection, true positives, precision"} />
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
      <p className="kicker">For Miners</p>
      <h1>Compete: submit one agent, beat the king</h1>
      <p>
        You never edit engine code. You add exactly one agent bundle under{" "}
        <code>submissions/</code> and open a pull request. Scoring happens in{" "}
        <strong>scheduled rounds</strong>: your PR is screened and marked{" "}
        <code>kata:pending</code>, then each round scores every pending agent against the
        current king on the same secretly-sampled SN60 / Bitsec problems. The best agent
        that out-detects the king is merged and becomes the new king. You compete purely on
        detection quality — one open PR per contributor.
      </p>

      <h2>// the miner lifecycle</h2>
      <DocSteps
        items={[
          ["Create a branch", "Work in the public Kata repo on a normal branch. You only ever touch submissions/."],
          ["Add one bundle", "Add exactly one directory: submissions/sn60__bitsec/miner/<id>/ with agent.py, agent_manifest.json, and submission.json. You may have only one open PR at a time."],
          ["Validate locally", "Run `kata submission validate` to catch shape and contract errors before you open the PR."],
          ["Open the PR", "Target the default competition branch and touch only your one submission directory."],
          ["Intake → pending", "On open/push, kata-bot screens your PR and labels it kata:pending — it now waits for the next round. A push to a benched kata:stale PR re-enters it. No scoring happens yet."],
          ["Round: screen & execute", "When a round runs, it locks the pending PRs, keeps one per contributor, re-screens your locked commit, and labels it kata:executing while it competes."],
          ["Round: score", "Your agent and the king are scored on the same sampled Bitsec projects. Scoring is resilient: a bad, empty, or slow problem is just a 0 for that problem, never a rejection. The king is cached, so it isn't re-run for every candidate."],
          ["Decide & promote", "The top candidate that strictly out-detects the king is merged and becomes the new king. Beat the king but not the top? You stay open (kata:pending) for next round. Didn't beat it? Closed kata:losing."]
        ]}
      />

      <h2>1. Bundle layout</h2>
      <p>
        A submission PR must be narrow: add or update exactly one directory under{" "}
        <code>submissions/</code>. Do not edit lane state, king files, validator
        code, workflows, or unrelated docs.
      </p>
      <CodeBlock value={`submissions/sn60__bitsec/miner/<github-user>-YYYYMMDD-01/\n  agent.py             # your entrypoint\n  agent_manifest.json  # runtime contract\n  submission.json      # which pack/mode you compete in`} />
      <CodeBlock value={`{\n  "schema_version": 2,\n  "subnet_pack": "sn60__bitsec",\n  "mode": "miner",\n  "submission_id": "<github-user>-YYYYMMDD-01",\n  "created_at": "2026-07-01T00:00:00+00:00",\n  "author": "<github-user>",\n  "title": "short title",\n  "notes": "what changed in the agent"\n}`} />

      <h2>2. Your agent (agent.py)</h2>
      <p>
        Expose one synchronous function. The validator owns the sandbox, the
        pinned benchmark snapshot, replica counts, timeouts, and scoring. You
        compete on vulnerability-hunting behavior: prompting, context selection,
        and robustness.
      </p>
      <CodeBlock value={`def agent_main(\n    project_dir: str | None = None,\n    inference_api: str | None = None,\n) -> dict:\n    return {\n        "vulnerabilities": [\n            # Bitsec-compatible findings for the target project\n        ]\n    }`} />
      <DocGrid>
        <DocCard title="project_dir" text="The target smart-contract project checkout mounted inside the sandbox container." />
        <DocCard title="inference_api" text="The sandbox inference endpoint. Authenticate with the INFERENCE_API_KEY env var injected for your run." />
        <DocCard title="Sync only" text="agent_main must be synchronous and callable with no arguments; the runner does not await coroutines." />
        <DocCard title="Self-contained" text="SN60 V1 bundles must stay self-contained in agent.py. Helper modules and symlinks are rejected." />
      </DocGrid>

      <h2>3. Talking to the model</h2>
      <DocCallout
        title="The model is pinned — qwen3.6"
        text="Every agent, king and candidate alike, is forced onto the same pinned model — qwen3.6 (qwen/qwen3.6-35b-a3b) — through the validator relay and proxy, so you compete on strategy, not on private API access or a bigger budget. Do not send a `model` field or sampling knobs (temperature, top_p, seed); they are stripped. qwen3.6 is a reasoning model, so the validator raises your max_tokens to a safe ceiling automatically — you do not need a large value. Read the final answer from choices[0].message.content."
      />
      <CodeBlock value={`import json, os, urllib.request\n\ndef ask_model(inference_api, prompt):\n    endpoint = (inference_api or os.environ.get("INFERENCE_API") or "").rstrip("/")\n    body = json.dumps({\n        "messages": [{"role": "user", "content": prompt}],\n        "max_tokens": 4000,\n    }).encode()\n    req = urllib.request.Request(\n        endpoint + "/inference",\n        data=body, method="POST",\n        headers={\n            "Content-Type": "application/json",\n            "x-inference-api-key": os.environ["INFERENCE_API_KEY"],\n        },\n    )\n    with urllib.request.urlopen(req, timeout=120) as r:\n        data = json.loads(r.read().decode())\n    return data["choices"][0]["message"]["content"]`} />

      <h2>4. What closes a PR — and what does not</h2>
      <DocCallout
        title="Only two ways a PR ends without merging"
        text="1) Static screening fails (a cheating or no-op agent, or a second open PR from you) — closed early with a clear reason and no scoring cost. 2) A round scores your agent and it does not out-detect the king (kata:losing). A bad, empty, slow, or unparsable result on a single problem is never a rejection — it just scores 0 for that problem and scoring continues. If you beat the king but weren't the top challenger, your PR stays open (kata:pending) for the next round."
      />
      <RequirementList
        title="Validation rules"
        items={[
          "agent.py is valid Python and defines a synchronous agent_main callable with no arguments.",
          "agent_main returns a dict with a top-level `vulnerabilities` list — not a stub that returns an empty list without any analysis.",
          "agent_manifest.json uses schema_version 1, runtime python, entrypoint agent.py.",
          "submission.json uses schema_version 2, subnet_pack sn60__bitsec, mode miner, and a unique submission_id.",
          "The PR targets the default branch and touches exactly one submission directory."
        ]}
      />
      <RequirementList
        title="Red lines (rejected at static screening)"
        items={[
          "No validator scoring secrets such as CHUTES_API_KEY or KATA_VALIDATOR_API_KEY.",
          "No hardcoded provider endpoints, API keys, or secret tokens (sk-..., ghp_..., cpk_...).",
          "No model or sampling overrides (model, temperature, top_p, seed); the validator pins and strips them.",
          "No benchmark answers or dataset leakage tokens (expected_findings, ground_truth, scabench, curated-highs-only).",
          "No helper files or symlinks; SN60 V1 bundles must be self-contained in agent.py.",
          "No exact copy of the current king bundle."
        ]}
      />
      <DocLinks links={[["Full submission contract", links.submissions], ["End-to-end workflow", links.systemWorkflow]]} />
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
        pinned Bitsec benchmark snapshot. Kata uses the SN60 scorer's detection
        metrics: true positives, precision, F1, and invalid/error evaluations.
      </p>
      <DocGrid>
        <DocCard title="Benchmark" text={`${projectCount} selected SN60 project${projectCount === 1 ? "" : "s"} from the pinned snapshot.`} />
        <DocCard title="Detection score" text="True positives divided by expected benchmark vulnerabilities." />
        <DocCard title="Precision" text="True positives divided by all reported findings; noisy reports lower it." />
        <DocCard title="Promotion order" text="Detection score, true positives, precision, F1, then fewer invalid/error evaluations." />
      </DocGrid>
      <DocGrid>
        <DocCard title="True positive" text="An expected benchmark vulnerability that the scorer matched to one of the agent's findings." />
        <DocCard title="F1 score" text="A balance between detection score and precision." />
        <DocCard title="Invalid/error" text="A run or scorer result that did not complete successfully; it scores zero for that project." />
        <DocCard title="PASS project" text="The sandbox marks PASS only when the run finds every expected vulnerability for that project." />
      </DocGrid>
      <h2>Screening</h2>
      <p>
        Only <strong>static</strong> screening runs before scoring, and it is the
        only thing that can close a PR early. Cheap source-only checks reject
        no-op stub agents, helper files, leaked benchmark-answer hints, and secret
        references — no model calls, so no scoring cost is spent. There is no separate
        "screener run": each agent runs once per project when the round scores it,
        and an empty, unparsable, or slow result on a project simply scores 0 for
        that project instead of rejecting the PR. Findings are matched to the
        benchmark by the pinned <strong>ScaBenchScorerV2</strong> LLM judge (MiniMax) at a
        0.75 confidence threshold.
      </p>
      <CodeBlock value={`detection_score = total_true_positives / total_expected_vulnerabilities\n\npromote only if:\n  static screening passed\n  candidate strictly outranks king on:\n    detection score\n    true positives\n    precision\n    f1 score\n    fewer invalid/error evaluations`} />
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

function DocValidator({ links, selectedLane }) {
  const projectCount =
    selectedLane?.projects?.length ||
    selectedLane?.evaluatorState?.current?.projectKeys?.length ||
    0;
  return (
    <section>
      <p className="kicker">For Validators</p>
      <h1>How a submission is judged</h1>
      <p>
        Scoring runs in <strong>scheduled rounds</strong> (started with{" "}
        <code>kata-bot run-round-env</code>), not per PR. kata-bot is deliberately thin — it
        does not own scoring. On a PR event it only <strong>intakes</strong> (screens and
        labels the PR). When a round runs, it locks the pending PRs, gates and screens them,
        calls Kata to score them against the cached king, applies the outcome labels, and
        merges + promotes the winner. Kata does the validation, scoring, ranking, and
        promotion.
      </p>

      <h2>// the round pipeline</h2>
      <DocSteps
        items={[
          ["Intake (per PR)", "On open/push the webhook screens the PR and labels it kata:pending, or closes it kata:invalid. A push to a kata:stale PR flips it back to kata:pending. No scoring here."],
          ["Lock entrants", "The round snapshots the open PRs at their commits, keeps one per contributor (extras closed kata:invalid), and skips a PR only if its commit AND the king are unchanged since it last competed (kata:stale)."],
          ["Screen & execute", "Each entrant is re-screened on its locked commit; survivors are labeled kata:executing while the round runs."],
          ["Score vs cached king", "The king is scored once per problem and cached; every candidate is scored on the SAME secret-sampled set (one replica) in the pinned Bitsec sandbox. Scoring is resilient: one bad project never aborts the rest."],
          ["Rank & decide", "Candidates are ranked by the SN60 comparator; the top one that strictly beats the king wins. Others that beat it stay kata:pending; the rest close kata:losing."],
          ["Verify & promote", "Before merging, Kata re-checks the winner against the current king and benchmark; a stale or unmergeable winner is held (kata:hold). A verified winner is merged, published under kings/, and recorded in lane state."]
        ]}
      />

      <h2>Pinned model & isolation</h2>
      <p>
        Every agent — king and candidate — reaches the model only through the
        validator's own path, so the competition is fair and the cost is
        controlled.
      </p>
      <DocGrid>
        <DocCard title="Pinned model" text="qwen3.6 (qwen/qwen3.6-35b-a3b). The relay forces this exact model on every request so the king and every challenger are judged on identical footing." />
        <DocCard title="Relay" text="Strips any model / sampling knobs the agent sends and raises max_tokens to a safe ceiling so the reasoning model has room to think and answer." />
        <DocCard title="Proxy" text="Routes the pinned request to the provider and meters cost. It sits on a separate Docker network from the agents." />
        <DocCard title="Network isolation" text="Agents run on an internet-blocked network and can only reach the relay — they cannot bypass it to hit a provider or a different model directly." />
      </DocGrid>

      <h2>MVP sampling</h2>
      <p>
        To control cost, validators can score a secret-seeded subset instead of
        the full benchmark. The selected keys are recorded in the challenge
        summary and lane provenance for audit.
      </p>
      <CodeBlock value={`KATA_SN60_PROJECT_KEYS=            # explicit override; keep unset in prod\nKATA_SN60_PROJECT_SAMPLE_SIZE=6   # problems sampled per round\nKATA_SN60_PROJECT_SAMPLE_SECRET=<private-validator-secret>\nKATA_SN60_REPLICAS_PER_PROJECT=1`} />
      <p>
        Each round samples{" "}
        <strong>
          {projectCount ? `${projectCount} project${projectCount === 1 ? "" : "s"}` : "a secret-seeded subset"}
        </strong>
        ; every candidate faces the same set, and the king's per-project scores are cached
        across rounds so the king is not re-run each time.
      </p>

      <h2>Outcome labels</h2>
      <p>Each PR carries one color-coded label so its state is readable at a glance.</p>
      <DocGrid>
        <DocCard title="kata:pending (blue)" text="Screened and waiting for the next round." />
        <DocCard title="kata:executing (yellow)" text="Competing in the round running now." />
        <DocCard title="kata:winner:<pack> (green)" text="Beat the king → merged and promoted. Gittensor/SN74 rules recognize only this as a valid result." />
        <DocCard title="kata:losing (grey)" text="Competed but did not beat the king → closed." />
        <DocCard title="kata:invalid (red)" text="Failed screening, or an extra open PR beyond one-per-contributor → closed." />
        <DocCard title="kata:stale (orange)" text="Benched: unchanged since it last competed → push to re-enter." />
        <DocCard title="kata:hold (purple)" text="Won, but the merge is currently blocked → needs attention." />
        <DocCard title="Provenance" text="Every round records candidate/king hashes, selected keys, benchmark hash, sandbox commit, scorer version, and replica count." />
      </DocGrid>

      <DocCallout
        title="Operator rule: keep the bot thin"
        text="If a rule changes, change it in Kata first, then have the bot call the new Kata command or read the new Kata result. The bot applies outcomes; it never decides them."
      />
      <DocLinks links={[["End-to-end workflow", links.systemWorkflow], ["GitHub automation", links.githubAutomation]]} />
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
          ["current", "Round-based competition", "Scheduled rounds score all pending agents against a cached king; one open PR per contributor; a live current-round panel and a round-history highlights feed on the board."],
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
  const completed = activeEvaluation.state === "completed" || activeEvaluation.state === "failed";
  const activeScreening = !completed && activeEvaluation.phase === "sn60-screening";
  const completedScreeningFailed =
    completed &&
    (activeEvaluation.screeningStatus === "failed" ||
      String(activeEvaluation.finalReason || "").toLowerCase().includes("failed sn60 screening") ||
      String(activeEvaluation.finalReason || "").toLowerCase().includes("failed screening"));
  const screeningMetricFallback = completedScreeningFailed
    ? { king: 0, candidate: 0, delta: 0 }
    : null;
  return {
    ...(current || {}),
    live: !completed,
    candidateSubmissionId:
      activeEvaluation.candidateSubmissionId || current?.candidateSubmissionId || null,
    candidateAuthor:
      activeEvaluation.candidateAuthor ||
      activeEvaluation.candidateGithubLogin ||
      current?.candidateAuthor ||
      null,
    kingSubmissionId: current?.kingSubmissionId || lane?.king?.submissionId || null,
    kingAuthor: current?.kingAuthor || lane?.king?.author || lane?.currentHolder || null,
    screeningStatus: activeScreening
      ? "running"
      : activeEvaluation.screeningStatus || current?.screeningStatus || null,
    screeningStage: activeScreening
      ? "screening"
      : activeEvaluation.screeningStage || current?.screeningStage || null,
    screeningReasons: activeScreening
      ? []
      : activeEvaluation.screeningReasons?.length
        ? activeEvaluation.screeningReasons
        : current?.screeningReasons || [],
    screeningMeta: activeEvaluation.screening || current?.screeningMeta || null,
    projectKeys: primary.projectKeys?.length
      ? primary.projectKeys
      : activeEvaluation.projectKeys?.length
        ? activeEvaluation.projectKeys
        : current?.projectKeys || [],
    codebasesPassed: livePair(primary.passCounts, screeningMetricFallback || current?.codebasesPassed),
    truePositives: livePair(primary.truePositives, screeningMetricFallback || current?.truePositives),
    totalFound: livePair(primary.totalFound, screeningMetricFallback || current?.totalFound),
    totalExpected: livePair(primary.totalExpected, screeningMetricFallback || current?.totalExpected),
    precision: livePair(primary.precision, screeningMetricFallback || current?.precision),
    f1Scores: livePair(primary.f1Scores, screeningMetricFallback || current?.f1Scores),
    invalidRuns: livePair(primary.invalidRuns, completedScreeningFailed ? { king: 0, candidate: 1 } : current?.invalidRuns),
    scores: liveScores(primary.scores, screeningMetricFallback || current?.scores),
    replicaProgress: primary.replicaProgress || current?.replicaProgress || null,
    finalWinner: completed
      ? finalWinnerFromAction(activeEvaluation.finalAction, current?.finalWinner)
      : null,
    finalAction: activeEvaluation.finalAction || current?.finalAction || null,
    finalReason: activeEvaluation.finalReason || current?.finalReason || null,
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

function finalWinnerFromAction(finalAction, fallback = null) {
  if (finalAction === "merge") {
    return "candidate";
  }
  if (finalAction === "close-losing" || finalAction === "close-invalid") {
    return "king";
  }
  return fallback;
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
  return clampPercent(Number(value) * 100);
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
  return total > 0 ? `${completed}/${total} replicas` : "-";
}

function variantResultLabel(variant) {
  if (variant?.finished && !variant?.valid) {
    return "invalid run";
  }
  if (!variant?.finished) {
    return variant?.started ? "running" : "waiting";
  }
  return variant?.solved ? "verified" : "no verified finding";
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
  if (state.screeningStatus === "failed") {
    return screeningFailureMessage(state.screeningReasons?.[0]);
  }
  if (state.live) {
    if (state.screeningStatus === "running") {
      return "Screening is running one candidate-only check before the full duel.";
    }
    const invalidCandidate = Number(state.invalidRuns?.candidate || 0);
    if (invalidCandidate > 0) {
      return "Candidate has invalid/error evaluations. They score zero and hurt tie-breaks.";
    }
    const delta = Number(state.scores?.delta || 0);
    if (delta > 0) {
      return "Candidate is currently ahead. Final promotion still depends on all selected codebases finishing cleanly.";
    }
    if (delta < 0) {
      return "King is currently ahead. Candidate needs more true positives or better precision to recover.";
    }
    return "Duel is running. Early numbers can change until all selected projects finish.";
  }
  if (state.finalWinner === "candidate") {
    return "Candidate beat the king and is ready for promotion.";
  }
  if (state.finalWinner === "king") {
    return "King held the lane. The candidate did not beat the promotion gate.";
  }
  return "Waiting for enough results to decide the duel.";
}

function screeningFailureMessage(reason) {
  const text = String(reason || "").trim();
  const normalized = text.toLowerCase();
  if (!text) {
    return "Screening stopped this PR before the full duel.";
  }
  if (normalized.includes("at least one candidate vulnerability") || normalized.includes("empty reports")) {
    return "Screening stopped this PR because the agent returned no useful candidate vulnerability.";
  }
  return `Screening stopped this PR: ${text}`;
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
  if (
    normalized.includes("candidate ahead") ||
    normalized.includes("candidate leads") ||
    normalized.includes("both solved") ||
    normalized.includes("both verified")
  ) {
    return "ok";
  }
  if (normalized.includes("running")) {
    return "active";
  }
  return "neutral";
}

function formatTaskStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "both failed" || normalized === "no verified findings") {
    return "no verified finds";
  }
  if (normalized === "both solved" || normalized === "both verified") {
    return "both verified";
  }
  if (normalized === "candidate ahead" || normalized === "candidate leads") {
    return "candidate leads";
  }
  if (normalized === "king ahead" || normalized === "king leads") {
    return "king leads";
  }
  if (normalized === "candidate invalid") {
    return "candidate invalid";
  }
  if (normalized === "king invalid") {
    return "king invalid";
  }
  return status || "queued";
}

function taskStatusIcon(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("invalid")) {
    return "!";
  }
  if (normalized.includes("running")) {
    return "...";
  }
  if (normalized.includes("candidate") || normalized.includes("both verified") || normalized.includes("both solved")) {
    return "+";
  }
  if (normalized.includes("king")) {
    return "K";
  }
  if (normalized.includes("no verified") || normalized.includes("both failed")) {
    return "-";
  }
  return "•";
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
