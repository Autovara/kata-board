import { useEffect, useMemo, useRef, useState } from "react";
import GridBackground from "./GridBackground.jsx";
import heroImage from "../assets/hero.png";
import {
  PAGES,
  POLL_INTERVAL_MS,
  CHALLENGE_STATE_BANNER,
  CHALLENGE_STATUS_LABEL,
} from "./constants.js";
import { readCurrentRoute, routeUrl, statusUrl, streamUrl } from "./lib/route.js";
import { Docs } from "./pages/Docs.jsx";

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
    let receivedAny = false;

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
            <button type="button" onClick={() => onNavigate("/arena")}>Arena</button>
            <button type="button" onClick={() => onNavigate("/winners")}>Winners</button>
            <button type="button" onClick={() => onNavigate("/leaderboard")}>Leaderboard</button>
          </div>
          <div className="site-footer-col">
            <h4>Build</h4>
            <button type="button" onClick={() => onNavigate("/docs")}>Submit an agent</button>
            <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`https://github.com/${repo}/blob/main/README.md`} target="_blank" rel="noreferrer">
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

function Reveal({ children }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (shown) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    const safety = setTimeout(() => setShown(true), 1500);
    return () => {
      io.disconnect();
      clearTimeout(safety);
    };
  }, [shown]);
  return (
    <div ref={ref} className={`reveal${shown ? " reveal-in" : ""}`}>
      {children}
    </div>
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
          <span>Kata is an</span>{" "}
          <span className="dash-hero-mark">optimization engine</span>{" "}
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

function useCountUp(target) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const end = Number(target) || 0;
    let raf;
    const duration = 950;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      setN(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
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

function StatTile({ label, value, live }) {
  const display = useCountUp(value);
  return (
    <div className="stat-tile">
      <span className="stat-tile-value">
        {display}
        {live ? <span className="stat-live-dot" aria-label="live" /> : null}
      </span>
      <span className="stat-tile-label">{label}</span>
    </div>
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
  const kingName = lane.king?.seeded
    ? "seed king"
    : lane.currentHolder || lane.king?.author || "—";
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

function SubnetMetric({ label, value }) {
  return (
    <div className="subnet-metric">
      <span className="subnet-metric-value">{value}</span>
      <span className="subnet-metric-label">{label}</span>
    </div>
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
        <path className="wf-crown" d={`M ${cx - 19} ${node.y - 6} l 7 12 8 -14 8 14 7 -12 -3 20 -24 0 z`} />
      ) : null}
      {node.tag ? (
        <text className="wf-tag" x={node.x + 13} y={node.y + 17}>
          {node.tag}
        </text>
      ) : null}
      <text className="wf-title" x={cx} y={node.y + node.h / 2 + (node.tag ? 6 : -2)} textAnchor="middle">
        {node.t}
      </text>
      {node.s ? (
        <text className="wf-sub" x={cx} y={node.y + node.h / 2 + (node.tag ? 24 : 16)} textAnchor="middle">
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
  const tee = { x: 726, y: 262, w: 158, h: 42, t: "kata-tee-runner", s: "sealed room · miner-paid" };
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
        <svg viewBox="0 0 1240 380" role="img" aria-label="Kata workflow: a contributor opens a PR; kata-bot screens it at intake to pending, then runs one continuous challenge marking the challenger executing; the kata engine re-solves the king fresh and scores it against the single challenger across the SN60, SN22 and future subnets in parallel inside the kata-tee-runner sealed room with miner-paid inference; the ranking checks whether the challenger beats the king's running-average score by the margin; kata-bot promotes the winner to a new king in kings and kata-board shows it live. The new king becomes the bar to beat, and the last four kings share the reward.">
          <defs>
            <marker id="wfArrow" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" className="wf-arrowhead" />
            </marker>
          </defs>
          <rect className="wf-band" x="512" y="186" width="576" height="186" rx="16" />
          <text className="wf-band-label" x="536" y="366">
            SCORE EVERY SUBNET, IN PARALLEL
          </text>
          <path className="wf-loop" d="M 1152 76 C 1152 26, 442 26, 442 76" markerEnd="url(#wfArrow)" />
          <text className="wf-loop-label" x="797" y="20" textAnchor="middle">
            the new king becomes the next challenger&apos;s bar to beat
          </text>
          {edges.map((d, i) => (
            <path key={i} className="wf-edge" d={d} markerEnd="url(#wfArrow)" />
          ))}
          {subnets.map((node) => (
            <g key={node.t}>
              <rect className="wf-node wf-node-subnet" x={node.x} y={node.y} width={node.w} height={node.h} rx="10" />
              <text className="wf-title wf-title-sm" x={node.x + node.w / 2} y={node.y + node.h / 2 + 5} textAnchor="middle">
                {node.t}
              </text>
            </g>
          ))}
          <WorkflowTagNode node={tee} />
          <g>
            <rect className="wf-node wf-node-rank" x={rank.x} y={rank.y} width={rank.w} height={rank.h} rx="10" />
            <text className="wf-title wf-title-sm" x={rank.x + rank.w / 2} y={rank.y + rank.h / 2 + 5} textAnchor="middle">
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

function ProofFact({ label, value }) {
  return (
    <div className="proof-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChallengeStatusPill({ status }) {
  const label = CHALLENGE_STATUS_LABEL[status] || status || "—";
  return <span className={`rstat rstat-${status || "neutral"}`}>{label}</span>;
}

function screeningFailureDetails(source) {
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

function ScreeningFailureBadge({ failure }) {
  if (!failure) {
    return null;
  }
  const title = [failure.projectKey ? `Project: ${failure.projectKey}` : "", ...failure.reasons]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className="rstat rstat-screening-failed"
      title={title || "Challenge-start execution screening failed"}
    >
      screening failed
    </span>
  );
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

function projectCountFromEntrant(entrant) {
  return Array.isArray(entrant?.projects) ? entrant.projects.length : 0;
}

function selectedProjectKeysFromChallenge(challenge) {
  const candidates = [
    challenge?.liveProgress?.projectKeys,
    challenge?.projectKeys,
    challenge?.primary?.projectKeys,
    challenge?.evaluatorState?.current?.projectKeys,
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

function inferReplicasPerProject(challenge) {
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

function projectReplicaPassLabel(project, fallback = 0) {
  const total = projectReplicaTotal(project, fallback);
  if (!project && !total) {
    return "—";
  }
  return `${projectPassCount(project)}/${total || 0} passed`;
}

function challengeExtras(challenge) {
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

function ChallengeRuleCard({ passThreshold, replicasPerProject }) {
  return (
    <div className="challenge-rule-card">
      <div>
        <span>promotion rule</span>
        <strong>Beat the king&apos;s running-average score by the margin</strong>
        <p>
          A project passes when enough replicas pass. This challenge uses {replicasPerProject} run
          {replicasPerProject === 1 ? "" : "s"} per project, so the pass threshold is{" "}
          {passThreshold}.
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
  const hasChallenge = Boolean(challenge && (state !== "idle" || entrants.length || challenge.runId));
  const challengeTitle = challenge?.challengeNumber
    ? `Current challenge · Challenge ${challenge.challengeNumber}`
    : "Current challenge";
  const challengeKingAuthor = challenge?.kingAuthor || kingAuthor;
  const challengeKingSubmissionId = challenge?.kingSubmissionId || kingSubmissionId;
  const selectedEntrant = entrants.find((entrant) => entrant.pull_number === selectedPull) || null;
  // Live progress only while the challenge is actively scoring; ignore a stale
  // snapshot left over from a previous challenge.
  const live =
    state === "executing" && challenge?.liveProgress?.state === "executing" ? challenge.liveProgress : null;
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
    <div className="challenge-block">
      <div className="challenge-block-head">
        <span className="showcase-kicker">Arena</span>
        <SectionTitle title={challengeTitle} />
        <p className="section-lead challenge-lead">
          Live challenge: the challenger is scored against the current king on the same secret
          evaluator-selected projects.
        </p>
      </div>

      {!hasChallenge ? (
        <div className="challenge-empty">
          <Status label="no challenge running" tone="neutral" />
          <p>
            No challenge is running. Once started, live candidate scores and results will appear here.
          </p>
        </div>
      ) : (
        <section className="table-section challenge-table">
          <div className="challenge-banner">
            <div className="challenge-banner-state">
              <Status
                label={(CHALLENGE_STATE_BANNER[state] || CHALLENGE_STATE_BANNER.idle).label}
                tone={(CHALLENGE_STATE_BANNER[state] || CHALLENGE_STATE_BANNER.idle).tone}
              />
              <p>{(CHALLENGE_STATE_BANNER[state] || CHALLENGE_STATE_BANNER.idle).text}</p>
            </div>
            <div className="challenge-banner-meta">
              {challenge.challengeNumber ? (
                <ChallengeMeta label="challenge" value={`#${challenge.challengeNumber}`} />
              ) : null}
              {kingResult && kingResult.aggregated_score != null ? (
                <ChallengeMeta
                  label="king detection"
                  value={formatDetection(kingResult.aggregated_score)}
                />
              ) : null}
              <ChallengeMeta label="project pass" value={`${passThreshold} replicas`} />
              <ChallengeMeta label="candidates" value={entrants.length} />
              {challenge.generatedAt ? (
                <ChallengeMeta
                  label={state === "executing" ? "started" : "finished"}
                  value={formatDateTime(challenge.generatedAt)}
                />
              ) : null}
            </div>
          </div>

          {challenge.note ? (
            <div
              className={`challenge-note challenge-note-${state === "skipped" || state === "failed" ? "warn" : "info"}`}
            >
              {challenge.note}
            </div>
          ) : null}

          {challenge.winnerSubmissionId ? (
            <div className="challenge-verdict challenge-verdict-win">
              <span className="challenge-verdict-crown" aria-hidden="true">
                ♔
              </span>
              <div>
                <strong>New king: {challenge.winnerSubmissionId}</strong>
                <p>Beat the king and is being promoted.</p>
              </div>
            </div>
          ) : state === "completed" ? (
            <div className="challenge-verdict challenge-verdict-hold">
              <span className="challenge-verdict-crown" aria-hidden="true">
                ♔
              </span>
              <div>
                <strong>King held the crown</strong>
                <p>
                  The challenger did not beat the king&apos;s running-average score by the margin.
                </p>
              </div>
            </div>
          ) : null}

          <ChallengeRuleCard
            passThreshold={passThreshold}
            replicasPerProject={replicasPerProject}
          />

          {showScreeningGate ? <ScreeningGatePanel screening={live.screening} /> : null}

          <div className="table-head challenge-grid">
            <span>PR</span>
            <span>{state === "completed" ? "rank · entrant" : "entrant"}</span>
            <span>pass score</span>
            <span>projects passed</span>
            <span>TP</span>
            <span>beats king</span>
            <span>status</span>
          </div>

          {kingResult || (live && live.king) ? (
            <div
              className="table-row challenge-grid challenge-row-king challenge-row-clickable"
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
                <EntrantIdentity
                  author={challengeKingAuthor}
                  submissionId={challengeKingSubmissionId || "current king"}
                />
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
                className="table-row challenge-grid challenge-row-clickable"
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
                  <BeatsKingBadge beats={entrant.beats_king} />
                </span>
                <span>
                  {renderEntrantStatus(
                    entrant,
                    progressByPull[entrant.pull_number],
                    screeningByPull[entrant.pull_number]
                  )}
                </span>
              </div>
            ))
          ) : (
            <Empty text="No challenger entered this challenge." />
          )}

          {challengeExtras(challenge).length ? (
            <div className="challenge-extras">
              {challengeExtras(challenge).map((text) => (
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
function replicaAwareProblemTotals(project, replicasPerProject = 0) {
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

function formatTpExpectedFound(project, replicasPerProject = 0) {
  if (!project) return "—";
  const totals = replicaAwareProblemTotals(project, replicasPerProject);
  return `${totals.truePositives}/${totals.totalExpected}/${totals.totalFound}`;
}

function problemResult(project, replicasPerProject = 0) {
  if (!project) return { label: "scoring", tone: "warn" };
  if (project.finished === false || project.scoring) return { label: "scoring", tone: "warn" };
  if (project.passed) return { label: "pass", tone: "ok" };
  if ((replicaAwareProblemTotals(project, replicasPerProject)?.truePositives ?? 0) > 0) {
    return { label: "fail · partial", tone: "warn" };
  }
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
                  <div className="live-task-side">
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

function normalizeReplicaRows(project, replicasPerProject) {
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

function formatReplicaFindings(replica) {
  if (!replica?.evaluated) {
    return "—";
  }
  return `${replica.true_positives ?? 0}/${replica.total_expected ?? 0}/${replica.total_found ?? 0}`;
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

function KingMetricPanel({ king, projectCount, passThreshold }) {
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
        <MetricChip label="true positives" value={String(king?.true_positives ?? "—")} />
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

function DuelDetail({
  entrant,
  king,
  kingAuthor,
  kataRepoSlug,
  progress,
  projectKeys,
  replicasPerProject,
  passThreshold,
  onBack,
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
  const problemKeys =
    projectKeys && projectKeys.length
      ? projectKeys
      : projects.map((project) => project.project_key);
  const candidatePassScore = formatPassScore(entrant, problemKeys.length);
  const kingPassScore = formatPassScore(king, problemKeys.length);
  const candidatePassRatio = entrantPassScore(entrant, problemKeys.length);
  const kingPassRatio = entrantPassScore(king, problemKeys.length);
  const candidatePassedProjects = entrantPassCount(entrant);
  const kingPassedProjects = entrantPassCount(king);
  const screeningFailure = screeningFailureDetails(entrant) || screeningFailureDetails(progress);
  const onlyScreeningFailure = Boolean(screeningFailure && !projects.length);

  return (
    <div className="challenge-block duel-page">
      <div className="duel-detail-topbar">
        <button type="button" className="button" onClick={onBack}>
          ← Back to challenge
        </button>
        <div className="duel-detail-title">
          <EntrantIdentity author={entrant.author} submissionId={entrant.submission_id} />
          {prLabel(kataRepoSlug, entrant.pull_number)}
          <ChallengeStatusPill status={entrant.status} />
        </div>
      </div>

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
                  entrant.author
                    ? `https://github.com/${encodeURIComponent(entrant.author)}.png?size=96`
                    : null
                }
                score={candidatePassScore}
                scoreLabel="project pass score"
                won={won}
              />
            </div>
          </div>
        </section>
      )}

      {!onlyScreeningFailure && taskTotal > 0 ? (
        <div className="duel-task-bar">
          <div className="duel-task-bar-head">
            <span>problem progress</span>
            <strong>
              {taskDone}/{taskTotal} problems scored
            </strong>
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

      {onlyScreeningFailure ? null : (
        <DecisionLadder
          candidate={{
            passRatio: candidatePassRatio,
            passScore: candidatePassScore,
            projectsPassed: candidatePassedProjects,
            truePositives: entrant.true_positives,
            totalExpected: entrant.total_expected,
            totalFound: entrant.total_found,
            invalidRuns: candidateInvalid,
            precision: entrant.precision,
            f1: entrant.f1_score,
          }}
          king={{
            passRatio: kingPassRatio,
            passScore: kingPassScore,
            projectsPassed: kingPassedProjects,
            truePositives: king?.true_positives,
            totalExpected: king?.total_expected,
            totalFound: king?.total_found,
            invalidRuns: king ? Number(king.invalid_runs || 0) : null,
            precision: king?.precision,
            f1: king?.f1_score,
          }}
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

function DecisionLadder({ candidate, king }) {
  const steps = [
    {
      rank: 1,
      label: "Project pass score",
      note: "First decision signal",
      candidateValue: candidate.passRatio,
      kingValue: king.passRatio,
      candidateDisplay: candidate.passScore,
      kingDisplay: king.passScore,
      higherIsBetter: true,
      primary: true,
    },
    {
      rank: 2,
      label: "Projects passed",
      note: "Used if pass score is tied",
      candidateValue: candidate.projectsPassed,
      kingValue: king.projectsPassed,
      candidateDisplay: formatMetricNumber(candidate.projectsPassed),
      kingDisplay: formatMetricNumber(king.projectsPassed),
      higherIsBetter: true,
      primary: true,
    },
    {
      rank: 3,
      label: "True positives",
      note: "Confirmed benchmark matches",
      candidateValue: candidate.truePositives,
      kingValue: king.truePositives,
      candidateDisplay: formatMetricNumber(candidate.truePositives),
      kingDisplay: formatMetricNumber(king.truePositives),
      higherIsBetter: true,
    },
    {
      rank: 4,
      label: "Invalid runs",
      note: "Lower is better",
      candidateValue: candidate.invalidRuns,
      kingValue: king.invalidRuns,
      candidateDisplay: formatMetricNumber(candidate.invalidRuns),
      kingDisplay: formatMetricNumber(king.invalidRuns),
      higherIsBetter: false,
    },
    {
      rank: 5,
      label: "Precision",
      note: "Cleaner reports win ties",
      candidateValue: candidate.precision,
      kingValue: king.precision,
      candidateDisplay: precisionFindingFigure(
        candidate.precision,
        candidate.truePositives,
        candidate.totalFound
      ),
      kingDisplay: precisionFindingFigure(king.precision, king.truePositives, king.totalFound),
      higherIsBetter: true,
    },
    {
      rank: 6,
      label: "F1 score",
      note: "Final tie-breaker",
      candidateValue: candidate.f1,
      kingValue: king.f1,
      candidateDisplay: f1FindingFigure(
        candidate.f1,
        candidate.truePositives,
        candidate.totalExpected,
        candidate.totalFound
      ),
      kingDisplay: f1FindingFigure(
        king.f1,
        king.truePositives,
        king.totalExpected,
        king.totalFound
      ),
      higherIsBetter: true,
    },
  ];

  const firstDecider = steps.find((step) => decisionWinner(step) !== "tie") || null;

  return (
    <section className="decision-ladder">
      <div className="decision-ladder-head">
        <div>
          <span>promotion priority</span>
          <strong>How this matchup is ranked</strong>
          <p>
            Kata checks these signals in order. Lower priority metrics matter only when every signal
            above them is tied.
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
          <DecisionStep key={step.label} step={step} active={firstDecider?.rank === step.rank} />
        ))}
      </div>
    </section>
  );
}

function DecisionStep({ step, active }) {
  const winner = decisionWinner(step);
  return (
    <article
      className={`decision-step decision-step-${winner} ${active ? "decision-step-active" : ""}`}
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
          <small>king</small>
          <div className="decision-value-main">{step.kingDisplay}</div>
        </span>
      </div>
    </article>
  );
}

function decisionWinner(step) {
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

function normalizedDecisionValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  const numeric = Number(value);
  return numeric < 0 ? null : numeric;
}

function formatMetricNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return formatNumber(value);
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
      <div className="battle-score">
        <strong>{score}</strong>
        <small>{scoreLabel}</small>
      </div>
    </div>
  );
}

function MetricChip({ label, value, tone = "neutral" }) {
  return (
    <div className={`metric-chip metric-chip-${tone}`}>
      <span>{label}</span>
      <div className="metric-chip-value">{value}</div>
    </div>
  );
}

function percentMetric(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${formatNumber(Number(value) * 100)}%`;
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

function formatProjectName(key) {
  return String(key || "").replace(/_/g, " ");
}

function formatPackLabel(value) {
  if (!value) {
    return "-";
  }
  // Generic for any subnet pack: "sn60__bitsec" -> "SN60 Bitsec", "sn22__desearch" -> "SN22
  // Desearch". Split on the pack separators, upper-case the SNxx token and title-case the rest.
  const normalized = String(value).replace(/__/g, " ").replace(/_/g, " ").trim();
  return normalized.replace(/\bsn(\d+)\b/gi, "SN$1").replace(/\b\w/g, (char) => char.toUpperCase());
}

function ChallengeMeta({ label, value }) {
  return (
    <div className="challenge-meta">
      <span>{label}</span>
      <strong>{value}</strong>
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
    <div className="challenge-screening-gate">
      <div className="challenge-screening-head">
        <div className="challenge-screening-title">
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
      <div className="challenge-screening-meta" aria-label="Screening status counts">
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
      <div className="challenge-screening-steps" aria-label="Per-PR screening progress">
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

function ScreeningCount({ label, value, tone }) {
  return (
    <div className={`screening-count screening-count-${tone || "neutral"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function screeningHeadline(screening) {
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

function nextScreeningEntry(screening) {
  return (screening?.entries || []).find((entry) => entry.state === "queued") || null;
}

function screeningStatusLabel(entry, { short = false } = {}) {
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
  const avatarUrl = author ? `https://github.com/${encodeURIComponent(author)}.png?size=48` : null;
  return (
    <span className="entrant-identity">
      <Avatar name={name} avatarUrl={avatarUrl} />
      <span className="entrant-name">{name}</span>
    </span>
  );
}

function renderEntrantStatus(entrant, progress, screening) {
  const failure =
    screeningFailureDetails(screening) ||
    screeningFailureDetails(progress) ||
    screeningFailureDetails(entrant);
  if (failure) {
    return <ScreeningFailureBadge failure={failure} />;
  }
  const hasScoringProgress =
    progress &&
    (progress.state !== "queued" ||
      Number(progress.done || 0) > 0 ||
      (Array.isArray(progress.projects) && progress.projects.length > 0));
  if (progress) {
    if (!hasScoringProgress && screening) {
      return <ScreeningStatusBadge screening={screening} />;
    }
    if (progress.state === "queued") {
      return <span className="rstat rstat-pending">queued</span>;
    }
    if (progress.state === "failed") {
      return <span className="rstat rstat-invalid">failed</span>;
    }
    const label =
      progress.state === "done"
        ? `${progress.done}/${progress.total}`
        : `scoring ${progress.done}/${progress.total}`;
    return <ProgressBar done={progress.done} total={progress.total} label={label} />;
  }
  if (screening) {
    return <ScreeningStatusBadge screening={screening} />;
  }
  return <ChallengeStatusPill status={entrant.status} />;
}

function ScreeningStatusBadge({ screening }) {
  const label = screeningStatusLabel(screening);
  const className =
    screening?.state === "passed"
      ? "rstat-screening-passed"
      : screening?.state === "running"
        ? "rstat-screening-running"
        : screening?.state === "failed"
          ? "rstat-screening-failed"
          : "rstat-pending";
  return (
    <span className={`rstat ${className}`} title={screening?.projectKey || ""}>
      {label}
    </span>
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
    <a
      href={`https://github.com/${kataRepoSlug}/pull/${pullNumber}`}
      target="_blank"
      rel="noreferrer"
    >
      #{pullNumber}
    </a>
  );
}

function ChallengeHistory({ challenges }) {
  if (!challenges || !challenges.length) {
    return null;
  }
  return (
    <div className="challenge-block">
      <div className="challenge-block-head">
        <SectionTitle title="Recent challenges" />
        <p className="section-lead">Highlights from completed challenges.</p>
      </div>
      <section className="table-section leaderboard-table">
        <div className="table-head challenge-hist-grid">
          <span>challenge</span>
          <span>highlights</span>
          <span>best detection</span>
          <span>finished</span>
        </div>
        {challenges.slice(0, 12).map((challenge, index) => (
          <div className="table-row challenge-hist-grid" key={challenge.runId || index}>
            <span className="challenge-hist-title">
              <strong>{challenge.challengeNumber ? `Challenge ${challenge.challengeNumber}` : "Challenge"}</strong>
              <small>{challenge.headline || "Challenge"}</small>
            </span>
            <span className="challenge-hist-badges">
              {challenge.achievements?.length ? (
                challenge.achievements.map((item) => (
                  <span className="rstat rstat-winner" key={item}>
                    {item}
                  </span>
                ))
              ) : (
                <span className="challenge-hist-quiet">no new king</span>
              )}
            </span>
            <span>{formatDetection(challenge.bestDetection)}</span>
            <span>{formatDateTime(challenge.generatedAt)}</span>
          </div>
        ))}
      </section>
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

      {!detailOpen ? <ChallengeHistory challenges={challengeHistory} /> : null}
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

function rankBadge(index) {
  return ["🥇", "🥈", "🥉"][index] || String(index + 1);
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

function Status({ label, tone }) {
  return <span className={`status status-${tone}`}>{label}</span>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
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
    maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
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
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDate(value) {
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
