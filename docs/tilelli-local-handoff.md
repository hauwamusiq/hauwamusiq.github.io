# Tilelli Local-Only Handoff

## Current state

- Tilelli now runs fully local on this Mac.
- Active public surface:
  - `http://127.0.0.1:8081/`
- Active API surface:
  - `http://127.0.0.1:8787`
- GravNova Q9 media origin:
  - `http://127.0.0.1:8081/q9-media/`
- Persistence:
  - SQLite at `.tilelli/local-stack/tilelli.sqlite`
- Process persistence:
  - LaunchAgent `com.johnmobley.tilelli-local-stack`

## What changed

- Cloudflare D1 is no longer part of the active runtime.
- Cloudflare R2 is no longer part of the active media path.
- Cloudflare Workers are no longer the primary runtime for Tilelli.
- nginx serves the repo root locally and proxies `/tilelli-api/` to the local Node API server.
- The browser client now defaults to the local same-origin API path.
- The CLI now defaults to the local API and GravNova Q9 media mirror.
- Tilelli CLI routes code prompts to Qwen by default and reasoning prompts to DeepSeek when installed, with Qwen fallback.

## Key files

- Local API/server:
  - `scripts/tilelli-local-stack.mjs`
- Local CLI:
  - `scripts/tilelli-cli.mjs`
- Browser client:
  - `tilelli-edge-client.js`
- nginx local origin:
  - `/opt/homebrew/etc/nginx/servers/tilelli-local.conf`
- GravNova Q9 media root:
  - `/Users/johnmobley/gravnova/q9/public/`
- GravNova Q9 storage policy:
  - quota: `4 GiB`
  - soft limit: `3 GiB`
  - reserve: `512 MiB`
  - long-term archive target: YouTube
- Spec and docs:
  - `spec/specification-system.manifest.json`
  - `docs/tilelli-edge.md`

## Local service behavior

- `GET /health` on `8787` returns local stack status.
- `POST /v1/anime/generations` creates a local generation job in SQLite.
- `POST /v1/anime/generations/:id/dispatch` dispatches to the local renderer path.
- `POST /v1/render/anime` is handled locally and completes by writing back to SQLite.
- Rendered MP4s and thumbnails are mirrored into GravNova Q9 under `/Users/johnmobley/gravnova/q9/public/`.

## Verification already completed

- `node scripts/tilelli-cli.mjs doctor` passes.
- `node scripts/tilelli-cli.mjs spec` passes.
- Local generation flow completed end-to-end:
  - create job
  - dispatch job
  - render MP4
  - callback completes job
  - artifact served back from nginx

## Local startup

```sh
npm run tilelli:local:db
npm run tilelli:local
nginx -t
brew services restart nginx
```

## Important environment defaults

- `TILELLI_API_BASE_URL=http://127.0.0.1:8787`
- `TILELLI_MEDIA_PUBLIC_BASE_URL=http://127.0.0.1:8081/q9-media`
- `TILELLI_ANIME_IMAGE_PROVIDER_CMD` optional anime still provider command (`/Users/johnmobley/gravnova/q9/anime-provider.sh` by default)
- `TILELLI_ANIME_IMAGE_PROVIDER_URL` optional anime still provider endpoint
- `TILELLI_LOCAL_HOST=127.0.0.1`
- `TILELLI_LOCAL_PORT=8787`

## Remaining legacy files

- Old Cloudflare Worker and Wrangler files still exist in the repo as archival code.
- They are not part of the active runtime path.
- GravNova Q9 is the active media origin for renders and playback.
- Tilelli model routing is local and availability-based; it does not require Cloudflare.

## Next work

- Keep the local-only path canonical.
- Expand local API coverage if new Tilelli features need it.
- Keep browser surfaces pointed at the local origin and local media mirror.
