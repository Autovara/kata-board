# kata-board

`kata-board` is the real-time leaderboard and status UI for Kata.

It is a separate repo on purpose.

Kata stays the evaluation engine, `kata-bot` stays the PR automation layer, and
`kata-board` turns live lane state into a clean visual monitor.

## What It Shows

This repo reads the current Kata system and shows:

- active subnet-pack lanes
- current king status per lane
- benchmark pack health
- SN60 duel state (screening, scores, replica stability, provenance)
- recent challenge activity
- optional miner leaderboard

It supports two leaderboard sources:

1. GitHub PR history
   - best option once the Kata repo is public or accessible with a token
2. event log file
   - best option once `kata-bot` starts writing competition events

Even without those, the board already shows real live status from:

- `kata/runs`

## Current Data Boundary

The current Kata system already exposes:

- the pack registry and per-lane state under `kata/lanes/`
- the published king artifact under `kata/kings/`
- recent `challenge_summary.json` files under `kata/runs/`

But it does **not** yet persist a full miner ranking database by itself.

So the board is designed like this:

- live lane and benchmark status works immediately
- miner ranking becomes real when GitHub PR history or an event log is available

That is the correct production direction and avoids inventing fake leaderboard
data.

## Quickstart

Install dependencies:

```bash
npm install
```

Run the API server and frontend together:

```bash
npm run dev
```

Default ports:

- frontend: `http://localhost:4173`
- API server: `http://localhost:8787`

`npm run dev` now behaves safely:

- if `8787` is free, it starts the API there
- if `8787` already has a running Kata API, it reuses it
- if `8787` is occupied by something else, it finds the next free API port automatically

You can also run the two sides separately:

```bash
npm run dev:api
npm run dev:web
```

If you want to force a specific API target, you still can:

```bash
VITE_API_TARGET=http://localhost:8788 npm run dev
```

## Environment

Copy:

```bash
cp .env.example .env
```

Important variables:

- `KATA_ROOT`
- `KATA_BOT_ROOT`
- `KATA_WORK_ROOT`
- `KATA_QUEUE_STATE_PATH`
- `KATA_LIVE_STATUS_PATH`
- `KATA_VALIDATOR_HEALTH_URL`
- `KATA_REPO_SLUG`
- `KATA_GITHUB_TOKEN`
- `KATA_STATUS_CACHE_TTL_MS`
- `KATA_LEADERBOARD_CACHE_TTL_MS`
- `KATA_BOARD_EVENT_LOG`

If the repo roots are omitted, `kata-board` assumes the repos live beside it:

- `../kata`
- `../kata-bot`

For active duel progress, point `KATA_LIVE_STATUS_PATH` at the same durable
status file used by `kata-bot`, usually:

- `/srv/kata-bot/state/live-status.json`

`KATA_STATUS_CACHE_TTL_MS` controls API caching. Use a low value such as `3000`
for live dashboards.

`KATA_LEADERBOARD_CACHE_TTL_MS` controls how often the GitHub PR leaderboard
refreshes (default `60000`). The GitHub source costs one API call per PR on a
cold refresh, so keep this well above the status TTL to stay inside rate
limits.

## Leaderboard Modes

### GitHub mode

Set:

- `KATA_REPO_SLUG=owner/kata`
- `KATA_GITHUB_TOKEN=<token>`

Then `kata-board` reads PR history and builds a miner leaderboard from
submission PRs under:

- `submissions/<subnet-pack>/<mode>/<submission-id>/...`

Merged submission PRs count as verified wins.

### Event log mode

Set:

- `KATA_BOARD_EVENT_LOG=/path/to/competition-events.jsonl`

Expected JSONL shape:

```json
{"created_at":"2026-06-30T04:00:00Z","author":"carlos4s","subnet_pack":"e35ventura__taopedia-articles","mode":"contributor","final_action":"merge","pull_number":12}
```

This mode is useful once `kata-bot` starts persisting results directly.

## API

Current server endpoints:

- `GET /api/health`
- `GET /api/status`

`/api/status` returns:

- overview metrics
- lane status and the current SN60 duel state
- recent challenge activity
- leaderboard rows
- data-source flags

## Live Deployment

`kata-board` is designed to run as a live Node service beside `kata-bot`.
The browser always reads `/api/status`, so the page reflects queue state,
current king data, active duel progress, benchmark counts, and GitHub PR
history dynamically.

Recommended ngrok split:

- `kingpawnusa.ngrok.app` forwards to `kata-bot` on `localhost:8080`
- `dashboardking.ngrok.app` forwards to `kata-board` on `localhost:8787`

Run the board:

```bash
npm install
npm run build
npm start
```

Then open:

```text
https://dashboardking.ngrok.app
```

The live API is:

```text
https://dashboardking.ngrok.app/api/status
```

## Current Kata Workflow

The board mirrors the current PR-only Kata workflow:

- miners submit one PR under `submissions/<subnet-pack>/<mode>/<submission-id>/`
- each registered subnet-pack/mode has its own current king under `kata/kings`
- candidate and king run the same selected benchmark codebases in the pinned
  Bitsec sandbox; the selected set may be the full snapshot or a
  validator-configured secret-sampled MVP subset
- the promotion comparator follows SN60-style metrics: detection score, true
  positives, precision, F1 score, then fewer invalid/error evaluations
- agents receive the project contents and an inference endpoint, not oracle
  files or benchmark answers

## Production Shape

Recommended deployment model:

1. `kata` runs evaluation
2. `kata-bot` handles PR automation
3. `kata-board` reads the subnet-pack registry, recent run artifacts, and optional PR
   history/event feed
4. the frontend polls `/api/status` every few seconds

That keeps the system simple and clean:

- no benchmark logic in the UI
- no GitHub bot logic in the evaluator
- no fake leaderboard state in the frontend
