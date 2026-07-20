import { describe, expect, it } from "vitest";
import { PAGES } from "./constants.js";

describe("constants", () => {
  it("exposes the five nav pages", () => {
    expect(PAGES.map((page) => page.path)).toEqual([
      "/",
      "/arena",
      "/winners",
      "/leaderboard",
      "/docs",
    ]);
  });
});
