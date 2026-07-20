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

export const CHALLENGE_STATE_BANNER = {
  idle: {
    label: "idle",
    tone: "neutral",
    text: "Waiting for the next challenge to start.",
  },
  executing: {
    label: "scoring now",
    tone: "warn",
    text: "Every candidate is being scored against the king right now.",
  },
  completed: {
    label: "challenge complete",
    tone: "ok",
    text: "Scoring finished — see the result below.",
  },
  skipped: {
    label: "challenge skipped",
    tone: "warn",
    text: "The challenge did not run. See the reason below.",
  },
  failed: {
    label: "challenge failed",
    tone: "bad",
    text: "The challenge stopped before validation. See the reason below.",
  },
};

export const CHALLENGE_STATUS_LABEL = {
  pending: "pending",
  executing: "scoring",
  winner: "winner",
  losing: "did not beat king",
  invalid: "invalid",
  stale: "stale",
  hold: "on hold",
};
