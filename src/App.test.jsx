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

describe("Arena latest-challenge outcome", () => {
  // Regression for the PR #195/#197 incident: PR #197 WON its challenge but its promotion
  // was rejected (stale-king guard), so it never became king. The card inferred "New king"
  // from the mere presence of a winner and announced the wrong PR as the new king.
  function arenaPayload({ kingPull, winnerSubmissionId }) {
    return {
      ...FIXTURE,
      lanes: [
        {
          id: "sn60__bitsec:miner",
          laneId: "sn60__bitsec",
          subnetPack: "sn60__bitsec",
          mode: "miner",
          king: {
            author: "bohdansolovie",
            submissionId: "bohdansolovie-20260723-08",
            sourcePullRequest: kingPull,
          },
        },
      ],
      byLane: {
        "sn60__bitsec:miner": {
          challenge: null,
          challengeHistory: [
            {
              runId: "sn60-challenge-20260723T065433Z-081c92",
              challengeNumber: 34,
              winnerSubmissionId,
            },
          ],
          publicProof: null,
        },
      },
    };
  }

  it("does not crown a challenge winner that was never promoted", async () => {
    mockStatus(arenaPayload({ kingPull: 195, winnerSubmissionId: "pr-197" }));
    await renderRoute("/arena");

    expect(screen.getByText(/Winner awaiting promotion/i)).toBeInTheDocument();
    expect(screen.queryByText(/New king/i)).not.toBeInTheDocument();
  });

  it("still shows a new king when the winner is the reigning king", async () => {
    mockStatus(arenaPayload({ kingPull: 195, winnerSubmissionId: "pr-195" }));
    await renderRoute("/arena");

    expect(screen.getByText(/New king/i)).toBeInTheDocument();
    expect(screen.queryByText(/Winner awaiting promotion/i)).not.toBeInTheDocument();
  });
});

describe("interrupted round", () => {
  // A round killed mid-challenge leaves challenge-status.json terminal-but-unfinished.
  // The board must say so plainly instead of animating a phantom running challenge or
  // silently showing a result-less panel.
  it("explains an interrupted round instead of showing it as running", async () => {
    mockStatus({
      ...FIXTURE,
      lanes: [
        {
          id: "sn60__bitsec:miner",
          laneId: "sn60__bitsec",
          subnetPack: "sn60__bitsec",
          mode: "miner",
          king: { author: "bohdansolovie", sourcePullRequest: 195 },
        },
      ],
      byLane: {
        "sn60__bitsec:miner": {
          challenge: {
            state: "interrupted",
            runId: "sn60-challenge-20260723T135145Z-e749f1",
            challengeNumber: 35,
            winnerSubmissionId: null,
            entrants: [{ pull_number: 197, status: "interrupted" }],
          },
          challengeHistory: [],
          publicProof: null,
        },
      },
    });
    await renderRoute("/arena");

    expect(screen.getByText("Round interrupted")).toBeInTheDocument();
    expect(screen.getByText(/no result was recorded and the crown did not change/i)).toBeInTheDocument();
    expect(screen.queryByText("New king")).not.toBeInTheDocument();
  });
});
