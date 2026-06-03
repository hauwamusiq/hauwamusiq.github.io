#!/usr/bin/env node
/*
Form: Node JavaScript
Runtime: Local Node
Purpose: Local-only Tilelli stack server for the API, render dispatch, and SQLite persistence.
Inputs: Local repo files, local SQLite database, owner/callback keys, and loopback requests.
Outputs: JSON API responses, local render job dispatches, and persisted SQLite rows.
Safety: Local filesystem and loopback network only.
Relations: workers/tilelli-api/src/index.js, scripts/tilelli-cli.mjs, tilelli-edge-client.js, /opt/homebrew/etc/nginx/servers/tilelli-local.conf.
*/

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import apiWorker from "../workers/tilelli-api/src/index.js";

const REPO_ROOT = process.env.TILELLI_REPO_ROOT || "/Users/johnmobley/tilelli/hauwamusiq.github.io";
const DEFAULT_HOST = process.env.TILELLI_LOCAL_HOST || "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.TILELLI_LOCAL_PORT || "8787", 10) || 8787;
const DB_PATH = process.env.TILELLI_LOCAL_DB_PATH || path.join(REPO_ROOT, ".tilelli/local-stack/tilelli.sqlite");
const SCHEMA_DIR = path.join(REPO_ROOT, "workers/tilelli-api/schema");
const API_BASE = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
const RENDERER_URL = process.env.TILELLI_GENERATION_RENDERER_URL || `${API_BASE}/v1/render/anime`;

class SQLiteStatementAdapter {
  constructor(statement) {
    this.statement = statement;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  all() {
    return { results: this.statement.all(...this.params) };
  }

  first() {
    return this.statement.get(...this.params) || null;
  }

  run() {
    const result = this.statement.run(...this.params);
    return {
      meta: {
        last_row_id: Number(result?.lastInsertRowid || 0),
        changes: Number(result?.changes || 0)
      }
    };
  }
}

class SQLiteDatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SQLiteStatementAdapter(this.db.prepare(sql));
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  close() {
    this.db.close();
  }
}

function logLine(message = "") {
  process.stdout.write(`${message}\n`);
}

function errorLine(message = "") {
  process.stderr.write(`${message}\n`);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function readLocalSecret(name) {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, ".tilelli", name), "utf8");
    return raw.trim();
  } catch {
    return "";
  }
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

async function ensureDatabase() {
  await ensureDir(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    `CREATE TABLE IF NOT EXISTS tilelli_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`
  );

  const applied = new Set(
    db
      .prepare("SELECT name FROM tilelli_migrations ORDER BY name")
      .all()
      .map(row => row.name)
  );

  const schemaFiles = (await fs.readdir(SCHEMA_DIR))
    .filter(name => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  for (const fileName of schemaFiles) {
    if (applied.has(fileName)) continue;
    const sql = await fs.readFile(path.join(SCHEMA_DIR, fileName), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO tilelli_migrations (name) VALUES (?)").run(fileName);
  }

  return new SQLiteDatabaseAdapter(db);
}

async function makeEnv(db) {
  const ownerWriteKey = process.env.TILELLI_OWNER_WRITE_KEY || (await readLocalSecret("owner-write-key"));
  const generationCallbackKey = process.env.TILELLI_GENERATION_CALLBACK_KEY || (await readLocalSecret("generation-callback-key"));
  return {
    DB: db,
    TILELLI_ALLOWED_ORIGINS: "*",
    TILELLI_OWNER_WRITE_KEY: ownerWriteKey,
    TILELLI_GENERATION_CALLBACK_KEY: generationCallbackKey,
    TILELLI_GENERATION_RENDERER_URL: RENDERER_URL,
    TILELLI_RENDERER_MODE: "local",
    TILELLI_RENDERER_AUTO_COMPLETE: "1"
  };
}

function requestToResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });
}

