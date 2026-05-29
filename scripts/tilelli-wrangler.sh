#!/usr/bin/env zsh
# Form: Shell
# Runtime: zsh
# Purpose: Run Wrangler for Tilelli with only TILELLI-scoped Cloudflare credentials.
# Inputs: ~/.zshrc.local, TILELLI_CLOUDFLARE_API_TOKEN, TILELLI_CLOUDFLARE_ACCOUNT_ID.
# Outputs: Delegated Wrangler command output.
# Safety: Explicitly unsets legacy/global Cloudflare variables before invoking Wrangler.
# Relations: package.json, workers/tilelli-api/wrangler.toml, docs/tilelli-edge.md.

set -euo pipefail

[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

token="${CLOUDFLARE_API_TOKEN:-${TILELLI_CLOUDFLARE_API_TOKEN:-}}"
account_id="${CLOUDFLARE_ACCOUNT_ID:-${TILELLI_CLOUDFLARE_ACCOUNT_ID:-}}"

if [[ -z "$token" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or TILELLI_CLOUDFLARE_API_TOKEN." >&2
  exit 1
fi

exec env \
  -u CF_API_KEY \
  -u CF_EMAIL \
  -u CLOUDFLARE_API_KEY \
  -u CLOUDFLARE_EMAIL \
  CLOUDFLARE_API_TOKEN="$token" \
  CLOUDFLARE_ACCOUNT_ID="$account_id" \
  wrangler "$@"
