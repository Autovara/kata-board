# kata-board

`kata-board` is the real-time leaderboard and status UI for Kata.

It is a separate repo on purpose.

Kata stays the evaluation engine, `kata-bot` stays the PR automation layer, and
`kata-board` turns live lane state into a clean visual monitor.

## ⚡ Built with Gittensor (Bittensor Subnet 74)

**Kata's development is powered by Gittensor — the open-source-software subnet on
Bittensor, Subnet 74 (SN74).** This repository is part of the Kata project, which is
registered on Gittensor; SN74 coordinates and rewards the contributors who build and
improve it. You don't need to use Bittensor or Discord to run or contribute to the
board — but that's where the work comes from and how contributors get credit.

> **Two subnets, two roles — keep them straight.** **SN74 / Gittensor** funds and
> coordinates the _development of this repository_. **SN60 / Bitsec** is the
> _competition target_ — the subnet Kata currently builds an agent for, and the one
> lane this board renders live today. Kata itself is **subnet-agnostic**; SN60 is
> simply the first live lane, and more will be added through the pack registry.

For the full project context, see the [`kata` README](../kata/README.md) and its
"Gittensor & SN74" section.

## What It Shows

This repo reads the current Kata system and shows:

- active subnet-pack lanes
- current king status per lane
- benchmark pack health
- the live current competition round — every candidate PR, its status, and its score
- a round-history highlights feed (achievements: new king, first true positive, record detection)
- recent challenge activity and evaluator-provided scores/provenance
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
- `KATA_BENCHMARK_FILE` — optional evaluator benchmark file used to show
  expected-finding counts during live progress (the legacy
  `KATA_SN60_BENCHMARK_FILE` remains accepted)
- `KATA_WORK_ROOT`
- `KATA_QUEUE_STATE_PATH`
- `KATA_LIVE_STATUS_PATH`
- `KATA_ROUND_STATUS_PATH`
- `KATA_ROUND_HISTORY_PATH`
- `KATA_ROUND_PROGRESS_PATH`
- `KATA_VALIDATOR_HEALTH_URL`
- `KATA_REPO_SLUG`
- `KATA_GITHUB_READ_TOKENS`
- `KATA_GITHUB_TOKEN`
- `KATA_STATUS_CACHE_TTL_MS`
- `KATA_LEADERBOARD_CACHE_TTL_MS`
- `KATA_BOARD_EVENT_LOG`

If the repo roots are omitted, `kata-board` assumes the repos live beside it:

- `../kata`
- `../kata-bot`

Point `KATA_LIVE_STATUS_PATH`, `KATA_ROUND_STATUS_PATH`, `KATA_ROUND_HISTORY_PATH`,
and `KATA_ROUND_PROGRESS_PATH` at the durable state files written by `kata-bot`,
usually alongside the queue:

- `/srv/kata-bot/state/live-status.json`
- `/srv/kata-bot/state/round-status.json`
- `/srv/kata-bot/state/round-history.json`
- `/srv/kata-bot/state/round-progress.json` — live per-candidate progress during a round

If they are omitted, the board derives them from the `KATA_QUEUE_STATE_PATH` directory.

`KATA_STATUS_CACHE_TTL_MS` controls API caching. Use a low value such as `3000`
for live dashboards.

`KATA_LEADERBOARD_CACHE_TTL_MS` controls how often the GitHub PR leaderboard
refreshes (default `60000`). The GitHub source costs one API call per PR on a
cold refresh, so keep this well above the status TTL to stay inside rate
limits.

Use `KATA_GITHUB_READ_TOKENS` for board reads when available. This is a
comma-separated pool of secondary GitHub tokens. `KATA_GITHUB_TOKEN` remains a
fallback for reads, but production should avoid pointing the board at the owner
write token unless there is no read pool. The board does not use `gh` CLI
fallback unless `KATA_BOARD_ALLOW_GH_CLI_FALLBACK=true`.

## Leaderboard Modes

### GitHub mode

Set:

- `KATA_REPO_SLUG=owner/kata`
- `KATA_GITHUB_READ_TOKENS=<read-token-1>,<read-token-2>`

Then `kata-board` reads PR history and builds a miner leaderboard from
submission PRs under:

- `submissions/<subnet-pack>/<mode>/<submission-id>/...`

Only merged PRs carrying trusted Kata winner labels count toward the reward score.

### Event log mode

Set:

- `KATA_BOARD_EVENT_LOG=/path/to/competition-events.jsonl`

Expected JSONL shape:

```json
{
  "created_at": "2026-06-30T04:00:00Z",
  "author": "carlos4s",
  "subnet_pack": "e35ventura__taopedia-articles",
  "mode": "contributor",
  "final_action": "merge",
  "pull_number": 12,
  "labels": ["kata:winner:e35ventura__taopedia-articles", "kata:mode:contributor"]
}
```

This mode is useful once `kata-bot` starts persisting results directly.

## API

Current server endpoints:

- `GET /api/health`
- `GET /api/status`

`/api/status` returns:

- overview metrics
- lane status and current king state
- `round` — the live current competition round (entrants, per-PR status, scores, winner)
- `roundHistory` — recent completed rounds with achievements
- recent challenge activity
- leaderboard rows
- data-source flags

## Live Deployment

`kata-board` is designed to run as a live Node service beside `kata-bot`.
The browser always reads `/api/status`, so the page reflects queue state,
current king data, the live round, benchmark counts, and GitHub PR history
dynamically.

Put the board behind the HTTPS reverse proxy or tunnel chosen for your
deployment. Route the board's public origin to `localhost:8787`; route the
resident `kata-bot` service separately to `localhost:8080` when GitHub needs
to deliver webhooks.

Run the board:

```bash
npm install
npm run build
npm start
```

Then open the public board origin configured by your proxy or tunnel, for
example:

```text
https://board.example.com
```

The live API is:

```text
https://board.example.com/api/status
```

## Current Kata Workflow

The board mirrors the current **round-based** Kata workflow:

- miners submit one PR under `submissions/<subnet-pack>/<mode>/<submission-id>/`; on
  open/push it is screened and labeled `kata:pending` (intake) — one open PR per contributor
- scoring runs in **scheduled rounds**, not per PR; a round locks the pending PRs, keeps one
  per contributor, screens them, and labels the qualified ones `kata:executing`
- each round scores the **cached king** against every candidate on the same secret evaluator-selected
  projects, so the king isn't re-run each round; a bad/empty/unparsable result on one
  problem just scores 0 for it (never a rejection)
- each evaluator publishes its own score metrics, replica rule, and promotion evidence; the top
  candidate that strictly beats the king is merged and becomes the new king
- outcome labels are color-coded: `kata:pending` (blue), `kata:executing` (yellow),
  `kata:winner:<pack>` (green), `kata:losing` (grey), `kata:invalid` (red), `kata:stale`
  (orange), `kata:hold` (purple)
- agents receive the project contents and an inference endpoint, not oracle files or
  benchmark answers

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