async function readNodeBody(nodeRequest) {
  const method = String(nodeRequest.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of nodeRequest) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

function buildLocalRequest(nodeRequest, body) {
  const url = new URL(nodeRequest.url, `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeRequest.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else headers.set(key, String(value));
  }
  const method = String(nodeRequest.method || "GET").toUpperCase();
  const init = { method, headers };
  if (body != null && method !== "GET" && method !== "HEAD") {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(url.toString(), init);
}

function spawnLocalRender(jobId) {
  const cliPath = path.join(REPO_ROOT, "scripts/tilelli-cli.mjs");
  const child = spawn(process.execPath, [cliPath, "render", "generation", String(jobId)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TILELLI_API_BASE_URL: API_BASE,
      TILELLI_MEDIA_PUBLIC_BASE_URL: process.env.TILELLI_MEDIA_PUBLIC_BASE_URL || "http://127.0.0.1:8081/q9-media",
      GRAVNOVA_Q9_ROOT: process.env.GRAVNOVA_Q9_ROOT || "/Users/johnmobley/gravnova/q9",
      GRAVNOVA_Q9_MEDIA_ROOT: process.env.GRAVNOVA_Q9_MEDIA_ROOT || "/Users/johnmobley/gravnova/q9/public"
    },
    stdio: "ignore",
    detached: true
  });
  child.unref();
  return child.pid || null;
}

async function routeLocal(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Tilelli-Owner-Key,X-Tilelli-Generation-Callback-Key",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  if (url.pathname === "/health") {
    return new Response(
      JSON.stringify(
        {
          ok: true,
          service: "tilelli-local-stack",
          apiBase: API_BASE,
          rendererUrl: RENDERER_URL,
          dbPath: DB_PATH,
          at: new Date().toISOString()
        },
        null,
        2
      ),
      {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  if (url.pathname === "/v1/anime/status") {
    const statePath = process.env.TILELLI_ANIME_BACKEND_STATE_PATH || "/Users/johnmobley/gravnova/q9/status/anime-backend-state.json";
    const backendState = await readJsonIfExists(statePath);
    return new Response(
      JSON.stringify(
        {
          ok: true,
          provider: "gravnova-anime-image",
          backendStatePath: statePath,
          backendState,
          at: new Date().toISOString()
        },
        null,
        2
      ),
      {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  if (url.pathname === "/v1/render/anime" && request.method === "POST") {
    const bodyText = await request.text();
    const body = bodyText.trim() ? JSON.parse(bodyText) : {};
    const jobId = Number(body?.job?.id || body?.jobId || body?.generation_id || body?.generationId || 0) || 0;
    if (!jobId) {
      return new Response(JSON.stringify({ ok: false, error: "generation job id is required." }, null, 2), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    const pid = spawnLocalRender(jobId);
    return new Response(
      JSON.stringify(
        {
          ok: true,
          renderer: "tilelli-local-cli",
          mode: "local-ffmpeg",
          status: "generating",
          provider_job_id: `tilelli-local-${jobId}-${Date.now()}`,
          job_id: jobId,
          pid,
          accepted_at: new Date().toISOString()
        },
        null,
        2
      ),
      {
        status: 202,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  return apiWorker.fetch(request, env);
}

async function serve() {
  const db = await ensureDatabase();
  const env = await makeEnv(db);

  const server = http.createServer(async (nodeRequest, nodeResponse) => {
    try {
      const body = await readNodeBody(nodeRequest);
      const request = buildLocalRequest(nodeRequest, body);
      const response = await routeLocal(request, env);
      requestToResponse(nodeResponse, response);
      const buffer = Buffer.from(await response.arrayBuffer());
      nodeResponse.end(buffer);
    } catch (error) {
      const payload = {
        ok: false,
        error: error?.message || "Unexpected local Tilelli error."
      };
      nodeResponse.statusCode = error?.status || 500;
      nodeResponse.setHeader("Content-Type", "application/json; charset=utf-8");
      nodeResponse.end(`${JSON.stringify(payload, null, 2)}\n`);
    }
  });

  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    logLine(`Tilelli local stack listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    logLine(`DB: ${DB_PATH}`);
  });

  const shutdown = () => {
    server.close(() => db.close());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  const [command] = process.argv.slice(2);
  if (!command || command === "serve") {
    await serve();
    return;
  }

  if (command === "db" && process.argv[3] === "init") {
    const db = await ensureDatabase();
    db.close();
    logLine(`Initialized Tilelli SQLite database at ${DB_PATH}`);
    return;
  }

  if (command === "health") {
    const db = await ensureDatabase();
    const env = await makeEnv(db);
    const response = await routeLocal(new Request(`${API_BASE}/health`), env);
    logLine(await response.text());
    db.close();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
  errorLine(error?.stack || error?.message || String(error));
  process.exit(1);
});
