// The board with TWO active subnets.
//
// Everything here was written against a one-lane board and silently degrades rather than breaking:
// a page that renders only the first lane looks completely healthy when there is only one. So each
// test below asserts something about the SECOND lane specifically -- a version of these that passed
// on a single-lane payload would be testing nothing.
//
// The lane-activation gate itself (a lane must be `active: true` to appear at all) is server-side
// and covered by server/twoLaneSn22.test.mjs. This file assumes discovery already happened.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./GridBackground.jsx", () => ({ default: () => null }));

import App from "./App.jsx";

const SN60 = "sn60__bitsec:miner";
const SN22 = "sn22__desearch:miner";

function lane(id, subnetPack, king) {
  return { id, subnetPack, mode: "miner", king, currentHolder: king?.author || null };
}

/** Two lanes, deliberately asymmetric: SN60 has a duel running and a king who earned it, SN22 is
 *  idle behind a seeded king. A board that renders only its first lane cannot fake this. */
const TWO_LANE = {
  generatedAt: "2026-07-28T23:00:00Z",
  publicLinks: { kataRepo: "Autovara/kata" },
  overview: { activeLanes: 2, uniqueChallengers: 34, totalSubmissions: 120 },
  lanes: [
    lane(SN60, "sn60__bitsec", { author: "bohdansolovie", submissionId: "bohdansolovie-20260723-08" }),
    lane(SN22, "sn22__desearch", { author: "kata", submissionId: "kata-seed-20260728-01", seeded: true }),
  ],
  byLane: {
    [SN60]: {
      challenge: { state: "executing", challengeNumber: 19, entrants: [] },
      challengeHistory: [{ challengeId: "sn60-1" }, { challengeId: "sn60-2" }],
      leaderboard: { rows: [] },
    },
    [SN22]: {
      challenge: { state: "idle", challengeNumber: 1, entrants: [] },
      challengeHistory: [],
      leaderboard: { rows: [] },
    },
  },
  validator: { queue: { available: false }, health: {} },
  challenge: { state: "executing", challengeNumber: 19, entrants: [] },
  challengeHistory: [],
  // One global table across both subnets, ranked by Gittensor score -- the reward currency both
  // lanes pay into. sn22_combined_score decides SN22's king; it is not a cross-subnet quantity.
  leaderboard: {
    rows: [
      { author: "bohdansolovie", wins: 3, totalSubmissions: 12, gittensorScore: 0.0747,
        poolShare: 0.62, currentKings: 1 },
      { author: "kata", wins: 1, totalSubmissions: 1, gittensorScore: 0.01, poolShare: 0.08,
        currentKings: 1 },
    ],
  },
};

function mockStatus(payload = TWO_LANE) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
}

/** The duel header names the challenge number, which is the one thing that differs between the two
 *  lanes in this fixture -- so it is how a test tells SN22's duel from SN60's. */
function duelHeading() {
  return document.querySelector(".challenge-block .section-title")?.textContent ?? null;
}

async function renderRoute(path) {
  window.history.pushState({}, "", path);
  render(<App />);
  await waitFor(() => expect(screen.queryByText("Loading board...")).not.toBeInTheDocument());
}

beforeEach(() => mockStatus());

