// Shared leaf presentational components extracted from App.jsx.

import { useEffect, useRef, useState } from "react";
import { avatarUrl, initials, screeningStatusLabel } from "../lib/format.js";
import { CHALLENGE_STATUS_LABEL } from "../constants.js";

export function useCountUp(target) {
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

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56v-2.02c-3.2.7-3.88-1.38-3.88-1.38-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.76 2.72 1.25 3.38.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18A11.1 11.1 0 0 1 12 6.17c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.64 1.58.24 2.75.12 3.04.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.07.79 2.16v3.03c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
      />
    </svg>
  );
}

export function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.6 13.6 0 0 0-.64 1.32 18.5 18.5 0 0 0-5.44 0 13.6 13.6 0 0 0-.64-1.32 19.7 19.7 0 0 0-4.97 1.57C.53 9.1-.32 13.7.1 18.24a19.9 19.9 0 0 0 6.09 3.08c.49-.66.92-1.36 1.29-2.1-.71-.27-1.39-.6-2.02-.97.17-.12.33-.25.49-.38a14.2 14.2 0 0 0 12.1 0l.49.38c-.64.38-1.31.7-2.03.97.37.74.8 1.44 1.29 2.1a19.9 19.9 0 0 0 6.09-3.08c.5-5.27-.84-9.83-3.57-13.87ZM8.02 15.45c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z"
      />
    </svg>
  );
}

export function Reveal({ children }) {
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

export function StatTile({ label, value, live }) {
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

export function SubnetMetric({ label, value }) {
  return (
    <div className="subnet-metric">
      <span className="subnet-metric-value">{value}</span>
      <span className="subnet-metric-label">{label}</span>
    </div>
  );
}

export function ProofFact({ label, value }) {
  return (
    <div className="proof-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ChallengeStatusPill({ status }) {
  const label = CHALLENGE_STATUS_LABEL[status] || status || "—";
  return <span className={`rstat rstat-${status || "neutral"}`}>{label}</span>;
}

export function ScreeningFailureBadge({ failure }) {
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

export function BeatsKingBadge({ beats }) {
  if (beats == null) {
    return <span className="beat-badge beat-pending">—</span>;
  }
  return beats ? (
    <span className="beat-badge beat-yes">beats king</span>
  ) : (
    <span className="beat-badge beat-no">no</span>
  );
}

export function MetricChip({ label, value, tone = "neutral" }) {
  return (
    <div className={`metric-chip metric-chip-${tone}`}>
      <span>{label}</span>
      <div className="metric-chip-value">{value}</div>
    </div>
  );
}

export function ChallengeMeta({ label, value }) {
  return (
    <div className="challenge-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ScreeningCount({ label, value, tone }) {
  return (
    <div className={`screening-count screening-count-${tone || "neutral"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ProgressBar({ done, total, label, tone = "candidate" }) {
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

export function EntrantIdentity({ author, submissionId }) {
  const name = author || submissionId || "unknown";
  const avatarUrl = author ? `https://github.com/${encodeURIComponent(author)}.png?size=48` : null;
  return (
    <span className="entrant-identity">
      <Avatar name={name} avatarUrl={avatarUrl} />
      <span className="entrant-name">{name}</span>
    </span>
  );
}

export function ScreeningStatusBadge({ screening }) {
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

export function PageIntro({ eyebrow, title, text }) {
  return (
    <section className="page-intro">
      <p className="kicker">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

export function SectionTitle({ title }) {
  return <h2 className="section-title">{title}</h2>;
}

export function Avatar({ name, avatarName, avatarUrl: explicitAvatarUrl }) {
  const src = explicitAvatarUrl || avatarUrl(avatarName || name);
  if (src) {
    return <img className="avatar" src={src} alt={name ? `${name} avatar` : ""} />;
  }
  return <div className="avatar avatar-fallback">{initials(name || "?")}</div>;
}

export function MinerIdentity({ name, sub, size = "compact" }) {
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

export function Status({ label, tone }) {
  return <span className={`status status-${tone}`}>{label}</span>;
}

export function Empty({ text }) {
  return <div className="empty">{text}</div>;
}
