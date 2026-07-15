import { spawn } from "node:child_process";
import net from "node:net";

const DEFAULT_API_PORT = 8787;
const MAX_PORT_SCAN = 25;
const requestedPort = Number.parseInt(process.env.PORT || `${DEFAULT_API_PORT}`, 10);
const explicitApiTarget = process.env.VITE_API_TARGET?.trim() || "";

const childProcesses = [];
let shuttingDown = false;

function log(message) {
  console.log(`[kata-board:dev] ${message}`);
}

function prefixStream(stream, prefix, target) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) {
        target.write(`${prefix} ${line}\n`);
      }
    }
  });
}

function spawnCommand(name, command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  childProcesses.push(child);
  prefixStream(child.stdout, `[${name}]`, process.stdout);
  prefixStream(child.stderr, `[${name}]`, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    log(`${name} exited with ${reason}`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
  setTimeout(() => process.exit(exitCode), 50);
}

function waitForSignal(signal) {
  process.on(signal, () => shutdown(0));
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isKataBoardApiReachable(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload?.service === "kata-board";
  } catch {
    return false;
  }
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + MAX_PORT_SCAN; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `could not find a free API port in range ${startPort}-${startPort + MAX_PORT_SCAN - 1}`
  );
}

async function resolveApiSetup() {
  if (explicitApiTarget) {
    log(`using explicit API target ${explicitApiTarget}`);
    return {
      apiTarget: explicitApiTarget,
      apiPort: requestedPort,
      startApi: false,
    };
  }

  if (await isPortFree(requestedPort)) {
    return {
      apiTarget: `http://127.0.0.1:${requestedPort}`,
      apiPort: requestedPort,
      startApi: true,
    };
  }

  if (await isKataBoardApiReachable(requestedPort)) {
    log(`reusing existing Kata API on port ${requestedPort}`);
    return {
      apiTarget: `http://127.0.0.1:${requestedPort}`,
      apiPort: requestedPort,
      startApi: false,
    };
  }

  const fallbackPort = await findFreePort(requestedPort + 1);
  log(`port ${requestedPort} is busy, switching local API to port ${fallbackPort}`);
  return {
    apiTarget: `http://127.0.0.1:${fallbackPort}`,
    apiPort: fallbackPort,
    startApi: true,
  };
}

async function main() {
  waitForSignal("SIGINT");
  waitForSignal("SIGTERM");

  const setup = await resolveApiSetup();
  const sharedEnv = {
    ...process.env,
    PORT: `${setup.apiPort}`,
    VITE_API_TARGET: setup.apiTarget,
  };

  if (setup.startApi) {
    spawnCommand("api", "npm", ["run", "dev:api"], sharedEnv);
  }

  spawnCommand("web", "npm", ["run", "dev:web"], sharedEnv);
  log(`frontend proxy target ${setup.apiTarget}`);
}

main().catch((error) => {
  console.error(`[kata-board:dev] ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
