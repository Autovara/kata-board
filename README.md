# kata-board

`kata-board` is the dashboard for Kata. It shows the current king, the live
continuous challenge, past kings, and an optional miner leaderboard.

It is read-only. The board does not run the competition and does not decide
anything. It reads state that the other Kata repos already wrote to disk, and
draws it. If a value is not in that state, the board does not show it and never
makes one up.

This README only covers the board: what it is, how it reads data, and how to
run it. For how scoring, the engine, and the challenge rules actually work, read the
sibling repos instead:

- `../kata` — the evaluation engine
- `../kata-sn60` — the SN60 subnet pack (the first live lane)
- `../kata-bot` — the GitHub PR automation that writes the challenge state files

## What it reads

The board is a projection of files that already exist. On each refresh the
server reads:

- from `../kata`: the lane registry, the published king artifact, and recent run
  summaries under `kata/runs/`
- from `../kata-bot`: the state files it writes as a challenge runs — `challenge-status.json`,
  `challenge-progress.json`, `challenge-history.json`, `live-status.json`, and the queue
- optionally, GitHub PR history (needs a repo slug and a read token) to build the
  leaderboard

Live king and challenge status work from the local files alone. The leaderboard is
empty until you point the board at a data source (GitHub PR history or an event
log). See [Leaderboard sources](#leaderboard-sources).

## Architecture

Two parts:

1. A React frontend built with Vite. This is the single-page app you see in the
   browser. It reads `/api/status` and subscribes to `/api/stream` for live
   updates.
2. A small Express server (`server/index.mjs`). It reads the Kata state files,
   builds one JSON payload, and serves it. It also serves the built frontend in
   production.

The server keeps short-lived caches so it does not re-read everything (or re-hit
GitHub) on every request. Live challenge progress refreshes on every frame even on a
cache hit, so the challenge animates smoothly.

Server endpoints:

- `GET /api/health` — liveness check
- `GET /api/status` — the full board payload as JSON
- `GET /api/stream` — the same payload pushed over Server-Sent Events; the
  frontend prefers this and falls back to polling `/api/status` if the stream is
  unavailable

## Pages

The frontend has five pages (see `src/constants.js` for the routes):

- Dashboard (`/`) — the home page. A summary of the current king, the latest
  challenge, the active lane, and queue/screening status.
- Arena (`/arena`, also `/live`) — the current challenge in detail. The challenger
  PR, its status, its score, and a per-problem breakdown. Click a row for the
  full duel view.
- Winners (`/winners`, also `/champions`) — past champions and the public proof
  for the current king.
- Leaderboard (`/leaderboard`) — a miner ranking. Empty until a data source is
  configured.
- Docs (`/docs`) — in-app help and submission pointers.

### Multiple lanes

Kata can run more than one subnet lane. When more than one active lane exists, a
lane selector appears and each page shows the selected lane's data. With a single
lane there is no selector and the board looks the same as a single-lane setup.

## Requirements

You need Node 20.19 or newer. The toolchain is Vite 8 and Vitest 4, and neither
runs on Node 18.

This matters most in production. If a machine's system Node is 18 (common when
installed with `sudo`), the build will fail or produce a stale bundle. Use a
modern Node such as 22 or 24 for both the build and the server. Check with
`node --version` before you build.

## Run it

Install dependencies first:

```bash
npm install
```

### Development

```bash
npm run dev
```

This starts the Express API and the Vite dev server together. Default ports:

- frontend: `http://localhost:4173`
- API: `http://localhost:8787`

`npm run dev` handles the API port for you:

- if `8787` is free, it starts the API there
- if a kata-board API is already running on `8787`, it reuses it
- if something else holds `8787`, it picks the next free port

You can run the two sides on their own:

```bash
npm run dev:api
npm run dev:web
```

To point the frontend at a specific API, set `VITE_API_TARGET`:

```bash
VITE_API_TARGET=http://localhost:8788 npm run dev
```

### Production

Build the frontend, then start the single Node service:

```bash
npm run build
npm start
```

`npm start` serves both the API and the built SPA from one process on `PORT`
(default `8787`). Put it behind your own HTTPS reverse proxy or tunnel and route
the public origin to `localhost:8787`. The live API is then at
`https://your-board-host/api/status`.

Remember the Node version warning above: build and run with Node 22 or 24, not an
old system Node.

## Configuration

Copy the example env file and edit it:

