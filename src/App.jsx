import { useEffect, useMemo, useState } from "react";
import GridBackground from "./GridBackground.jsx";
import heroImage from "../assets/hero.png";
import { PAGES, POLL_INTERVAL_MS } from "./constants.js";
import { readCurrentRoute, routeUrl, statusUrl, streamUrl } from "./lib/route.js";
import { Docs } from "./pages/Docs.jsx";
import {
  buildDashboardLatestStatus,
  compareEntrantsByRank,
  decisionWinner,
  entrantPassScore,
  formatDate,
  formatDateTime,
  formatDetection,
  formatMetricNumber,
  formatNumber,
  formatPackLabel,
  formatPassScore,
  formatSideTruePositives,
  sideLadderSignals,
  formatProjectName,
  formatProjectsPassed,
  formatReplicaFindings,
  formatTpExpectedFound,
  inferReplicasPerProject,
  kingAgentLink,
  nextScreeningEntry,
  normalizeReplicaRows,
  percentMetric,
  problemResult,
  projectPassThresholdLabel,
  projectReplicaPassLabel,
  rankBadge,
  replicaStatusLabel,
  replicaStatusTone,
  screeningFailureDetails,
  screeningHeadline,
  screeningStatusLabel,
  selectedProjectKeysFromChallenge,
} from "./lib/format.js";
import {
  Avatar,
  DiscordIcon,
  Empty,
  GitHubIcon,
  MetricChip,
  MinerIdentity,
  PageIntro,
  ProgressBar,
  ProofFact,
  Reveal,
  ScreeningCount,
  SectionTitle,
  StatTile,
  Status,
  SubnetMetric,
} from "./components/ui.jsx";

export default function App() {
  const [pathname, setPathname] = useState(readCurrentRoute);
  const [selectedLaneId, setSelectedLaneId] = useState(null);
  const [state, setState] = useState({
    loading: true,
    error: null,
    payload: null,
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
    let watchdogId = null;
    let receivedAny = false;
    // A proxy (ngrok/CDN) can leave an EventSource open but silently stop
    // delivering frames. The server pushes at least a keep-alive/data frame every
    // few seconds, so if we go this long with nothing the connection is a zombie
    // and we reconnect it — the dashboard self-heals without a manual refresh.
    const STREAM_STALE_MS = 15000;
    let lastFrameAt = Date.now();

    function applyPayload(payload) {
      if (cancelled) {
        return;
      }
      if (payload && payload.__error) {
        setState((current) => ({
          loading: false,
          error: payload.__error,
          payload: current.payload,
        }));
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

    function connectStream() {
      source = new EventSource(streamUrl());
      source.onmessage = (event) => {
        lastFrameAt = Date.now();
        receivedAny = true;
        try {
          applyPayload(JSON.parse(event.data));
        } catch {
          // ignore a malformed frame; the next one will refresh state
        }
      };
      // Named liveness event: keeps the freshness watchdog satisfied during idle
      // WITHOUT firing onmessage, so the rendered state is never disturbed.
      source.addEventListener("heartbeat", () => {
        lastFrameAt = Date.now();
        receivedAny = true;
      });
      source.onerror = () => {
        if (!receivedAny && source) {
          // Never got a frame: the stream is unusable here, fall back to polling.
          source.close();
          source = null;
          startPolling();
        }
        // otherwise let EventSource auto-reconnect (and the watchdog backstops it).
      };
    }

    // Prefer a live server-push stream; fall back to polling if EventSource is
    // unavailable or the stream never delivers a frame.
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        connectStream();
        // Backstop the browser's own reconnect: if a proxy silently wedges the
        // connection (open but no frames), force a fresh EventSource so live
        // updates resume on their own.
        watchdogId = window.setInterval(() => {
          if (cancelled || !source) {
            return;
          }
          if (Date.now() - lastFrameAt > STREAM_STALE_MS) {
            lastFrameAt = Date.now(); // reset so we reconnect at most once per window
            try {
              source.close();
            } catch {
              // already closing
            }
            connectStream();
          }
        }, 5000);
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
      if (watchdogId) {
        window.clearInterval(watchdogId);
      }
    };
  }, []);

  const payload = state.payload;
  // Memoize so `lanes` is a stable reference between fetches (a fresh `[]` each render would churn
  // the hooks below). selectedLaneId is only the user's explicit pick; selectedLane derives a
  // fallback, so no effect is needed to auto-select (which would setState during render).
  const lanes = useMemo(() => payload?.lanes ?? [], [payload]);

  const selectedLane = useMemo(
    () => lanes.find((lane) => lane.id === selectedLaneId) || lanes[0] || null,
    [lanes, selectedLaneId]
  );
  // The selected lane's competition fields (challenge / proof / leaderboard / activity). On a
  // single-lane board byLane[selectedLane.id] holds the same objects as the top-level payload, so
  // this is byte-identical; the `payload` fallback keeps a lane with no byLane entry rendering the
  // global data.
  const laneData = useMemo(
    () => (selectedLane && payload?.byLane?.[selectedLane.id]) || payload || {},
    [payload, selectedLane]
  );
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

        {payload?.dataNotice ? <DataNotice notice={payload.dataNotice} /> : null}

        {lanes.length > 1 ? (
          <LaneSelector lanes={lanes} selectedLane={selectedLane} onSelect={setSelectedLaneId} />
        ) : null}

        {state.error ? <div className="alert">{state.error}</div> : null}
        {!payload && state.loading ? <div className="empty-page">Loading board...</div> : null}

        {payload && pathname === "/" ? (
          <Dashboard
            payload={payload}
            lanes={lanes}
            selectedLane={selectedLane}
            validator={payload.validator}
            onNavigate={navigate}
            onSelectLane={setSelectedLaneId}
          />
        ) : null}
        {payload && (pathname === "/arena" || pathname === "/live") ? (
          <Arena
            selectedLane={selectedLane}
            challenge={laneData.challenge}
            challengeHistory={laneData.challengeHistory}
            kataRepoSlug={payload.publicLinks?.kataRepo}
          />
        ) : null}
        {payload && (pathname === "/winners" || pathname === "/champions") ? (
          <Winners
            lanes={lanes}
            kataRepoSlug={payload.publicLinks?.kataRepo}
            publicProof={laneData.publicProof}
          />
        ) : null}
        {payload && pathname === "/leaderboard" ? (
          <Leaderboard leaderboard={laneData.leaderboard} />
        ) : null}
        {payload && pathname === "/docs" ? (
          <Docs selectedLane={selectedLane} kataRepoSlug={payload.publicLinks?.kataRepo} />
        ) : null}
      </main>
      <Footer kataRepoSlug={payload?.publicLinks?.kataRepo} onNavigate={navigate} />
    </div>
  );
}

function DataNotice({ notice }) {
  if (!notice?.message) {
    return null;
  }
  return (
    <div className={`data-notice data-notice-${notice.level || "warning"}`} role="status">
      <span className="data-notice-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="data-notice-text">{notice.message}</span>
    </div>
  );
}

function Footer({ kataRepoSlug, onNavigate }) {
  const year = new Date().getFullYear();
  const repo = kataRepoSlug || "Autovara/kata";
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="site-footer-mark">Kata</span>
          <p>Open competition that builds the strongest miner agent for every subnet.</p>
          <span className="site-footer-tag">Built on Gittensor · Bittensor SN74</span>
        </div>
        <nav className="site-footer-nav" aria-label="Footer">
          <div className="site-footer-col">
            <h4>Explore</h4>
            <button type="button" onClick={() => onNavigate("/arena")}>
              Arena
            </button>
            <button type="button" onClick={() => onNavigate("/winners")}>
              Winners
            </button>
            <button type="button" onClick={() => onNavigate("/leaderboard")}>
              Leaderboard
            </button>
          </div>
          <div className="site-footer-col">
            <h4>Build</h4>
            <button type="button" onClick={() => onNavigate("/docs")}>
              Submit an agent
            </button>
            <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a
              href={`https://github.com/${repo}/blob/main/README.md`}
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
          </div>
        </nav>
      </div>
      <div className="site-footer-bottom">
        <span>© {year} Kata</span>
        <span>MIT licensed</span>
      </div>
    </footer>
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
          <Status
            label={error ? "error" : loading ? "syncing" : "live"}
            tone={error ? "bad" : "ok"}
          />
          <span>{formatDateTime(generatedAt)}</span>
        </div>
      </div>
    </header>
  );
}

