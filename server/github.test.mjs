import assert from "node:assert/strict";
import test from "node:test";

import {
  githubRequest,
  loadGithubCliLeaderboard,
  parseGithubTokenList
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
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify([{ number: 76 }]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
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
      headers: { "Content-Type": "application/json" }
    });
  };

  await githubRequest("/repos/Autovara/kata/pulls", ["read-a", "read-b"]);
  await githubRequest("/repos/Autovara/kata/pulls", ["read-a", "read-b"]);

  assert.equal(authorizations.length, 2);
  assert(authorizations.every((value) => ["Bearer read-a", "Bearer read-b"].includes(value)));
  assert.equal(new Set(authorizations).size, 2);
});

test("parseGithubTokenList trims comma-separated read tokens", () => {
  assert.deepEqual(parseGithubTokenList(" read-a,read-b, , read-c "), [
    "read-a",
    "read-b",
    "read-c"
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
      files: [{ path: "submissions/sn60__bitsec/miner/jonathan-20260707-01/agent.py" }]
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
      files: [{ path: "submissions/sn60__bitsec/miner/davion-knight-20260707-01/agent.py" }]
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
      files: [{ path: "submissions/sn60__bitsec/miner/reviewer-20260707-01/agent.py" }]
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
      files: [{ path: "README.md" }]
    }
  ]);

  const leaderboard = loadGithubCliLeaderboard({
    repoSlug: "Autovara/kata",
    run: () => output
  });

  assert.equal(leaderboard.source, "github-cli");
  assert.deepEqual(
    leaderboard.rows.map((row) => row.author),
    ["jonathanchang31", "reviewer", "davion-knight"]
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
  assert.equal(
    leaderboard.latestLaneWinners["sn60__bitsec::miner"].author,
    "jonathanchang31"
  );
});