```bash
cp .env.example .env
```

The server reads `.env` on startup. Every variable is optional. If you omit the
repo roots, the board assumes `../kata` and `../kata-bot` sit beside it.

### Server and repo locations

- `PORT` — port for the API and, in production, the SPA. Default `8787`.
- `KATA_BOARD_ROOT` — the parent directory that holds the sibling repos. Defaults
  to the board's parent directory.
- `KATA_ROOT` — path to the `kata` repo. Defaults to `<board-root>/kata`.
- `KATA_BOT_ROOT` — path to the `kata-bot` repo. Defaults to `<board-root>/kata-bot`.
- `KATA_WORK_ROOT` — kata-bot's work directory. Defaults to `<kata-bot>/work`.
- `KATA_ASSETS_DIR` — directory of image assets to serve at `/kata-assets`.
  Defaults to `../kata/assets`.

### kata-bot state files

These point at the durable state files kata-bot writes. In production they
usually live under `/srv/kata-bot/state/`. If you omit them, the board derives
each path from the directory of `KATA_QUEUE_STATE_PATH`.

- `KATA_QUEUE_STATE_PATH` — the queue file. Default `<kata-bot>/state/queue.json`.
- `KATA_LIVE_STATUS_PATH` — live status.
- `KATA_CHALLENGE_STATUS_PATH` — the current challenge.
- `KATA_CHALLENGE_PROGRESS_PATH` — live per-candidate progress during a challenge.
- `KATA_CHALLENGE_HISTORY_PATH` — completed challenges.
- `KATA_REVIEW_APPROVALS_PATH` — recorded review approvals.
- `KATA_PUBLIC_RESULTS_CURRENT_PATH` — the published king proof. Default
  `<kata>/public-results/current.json`.

### Benchmark and validator

- `KATA_BENCHMARK_FILE` — optional evaluator benchmark file, used to show
  expected-finding counts during live progress. The older
  `KATA_SN60_BENCHMARK_FILE` name is still accepted.
- `KATA_VALIDATOR_HEALTH_URL` — optional validator health endpoint to poll.

### Leaderboard (GitHub read config)

- `KATA_REPO_SLUG` — the Kata repo as `owner/name`, for reading PR history. If
  omitted, the board tries to infer it from the `kata` repo's git remote.
- `KATA_GITHUB_READ_TOKENS` — comma-separated pool of read-only GitHub tokens.
  Prefer this for board reads.
- `KATA_GITHUB_TOKEN` — a single fallback read token. Do not point the board at
  the owner write token in production unless there is no read pool.
- `KATA_BOARD_ALLOW_GH_CLI_FALLBACK` — set to `true` to allow the `gh` CLI as a
  fallback. Off by default.
- `KATA_BOARD_EVENT_LOG` — path to a JSONL event log, an alternative leaderboard
  source (see below).

### Tuning

- `KATA_STATUS_CACHE_TTL_MS` — how long the status payload is cached. Use a low
  value like `3000` for a live dashboard. Default `3000`.
- `KATA_LEADERBOARD_CACHE_TTL_MS` — how often the GitHub leaderboard refreshes.
  Default `60000`. A cold GitHub refresh costs about one API call per PR, so keep
  this well above the status TTL to stay under rate limits.
- `KATA_STREAM_INTERVAL_MS` — how often the SSE stream checks for changes.
  Default `1000`, minimum `500`.
- `KATA_ACTIVITY_LIMIT` — how many recent activity items to show. Default `18`.

## Leaderboard sources

The board can build a miner ranking two ways. Both are optional; without either,
every other page still works.

### GitHub mode

Set:

- `KATA_REPO_SLUG=owner/kata`
- `KATA_GITHUB_READ_TOKENS=<read-token-1>,<read-token-2>`

The board reads PR history and ranks miners from their submission PRs. Only merged
PRs carrying trusted Kata winner labels count toward the score.

### Event log mode

Set:

- `KATA_BOARD_EVENT_LOG=/path/to/competition-events.jsonl`

Each line is one JSON object, for example:

```json
{
  "created_at": "2026-06-30T04:00:00Z",
  "author": "carlos4s",
  "subnet_pack": "e35ventura__taopedia-articles",
  "mode": "contributor",
  "final_action": "merge",
  "pull_number": 12,
  "labels": ["kata:winner:e35ventura__taopedia-articles"]
}
```

This is the right source once kata-bot persists results directly.
