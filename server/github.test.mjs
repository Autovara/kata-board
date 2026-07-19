import assert from "node:assert/strict";
import test from "node:test";

import {
  githubRequest,
  loadGithubCliLeaderboard,
  loadGithubLeaderboard,
  parseGithubTokenList,
} from "./github.mjs";

test("githubRequest retries public reads without a rejected token", async (t) => {
  const originalFetch = globalThis.fetch;
  const authorizations = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options = {}) => {
    authorizations.push(options.headers?.Authorization || null);
    if (authorizations.length === 1) {
      return new Response(JSON.stringify({ message: "bad credentials" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{ number: 76 }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const payload = await githubRequest("/repos/Autovara/kata/pulls", "bad-token");

  assert.deepEqual(payload, [{ number: 76 }]);
  assert.deepEqual(authorizations, ["Bearer bad-token", null]);
});

test("githubRequest rotates configured read tokens", async (t) => {
  const originalFetch = globalThis.fetch;
  const authorizations = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options = {}) => {
    authorizations.push(options.headers?.Authorization || null);
    return new Response(JSON.stringify([{ number: authorizations.length }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await githubRequest("/repos/Autovara/kata/pulls", ["read-a", "read-b"]);
  await githubRequest("/repos/Autovara/kata/pulls", ["read-a", "read-b"]);

  assert.equal(authorizations.length, 2);
  assert(authorizations.every((value) => ["Bearer read-a", "Bearer read-b"].includes(value)));
  assert.equal(new Set(authorizations).size, 2);
});

test("githubRequest fails over to another token when one is rate-limited", async (t) => {
  const originalFetch = globalThis.fetch;
  const authorizations = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options = {}) => {
    const auth = options.headers?.Authorization || null;
    authorizations.push(auth);
    // Whichever token is tried first is exhausted (rate-limited); the failover
    // attempt (a different token) still has quota.
    if (authorizations.length === 1) {
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{ number: 99 }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const payload = await githubRequest("/repos/Autovara/kata/pulls", ["read-a", "read-b"]);

  // Failed over to the OTHER token, not down to an unauthenticated read.
  assert.deepEqual(payload, [{ number: 99 }]);
  assert.equal(authorizations.length, 2);
  assert.ok(!authorizations.includes(null));
  assert.notEqual(authorizations[0], authorizations[1]);
  assert.ok(authorizations.every((value) => ["Bearer read-a", "Bearer read-b"].includes(value)));
});

test("parseGithubTokenList trims comma-separated read tokens", () => {
  assert.deepEqual(parseGithubTokenList(" read-a,read-b, , read-c "), [
    "read-a",
    "read-b",
    "read-c",
  ]);
});

test("loadGithubCliLeaderboard ranks all miner PR contributors from gh output", () => {
  const output = JSON.stringify([
    {
      number: 76,
      title: "feat(sn60): add jonathan-20260707-01 miner submission",
      state: "MERGED",
      mergedAt: "2026-07-07T16:46:36Z",
      updatedAt: "2026-07-07T16:46:36Z",
      url: "https://github.com/Autovara/kata/pull/76",
      author: { login: "jonathanchang31" },
      labels: [{ name: "kata:winner:sn60__bitsec" }],
      files: [{ path: "submissions/sn60__bitsec/miner/jonathan-20260707-01/agent.py" }],
    },
    {
      number: 84,
      title: "feat(sn60): add davion miner",
      state: "CLOSED",
      mergedAt: null,
      updatedAt: "2026-07-07T17:00:00Z",
      url: "https://github.com/Autovara/kata/pull/84",
      author: { login: "davion-knight" },
      labels: [{ name: "kata:losing" }],
      files: [{ path: "submissions/sn60__bitsec/miner/davion-knight-20260707-01/agent.py" }],
    },
    {
      number: 85,
      title: "feat(sn60): add review miner",
      state: "OPEN",
      mergedAt: null,
      updatedAt: "2026-07-07T18:00:00Z",
      url: "https://github.com/Autovara/kata/pull/85",
      author: { login: "reviewer" },
      labels: [{ name: "kata:review" }],
      files: [{ path: "submissions/sn60__bitsec/miner/reviewer-20260707-01/agent.py" }],
    },
    {
      number: 80,
      title: "docs only",
      state: "CLOSED",
      mergedAt: null,
      updatedAt: "2026-07-07T17:00:00Z",
      url: "https://github.com/Autovara/kata/pull/80",
      author: { login: "maintainer" },
      labels: [],
      files: [{ path: "README.md" }],
    },
  ]);

  const leaderboard = loadGithubCliLeaderboard({
    repoSlug: "Autovara/kata",
    run: () => output,
  });

  assert.equal(leaderboard.source, "github-cli");
  assert.deepEqual(
    leaderboard.rows.map((row) => row.author),
    ["jonathanchang31", "davion-knight", "reviewer"]
  );
  assert.equal(leaderboard.rows[0].wins, 1);
  assert.ok(leaderboard.rows[0].gittensorScore > 0);
  assert.ok(leaderboard.rows[0].gittensorScore <= 1);
  const reviewer = leaderboard.rows.find((row) => row.author === "reviewer");
  const davion = leaderboard.rows.find((row) => row.author === "davion-knight");
  assert.equal(reviewer.reviewSubmissions, 1);
  assert.equal(reviewer.recentPulls[0].statusLabel, "kata:review");
  assert.equal(davion.closedSubmissions, 1);
  assert.equal(davion.losingSubmissions, 1);
  assert.equal(leaderboard.latestLaneWinners["sn60__bitsec::miner"].author, "jonathanchang31");
});

test("loadGithubCliLeaderboard counts a subnet-qualified defeat as a historical win", () => {
  const output = JSON.stringify([
    {
      number: 98,
      title: "feat(sn60): add kianni miner",
      state: "MERGED",
      mergedAt: "2026-07-09T10:00:00Z",
      updatedAt: "2026-07-09T10:00:00Z",
      url: "https://github.com/Autovara/kata/pull/98",
      author: { login: "kiannidev" },
      labels: [{ name: "kata:defeat:sn60__bitsec" }],
      files: [{ path: "submissions/sn60__bitsec/miner/kianni-20260708-01/agent.py" }],
    },
    {
      number: 124,
      title: "feat(sn60): add daedalus miner",
      state: "MERGED",
      mergedAt: "2026-07-11T01:26:38Z",
      updatedAt: "2026-07-11T01:26:38Z",
      url: "https://github.com/Autovara/kata/pull/124",
      author: { login: "Daedalus-Icarus" },
      labels: [{ name: "kata:winner:sn60__bitsec" }],
      files: [{ path: "submissions/sn60__bitsec/miner/daedalus-20260710-01/agent.py" }],
    },
  ]);

  const leaderboard = loadGithubCliLeaderboard({
    repoSlug: "Autovara/kata",
    run: () => output,
  });

  const kianni = leaderboard.rows.find((row) => row.author === "kiannidev");
  const daedalus = leaderboard.rows.find((row) => row.author === "Daedalus-Icarus");
  // Both won a round, so each keeps one historical win.
  assert.equal(kianni.wins, 1, "dethroned king should still have 1 win");
  assert.equal(daedalus.wins, 1);
  // But the current king is the winner PR, not the dethroned one.
  assert.equal(leaderboard.latestLaneWinners["sn60__bitsec::miner"].author, "Daedalus-Icarus");
  assert.equal(leaderboard.latestLaneWinners["sn60__bitsec::miner"].pullNumber, 124);
});

test("githubRequest does not fall back to an unauthenticated read on a 429", async (t) => {
  const originalFetch = globalThis.fetch;
  const authorizations = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options = {}) => {
    authorizations.push(options.headers?.Authorization || null);
    // Every token hits the secondary rate limit (429). An unauthenticated read
    // shares the same per-IP secondary limit, so it must NOT be attempted.
    return new Response(JSON.stringify({ message: "too many requests" }), {
      status: 429,
      statusText: "too many requests",
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(
    () => githubRequest("/repos/Autovara/kata/pulls", ["read-a", "read-b"]),
    /429/
  );
  // Both tokens were tried; no unauthenticated (null Authorization) attempt.
  assert.deepEqual(authorizations, ["Bearer read-a", "Bearer read-b"]);
  assert.ok(!authorizations.includes(null));
});

test("loadGithubLeaderboard builds from labels without per-PR file fetches", async (t) => {
  const originalFetch = globalThis.fetch;
  const fetchedPaths = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    const path = String(url);
    fetchedPaths.push(path);
    if (path.includes("/pulls?") && path.includes("page=1")) {
      return new Response(
        JSON.stringify([
          {
            number: 156, title: "add miner", state: "closed",
            merged_at: "2026-07-18T09:58:00Z", created_at: "2026-07-17T14:00:00Z",
            updated_at: "2026-07-18T09:58:00Z",
            html_url: "https://github.com/Autovara/kata/pull/156",
            user: { login: "bohdansolovie" },
            labels: [{ name: "kata:winner:sn60__bitsec" }],
          },
          {
            number: 160, title: "another miner", state: "open", merged_at: null,
            created_at: "2026-07-19T02:00:00Z", updated_at: "2026-07-19T02:49:00Z",
            html_url: "https://github.com/Autovara/kata/pull/160",
            user: { login: "someminer" },
            labels: [{ name: "kata:executing" }],
          },
          {
            number: 3, title: "engine fix (not a submission)", state: "closed",
            merged_at: "2026-07-10T00:00:00Z", created_at: "2026-07-09T00:00:00Z",
            updated_at: "2026-07-10T00:00:00Z",
            html_url: "https://github.com/Autovara/kata/pull/3",
            user: { login: "maintainer" }, labels: [],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify([]), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };

  const leaderboard = await loadGithubLeaderboard({
    repoSlug: "Autovara/kata", githubTokens: ["read-a"],
  });

  // The N+1 per-PR /files fetch (what tripped GitHub's secondary rate limit) is gone.
  assert.ok(!fetchedPaths.some((p) => p.includes("/files")), "must not fetch per-PR files");
  assert.equal(leaderboard.source, "github");
  // Label-based relevance: only the two kata-labelled PRs; the unlabelled engine PR is excluded.
  const authors = leaderboard.rows.map((r) => r.author).sort();
  assert.deepEqual(authors, ["bohdansolovie", "someminer"]);
  const winner = leaderboard.rows.find((r) => r.author === "bohdansolovie");
  assert.ok(winner && winner.wins >= 1, "winner-labelled PR counts as a win");
});
