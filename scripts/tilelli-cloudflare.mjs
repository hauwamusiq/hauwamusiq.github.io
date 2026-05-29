#!/usr/bin/env node
/*
Form: Node JavaScript
Runtime: Local Node CLI
Purpose: Tilelli Cloudflare agent harness for account discovery, permission group lookup, and scoped token minting.
Inputs: TILELLI_CLOUDFLARE_EMAIL, TILELLI_CLOUDFLARE_GLOBAL_API_KEY, TILELLI_CLOUDFLARE_ACCOUNT_ID, capability request JSON.
Outputs: Cloudflare API results and git-ignored .tilelli/*.token files.
Safety: Treats the global key as bootstrap only; does not print minted token values; token files are mode 0600.
Relations: agents/tilelli/base-agent.json, agents/tilelli/forms/*.json, .env.tilelli.example.
*/
import fs from "node:fs/promises";
import path from "node:path";

const CF_API = "https://api.cloudflare.com/client/v4";

const profiles = {
  cloudflare_workers_d1_deployer: {
    resource: "account",
    permissions: [
      "Workers Scripts Write",
      "Workers Tail Read",
      "D1 Write",
      "Account Settings Read"
    ]
  },
  cloudflare_observer: {
    resource: "account",
    permissions: [
      "Workers Scripts Read",
      "D1 Read",
      "Account Settings Read"
    ]
  },
  cloudflare_token_minter: {
    resource: "user",
    permissions: [
      "API Tokens Write",
      "API Tokens Read",
      "Account Settings Read"
    ]
  }
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function bootstrapHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Auth-Email": requireEnv("TILELLI_CLOUDFLARE_EMAIL"),
    "X-Auth-Key": requireEnv("TILELLI_CLOUDFLARE_GLOBAL_API_KEY")
  };
}

async function cfFetch(pathname, options = {}) {
  const response = await fetch(`${CF_API}${pathname}`, {
    ...options,
    headers: { ...bootstrapHeaders(), ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!body.success) {
    const message = body.errors?.map(error => `${error.code}: ${error.message}`).join("; ") || "Cloudflare API request failed";
    throw new Error(message);
  }
  return body.result;
}

async function listAccounts() {
  const accounts = await cfFetch("/accounts?per_page=50");
  return accounts.map(account => ({ id: account.id, name: account.name }));
}

async function permissionGroups() {
  const groups = await cfFetch("/user/tokens/permission_groups");
  return groups.map(group => ({
    id: group.id,
    name: group.name,
    scopes: group.scopes || []
  }));
}

function resolveGroups(groups, wanted) {
  return wanted.map(name => {
    const match = groups.find(group => group.name === name);
    if (!match) {
      const close = groups
        .filter(group => group.name.toLowerCase().includes(name.split(" ")[0].toLowerCase()))
        .slice(0, 8)
        .map(group => group.name);
      throw new Error(`Permission group not found: ${name}${close.length ? `. Similar: ${close.join(", ")}` : ""}`);
    }
    return { id: match.id, name: match.name };
  });
}

function resourcesFor(profile, accountId) {
  if (profile.resource === "user") return { "com.cloudflare.api.user": "*" };
  return { [`com.cloudflare.api.account.${accountId}`]: "*" };
}

function expirationDate(ttlDays) {
  const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return expires.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function mintToken(requestPath) {
  const raw = await fs.readFile(requestPath, "utf8");
  const request = JSON.parse(raw);
  const profile = profiles[request.profile];
  if (!profile) throw new Error(`Unknown capability profile: ${request.profile}`);
  const accountId = requireEnv("TILELLI_CLOUDFLARE_ACCOUNT_ID");
  const groups = await permissionGroups();
  const permissionGroupsResolved = resolveGroups(groups, profile.permissions);
  const body = {
    name: request.name,
    not_before: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    expires_on: expirationDate(Number(request.ttlDays || 180)),
    policies: [
      {
        effect: "allow",
        permission_groups: permissionGroupsResolved.map(group => ({ id: group.id })),
        resources: resourcesFor(profile, accountId)
      }
    ]
  };
  const result = await cfFetch("/user/tokens", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const outDir = path.resolve(".tilelli");
  await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(outDir, `${request.name}.token`);
  await fs.writeFile(tokenFile, `${result.value}\n`, { mode: 0o600 });
  return {
    id: result.id,
    name: result.name,
    status: result.status,
    expires_on: result.expires_on,
    tokenFile,
    permissions: permissionGroupsResolved.map(group => group.name)
  };
}

async function main() {
  const command = process.argv[2];
  if (command === "accounts") {
    console.log(JSON.stringify(await listAccounts(), null, 2));
    return;
  }
  if (command === "permission-groups") {
    console.log(JSON.stringify(await permissionGroups(), null, 2));
    return;
  }
  if (command === "mint-token") {
    const requestPath = process.argv[3];
    if (!requestPath) throw new Error("Usage: node scripts/tilelli-cloudflare.mjs mint-token <request.json>");
    console.log(JSON.stringify(await mintToken(requestPath), null, 2));
    return;
  }
  throw new Error("Usage: node scripts/tilelli-cloudflare.mjs <accounts|permission-groups|mint-token>");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
