// A time-to-live cache with an INJECTABLE clock.
//
// `status.mjs` carried four module-level mutable variables -- `cachedStatus`, `cachedAt`,
// `cachedLeaderboard`, `cachedLeaderboardAt` -- read and written from several functions and
// compared against `Date.now()` inline. Three consequences, all of which showed up as difficulty
// rather than as bugs:
//
//   * a test could not advance time, so cache-expiry behaviour was either untested or tested by
//     sleeping, which is slow and flaky;
//   * the two caches had the same shape and separate implementations, so a fix to one did not
//     reach the other;
//   * "is this value fresh?" was answered in the middle of a 130-line function, where it read as
//     incidental rather than as policy.
//
// This is the same behaviour with the clock passed in. Nothing here knows what it caches.

export class TtlCache {
  /**
   * @param {object} options
   * @param {number} options.ttlMs      how long an entry stays fresh
   * @param {() => number} [options.now] monotonic-enough clock; defaults to Date.now
   */
  constructor({ ttlMs, now = Date.now } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new TypeError(`ttlMs must be a non-negative finite number, got ${ttlMs}`);
    }
    this.ttlMs = ttlMs;
    this._now = now;
    this._value = null;
    this._storedAt = null;
    this._key = null;
  }

  /**
   * The cached value if it is still fresh AND was stored under the same key, else null.
   *
   * The key exists because the leaderboard cache is keyed by environment: returning a value
   * computed under a different configuration would be worse than a miss, because it would look
   * like a fast answer instead of a wrong one.
   */
  get(key = null) {
    if (this._storedAt === null) return null;
    if (this._key !== key) return null;
    // A ttl of 0 means "never fresh", which is how the tests disable caching entirely.
    if (this.ttlMs === 0) return null;
    if (this._now() - this._storedAt >= this.ttlMs) return null;
    return this._value;
  }

  set(value, key = null) {
    this._value = value;
    this._key = key;
    this._storedAt = this._now();
    return value;
  }

  /** The stored value regardless of freshness. For an in-place refresh of a stale-but-usable entry. */
  peek() {
    return this._value;
  }

  clear() {
    this._value = null;
    this._storedAt = null;
    this._key = null;
  }
}
