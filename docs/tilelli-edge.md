# Tilelli Edge Backend

This repo now has the base structure for Cloudflare-backed edge endpoints:

- `workers/tilelli-api/src/index.js`: Worker API.
- `workers/tilelli-api/schema/0001_initial.sql`: D1 schema.
- `workers/tilelli-api/wrangler.toml`: Worker, D1, and cron config.
- `anime.html`: Prompt-driven anime scene generator foundation with local storyboard, asset editing, render-job tracking, and playback review.
- `agents/tilelli/base-agent.json`: Base capability map.
- `agents/tilelli/coding-agent.json`: Coding-agent harness contract.
- `agents/tilelli/forms/coding-task.request.json`: Example coding-task request.
- `scripts/tilelli-cloudflare.mjs`: Cloudflare account discovery, permission group lookup, and scoped token minting.
- `.github/workflows/tilelli-edge.yml`: Live GitHub Actions check/deploy/heartbeat workflow.
- `docs/tilelli-edge.workflow.yml.template`: GitHub Actions template copy.

Live Worker:

```txt
https://tilelli-api.hauwamusiq.workers.dev
```

## Environment Namespace

All project variables use the `TILELLI_` prefix.

Required local bootstrap values:

```sh
TILELLI_CLOUDFLARE_EMAIL=hauwamusiq@gmail.com
TILELLI_CLOUDFLARE_GLOBAL_API_KEY=...
TILELLI_CLOUDFLARE_ACCOUNT_ID=...
```

Preferred deployment value after bootstrap:

```sh
TILELLI_CLOUDFLARE_API_TOKEN=...
```

## Token Minting

Use the global key only to mint narrower tokens:

```sh
source ~/.zshrc.local
node scripts/tilelli-cloudflare.mjs mint-token agents/tilelli/forms/deployer-token.request.json
```

The returned token is written to `.tilelli/*.token`, which is ignored by git.

Inspect the coding-agent harness and validate the agent forms:

```sh
tilelli agent profile coding
tilelli agent forms
tilelli agent validate
tilelli agent run agents/tilelli/forms/coding-task.request.json
```

Agent runs are synced to the Worker endpoint at `POST /v1/agent/runs` and also written locally to `.tilelli/agent-runs/` as a fallback record.

## D1 Lifecycle

Create the remote database once:

```sh
scripts/tilelli-wrangler.sh d1 create tilelli-core --config workers/tilelli-api/wrangler.toml
```

Copy the database ID into `workers/tilelli-api/wrangler.toml`, then apply schema:

```sh
npm run d1:apply:remote
```

## Worker Secrets

Set the owner write key as a Worker secret:

```sh
scripts/tilelli-wrangler.sh secret put TILELLI_OWNER_WRITE_KEY --config workers/tilelli-api/wrangler.toml
```

## GitHub Actions

The live workflow is stored at:

```txt
.github/workflows/tilelli-edge.yml
```

Add repository secrets/variables:

- Secret: `TILELLI_CLOUDFLARE_API_TOKEN`
- Variable: `TILELLI_API_BASE_URL`

The workflow checks HTML/Worker syntax, deploys on `main`, and performs a scheduled health ping.

## Anime Scene Phase 1

`anime.html` is the intake surface for prompt-driven scene production:

- scene title
- scene prompt
- three visual styles
- three settings
- storyboard draft editor
- local queue history
- optional owner-gated sync to `/v1/anime/scenes`

The page keeps the scene record local-first so the user can work even when the edge backend is unavailable.

## Anime Scene Phase 3

The asset layer extends the scene system with:

- sketches
- references
- character sheets
- background plates
- moodboards
- prompt presets

Assets can be stored locally and, when owner credentials are available, synced to `/v1/anime/assets`.

## Anime Scene Phase 6

The publish phase turns the current scene workspace into a portable bundle:

- scene record
- storyboard draft
- linked assets
- export timestamp
- render state

Use the export buttons in `anime.html` to download or copy a JSON bundle for downstream renderers, preview tools, or external automation.

## Anime Scene Phase 7

Render integration turns the publish bundle into a tracked job:

- create render jobs through `/v1/anime/renders`
- list render jobs through `/v1/anime/renders?limit=...`
- update jobs with `PATCH /v1/anime/renders/:id`
- status values: `queued`, `rendering`, `ready`, `failed`
- local UI stores job drafts and job history so the workspace still functions before a renderer exists

## Anime Scene Phase 8

Playback review adds a local-first review surface:

- select a scene or render job
- inspect the bundle, storyboard, assets, and render metadata
- reopen a scene or render draft back into the intake flow
- keep the review panel available before a real player or frame scrubber is connected
