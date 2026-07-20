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

// Real-time push. The client subscribes with EventSource; we emit a fresh
// payload whenever the status timestamp changes and a lightweight keep-alive
// comment otherwise. loadBoardStatus is cached, so a short interval is cheap.
app.get("/api/stream", async (_request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable reverse-proxy response buffering so events flush immediately.
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();

  let closed = false;
  let lastStamp = null;

  async function push() {
    if (closed) {
      return;
    }
    try {
      const payload = await loadBoardStatus(process.env);
      // The client may have disconnected during the await; writing to an ended
      // response throws an unhandled rejection out of the interval callback.
      if (closed) {
        return;
      }
      // Gate on a stamp that also reflects live challenge progress. On a cache hit
      // loadBoardStatus refreshes challenge.liveProgress but keeps the same
      // generatedAt, so gating on generatedAt alone would drop every mid-challenge
      // progress frame and the challenge would only animate once per cache TTL.
      const stamp = streamStamp(payload);
      if (stamp !== lastStamp) {
        lastStamp = stamp;
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      } else {
        response.write(":\n\n"); // keep-alive comment
      }
    } catch (error) {
      if (closed) {
        return;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      response.write(`data: ${JSON.stringify({ __error: message })}\n\n`);
    }
  }

  await push();
  const interval = setInterval(push, streamIntervalMs(process.env));
  _request.on("close", () => {
    closed = true;
    clearInterval(interval);
    response.end();
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
  app.use(express.static(distRoot));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distRoot, "index.html"));
  });
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
