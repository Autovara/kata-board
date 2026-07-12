import { describe, expect, it } from "vitest";
import { KATA_IMAGES, PAGES, assetUrl } from "./constants.js";

describe("assetUrl", () => {
  it("URL-encodes the filename under the asset base", () => {
    expect(assetUrl("Community Competition.png")).toContain(
      "Community%20Competition.png"
    );
  });
});

describe("constants", () => {
  it("builds asset urls for the hero images", () => {
    expect(KATA_IMAGES.proof).toContain("proof.png");
    expect(KATA_IMAGES.heroDashboard).toContain("hero-dashboard.png");
  });

  it("exposes the five nav pages", () => {
    expect(PAGES.map((page) => page.path)).toEqual([
      "/",
      "/arena",
      "/winners",
      "/leaderboard",
      "/docs"
    ]);
  });
});
