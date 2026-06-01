# Tilelli Edge Backend

This repo now has the base structure for Cloudflare-backed edge endpoints:

- `workers/tilelli-api/src/index.js`: Worker API.
- `workers/tilelli-renderer/src/index.js`: Renderer adapter scaffold.
- `workers/tilelli-api/schema/0001_initial.sql`: D1 schema.
- `workers/tilelli-api/wrangler.toml`: Worker, D1, and cron config.
- `workers/tilelli-renderer/wrangler.toml`: Renderer Worker config.
- `anime.html`: Prompt-driven anime scene generator foundation with local storyboard, freeform setting input, asset editing, render-job tracking, playback review, template reuse, automation rules, and generation jobs.
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

Set the generation callback key on both the Worker and the renderer service:

```sh
scripts/tilelli-wrangler.sh secret put TILELLI_GENERATION_CALLBACK_KEY --config workers/tilelli-api/wrangler.toml
scripts/tilelli-wrangler.sh secret put TILELLI_GENERATION_CALLBACK_KEY --config workers/tilelli-renderer/wrangler.toml
```

Optionally set a default renderer dispatch URL on the Worker:

```sh
scripts/tilelli-wrangler.sh secret put TILELLI_GENERATION_RENDERER_URL --config workers/tilelli-api/wrangler.toml
```

## GitHub Actions

The live workflow is stored at:

```txt
.github/workflows/tilelli-edge.yml
```

Add repository secrets/variables:

- Secret: `TILELLI_CLOUDFLARE_API_TOKEN`
- Variable: `TILELLI_API_BASE_URL`

Renderer deploy helper:

```sh
npm run deploy:renderer
```

The live generation loop uses service bindings between the two Workers:

- API Worker binding: `TILELLI_RENDERER`
- Renderer Worker binding: `TILELLI_API`
- shared callback secret: `TILELLI_GENERATION_CALLBACK_KEY`

The workflow checks HTML/Worker syntax, deploys on `main`, and performs a scheduled health ping.

## Anime Scene Phase 1

`anime.html` is the intake surface for prompt-driven scene production:

- scene title
- scene prompt
- three visual styles
- freeform setting input with suggestion chips
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

## Anime Scene Phase 9

Template reuse adds starter scenes:

- save the current scene as a reusable template
- browse built-in and saved templates
- apply a template back into the intake form
- keep recurring looks and scene structures available without copy-paste

## Anime Scene Phase 10

Automation turns the workspace into a rule-driven studio:

- create rules for render, archive, clone, or export actions
- save rules locally and sync them to the edge when owner credentials are available
- run a rule immediately from the automation panel
- archive scenes remotely through `PATCH /v1/anime/scenes/:id`

## Anime Scene Phase 11

Generation is the actual video-generation handoff:

- compose generation jobs with provider, model, duration, resolution, and FPS
- save jobs locally and sync them to `/v1/anime/generations`
- update jobs with `PATCH /v1/anime/generations/:id`
- dispatch a job to a renderer with `POST /v1/anime/generations/:id/dispatch`
- accept renderer callbacks on `POST /v1/anime/generations/:id/complete` and `POST /v1/anime/generations/:id/fail`
- configure `TILELLI_GENERATION_CALLBACK_KEY` on the Worker and renderer so callbacks can be authenticated
- optionally configure `TILELLI_GENERATION_RENDERER_URL` so dispatch can target a default renderer without storing the URL on every job
- status values: `queued`, `generating`, `ready`, `failed`
- the workspace now has a distinct place for video output jobs, even before a renderer is attached

Renderer adapter scaffold:

- `workers/tilelli-renderer/src/index.js` accepts `POST /v1/render/anime`
- mock mode immediately schedules a callback to Tilelli with a placeholder ready artifact
- proxy mode can forward the request to an upstream renderer when one is configured

## Portfolio Submission Flow

`tilaelia.html` now supports richer private submissions:

- text-only poetry or essays
- image, audio, or video attachments via file upload
- automatic local timestamps on submitted entries
- optional edge publication to `/v1/portfolio/entries` when owner credentials are configured
