# `kata-board` public surfaces

The board is a **read-only consumer**. It renders state owned by `kata` and `kata-bot` and decides
nothing. Anything here that looks like a decision is a formatting choice over a decision made
elsewhere.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/status` | the whole board payload |
| `GET /api/stream` | server-sent events; pushes the same payload plus a named `heartbeat` event |
| `GET *` | SPA history fallback — serves `index.html` so client routes survive a refresh |

The `*` fallback is load-bearing: `/arena/<subnet-pack>` is a real URL and a hard refresh there must
load the app rather than 404.

## Client routes

`/`, `/arena`, `/arena/<subnet-pack>`, `/winners`, `/leaderboard`, `/docs`
(`/live` and `/champions` are accepted aliases.)

## `/api/status` payload

Top-level keys: `generatedAt`, `publicLinks`, `dataSources`, `overview`, `lanes`, `byLane`,
`challenge`, `challengeHistory`, `leaderboard`, `publicProof`, `activity`, `validator`,
`submissionStatus`, `notes`, `dataNotice`

- `lanes[]` — only lanes marked `active: true` in the lane registry **and** their `lane.json`. An
  installed-but-unannounced lane must not appear; that is how a lane goes live by accident.
- `byLane[laneId]` — per-lane `challenge`, `challengeHistory`, `publicProof`, `leaderboard`,
  `activity`.
- `leaderboard` — **cross-subnet**, ranked by Gittensor score descending. It is one global table;
  `byLane[*].leaderboard` aliases the same object.

## Inputs read from disk

`KATA_ROOT`'s `lanes/registry.json`, `lanes/<lane>/lane.json`, `lanes/<lane>/king.json`, the bot's
lane-scoped state, and `public-results/`. Lane-scoped state is never allowed to fall back to stale
root state — a board that silently rendered the wrong lane's duel would be worse than one that
rendered nothing.

## Environment variables

`PORT` (default 8787), `KATA_ASSETS_DIR`, `KATA_GITHUB_MIN_REQUEST_INTERVAL_MS`, plus the GitHub
token used for leaderboard enrichment.

## Build and deploy

`npm run build` emits `dist/`, which is **gitignored** — the build is a required deploy step, not an
optional one. The production checkout is a detached-HEAD pin: deploy is
`fetch` → `checkout <sha>` → `npm run build` → restart, never `git pull`.