describe("dashboard", () => {
  it("counts both subnets as active", async () => {
    await renderRoute("/");
    const tile = screen.getByText("Active subnets").closest(".stat-tile");
    // The value counts up from 0, so the first frame is always 0 regardless of the payload.
    await waitFor(() =>
      expect(within(tile).getByText("2", { exact: false })).toBeInTheDocument()
    );
  });

  it("renders a card for each subnet, not just the first", async () => {
    await renderRoute("/");
    expect(screen.getAllByText("sn60__bitsec").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sn22__desearch").length).toBeGreaterThan(0);
  });
});

describe("arena", () => {
  it("lands on a bare card list — no heading, no blurb, no duel", async () => {
    await renderRoute("/arena");
    expect(document.querySelectorAll(".arena-subnets .subnet-card").length).toBe(2);
    // The chooser REPLACES the duel rather than sitting above it; otherwise the page would
    // silently be showing lane one's duel before anything was picked.
    expect(document.querySelector(".challenge-block")).toBeNull();
    // Nothing but the cards. A heading here was removed deliberately, and a page-intro creeping
    // back in is exactly the kind of change that gets made without anyone deciding to make it.
    expect(document.querySelector(".arena-subnets .page-intro")).toBeNull();
  });

  it("navigates to the subnet's own URL when its card is clicked", async () => {
    await renderRoute("/arena");
    const sn22Card = [...document.querySelectorAll(".subnet-card")].find((card) =>
      within(card).queryByText("sn22__desearch")
    );
    fireEvent.click(sn22Card);
    // A real page, not a mode: the duel must be linkable, refreshable and back-buttonable.
    await waitFor(() => expect(window.location.pathname).toBe("/arena/sn22__desearch"));
    expect(document.querySelector(".arena-subnets")).toBeNull();
    expect(duelHeading()).toBe("Current challenge · Challenge 1");
  });

  it("opens a subnet's duel directly from its URL", async () => {
    // The route IS the selection. If the page read the manually-picked lane instead, a shared link
    // would show whichever subnet the visitor last clicked -- with no sign anything was wrong.
    await renderRoute("/arena/sn22__desearch");
    expect(document.querySelector(".arena-subnets")).toBeNull();
    // Assert WHICH subnet, not merely that a duel rendered. SN22 is on challenge 1 and SN60 on 19,
    // so a page that ignored the URL and fell back to the picked lane would show 19 here -- and an
    // assertion that only checked "a duel exists" would pass on exactly that bug.
    expect(duelHeading()).toBe("Current challenge · Challenge 1");
  });

  it("goes back to the card list", async () => {
    await renderRoute("/arena/sn22__desearch");
    fireEvent.click(document.querySelector(".arena-back"));
    await waitFor(() => expect(window.location.pathname).toBe("/arena"));
    expect(document.querySelectorAll(".arena-subnets .subnet-card").length).toBe(2);
  });

  it("marks the live subnet as scoring and the idle one as idle", async () => {
    await renderRoute("/arena");
    const cards = [...document.querySelectorAll(".arena-subnets .subnet-card")];
    const sn60 = cards.find((card) => within(card).queryByText("sn60__bitsec"));
    const sn22 = cards.find((card) => within(card).queryByText("sn22__desearch"));
    expect(within(sn60).getByText("scoring")).toBeInTheDocument();
    expect(within(sn22).getByText("idle")).toBeInTheDocument();
  });
});

describe("winners", () => {
  it("shows one king card per subnet", async () => {
    await renderRoute("/winners");
    const cards = [...document.querySelectorAll(".king-card")];
    expect(cards.length).toBe(2);
    expect(within(cards[0]).getByText("SN60 Bitsec")).toBeInTheDocument();
    expect(within(cards[1]).getByText("SN22 Desearch")).toBeInTheDocument();
  });

  it("marks a seeded king as seeded rather than as an earned crown", async () => {
    await renderRoute("/winners");
    // The first SN22 king won an empty throne. Showing it exactly like an earned one would
    // misrepresent the ladder to every miner reading the page.
    //
    // Scoped to the SN22 card on purpose: SN60's card carries the words "seed baseline" in an
    // unrelated fact, so a page-wide text match would pass on a board that never marked SN22 at all.
    const sn22 = [...document.querySelectorAll(".king-card")].find((card) =>
      within(card).queryByText("SN22 Desearch")
    );
    expect(within(sn22).getByText("seed king")).toBeInTheDocument();
  });
});

describe("leaderboard", () => {
  it("ranks every miner across both subnets by gittensor score", async () => {
    await renderRoute("/leaderboard");
    const rows = [...document.querySelectorAll(".lb-row")];
    expect(rows.length).toBe(2);
    expect(within(rows[0]).getByText("bohdansolovie")).toBeInTheDocument();
    expect(within(rows[1]).getByText("kata")).toBeInTheDocument();
  });
});


