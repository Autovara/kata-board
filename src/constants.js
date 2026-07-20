export const STATUS_URL = import.meta.env.VITE_STATUS_URL || "/api/status";
export const STREAM_URL = import.meta.env.VITE_STREAM_URL || "/api/stream";
export const POLL_INTERVAL_MS = 2000;

export const PAGES = [
  { path: "/", label: "Dashboard" },
  { path: "/arena", label: "Arena" },
  { path: "/winners", label: "Winners" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/docs", label: "Docs" },
];

export const ROUND_STATE_BANNER = {
  idle: {
    label: "idle",
    tone: "neutral",
    text: "Waiting for the next round to start.",
  },
  executing: {
    label: "scoring now",
    tone: "warn",
    text: "Every candidate is being scored against the king right now.",
  },
  completed: {
    label: "round complete",
    tone: "ok",
    text: "Scoring finished — see the result below.",
  },
  skipped: {
    label: "round skipped",
    tone: "warn",
    text: "The round did not run. See the reason below.",
  },
  failed: {
    label: "round failed",
    tone: "bad",
    text: "The round stopped before validation. See the reason below.",
  },
};

export const ROUND_STATUS_LABEL = {
  pending: "pending",
  executing: "scoring",
  winner: "winner",
  losing: "did not beat king",
  invalid: "invalid",
  stale: "stale",
  hold: "on hold",
};
