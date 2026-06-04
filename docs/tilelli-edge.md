# Tilelli Local Stack

Tilelli now runs fully local on this Mac:

- static site: `http://127.0.0.1:8081/`
- API server: `http://127.0.0.1:8787`
- GravNova Q9 media origin: `http://127.0.0.1:8081/q9-media/`
- SQLite database: `.tilelli/local-stack/tilelli.sqlite`

## Main files

- `scripts/tilelli-local-stack.mjs`: local API server and render dispatch.
- `scripts/tilelli-cli.mjs`: local CLI, render pipeline, doctor checks, and local agent runs.
- `tilelli-edge-client.js`: browser client that defaults to `/tilelli-api`.
- `anime.html`: anime scene workspace and generation UI.
- `agents/tilelli/*.json`: local agent contracts.

## Start the stack

```sh
npm run tilelli:local
```

In another shell:

```sh
nginx -t
brew services restart nginx
```

## What nginx serves

The local nginx server block is:

- `/opt/homebrew/etc/nginx/servers/tilelli-local.conf`

It serves the repo root and proxies:

- `/tilelli-api/` -> `http://127.0.0.1:8787/`

and mirrors media from GravNova Q9:

- `/Users/johnmobley/gravnova/q9/public/`

## Local API contract

The local API keeps the same `/v1/...` shape as the former Worker path:

- `/v1/projects`
- `/v1/events`
- `/v1/portfolio/entries`
- `/v1/physics/notes`
- `/v1/dashboard/reminders`
- `/v1/anime/scenes`
- `/v1/anime/assets`
- `/v1/anime/renders`
- `/v1/anime/automations`
- `/v1/anime/generations`
- `/v1/agent/runs`

Render dispatch is local-only:

- `POST /v1/render/anime`
- invokes the local ffmpeg render path through `scripts/tilelli-cli.mjs`
- callbacks land back on the same local API server

## Environment

Required or useful local variables:

- `TILELLI_API_BASE_URL=http://127.0.0.1:8787`
- `TILELLI_MEDIA_PUBLIC_BASE_URL=http://127.0.0.1:8081/q9-media`
- `TILELLI_LOCAL_HOST=127.0.0.1`
- `TILELLI_LOCAL_PORT=8787`
- `TILELLI_LOCAL_DB_PATH=...` optional override
- `TILELLI_MODEL_BASE_URL` optional local model endpoint
- `TILELLI_MODEL_NAME` optional local model name
- `TILELLI_ANIME_IMAGE_PROVIDER_CMD` optional local anime still provider command (`/Users/johnmobley/gravnova/q9/anime-provider.sh` by default)
- `TILELLI_ANIME_IMAGE_PROVIDER_URL` optional local anime still provider endpoint
- `TILELLI_ANIME_IMAGE_PROVIDER_MODE=auto|command|http` optional provider preference

The local CLI mirrors rendered MP4s and thumbnails into `/Users/johnmobley/gravnova/q9/public/` and writes browser-accessible URLs back into the generation callback. If an anime image provider is configured, the thumbnail comes from that provider first; otherwise the CLI falls back to a local ffmpeg still card.

## Validation

```sh
npm run tilelli:local:db
node scripts/tilelli-cli.mjs doctor
node scripts/tilelli-cli.mjs spec
```

## Notes

- No D1.
- No remote object storage.
- No Worker deploy path in the active flow.
- GravNova Q9 is the active media origin.
- Tilelli model routing is local-first: code tasks prefer Qwen, reasoning tasks prefer DeepSeek if present.
- Legacy Cloudflare files remain in the repo only as archival code, not as the primary runtime.
