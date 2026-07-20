import assert from "node:assert/strict";
import test from "node:test";

import { streamStamp } from "./index.mjs";

test("streamStamp changes when live challenge progress advances but generatedAt is unchanged", () => {
  // On a cache hit loadBoardStatus refreshes challenge.liveProgress in place while
  // keeping the same generatedAt. The SSE gate must still see a new stamp so the
  // challenge animates every frame instead of once per cache TTL.
  const generatedAt = "2026-07-13T00:00:00.000Z";
  const first = streamStamp({
    generatedAt,
    challenge: { liveProgress: { king: { done: 1, total: 7 } } },
  });
  const second = streamStamp({
    generatedAt,
    challenge: { liveProgress: { king: { done: 2, total: 7 } } },
  });
  assert.notEqual(first, second);
});

test("streamStamp is stable when nothing changes", () => {
  const payload = {
    generatedAt: "2026-07-13T00:00:00.000Z",
    challenge: { liveProgress: { king: { done: 3, total: 7 } } },
  };
  assert.equal(streamStamp(payload), streamStamp({ ...payload }));
});

test("streamStamp tolerates a missing challenge or progress", () => {
  assert.equal(streamStamp({ generatedAt: "t" }), streamStamp({ generatedAt: "t", challenge: null }));
});

test("streamStamp reflects per-lane byLane progress so multi-lane challenges stream", () => {
  const generatedAt = "2026-07-13T00:00:00.000Z";
  const first = streamStamp({
    generatedAt,
    byLane: { "l1:miner": { challenge: { liveProgress: { king: { done: 1, total: 7 } } } } },
  });
  const second = streamStamp({
    generatedAt,
    byLane: { "l1:miner": { challenge: { liveProgress: { king: { done: 2, total: 7 } } } } },
  });
  assert.notEqual(first, second);
});
