import { describe, expect, it } from "vitest";
import { normalizeRoute, routeUrl } from "./route.js";

describe("normalizeRoute", () => {
  it("defaults empty/nullish input to /", () => {
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute(null)).toBe("/");
    expect(normalizeRoute(undefined)).toBe("/");
  });

  it("strips query strings and hashes", () => {
    expect(normalizeRoute("/arena?tab=live")).toBe("/arena");
    expect(normalizeRoute("/arena#section")).toBe("/arena");
  });

  it("adds a leading slash when missing", () => {
    expect(normalizeRoute("winners")).toBe("/winners");
  });

  it("passes a normal path through unchanged", () => {
    expect(normalizeRoute("/leaderboard")).toBe("/leaderboard");
  });

  it("routeUrl normalizes its argument", () => {
    expect(routeUrl("docs")).toBe("/docs");
  });
});
