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

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "kata-board",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/status", async (_request, response) => {
  try {
    const payload = await loadBoardStatus(process.env);
    response.json(payload);
  } catch (error) {
    response.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : "unknown error"
    });
  }
});

// Unknown API paths get a JSON 404, never the SPA shell — otherwise a typo'd
// or removed /api/* route returns index.html with a 200 and confuses clients.
app.use("/api", (_request, response) => {
  response.status(404).json({ status: "error", message: "unknown endpoint" });
});

if (fs.existsSync(distRoot)) {
  app.use(express.static(distRoot));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distRoot, "index.html"));
  });
}

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
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
