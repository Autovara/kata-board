# kata-board

`kata-board` is the real-time leaderboard and status UI for Kata.

It is a separate repo on purpose.

Kata stays the evaluation engine, `kata-bot` stays the PR automation layer, and
`kata-board` turns live lane state into a clean visual monitor.

## What It Shows

This repo reads the current Kata system and shows:

- active repo lanes
- frontier status
- benchmark pack health
- primary and hidden holdout promotion gates
- recent challenge activity
- optional miner leaderboard

It supports two leaderboard sources:

1. GitHub PR history
   - best option once the Kata repo is public or accessible with a token
2. event log file
   - best option once `kata-bot` starts writing competition events

Even without those, the board already shows real live status from:

- `kata-benchmarks`
- `kata-benchmarks-private`, when configured
- `kata/runs`

## Current Data Boundary

The current Kata system already exposes:

- `frontier.json`
- benchmark tasks and pack targets
- recent `challenge_summary.json` files

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
- `KATA_BENCHMARKS_ROOT`
- `KATA_PRIVATE_BENCHMARKS_ROOT`
- `KATA_BOT_ROOT`
- `KATA_QUEUE_STATE_PATH`
- `KATA_VALIDATOR_HEALTH_URL`
- `KATA_REPO_SLUG`
- `KATA_GITHUB_TOKEN`
- `KATA_BOARD_EVENT_LOG`

If the repo roots are omitted, `kata-board` assumes the repos live beside it:

- `../kata`
- `../kata-benchmarks`
- `../kata-bot`

## Leaderboard Modes

### GitHub mode

Set:

- `KATA_REPO_SLUG=owner/kata`
- `KATA_GITHUB_TOKEN=<token>`

Then `kata-board` reads PR history and builds a miner leaderboard from
submission PRs under:

- `submissions/<repo-pack>/<mode>/<submission-id>/...`

Merged submission PRs count as verified wins.

### Event log mode

Set:

- `KATA_BOARD_EVENT_LOG=/path/to/competition-events.jsonl`

Expected JSONL shape:

```json
{"created_at":"2026-06-30T04:00:00Z","author":"carlos4s","repo_pack":"e35ventura__taopedia-articles","mode":"contributor","final_action":"merge","pull_number":12}
```

This mode is useful once `kata-bot` starts persisting results directly.

## API

Current server endpoints:

- `GET /api/health`
- `GET /api/status`

`/api/status` returns:

- overview metrics
- lane status
- recent challenge activity
- primary and holdout margins
- leaderboard rows
- data-source flags

## GitHub Pages Deployment

`kata-board` can deploy like the SparkInfer dashboard:

```text
https://autovara.github.io/kata-board/
```

The Pages build is static. It does not run the Express API. Instead, GitHub
Actions exports the current board payload to `status.json`, builds the Vite app,
and deploys `dist/` to GitHub Pages.

Enable Pages:

1. Open GitHub repo settings for `Autovara/kata-board`.
2. Go to `Settings -> Pages`.
3. Set source to `GitHub Actions`.
4. Run `Deploy GitHub Pages` from the Actions tab, or push to `main`.

Recommended repository variables:

- `KATA_REPO_SLUG=Autovara/kata`
- `KATA_BENCHMARKS_REPO_SLUG=Autovara/kata-benchmarks`
- `KATA_PRIVATE_BENCHMARKS_REPO_SLUG=Autovara/kata-benchmarks-private`
- `KATA_REPO_SLUG_FOR_LINKS=Autovara/kata`

If the private benchmark repo is private, add this repository secret:

- `KATA_PRIVATE_REPO_TOKEN`

The token only needs read access to `kata-benchmarks-private`. If it is missing,
the public board still deploys, but hidden holdout counts may be incomplete.

The workflow runs:

```bash
npm run export:status
VITE_STATUS_SOURCE=static VITE_BASE_PATH=/kata-board/ npm run build
```

Static mode reads:

```text
/kata-board/status.json
```

Local development still uses the live API:

```text
/api/status
```

## Current Kata Workflow

The board mirrors the current PR-only Kata workflow:

- miners submit one PR under `submissions/<repo-pack>/<mode>/<submission-id>/`
- each registered repo-pack/mode has its own current king under `kata/kings`
- primary duels draw 20 random live public tasks
- hidden holdout duels use 10 private tasks
- promotion requires both `candidate >= king + 10` primary points and
  `candidate >= king + 10` hidden holdout points
- agents receive task text and repo contents, not oracle files or hidden task
  metadata

## Production Shape

Recommended deployment model:

1. `kata` runs evaluation
2. `kata-bot` handles PR automation
3. `kata-board` reads the benchmark repo, recent run artifacts, and optional PR
   history/event feed
4. the frontend polls `/api/status` every few seconds

That keeps the system simple and clean:

- no benchmark logic in the UI
- no GitHub bot logic in the evaluator
- no fake leaderboard state in the frontend
