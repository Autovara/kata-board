import assert from "node:assert/strict";
import test from "node:test";

import { streamStamp } from "./index.mjs";

test("streamStamp changes when live round progress advances but generatedAt is unchanged", () => {
  // On a cache hit loadBoardStatus refreshes round.liveProgress in place while
  // keeping the same generatedAt. The SSE gate must still see a new stamp so the
  // round animates every frame instead of once per cache TTL.
  const generatedAt = "2026-07-13T00:00:00.000Z";
  const first = streamStamp({
    generatedAt,
    round: { liveProgress: { king: { done: 1, total: 7 } } }
  });
  const second = streamStamp({
    generatedAt,
    round: { liveProgress: { king: { done: 2, total: 7 } } }
  });
  assert.notEqual(first, second);
});

test("streamStamp is stable when nothing changes", () => {
  const payload = {
    generatedAt: "2026-07-13T00:00:00.000Z",
    round: { liveProgress: { king: { done: 3, total: 7 } } }
  };
  assert.equal(streamStamp(payload), streamStamp({ ...payload }));
});

test("streamStamp tolerates a missing round or progress", () => {
  assert.equal(
    streamStamp({ generatedAt: "t" }),
    streamStamp({ generatedAt: "t", round: null })
  );
});
