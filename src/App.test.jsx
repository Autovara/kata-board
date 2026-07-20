import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The decorative canvas background is irrelevant to page smoke tests and needs
// canvas/matchMedia APIs jsdom lacks.
vi.mock("./GridBackground.jsx", () => ({ default: () => null }));

import App from "./App.jsx";

// A minimal-but-plausible /api/status payload that exercises each page's empty
// states. It is deliberately small; the point is that every route mounts and
// renders without throwing, which is the safety net for splitting App.jsx.
const FIXTURE = {
  generatedAt: "2026-07-12T00:00:00Z",
  lanes: [],
  validator: { queue: { available: false }, health: {} },
  publicProof: null,
  challenge: null,
  challengeHistory: [],
  leaderboard: { rows: [] },
  publicLinks: { kataRepo: "Autovara/kata" },
};

function mockStatus(payload = FIXTURE) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
}

async function renderRoute(path) {
  window.history.pushState({}, "", path);
  render(<App />);
  await waitFor(() => expect(screen.queryByText("Loading board...")).not.toBeInTheDocument());
}

describe("App routes render without crashing", () => {
  beforeEach(() => mockStatus());

  it.each([
    ["/", "Dashboard"],
    ["/arena", "Arena"],
    ["/winners", "Winners"],
    ["/leaderboard", "Leaderboard"],
    ["/docs", "Docs"],
  ])("mounts the %s route", async (path) => {
    await renderRoute(path);
    // The always-present nav proves the shell + page mounted after data load.
    for (const label of ["Dashboard", "Arena", "Winners", "Leaderboard", "Docs"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("falls back to fetch polling and surfaces a load error", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ message: "boom" }),
    }));
    window.history.pushState({}, "", "/");
    render(<App />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("documents miner-funded inference without obsolete validator caps", async () => {
    await renderRoute("/docs");
    fireEvent.click(screen.getByRole("tab", { name: /submit/i }));

    expect(screen.getByText("Miner-funded inference")).toBeInTheDocument();
    expect(
      screen.getByText(/Kata does not impose validator model, token, call, or retry caps/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/qwen\/qwen/i)).not.toBeInTheDocument();
  });
});
