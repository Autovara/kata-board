// The cache's whole reason to exist as a component is that its clock can be advanced. If these
// tests had to sleep, the extraction would have bought nothing.

import assert from "node:assert/strict";
import test from "node:test";

import { TtlCache } from "./ttlCache.mjs";

function fakeClock(start = 1000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test("a fresh entry is returned", () => {
  const cache = new TtlCache({ ttlMs: 100, now: fakeClock() });
  cache.set({ ok: true });
  assert.deepEqual(cache.get(), { ok: true });
});

test("an entry expires exactly at the ttl, not after it", () => {
  const now = fakeClock();
  const cache = new TtlCache({ ttlMs: 100, now });
  cache.set("v");
  now.advance(99);
  assert.equal(cache.get(), "v");
  now.advance(1);
  assert.equal(cache.get(), null, "at ttl the entry is stale");
});

test("a ttl of zero disables caching", () => {
  // This is how the board's own tests turn caching off; if it silently cached, every test that
  // mutates state between reads would see a stale board.
  const cache = new TtlCache({ ttlMs: 0, now: fakeClock() });
  cache.set("v");
  assert.equal(cache.get(), null);
});

test("a value stored under a different key is a miss, not a fast wrong answer", () => {
  const cache = new TtlCache({ ttlMs: 1000, now: fakeClock() });
  cache.set("computed-for-A", "A");
  assert.equal(cache.get("A"), "computed-for-A");
  assert.equal(cache.get("B"), null);
});

test("peek returns a stale value for an in-place refresh", () => {
  const now = fakeClock();
  const cache = new TtlCache({ ttlMs: 10, now });
  cache.set({ n: 1 });
  now.advance(1000);
  assert.equal(cache.get(), null, "stale for a normal read");
  assert.deepEqual(cache.peek(), { n: 1 }, "still available to refresh in place");
});

test("clear forgets the value and the key", () => {
  const cache = new TtlCache({ ttlMs: 1000, now: fakeClock() });
  cache.set("v", "k");
  cache.clear();
  assert.equal(cache.get("k"), null);
  assert.equal(cache.peek(), null);
});

test("an invalid ttl is refused at construction", () => {
  // Caught where the cache is declared rather than on the first read that silently never expires.
  for (const bad of [undefined, -1, NaN, Infinity, "100"]) {
    assert.throws(() => new TtlCache({ ttlMs: bad }), TypeError);
  }
});

test("an empty cache is a miss", () => {
  assert.equal(new TtlCache({ ttlMs: 100, now: fakeClock() }).get(), null);
});
