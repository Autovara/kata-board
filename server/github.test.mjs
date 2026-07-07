import assert from "node:assert/strict";
import test from "node:test";

import { githubRequest } from "./github.mjs";

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
