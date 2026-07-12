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