function Dashboard({ payload, lanes, selectedLane, validator, onNavigate, onSelectLane }) {
  const activeEvaluation = validator?.activeEvaluation || null;
  const recentActivity = payload.activity || [];
  const latestChallenge = recentActivity[0] || null;
  const latestStatus = buildDashboardLatestStatus(activeEvaluation, latestChallenge);

  return (
    <div className="dashboard-page">
      <DashboardHero onNavigate={onNavigate} />

      <Reveal>
        <DashboardStats payload={payload} lanes={lanes} />
      </Reveal>

      <Reveal>
        <DashboardWorkflow />
      </Reveal>

      <Reveal>
        <DashboardSubnets
          payload={payload}
          lanes={lanes}
          selectedLane={selectedLane}
          onNavigate={onNavigate}
          onSelectLane={onSelectLane}
        />
      </Reveal>

      <Reveal>
        <DashboardOperations
          payload={payload}
          latestStatus={latestStatus}
          generatedAt={payload.generatedAt}
        />
      </Reveal>
    </div>
  );
}

function DashboardHero({ onNavigate }) {
  return (
    <section className="dash-hero">
      <div className="dash-hero-copy">
        <p className="kicker">Built with Gittensor · Bittensor SN74</p>
        <h1 className="dash-hero-title">
          <span>Kata is an</span> <span className="dash-hero-mark">optimization engine</span>{" "}
          <span>for miner agents</span>
        </h1>
        <p className="dash-hero-sub">
          Kata runs open competition to build stronger miner agents for Bittensor subnets, promotes
          the best proven agent as king, and moves mining toward a simple one-click experience.
        </p>
        <div className="dash-hero-actions">
          <button type="button" className="button primary" onClick={() => onNavigate("/arena")}>
            Watch the Arena
          </button>
          <button type="button" className="button" onClick={() => onNavigate("/docs")}>
            Submit an agent
          </button>
        </div>
      </div>
      <div className="dash-hero-visual">
        <img className="dash-hero-image" src={heroImage} alt="Kata competition arena" />
      </div>
    </section>
  );
}

function DashboardStats({ payload, lanes }) {
  const byLane = payload.byLane || {};
  const overview = payload.overview || {};
  const laneList = Array.isArray(lanes) ? lanes : [];
  const activeSubnets = overview.activeLanes ?? laneList.length;
  const challengesRun = laneList.reduce(
    (sum, lane) => sum + (byLane[lane.id]?.challengeHistory?.length || 0),
    0
  );
  const challengers = overview.uniqueChallengers ?? 0;
  const submissions = overview.totalSubmissions ?? 0;
  const live = laneList.some((lane) => byLane[lane.id]?.challenge?.state === "executing");
  return (
    <section className="dash-stats" aria-label="Network at a glance">
      <StatTile label="Active subnets" value={activeSubnets} live={live} />
      <StatTile label="Challenges run" value={challengesRun} />
      <StatTile label="Challengers" value={challengers} />
      <StatTile label="Agents submitted" value={submissions} />
    </section>
  );
}

function DashboardSubnets({ payload, lanes, selectedLane, onNavigate, onSelectLane }) {
  const byLane = payload.byLane || {};
  const laneList = Array.isArray(lanes) ? lanes : [];
  return (
    <section className="dash-subnets">
      <div className="dash-section-head">
        <span className="showcase-kicker">Subnets</span>
        <h2>One engine, every target.</h2>
        <p>
          Each subnet keeps its own king and runs its own continuous challenges. Pick one to watch
          it live.
        </p>
      </div>
      <div className="dash-subnet-grid">
        {laneList.map((lane) => (
          <SubnetCard
            key={lane.id}
            lane={lane}
            data={byLane[lane.id] || {}}
            active={selectedLane?.id === lane.id}
            onEnter={() => {
              onSelectLane?.(lane.id);
              onNavigate("/arena");
            }}
          />
        ))}
        <article className="subnet-card subnet-card-ghost">
          <div className="subnet-card-head">
            <div className="subnet-card-title">
              <h3>More targets</h3>
            </div>
          </div>
          <p className="subnet-ghost-text">
            The same engine, challenge ladder, and sealed room extend to new subnets as they come
            online.
          </p>
        </article>
      </div>
    </section>
  );
}

