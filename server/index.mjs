import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadBoardStatus } from "./status.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
loadDotEnv(path.join(projectRoot, ".env"));

const app = express();
const port = Number.parseInt(process.env.PORT || "8787", 10);
const kataAssetsRoot = path.resolve(
  process.env.KATA_ASSETS_DIR || path.join(projectRoot, "..", "kata", "assets")
);

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "kata-board",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/status", async (_request, response) => {
  try {
    const payload = await loadBoardStatus(process.env);
    response.json(payload);
  } catch (error) {
    response.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
});

// Real-time push. Clients subscribe with EventSource. A SINGLE shared interval
// computes loadBoardStatus once per tick and fans the result out to every
// subscriber, so N clients cost O(1) status builds per tick, not O(N). (Previously
// each connection ran its own interval + status build; a reconnect spiral then
// multiplied the work until the event loop was saturated and new connections were
// starved out of the accept queue — the whole dashboard would fail to load.)
const sseClients = new Set();
let sseTimer = null;
let sseLastStamp = null;

function writeToClient(response, chunk) {
  try {
    response.write(chunk);
  } catch {
    // A client that died without firing "close": drop it so it stops costing writes.
    sseClients.delete(response);
    try {
      response.end();
    } catch {
      /* already torn down */
    }
  }
}

async function broadcastBoardStatus() {
  if (sseClients.size === 0) {
    return;
  }
  let chunk;
  try {
    const payload = await loadBoardStatus(process.env);
    // Gate on a stamp that also reflects live challenge progress. On a cache hit
    // loadBoardStatus refreshes challenge.liveProgress but keeps the same
    // generatedAt, so gating on generatedAt alone would drop every mid-challenge
    // progress frame and the challenge would only animate once per cache TTL.
    const stamp = streamStamp(payload);
    if (stamp !== sseLastStamp) {
      sseLastStamp = stamp;
      chunk = `data: ${JSON.stringify(payload)}\n\n`;
    } else {
      // Liveness as a NAMED event: the client listens for "heartbeat" to keep its
      // stream-freshness watchdog satisfied, but a named event does NOT fire the
      // default `onmessage`, so it never disturbs the rendered state — and older
      // cached clients (which only handle onmessage) simply ignore it.
      chunk = "event: heartbeat\ndata: 1\n\n";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    chunk = `data: ${JSON.stringify({ __error: message })}\n\n`;
  }
  for (const response of [...sseClients]) {
    writeToClient(response, chunk);
  }
}

app.get("/api/stream", async (_request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable reverse-proxy response buffering so events flush immediately.
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();
  sseClients.add(response);

  // Give this new subscriber an immediate snapshot: the shared broadcast only fires
  // on a stamp change, so a client joining between changes would otherwise see
  // nothing until the next one. loadBoardStatus is cached, so this is a cheap hit.
  try {
    const payload = await loadBoardStatus(process.env);
    writeToClient(response, `data: ${JSON.stringify(payload)}\n\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    writeToClient(response, `data: ${JSON.stringify({ __error: message })}\n\n`);
  }

  if (!sseTimer) {
    sseTimer = setInterval(broadcastBoardStatus, streamIntervalMs(process.env));
  }

  _request.on("close", () => {
    sseClients.delete(response);
    try {
      response.end();
    } catch {
      /* already torn down */
    }
    if (sseClients.size === 0 && sseTimer) {
      clearInterval(sseTimer);
      sseTimer = null;
    }
  });
});

// Unknown API paths get a JSON 404, never the SPA shell — otherwise a typo'd
// or removed /api/* route returns index.html with a 200 and confuses clients.
app.use("/api", (_request, response) => {
  response.status(404).json({ status: "error", message: "unknown endpoint" });
});

if (fs.existsSync(kataAssetsRoot)) {
  app.use(
    "/kata-assets",
    express.static(kataAssetsRoot, {
      fallthrough: true,
      immutable: false,
      maxAge: "10m",
    })
  );
}

if (fs.existsSync(distRoot)) {
  // Hashed asset files (index-<hash>.js/.css) are safe to cache forever; the HTML
  // shell must never be cached, or a refresh keeps loading a stale bundle reference.
  app.use(express.static(distRoot, { setHeaders: setAssetCacheHeaders }));
  app.get("*", (_request, response) => {
    response.set("Cache-Control", "no-cache, no-store, must-revalidate");
    response.sendFile(path.join(distRoot, "index.html"));
  });
}

function setAssetCacheHeaders(response, filePath) {
  if (filePath.endsWith("index.html")) {
    response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  } else if (/\/assets\//.test(filePath)) {
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

// Only bind the port when run directly (node server/index.mjs); importing this
// module in tests must not start a server.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  const server = app.listen(port, () => {
    console.log(`kata-board listening on http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(
        `kata-board could not start because port ${port} is already in use. ` +
          `Stop the existing process or rerun with PORT=<free-port> npm run dev`
      );
      process.exit(1);
    }

    throw error;
  });
}

// A stream identity for the payload: the generatedAt timestamp plus the live
// challenge progress, which changes on a cache hit while generatedAt does not.
export function streamStamp(payload) {
  const progress = payload?.challenge?.liveProgress;
  // Include EACH lane's live progress so the SSE stream also pushes multi-lane challenge updates
  // (byLane progress advances on a cache hit while generatedAt does not).
  const byLane = payload?.byLane;
  let laneProgress = "";
  if (byLane && typeof byLane === "object") {
    laneProgress = Object.keys(byLane)
      .sort()
      .map((id) => {
        const p = byLane[id]?.challenge?.liveProgress;
        return `${id}:${p ? JSON.stringify(p) : ""}`;
      })
      .join("|");
  }
  return `${payload?.generatedAt ?? ""}|${progress ? JSON.stringify(progress) : ""}|${laneProgress}`;
}

function streamIntervalMs(env) {
  const parsed = Number.parseInt(env.KATA_STREAM_INTERVAL_MS || "1000", 10);
  if (Number.isFinite(parsed) && parsed >= 500) {
    return parsed;
  }
  return 1000;
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = stripEnvQuotes(value);
    }
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
