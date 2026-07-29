import { STATUS_URL, STREAM_URL } from "../constants.js";

export function statusUrl() {
  return STATUS_URL;
}

export function streamUrl() {
  return STREAM_URL;
}

export function readCurrentRoute() {
  return normalizeRoute(window.location.pathname);
}

export function routeUrl(routePath) {
  return normalizeRoute(routePath);
}

export function normalizeRoute(value) {
  const path = value || "/";
  const withoutQuery = path.split("?")[0].split("#")[0] || "/";
  const withLeading = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withLeading === "" ? "/" : withLeading;
}

// `/arena/<subnet-pack>` — a subnet's duel is its own PAGE, not a mode of the arena. It gets a real
// URL so it can be linked, refreshed and reached with the back button; the server already falls
// through to index.html for unknown paths, so a hard refresh here loads the app rather than 404ing.
export function arenaPackFromRoute(value) {
  const match = /^\/(?:arena|live)\/(.+)$/.exec(normalizeRoute(value));
  return match ? decodeURIComponent(match[1]) : null;
}

export function arenaPackUrl(pack) {
  return `/arena/${encodeURIComponent(pack)}`;
}