function SubnetCard({ lane, data, active, onEnter }) {
  const challenge = data.challenge || {};
  const live = challenge.state === "executing";
  const kingName = lane.king?.seeded ? "seed king" : lane.currentHolder || lane.king?.author || "—";
  const challenges = data.challengeHistory?.length ?? challenge.challengeNumber ?? "—";
  const challengers = data.leaderboard?.rows?.length ?? "—";
  return (
    <article
      className={`subnet-card${active ? " subnet-card-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onEnter}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEnter();
        }
      }}
    >
      <div className="subnet-card-head">
        <div className="subnet-card-title">
          <h3>{formatPackLabel(lane.subnetPack)}</h3>
          <span className="subnet-pack">{lane.subnetPack}</span>
        </div>
        <span className={`subnet-pill ${live ? "subnet-pill-live" : "subnet-pill-idle"}`}>
          {live ? "scoring" : "idle"}
        </span>
      </div>
      <div className="subnet-king">
        <span className="subnet-king-label">Current king</span>
        <strong>{kingName}</strong>
      </div>
      <div className="subnet-metrics">
        <SubnetMetric label="Challenges run" value={challenges} />
        <SubnetMetric label="Challengers" value={challengers} />
      </div>
      <span className="subnet-enter">Enter arena →</span>
    </article>
  );
}

function WorkflowTagNode({ node }) {
  const cx = node.x + node.w / 2;
  return (
    <g>
      <rect
        className={`wf-node${node.king ? " wf-node-king" : ""}${node.svc ? " wf-node-svc" : ""}`}
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx="12"
      />
      {node.king ? (
        <path
          className="wf-crown"
          d={`M ${cx - 19} ${node.y - 6} l 7 12 8 -14 8 14 7 -12 -3 20 -24 0 z`}
        />
      ) : null}
      {node.tag ? (
        <text className="wf-tag" x={node.x + 13} y={node.y + 17}>
          {node.tag}
        </text>
      ) : null}
      <text
        className="wf-title"
        x={cx}
        y={node.y + node.h / 2 + (node.tag ? 6 : -2)}
        textAnchor="middle"
      >
        {node.t}
      </text>
      {node.s ? (
        <text
          className="wf-sub"
          x={cx}
          y={node.y + node.h / 2 + (node.tag ? 24 : 16)}
          textAnchor="middle"
        >
          {node.s}
        </text>
      ) : null}
    </g>
  );
}

function DashboardWorkflow() {
  const spine = [
    { id: "c", x: 18, y: 76, w: 150, h: 74, t: "Contributor", s: "opens one PR" },
    { id: "in", x: 190, y: 76, w: 156, h: 74, t: "Intake", s: "screen → pending", tag: "kata-bot" },
    { id: "rd", x: 368, y: 76, w: 148, h: 74, t: "Challenge", s: "→ executing", tag: "kata-bot" },
    { id: "eng", x: 538, y: 76, w: 158, h: 74, t: "kata engine", s: "king vs challenger" },
    { id: "prm", x: 912, y: 76, w: 150, h: 74, t: "Promote", s: "merge → king", tag: "kata-bot" },
    { id: "king", x: 1082, y: 76, w: 140, h: 74, t: "New King", s: "→ kings/", king: true },
    { id: "board", x: 1082, y: 300, w: 140, h: 54, t: "kata-board", s: "shows it live", svc: true },
  ];
  const subnets = [
    { x: 538, y: 210, w: 158, h: 42, t: "SN60 · Bitsec" },
    { x: 538, y: 262, w: 158, h: 42, t: "SN22 · Desearch" },
    { x: 538, y: 314, w: 158, h: 42, t: "+ more targets" },
  ];
  const tee = {
    x: 726,
    y: 262,
    w: 158,
    h: 42,
    t: "kata-tee-runner",
    s: "sealed room · miner-paid",
  };
  const rank = { x: 914, y: 262, w: 148, h: 42, t: "beats king's average?" };
  const edges = [
    "M 168 113 L 190 113",
    "M 346 113 L 368 113",
    "M 516 113 L 538 113",
    "M 1062 113 L 1082 113",
    "M 617 150 C 590 178, 538 190, 538 231",
    "M 617 150 L 617 262",
    "M 617 150 C 590 215, 538 272, 538 335",
    "M 696 231 C 712 231, 712 283, 726 283",
    "M 696 283 L 726 283",
    "M 696 335 C 712 335, 712 283, 726 283",
    "M 884 283 L 914 283",
    "M 988 262 C 988 210, 987 176, 987 150",
    "M 1152 150 L 1152 300",
  ];
  return (
    <section className="dash-workflow">
      <div className="dash-section-head">
        <span className="showcase-kicker">How it works</span>
        <h2>One PR in, one verified king out.</h2>
        <p>
          A contributor opens a PR; kata-bot screens it and, one challenge at a time, has it fight
          the reigning king; the kata engine re-solves the king fresh on a secret sample inside a
          sealed room. A challenger that beats the king&apos;s running-average score by a clear
          margin is promoted — and the last four kings share the reward.
        </p>
      </div>
      <div className="wf-diagram">
        <svg
          viewBox="0 0 1240 380"
          role="img"
          aria-label="Kata workflow: a contributor opens a PR; kata-bot screens it at intake to pending, then runs one continuous challenge marking the challenger executing; the kata engine re-solves the king fresh and scores it against the single challenger across the SN60, SN22 and future subnets in parallel inside the kata-tee-runner sealed room with miner-paid inference; the ranking checks whether the challenger beats the king's running-average score by the margin; kata-bot promotes the winner to a new king in kings and kata-board shows it live. The new king becomes the bar to beat, and the last four kings share the reward."
        >
          <defs>
            <marker id="wfArrow" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" className="wf-arrowhead" />
            </marker>
          </defs>
          <rect className="wf-band" x="512" y="186" width="576" height="186" rx="16" />
          <text className="wf-band-label" x="536" y="366">
            SCORE EVERY SUBNET, IN PARALLEL
          </text>
          <path
            className="wf-loop"
            d="M 1152 76 C 1152 26, 442 26, 442 76"
            markerEnd="url(#wfArrow)"
          />
          <text className="wf-loop-label" x="797" y="20" textAnchor="middle">
            the new king becomes the next challenger&apos;s bar to beat
          </text>
          {edges.map((d, i) => (
            <path key={i} className="wf-edge" d={d} markerEnd="url(#wfArrow)" />
          ))}
          {subnets.map((node) => (
            <g key={node.t}>
              <rect
                className="wf-node wf-node-subnet"
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx="10"
              />
              <text
                className="wf-title wf-title-sm"
                x={node.x + node.w / 2}
                y={node.y + node.h / 2 + 5}
                textAnchor="middle"
              >
                {node.t}
              </text>
            </g>
          ))}
          <WorkflowTagNode node={tee} />
          <g>
            <rect
              className="wf-node wf-node-rank"
              x={rank.x}
              y={rank.y}
              width={rank.w}
              height={rank.h}
              rx="10"
            />
            <text
              className="wf-title wf-title-sm"
              x={rank.x + rank.w / 2}
              y={rank.y + rank.h / 2 + 5}
              textAnchor="middle"
            >
              {rank.t}
            </text>
          </g>
          {spine.map((node) => (
            <WorkflowTagNode key={node.id} node={node} />
          ))}
        </svg>
      </div>
    </section>
  );
}

function DashboardOperations({ payload, latestStatus, generatedAt }) {
  const counts = payload.submissionStatus?.counts || {};
  const outcomes = [
    { label: "Submitted", value: counts.total ?? 0, tone: "muted" },
    { label: "Promoted to king", value: counts.winner ?? 0, tone: "green" },
    { label: "Competed", value: counts.losing ?? 0, tone: "soft" },
    { label: "Screened out", value: counts.invalid ?? 0, tone: "red" },
  ];
  const queue = [
    { label: "Pending", value: counts.pending ?? 0 },
    { label: "In review", value: counts.review ?? 0 },
    { label: "Executing", value: counts.executing ?? 0 },
    { label: "On hold", value: counts.hold ?? 0 },
  ];
  return (
    <section className="dash-ops">
      <div className="dash-section-head">
        <span className="showcase-kicker">Live status</span>
        <h2>Competition activity.</h2>
      </div>
      <div className="dash-ops-grid">
        <div className="ops-card">
          <h3>Where submissions end up</h3>
          <ul className="ops-funnel">
            {outcomes.map((row) => (
              <li key={row.label} className={`ops-funnel-row ops-tone-${row.tone}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className="ops-card">
          <h3>In the queue right now</h3>
          <div className="ops-queue">
            {queue.map((item) => (
              <div key={item.label} className="ops-queue-item">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="ops-latest">
            <span className="ops-latest-label">Latest</span>
            <div className="ops-latest-body">
              <span>
                {latestStatus.challenger} · {latestStatus.status}
              </span>
              <span className="ops-latest-time">
                {formatDateTime(latestStatus.updatedAt || generatedAt)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChallengePanel({
  challenge,
  kataRepoSlug,
  kingAuthor,
  kingSubmissionId,
  selectedPull,
  setSelectedPull,
}) {
  const entrants = challenge?.entrants || [];
  const state = challenge?.state || "idle";
  // Show the challenge for every non-idle state, including "paused" — the last recorded
  // status must stay visible until a new challenge replaces it.
  const hasChallenge = Boolean(
    challenge && (state !== "idle" || entrants.length || challenge.runId)
  );
  const challengeTitle = challenge?.challengeNumber
    ? `Current challenge · Challenge ${challenge.challengeNumber}`
    : "Current challenge";
  const challengeKingAuthor = challenge?.kingAuthor || kingAuthor;
  const challengeKingSubmissionId = challenge?.kingSubmissionId || kingSubmissionId;
  const selectedEntrant = entrants.find((entrant) => entrant.pull_number === selectedPull) || null;
  // Live progress only while the challenge is actively scoring; ignore a stale
  // snapshot left over from a previous challenge.
  const live =
    state === "executing" && challenge?.liveProgress?.state === "executing"
      ? challenge.liveProgress
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
  const screeningByPull = {};
  (live?.screening?.entries || []).forEach((entry) => {
    if (entry?.pullNumber) {
      screeningByPull[entry.pullNumber] = entry;
    }
  });
  const showScreeningGate = Boolean(live?.screening) && live.screening.state !== "complete";

  // Per-PR result feed (published as each PR finishes, and after the challenge ends) —
  // used by the detail page so a finished PR keeps its full result. Not gated on
  // "executing", so it survives to the completed snapshot.
  const resultByPull = {};
  (challenge?.liveProgress?.candidates || []).forEach((candidate) => {
    const match = /^pr-(\d+)$/.exec(candidate.submission_id || "");
    if (match) {
      resultByPull[Number(match[1])] = candidate;
    }
  });
  const kingResult = challenge?.liveProgress?.king || challenge?.king || null;
  const projectKeys = selectedProjectKeysFromChallenge(challenge);
  const selectedProjectCount = projectKeys.length;
  const replicasPerProject = inferReplicasPerProject(challenge);
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
        total_found: result.total_found ?? entrant.total_found,
        total_expected: result.total_expected ?? entrant.total_expected,
        invalid_runs: result.invalid_runs ?? entrant.invalid_runs,
        beats_king: result.beats_king ?? entrant.beats_king,
        codebase_pass_count: result.codebase_pass_count ?? entrant.codebase_pass_count,
        projects: result.projects ?? entrant.projects,
        screening_result: result.screening_result ?? entrant.screening_result,
        status: result.state === "failed" ? "invalid" : entrant.status,
      };
    })
    .sort((left, right) => compareEntrantsByRank(left, right, selectedProjectCount));

  // Clicking a row opens a full-width duel page (not a modal), matching the
  // original arena duel layout.
  if (hasChallenge && selectedPull === "king") {
    return (
      <KingDetail
        king={kingResult}
        progress={challenge?.liveProgress?.king || null}
        kingAuthor={challengeKingAuthor}
        kingSubmissionId={challengeKingSubmissionId}
        projectKeys={projectKeys}
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold}
        onBack={() => setSelectedPull(null)}
      />
    );
  }
  if (hasChallenge && selectedEntrant) {
    const result = resultByPull[selectedEntrant.pull_number] || null;
    const candidate = {
      ...selectedEntrant,
      ...(result
        ? {
            // Fall back to the entrant's own values for every field: a live result
            // can exist before these metrics are computed, and overwriting with
            // undefined would blank the per-problem breakdown and precision/F1 for
            // an entrant that already carried them (see the ranked-table merge).
            aggregated_score: result.aggregated_score ?? selectedEntrant.aggregated_score,
            true_positives: result.true_positives ?? selectedEntrant.true_positives,
            precision: result.precision ?? selectedEntrant.precision,
            f1_score: result.f1_score ?? selectedEntrant.f1_score,
            total_found: result.total_found ?? selectedEntrant.total_found,
            total_expected: result.total_expected ?? selectedEntrant.total_expected,
            invalid_runs: result.invalid_runs ?? selectedEntrant.invalid_runs,
            beats_king: result.beats_king ?? selectedEntrant.beats_king,
            projects: result.projects ?? selectedEntrant.projects,
            screening_result: result.screening_result ?? selectedEntrant.screening_result,
            status: result.state === "failed" ? "invalid" : selectedEntrant.status,
          }
        : {}),
    };
    return (
      <DuelDetail
        entrant={candidate}
        king={kingResult}
        kingAuthor={challengeKingAuthor}
        kingRankAverage={challenge?.kingRankAverage || null}
        kingRankSamples={challenge?.kingRankSamples || 0}
        kingReignRecords={challenge?.kingReignRecords || []}
        progress={result}
        projectKeys={projectKeys}
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold}
        kataRepoSlug={kataRepoSlug}
        onBack={() => setSelectedPull(null)}
      />
    );
  }

  // Challenge mode is a 1v1 king-of-the-hill: show the duel detail directly, no table.
  const primaryEntrant = rankedEntrants[0] || null;
  const primaryProgress = primaryEntrant
    ? resultByPull[primaryEntrant.pull_number] || null
    : null;

  const arenaHead = (
    <div className="challenge-block-head">
      <span className="showcase-kicker">Arena</span>
      <SectionTitle title={challengeTitle} />
      <p className="section-lead challenge-lead">
        The king defends its crown against a challenger. Both agents look for bugs in the same
        secret projects — the challenger wins the crown only if it beats the king on the ranked
        signals below.
      </p>
    </div>
  );

  const note = challenge?.note ? (
    <div
      className={`challenge-note challenge-note-${state === "skipped" || state === "failed" ? "warn" : "info"}`}
    >
      {challenge.note}
    </div>
  ) : null;

  const verdict = challenge?.winnerSubmissionId ? (
    <div className="round-verdict round-verdict-win">
      <span className="round-verdict-crown" aria-hidden="true">
        ♔
      </span>
      <div>
        <strong>New king: {challenge.winnerSubmissionId}</strong>
        <p>Outranked the king on SN60&apos;s promotion order and is being promoted.</p>
      </div>
    </div>
  ) : state === "completed" ? (
    <div className="round-verdict round-verdict-hold">
      <span className="round-verdict-crown" aria-hidden="true">
        ♔
      </span>
      <div>
        <strong>King held the crown</strong>
        <p>The challenger did not outrank the king on SN60&apos;s promotion order.</p>
      </div>
    </div>
  ) : null;

  const pausedNote =
    state === "paused" || (challenge?.stale && state !== "completed") ? (
      <div className="round-verdict round-verdict-hold">
        <span className="round-verdict-crown" aria-hidden="true">
          ⏸
        </span>
        <div>
          <strong>Round paused</strong>
          <p>
            Below are the last scores from the challenge that was running. Resume the round to pick
            up where it left off.
          </p>
        </div>
      </div>
    ) : null;

  const arenaIntro = (
    <>
      {arenaHead}
      {note}
      {pausedNote}
      {verdict}
      {showScreeningGate ? <ScreeningGatePanel screening={live.screening} /> : null}
    </>
  );

  if (hasChallenge && primaryEntrant) {
    return (
      <DuelDetail
        entrant={primaryEntrant}
        king={kingResult}
        kingAuthor={challengeKingAuthor}
        kingRankAverage={challenge?.kingRankAverage || null}
        kingRankSamples={challenge?.kingRankSamples || 0}
        kingReignRecords={challenge?.kingReignRecords || []}
        progress={primaryProgress}
        projectKeys={projectKeys}
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold}
        kataRepoSlug={kataRepoSlug}
        onBack={null}
        intro={arenaIntro}
      />
    );
  }

  return (
    <div className="challenge-block">
      {arenaHead}
      {!hasChallenge ? (
        <div className="challenge-empty">
          <Status label="no challenge running" tone="neutral" />
          <p>
            No challenge is running. Once a challenger opens a PR, the live duel — king vs
            challenger — appears here.
          </p>
        </div>
      ) : (
        <>
          {note}
          {pausedNote}
          {verdict}
          <Empty text="No challenger has entered yet — the king holds the crown until one does." />
        </>
      )}
    </div>
  );
}

// One problem row's score, read as tp / expected / found:
//   tp       = real vulnerabilities the agent matched
//   expected = real vulnerabilities in that codebase
//   found    = total findings the agent reported (tp + false positives)
// `project.passed` is the engine verdict after applying the replica threshold.
function ProblemBreakdown({
  projectKeys,
  primaryByKey,
  primaryLabel,
  secondaryByKey = {},
  secondaryLabel = null,
  replicasPerProject,
  passThreshold,
  mode = "duel",
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
          const result = problemResult(pending ? null : project, replicasPerProject);
          const open = openProjectKey === key;
          return (
            <div
              className={`problem-accordion problem-accordion-${
                pending
                  ? "neutral"
                  : project.passed
                    ? "ok"
                    : result.tone === "warn"
                      ? "active"
                      : "bad"
              } ${open ? "problem-accordion-open" : ""}`}
              key={key}
            >
              <button
                type="button"
                className={`live-task-row problem-row-button live-task-row-${
                  pending
                    ? "neutral"
                    : project.passed
                      ? "ok"
                      : result.tone === "warn"
                        ? "active"
                        : "bad"
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
                  <strong>
                    {pending ? "—" : formatTpExpectedFound(project, replicasPerProject)}
                  </strong>
                  <small>tp / expected / found</small>
                </div>
                {single ? null : (
                  <div
                    className={`live-task-side ${
                      !secondaryProject
                        ? ""
                        : secondaryProject.passed
                          ? "live-task-side-ok"
                          : "live-task-side-bad"
                    }`}
                  >
                    <span>{secondaryLabel || "secondary"}</span>
                    <strong>{formatTpExpectedFound(secondaryProject, replicasPerProject)}</strong>
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
    <div
      className={`replica-table replica-table-${tone} ${compact ? "replica-table-compact" : ""}`}
    >
      <div className="replica-table-title">
        <strong>{title}</strong>
        <span>{projectReplicaPassLabel(project, replicasPerProject)}</span>
      </div>
      <div className="replica-table-head" aria-hidden="true">
        <span>#</span>
        <span>evaluated</span>
        <span>tp / exp / found</span>
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

function KingDetail({
  king,
  progress,
  kingAuthor,
  kingSubmissionId,
  projectKeys,
  replicasPerProject,
  passThreshold,
  onBack,
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
    projectKeys && projectKeys.length
      ? projectKeys
      : projects.map((project) => project.project_key);
  const name = kingAuthor || kingSubmissionId || "Current king";
  return (
    <div className="challenge-block duel-page">
      <div className="duel-detail-topbar">
        <button type="button" className="button" onClick={onBack}>
          ← Back to challenge
        </button>
        <div className="duel-detail-title">
          <span className="rstat rstat-king">♔ current king</span>
          {scoring ? (
            <Status label="scoring now" tone="warn" />
          ) : (
            <Status label="fresh this challenge" tone="ok" />
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
                kingAuthor
                  ? `https://github.com/${encodeURIComponent(kingAuthor)}.png?size=96`
                  : null
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
            <strong>
              {done}/{total} problems scored
            </strong>
            <small>
              {scoring
                ? "Re-solving the king fresh on this challenge's problems."
                : "King scored and cached; candidates are compared to this."}
            </small>
          </div>
          <div className="progress-track duel-task-track" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <KingMetricPanel
        king={king}
        projectCount={problemKeys.length}
        replicasPerProject={replicasPerProject}
        passThreshold={passThreshold || projectPassThresholdLabel(replicasPerProject)}
      />

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

function KingMetricPanel({ king, projectCount, replicasPerProject, passThreshold }) {
  return (
    <section className="king-metric-panel">
      <div className="king-metric-head">
        <div>
          <span>cached king baseline</span>
          <strong>King scoring snapshot</strong>
        </div>
        <p>The challenger is scored against this freshly re-solved king.</p>
      </div>
      <div className="king-metric-primary">
        <KingMetricCard
          label="project pass score"
          value={formatPassScore(king, projectCount)}
          hint="First ranking signal"
          tone="gold"
        />
        <KingMetricCard
          label="projects passed"
          value={formatProjectsPassed(king)}
          hint="Second ranking signal"
          tone="green"
        />
      </div>
      <div className="king-metric-support">
        <MetricChip
          label="true positives"
          value={formatSideTruePositives(king, replicasPerProject)}
        />
        <MetricChip label="fewer invalid runs" value={String(Number(king?.invalid_runs || 0))} />
        <MetricChip
          label="precision"
          value={precisionFindingFigure(king?.precision, king?.true_positives, king?.total_found)}
        />
        <MetricChip
          label="f1 score"
          value={f1FindingFigure(
            king?.f1_score,
            king?.true_positives,
            king?.total_expected,
            king?.total_found
          )}
        />
        <MetricChip label="project pass rule" value={passThreshold} />
      </div>
    </section>
  );
}

function KingMetricCard({ label, value, hint, tone = "neutral" }) {
  return (
    <article className={`king-metric-card king-metric-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

const KING_SIGNAL_KEYS = [
  "pass_score",
  "codebase_pass_count",
  "true_positives",
  "invalid_runs",
  "precision",
  "f1_score",
];

// Element-wise mean of a list of six-signal records (same as the bot's ledger average).
function averageKingSignals(records) {
  const count = records.length || 1;
  const out = {};
  for (const key of KING_SIGNAL_KEYS) {
    out[key] = records.reduce((sum, record) => sum + Number(record[key] || 0), 0) / count;
  }
  return out;
}

// The king's this-challenge best-of ladder, expressed as the ledger's six-signal shape
// so it can be averaged with the reign records.
function ladderToKingSignals(ladder) {
  return {
    pass_score: Number(ladder.passRatio || 0),
    codebase_pass_count: Number(ladder.projectsPassed || 0),
    true_positives: Number(ladder.truePositives || 0),
    invalid_runs: Number(ladder.invalidRuns || 0),
    precision: Number(ladder.precision || 0),
    f1_score: Number(ladder.f1 || 0),
  };
}

function DuelDetail({
  entrant,
  king,
  kingAuthor,
  kingRankAverage = null,
  kingRankSamples = 0,
  kingReignRecords = [],
  kataRepoSlug,
  progress,
  projectKeys,
  replicasPerProject,
  passThreshold,
  onBack,
  intro = null,
}) {
  const won = entrant.beats_king === true;
  const decided = entrant.status !== "executing" && entrant.aggregated_score != null;
  const scoring = progress && progress.state === "scoring";
  const kingProjects = {};
  (king?.projects || []).forEach((project) => {
    kingProjects[project.project_key] = project;
  });
  const projects = entrant.projects || [];
  // Show ALL sampled problems up front; scored ones fill in, the rest stay "scoring".
  const candidateByKey = {};
  projects.forEach((project) => {
    candidateByKey[project.project_key] = project;
  });
  const problemKeys =
    projectKeys && projectKeys.length
      ? projectKeys
      : projects.map((project) => project.project_key);
  const candidatePassScore = formatPassScore(entrant, problemKeys.length);
  const kingPassScore = formatPassScore(king, problemKeys.length);
  const candidatePassRatio = entrantPassScore(entrant, problemKeys.length);
  const kingPassRatio = entrantPassScore(king, problemKeys.length);
  // The gate compares the candidate against the king's AVERAGE over its reign, so show
  // that average in the decision ladder when we have it (a fresh king with no reign
  // history falls back to its this-challenge scores).
  // Every ladder value is computed BEST-OF and identically for both sides. The candidate
  // uses its this-challenge best-of; the king uses its reign average.
  const candidateLadder = sideLadderSignals(entrant, replicasPerProject, problemKeys.length);
  const liveKingLadder = sideLadderSignals(king, replicasPerProject, problemKeys.length);
  // While the round is executing, the king's this-challenge score is NOT in the ledger
  // yet (it's recorded only when the round completes). So blend the reign records with
  // the king's LIVE this-challenge score, so the displayed average updates in real time
  // as the king finds more — matching the average the gate will use at completion. Once
  // completed, the published kingRankAverage already includes this round, so use it.
  const stillScoring = entrant.status === "executing";
  let effectiveKingAverage = kingRankAverage;
  let effectiveKingSamples = kingRankSamples;
  if (stillScoring && kingReignRecords.length) {
    effectiveKingAverage = averageKingSignals([
      ...kingReignRecords,
      ladderToKingSignals(liveKingLadder),
    ]);
    effectiveKingSamples = kingReignRecords.length + 1;
  }
  const kingIsAverage = Boolean(effectiveKingAverage);
  const kingLadder = kingIsAverage
    ? {
        passRatio: Number(effectiveKingAverage.pass_score || 0),
        passScore: `${Math.round(Number(effectiveKingAverage.pass_score || 0) * 100)}%`,
        projectsPassed: Number(effectiveKingAverage.codebase_pass_count || 0),
        truePositives: Number(effectiveKingAverage.true_positives || 0),
        totalExpected: null,
        totalFound: null,
        invalidRuns: Number(effectiveKingAverage.invalid_runs || 0),
        precision: Number(effectiveKingAverage.precision || 0),
        f1: Number(effectiveKingAverage.f1_score || 0),
      }
    : liveKingLadder;
  const screeningFailure = screeningFailureDetails(entrant) || screeningFailureDetails(progress);
  const onlyScreeningFailure = Boolean(screeningFailure && !projects.length);

  return (
    <div className="challenge-block duel-page">
      {intro}
      {onBack ? (
        <div className="duel-detail-topbar">
          <button type="button" className="button" onClick={onBack}>
            ← Back to challenge
          </button>
        </div>
      ) : null}

      {screeningFailure ? (
        <div className="screening-failure-panel">
          <div>
            <Status label="screening failed" tone="bad" />
            <strong>Challenge-start execution screener failed</strong>
            <p>
              This PR passed intake earlier, but it did not run cleanly in the one-project execution
              smoke test, so it did not enter main scoring.
            </p>
          </div>
          {screeningFailure.projectKey ? (
            <div className="screening-failure-fact">
              <span>project</span>
              <strong>{screeningFailure.projectKey}</strong>
            </div>
          ) : null}
          {screeningFailure.reasons.length ? (
            <ul>
              {screeningFailure.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {scoring ? (
        <div className="duel-live-banner">
          <Status label="scoring now" tone="warn" />
          <span>
            {progress.done}/{progress.total} problems scored — live metrics fill in as the challenge
            completes.
          </span>
        </div>
      ) : null}

      {onlyScreeningFailure ? null : (
        <section className="arena-hero">
          <div className="battle-wrap">
            <div className="battle">
              <BattleSide
                role="king"
                crown
                name={kingAuthor || "Current king"}
                sub={kingAuthor ? "reigning king" : "current king"}
                avatarUrl={
                  kingAuthor
                    ? `https://github.com/${encodeURIComponent(kingAuthor)}.png?size=96`
                    : null
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
                  <strong
                    className={
                      candidatePassRatio > kingPassRatio
                        ? "positive"
                        : candidatePassRatio < kingPassRatio
                          ? "negative"
                          : ""
                    }
                  >
                    {kingPassScore} vs {candidatePassScore}
                  </strong>
                  <small>king vs challenger · project pass score</small>
                </div>
              </div>
              <BattleSide
                role="candidate"
                name={entrant.author || entrant.submission_id}
                sub="challenger"
                pr={prLabel(kataRepoSlug, entrant.pull_number)}
                avatarUrl={
                  entrant.author
                    ? `https://github.com/${encodeURIComponent(entrant.author)}.png?size=96`
                    : null
                }
                score={candidatePassScore}
                scoreLabel="project pass score"
                won={won}
              />
              <SideProgressBar
                progress={king ? { done: king.done, total: king.total, state: king.state } : null}
                role="king"
                label="king"
              />
              <div aria-hidden="true" />
              <SideProgressBar
                progress={
                  progress
                    ? { done: progress.done, total: progress.total, state: progress.state }
                    : null
                }
                role="candidate"
                label="challenger"
              />
            </div>
          </div>
        </section>
      )}

      {onlyScreeningFailure ? null : (
        <DecisionLadder
          candidate={candidateLadder}
          king={kingLadder}
          kingIsAverage={kingIsAverage}
          kingLabel={
            kingIsAverage ? `king · avg of ${effectiveKingSamples}` : "king (this challenge)"
          }
          kingReignRecords={kingReignRecords}
          liveKingSignals={ladderToKingSignals(liveKingLadder)}
          numProjects={problemKeys.length}
          replicasPerProject={replicasPerProject}
          totalExpected={Number(candidateLadder.totalExpected || 0)}
          executing={stillScoring}
        />
      )}

      {onlyScreeningFailure ? null : (
        <ProblemBreakdown
          projectKeys={problemKeys}
          primaryByKey={candidateByKey}
          primaryLabel="candidate"
          secondaryByKey={kingProjects}
          secondaryLabel="king"
          replicasPerProject={replicasPerProject}
          passThreshold={passThreshold}
        />
      )}
    </div>
  );
}

const DECISION_SIGNALS = [
  { rank: 1, key: "pass_score", label: "Project pass score", note: "First decision signal", higherIsBetter: true },
  { rank: 2, key: "codebase_pass_count", label: "Projects passed", note: "Used if pass score is tied", higherIsBetter: true },
  { rank: 3, key: "true_positives", label: "True positives", note: "Confirmed benchmark matches", higherIsBetter: true },
  { rank: 4, key: "invalid_runs", label: "Invalid runs", note: "Lower is better", higherIsBetter: false },
  { rank: 5, key: "precision", label: "Precision", note: "Cleaner reports win ties", higherIsBetter: true },
  { rank: 6, key: "f1_score", label: "F1 score", note: "Final tie-breaker", higherIsBetter: true },
];

const roundTo = (value, places = 0) => {
  const factor = 10 ** places;
  return Math.round(Number(value || 0) * factor) / factor;
};
const asPercent = (value) => (value == null ? "—" : `${Math.round(Number(value) * 100)}%`);
// Whole-count signals show the number itself (the king's reign average, the challenger's
// this-challenge count); a whole number stays whole, an average shows one decimal.
const formatCount = (value) => {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

// The raw ladder value used to decide the ranking for each signal (unchanged by display).
function ladderRawValue(ladder, key) {
  switch (key) {
    case "pass_score":
      return ladder.passRatio;
    case "codebase_pass_count":
      return ladder.projectsPassed;
    case "true_positives":
      return ladder.truePositives;
    case "invalid_runs":
      return ladder.invalidRuns;
    case "precision":
      return ladder.precision;
    case "f1_score":
      return ladder.f1;
    default:
      return null;
  }
}

// Ratio signals (project pass score, precision, F1) show a percentage; whole-count
// signals (projects passed, true positives, invalid runs) show the number itself. Note
// "project pass score" (a %) and "projects passed" (a count) are deliberately different
// views of the same passes.
function ladderSignalDisplay(ladder, key) {
  switch (key) {
    case "pass_score":
      return asPercent(ladder.passRatio);
    case "codebase_pass_count":
      return formatCount(ladder.projectsPassed);
    case "true_positives":
      return formatCount(ladder.truePositives);
    case "invalid_runs":
      return formatCount(ladder.invalidRuns);
    case "precision":
      return asPercent(ladder.precision);
    case "f1_score":
      return asPercent(ladder.f1);
    default:
      return "—";
  }
}

const SIGNAL_HELP = {
  pass_score: "Share of the sampled projects the agent fully passed.",
  codebase_pass_count: "How many of the sampled projects the agent passed.",
  true_positives: "Real benchmark bugs the agent correctly found.",
  invalid_runs: "Scoring runs that errored out — fewer is better.",
  precision: "Of everything the agent reported, how much was real.",
  f1_score: "Overall balance of precision and detection.",
};

// The challenger's raw this-challenge counts for a signal, as a plain sentence.
function candidateSignalCounts(key, c, { numProjects, totalRuns }) {
  const tp = roundTo(c.truePositives);
  const found = roundTo(c.totalFound);
  const expected = roundTo(c.totalExpected);
  const passed = roundTo(c.projectsPassed);
  const invalid = roundTo(c.invalidRuns);
  const withPct = (num, den) => (den > 0 ? ` (${Math.round((num / den) * 100)}%)` : "");
  switch (key) {
    case "pass_score":
    case "codebase_pass_count":
      return `Passed ${passed} of ${numProjects} projects${withPct(passed, numProjects)}.`;
    case "true_positives":
      return `Found ${tp} of ${expected} real bugs · ${Math.max(found - tp, 0)} false positives.`;
    case "invalid_runs":
      return `${invalid} of ${totalRuns} scoring runs errored${withPct(invalid, totalRuns)}.`;
    case "precision":
      return `${tp} of ${found} reported findings were real${withPct(tp, found)}.`;
    case "f1_score":
      return `F1 ${roundTo(c.f1, 2)} — the balance of precision and detection.`;
    default:
      return "—";
  }
}

// Format one king history value for a signal: ratios as %, counts as counts.
function formatKingHistoryValue(key, value, { numProjects }) {
  switch (key) {
    case "pass_score":
    case "precision":
    case "f1_score":
      return key === "f1_score" ? roundTo(value, 2).toFixed(2) : asPercent(value);
    case "codebase_pass_count":
      return `${roundTo(value, 1)} / ${numProjects}`;
    case "true_positives":
      return `${roundTo(value, 1)} TP`;
    case "invalid_runs":
      return `${roundTo(value, 1)} runs`;
    default:
      return "—";
  }
}

// The king's full finding history for a signal: one row per reign record, plus the live
// this-challenge value while scoring, plus the reign average.
function kingSignalHistory(key, reignRecords, liveSignals, executing) {
  const rows = reignRecords.map((record, index) => ({
    label: `challenge ${index + 1}`,
    value: Number(record[key] || 0),
  }));
  if (executing && liveSignals) {
    rows.push({ label: "this challenge (live)", value: Number(liveSignals[key] || 0), live: true });
  }
  const average = rows.length ? rows.reduce((sum, row) => sum + row.value, 0) / rows.length : 0;
  return { rows, average };
}

function DecisionLadder({
  candidate,
  king,
  kingIsAverage = false,
  kingLabel = "king",
  kingReignRecords = [],
  liveKingSignals = null,
  numProjects = 0,
  replicasPerProject = 1,
  totalExpected = 0,
  executing = false,
}) {
  const [openSignal, setOpenSignal] = useState(null);
  const totalRuns = numProjects * Math.max(Number(replicasPerProject) || 1, 1);
  const ctx = { numProjects, totalRuns, totalExpected };
  const steps = DECISION_SIGNALS.map((signal) => ({
    ...signal,
    candidateValue: ladderRawValue(candidate, signal.key),
    kingValue: ladderRawValue(king, signal.key),
    candidateDisplay: ladderSignalDisplay(candidate, signal.key),
    kingDisplay: ladderSignalDisplay(king, signal.key),
    candidateDetail: candidateSignalCounts(signal.key, candidate, ctx),
    kingHistory: kingSignalHistory(signal.key, kingReignRecords, liveKingSignals, executing),
  }));

  const firstDecider = steps.find((step) => decisionWinner(step) !== "tie") || null;
  const activeStep = steps.find((step) => step.key === openSignal) || null;

  return (
    <section className="decision-ladder">
      <div className="decision-ladder-head">
        <div>
          <span>promotion priority</span>
          <strong>How this matchup is ranked</strong>
          <p>
            The challenger&apos;s score is compared, in order, against{" "}
            {kingIsAverage ? "the king's average over its reign" : "the king"}. Lower-priority
            signals matter only when every signal above them is tied. Tap a card for the counts.
          </p>
        </div>
        <div className="decision-ladder-verdict">
          <span>first deciding signal</span>
          <strong>
            {firstDecider ? `#${firstDecider.rank} ${firstDecider.label}` : "Tie so far"}
          </strong>
        </div>
      </div>
      <div className="decision-ladder-grid">
        {steps.map((step) => (
          <DecisionStep
            key={step.label}
            step={step}
            active={firstDecider?.rank === step.rank}
            kingLabel={kingLabel}
            onOpen={() => setOpenSignal(step.key)}
          />
        ))}
      </div>
      {activeStep ? (
        <DecisionStepDialog
          step={activeStep}
          ctx={ctx}
          onClose={() => setOpenSignal(null)}
        />
      ) : null}
    </section>
  );
}

function DecisionStep({ step, active, kingLabel = "king", onOpen }) {
  const winner = decisionWinner(step);
  return (
    <button
      type="button"
      className={`decision-step decision-step-${winner} ${active ? "decision-step-active" : ""}`}
      onClick={onOpen}
    >
      <div className="decision-step-top">
        <span className="decision-rank">#{step.rank}</span>
        <span className="decision-state">
          {winner === "candidate" ? "candidate leads" : winner === "king" ? "king leads" : "tie"}
        </span>
      </div>
      <strong>{step.label}</strong>
      <p>{step.note}</p>
      <div className="decision-values">
        <span>
          <small>candidate</small>
          <div className="decision-value-main">{step.candidateDisplay}</div>
        </span>
        <span>
          <small>{kingLabel}</small>
          <div className="decision-value-main">{step.kingDisplay}</div>
        </span>
      </div>
      <span className="decision-step-more">tap for counts</span>
    </button>
  );
}

function DecisionStepDialog({ step, ctx, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="decision-dialog-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="decision-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="decision-dialog-head">
          <div>
            <span>signal #{step.rank}</span>
            <strong>{step.label}</strong>
          </div>
          <button
            type="button"
            className="decision-dialog-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="decision-dialog-body">
          <p className="decision-dialog-help">{SIGNAL_HELP[step.key]}</p>
          <section className="decision-dialog-section">
            <h4>🥊 Challenger — this challenge</h4>
            <p className="decision-dialog-candidate">{step.candidateDetail}</p>
          </section>
          <section className="decision-dialog-section">
            <h4>👑 King — every challenge in its reign</h4>
            {step.kingHistory.rows.length ? (
              <ul className="decision-dialog-history">
                {step.kingHistory.rows.map((row, index) => (
                  <li key={`${row.label}-${index}`} className={row.live ? "is-live" : ""}>
                    <span>{row.label}</span>
                    <strong>{formatKingHistoryValue(step.key, row.value, ctx)}</strong>
                  </li>
                ))}
                <li className="decision-dialog-avg">
                  <span>Average — the score to beat</span>
                  <strong>{formatKingHistoryValue(step.key, step.kingHistory.average, ctx)}</strong>
                </li>
              </ul>
            ) : (
              <p className="decision-dialog-candidate">
                No reign history yet — this is a freshly crowned king.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function BattleSide({
  role,
  name,
  sub,
  score,
  scoreLabel = "detection score",
  avatarUrl,
  crown,
  won,
  pr = null,
}) {
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
      {pr ? <div className="battle-pr">PR&nbsp;{pr}</div> : null}
      <div className="battle-score">
        <strong>{score}</strong>
        <small>{scoreLabel}</small>
      </div>
    </div>
  );
}

// A per-side "problem progress" bar rendered BELOW its hero card (outside the box), in
// the second row of the hero grid so it lines up under the card.
function SideProgressBar({ progress, role, label }) {
  if (!progress || Number(progress.total) <= 0) {
    return <div aria-hidden="true" />; // keep the grid cell so alignment holds
  }
  const done = Number(progress.done || 0);
  const total = Number(progress.total);
  const stateLabel =
    progress.state === "scoring"
      ? "scoring…"
      : progress.state === "done"
        ? "scored"
        : progress.state === "queued"
          ? "waiting to score"
          : progress.state || "";
  return (
    <div className={`side-progress side-progress-${role}`}>
      <div className="side-progress-head">
        <span>{label} · problem progress</span>
        <strong>
          {done}/{total}
        </strong>
      </div>
      <ProgressBar done={done} total={total} tone={role} />
      {stateLabel ? <small>{stateLabel}</small> : null}
    </div>
  );
}

function precisionFindingFigure(value, truePositives, totalFound) {
  return qualityRatio(value, [truePositives, totalFound]);
}

function f1FindingFigure(value, truePositives, totalExpected, totalFound) {
  return qualityRatio(value, [truePositives, totalExpected, totalFound]);
}

function qualityRatio(value, figures) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return (
    <div className="quality-ratio">
      <strong>{percentMetric(value)}</strong>
      <small>{figures.map((figure) => formatMetricNumber(figure)).join("/")}</small>
    </div>
  );
}

function ScreeningGatePanel({ screening }) {
  if (!screening) {
    return null;
  }
  const done = Number(screening.passed || 0) + Number(screening.failed || 0);
  const current = screening.current;
  const next = nextScreeningEntry(screening);
  const headline = screeningHeadline(screening);
  return (
    <div className="round-screening-gate">
      <div className="round-screening-head">
        <div className="round-screening-title">
          <span>screening gate</span>
          <strong>{headline}</strong>
          <small>
            {done} of {screening.total} PR{screening.total === 1 ? "" : "s"} checked
          </small>
        </div>
        <ProgressBar
          done={done}
          total={screening.total}
          label={`${done}/${screening.total}`}
          tone="screening"
        />
      </div>
      <div className="round-screening-meta" aria-label="Screening status counts">
        <ScreeningCount label="cleared" value={screening.passed || 0} tone="passed" />
        <ScreeningCount label="screening" value={screening.running || 0} tone="running" />
        <ScreeningCount label="waiting" value={screening.queued || 0} tone="queued" />
        <ScreeningCount label="failed" value={screening.failed || 0} tone="failed" />
        {current ? (
          <ScreeningCount
            label={current.state === "queued" ? "next" : "current"}
            value={`#${current.pullNumber}`}
            tone={current.state}
          />
        ) : null}
        {!current && next ? (
          <ScreeningCount label="next" value={`#${next.pullNumber}`} tone="queued" />
        ) : null}
      </div>
      <div className="round-screening-steps" aria-label="Per-PR screening progress">
        {(screening.entries || []).map((entry) => (
          <div
            className={`screening-step screening-step-${entry.state}`}
            aria-current={entry.pullNumber === current?.pullNumber ? "step" : undefined}
            key={entry.pullNumber}
            title={entry.projectKey || entry.runId || ""}
          >
            <i aria-hidden="true" />
            <span>#{entry.pullNumber}</span>
            <small>{screeningStatusLabel(entry, { short: true })}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function prLabel(kataRepoSlug, pullNumber) {
  if (!pullNumber) {
    return "—";
  }
  if (!kataRepoSlug) {
    return `#${pullNumber}`;
  }
  return (
    <a
      href={`https://github.com/${kataRepoSlug}/pull/${pullNumber}`}
      target="_blank"
      rel="noreferrer"
    >
      #{pullNumber}
    </a>
  );
}

function winnerPullFromSubmission(winnerSubmissionId) {
  if (!winnerSubmissionId) {
    return null;
  }
  const match = String(winnerSubmissionId).match(/pr-?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function ChallengeHistory({ challenges, kataRepoSlug }) {
  if (!challenges || !challenges.length) {
    return null;
  }
  return (
    <div className="challenge-block">
      <div className="challenge-block-head">
        <SectionTitle title="Latest challenge" />
        <p className="section-lead">How the most recent king-of-the-hill match finished.</p>
      </div>
      <ul className="challenge-feed">
        {challenges.slice(0, 1).map((challenge, index) => {
          const promoted = Boolean(challenge.winnerSubmissionId);
          const winnerPull = winnerPullFromSubmission(challenge.winnerSubmissionId);
          // "New king" is already covered by the outcome badge; keep the rest.
          const highlights = (challenge.achievements || []).filter(
            (item) => !/new king/i.test(item)
          );
          return (
            <li
              className={`challenge-card ${promoted ? "is-promoted" : "is-defended"}`}
              key={challenge.runId || index}
            >
              <div className="challenge-card-main">
                <div className="challenge-card-top">
                  <span className="challenge-card-num">
                    {challenge.challengeNumber
                      ? `Challenge ${challenge.challengeNumber}`
                      : "Challenge"}
                  </span>
                  <span
                    className={`challenge-outcome ${
                      promoted ? "challenge-outcome-new" : "challenge-outcome-held"
                    }`}
                  >
                    {promoted ? "👑 New king" : "🛡️ King defended"}
                  </span>
                </div>
                <p className="challenge-card-summary">
                  {promoted ? (
                    <>
                      A challenger beat the king and took the crown
                      {winnerPull ? <> — {prLabel(kataRepoSlug, winnerPull)}</> : null}.
                    </>
                  ) : (
                    <>No challenger beat the king — the crown stayed put.</>
                  )}
                </p>
                {highlights.length ? (
                  <div className="challenge-card-chips">
                    {highlights.map((item) => (
                      <span className="rstat rstat-winner" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <dl className="challenge-card-stats">
                <div>
                  <dt>Best detection</dt>
                  <dd>{formatDetection(challenge.bestDetection)}</dd>
                </div>
                <div>
                  <dt>Bugs found</dt>
                  <dd>{challenge.bestTruePositives ?? 0}</dd>
                </div>
                <div>
                  <dt>Challengers</dt>
                  <dd>{challenge.candidateCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatDateTime(challenge.generatedAt)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Arena({ selectedLane, challenge, challengeHistory, kataRepoSlug }) {
  const [selectedPull, setSelectedPull] = useState(null);
  const entrants = challenge?.entrants || [];
  // A duel detail page is open — hide everything else (recent challenges) so the page
  // shows only that PR's duel.
  const detailOpen =
    selectedPull === "king" ||
    (selectedPull != null && entrants.some((e) => e.pull_number === selectedPull));

  return (
    <div className="stack">
      <ChallengePanel
        challenge={challenge}
        kataRepoSlug={kataRepoSlug}
        kingAuthor={selectedLane?.king?.author || null}
        kingSubmissionId={selectedLane?.king?.submissionId || null}
        selectedPull={selectedPull}
        setSelectedPull={setSelectedPull}
      />

      {!detailOpen ? (
        <ChallengeHistory challenges={challengeHistory} kataRepoSlug={kataRepoSlug} />
      ) : null}
    </div>
  );
}

function Winners({ lanes, kataRepoSlug }) {
  const visibleLanes = Array.isArray(lanes) ? lanes : [];
  return (
    <div className="stack">
      <PageIntro
        eyebrow="Winners"
        title="Reigning kings"
        text="The current champion for each subnet — the agent that beat every challenger and holds the crown. Every king is published in the open, so anyone can run it."
      />
      <div className="king-grid">
        {visibleLanes.length ? (
          visibleLanes.map((lane) => (
            <KingCard key={lane.id} lane={lane} kataRepoSlug={kataRepoSlug} />
          ))
        ) : (
          <Empty text="No active subnets yet." />
        )}
      </div>
    </div>
  );
}

function KingCard({ lane, kataRepoSlug }) {
  const king = lane.king || {};
  const seeded = king.seeded;
  const winner = seeded ? "Seed king" : lane.currentHolder || king.author || "—";
  const packName = formatPackLabel(lane.subnetPack || lane.repoName || "subnet");
  const pr = lane.currentHolderPullNumber || king.sourcePullRequest || null;
  const agentHref = lane.id ? kingAgentLink(lane, kataRepoSlug) : null;
  const prHref = pr && kataRepoSlug ? `https://github.com/${kataRepoSlug}/pull/${pr}` : null;
  return (
    <article className="king-card">
      <div className="king-card-top">
        <span className="king-card-pack">{packName}</span>
        <Status label={seeded ? "seed king" : "promoted"} tone={seeded ? "neutral" : "ok"} />
      </div>
      <div className="king-card-identity">
        <div className="king-card-avatar">
          <Avatar name={winner} />
          <span className="king-card-crown" aria-hidden="true">
            ♔
          </span>
        </div>
        <div className="king-card-name">
          <h2 title={winner}>{winner}</h2>
          <span className="king-card-sub">{king.submissionId || "current king"}</span>
        </div>
      </div>
      <div className="king-card-facts">
        <ProofFact label="Promoted" value={formatDate(king.updatedAt || lane.kingUpdatedAt)} />
        <ProofFact label="Source" value={pr ? `PR #${pr}` : "seed baseline"} />
        <ProofFact label="Mode" value={lane.mode || "miner"} />
      </div>
      <div className="king-card-actions">
        {typeof agentHref === "string" && agentHref ? (
          <a
            className="king-card-action king-card-action-primary"
            href={agentHref}
            target="_blank"
            rel="noreferrer"
          >
            Open agent
          </a>
        ) : null}
        {prHref ? (
          <a className="king-card-action" href={prHref} target="_blank" rel="noreferrer">
            View winning PR
          </a>
        ) : null}
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
        title="Contributor leaderboard"
        text="Every contributor who has entered the arena. Gittensor score is earned only by an agent that was promoted to king, and it decays over time — so a fresh king out-earns an old one."
      />

      <section className="lb-table">
        <div className="lb-head">
          <span>Rank</span>
          <span>Contributor</span>
          <span className="lb-num">Wins</span>
          <span className="lb-num">Submissions</span>
          <span className="lb-num">Gittensor score</span>
        </div>
        {rows.length ? (
          rows.map((row, index) => (
            <div
              className={`lb-row${index < 3 ? ` lb-row-top lb-row-${index + 1}` : ""}`}
              key={row.author}
            >
              <span className="lb-rank">{rankBadge(index)}</span>
              <MinerIdentity
                name={row.author}
                sub={
                  row.currentKings
                    ? `${row.currentKings} active king${row.currentKings === 1 ? "" : "s"}`
                    : row.wins
                      ? "promoted contributor"
                      : "contributor"
                }
              />
              <span className="lb-num">{row.wins}</span>
              <span className="lb-num">{row.totalSubmissions}</span>
              <strong className="lb-num lb-score">
                {formatNumber(row.gittensorScore ?? row.score)}
              </strong>
            </div>
          ))
        ) : (
          <Empty text="No ranked contributors yet." />
        )}
      </section>
    </div>
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
