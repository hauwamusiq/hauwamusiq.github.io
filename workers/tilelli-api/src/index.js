/*
Form: Cloudflare Worker JavaScript
Runtime: Cloudflare Workers
Purpose: Tilelli edge API for project inventory, portfolio entries, physics notes, reminders, audit events, and cron heartbeat.
Inputs: HTTP requests, DB D1 binding, TILELLI_ALLOWED_ORIGINS, TILELLI_OWNER_WRITE_KEY.
Outputs: JSON responses, D1 rows, CORS headers.
Safety: Client writes are validated; owner-only writes require X-Tilelli-Owner-Key; no raw secrets are returned.
Relations: workers/tilelli-api/wrangler.toml, workers/tilelli-api/schema/0001_initial.sql, docs/tilelli-edge.workflow.yml.template.
*/

const PROJECTS = [
  { id: "index", name: "Ariadni Command Center", url: "https://hauwamusiq.github.io/" },
  { id: "portfolio", name: "Tilelli's Thread", url: "https://hauwamusiq.github.io/tilaelia.html" },
  { id: "dashboard", name: "Chic Clock", url: "https://hauwamusiq.github.io/clock.html" },
  { id: "world", name: "Omniscribe Core", url: "https://hauwamusiq.github.io/gaia.html" },
  { id: "physics", name: "Aletheia Physics Lab", url: "https://hauwamusiq.github.io/lani.html" },
  { id: "esp", name: "ESP Target Trainer", url: "https://hauwamusiq.github.io/esp.html" }
];

function json(data, init = {}, env, request) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(env, request),
      ...(init.headers || {})
    }
  });
}

function corsHeaders(env, request) {
  const origin = request?.headers.get("Origin") || "null";
  const allowed = String(env.TILELLI_ALLOWED_ORIGINS || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed.includes("*") ? "*" : "https://hauwamusiq.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Tilelli-Owner-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw statusError(400, "Invalid JSON body.");
  }
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireOwner(request, env) {
  if (!env.TILELLI_OWNER_WRITE_KEY) {
    throw statusError(503, "Owner write key is not configured for this Worker.");
  }
  const provided = request.headers.get("X-Tilelli-Owner-Key");
  if (provided !== env.TILELLI_OWNER_WRITE_KEY) {
    throw statusError(401, "Owner write key is required.");
  }
}

function cleanText(value, limit = 4000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanChoice(value, allowed, fallback) {
  const cleaned = cleanText(value, 80).toLowerCase();
  return allowed.includes(cleaned) ? cleaned : fallback;
}

async function logEvent(env, type, payload, request) {
  await env.DB.prepare(
    "INSERT INTO audit_events (event_type, project, payload, user_agent) VALUES (?, ?, ?, ?)"
  )
    .bind(type, "tilelli", JSON.stringify(payload || {}), request.headers.get("User-Agent") || "")
    .run();
}

async function listPortfolio(env, url) {
  const visibility = url.searchParams.get("visibility") || "published";
  const section = url.searchParams.get("section");
  let query = "SELECT * FROM portfolio_entries WHERE visibility = ?";
  const params = [visibility];
  if (section) {
    query += " AND section = ?";
    params.push(section);
  }
  query += " ORDER BY created_at DESC LIMIT 100";
  return env.DB.prepare(query).bind(...params).all();
}

async function createPortfolio(env, request) {
  const body = await readJson(request);
  const section = cleanChoice(body.section, ["music", "writing", "visuals", "research"], "writing");
  const category = cleanText(body.category || "other", 80);
  const title = cleanText(body.title, 180);
  if (!title) throw statusError(400, "Portfolio entry title is required.");
  const item = {
    section,
    category,
    title,
    meta: cleanText(body.meta, 240),
    body: cleanText(body.body, 8000),
    media_type: cleanChoice(body.mediaType || body.media_type, ["none", "image", "audio", "video", "link"], "none"),
    media_url: cleanText(body.mediaUrl || body.media_url, 1200),
    visibility: cleanChoice(body.visibility, ["draft", "published", "archived"], "draft")
  };
  const result = await env.DB.prepare(
    `INSERT INTO portfolio_entries
      (section, category, title, meta, body, media_type, media_url, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(item.section, item.category, item.title, item.meta, item.body, item.media_type, item.media_url, item.visibility)
    .run();
  await logEvent(env, "portfolio_entry.created", { id: result.meta.last_row_id, title: item.title }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function listPhysicsNotes(env) {
  return env.DB.prepare("SELECT * FROM physics_notes ORDER BY created_at DESC LIMIT 100").all();
}

async function createPhysicsNote(env, request) {
  const body = await readJson(request);
  const title = cleanText(body.title, 180);
  if (!title) throw statusError(400, "Physics note title is required.");
  const item = {
    title,
    topic: cleanText(body.topic, 180),
    claim: cleanText(body.claim, 4000),
    prerequisites: cleanText(body.prerequisites || body.prereqs, 4000),
    reproduce: cleanText(body.reproduce, 4000),
    status: cleanChoice(body.status, ["queue", "active", "mastered", "archived"], "queue")
  };
  const result = await env.DB.prepare(
    `INSERT INTO physics_notes (title, topic, claim, prerequisites, reproduce, status)
      VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(item.title, item.topic, item.claim, item.prerequisites, item.reproduce, item.status)
    .run();
  await logEvent(env, "physics_note.created", { id: result.meta.last_row_id, title: item.title }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function listReminders(env) {
  return env.DB.prepare("SELECT * FROM dashboard_reminders WHERE status = 'open' ORDER BY due_at IS NULL, due_at ASC, created_at DESC LIMIT 100").all();
}

async function createReminder(env, request) {
  const body = await readJson(request);
  const title = cleanText(body.title, 180);
  if (!title) throw statusError(400, "Reminder title is required.");
  const item = {
    title,
    body: cleanText(body.body, 4000),
    due_at: cleanText(body.dueAt || body.due_at, 80) || null,
    status: cleanChoice(body.status, ["open", "done", "archived"], "open")
  };
  const result = await env.DB.prepare(
    "INSERT INTO dashboard_reminders (title, body, due_at, status) VALUES (?, ?, ?, ?)"
  )
    .bind(item.title, item.body, item.due_at, item.status)
    .run();
  await logEvent(env, "reminder.created", { id: result.meta.last_row_id, title: item.title }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env, request) });
  if (pathname === "/" || pathname === "/health") {
    return json({ ok: true, service: "tilelli-api", at: new Date().toISOString() }, {}, env, request);
  }
  if (pathname === "/v1/projects" && request.method === "GET") {
    return json({ projects: PROJECTS }, {}, env, request);
  }
  if (pathname === "/v1/events" && request.method === "POST") {
    await logEvent(env, "client.event", await readJson(request), request);
    return json({ ok: true }, { status: 201 }, env, request);
  }
  if (pathname === "/v1/portfolio/entries" && request.method === "GET") {
    return json(await listPortfolio(env, url), {}, env, request);
  }
  if (pathname === "/v1/portfolio/entries" && request.method === "POST") {
    requireOwner(request, env);
    return json(await createPortfolio(env, request), { status: 201 }, env, request);
  }
  if (pathname === "/v1/physics/notes" && request.method === "GET") {
    return json(await listPhysicsNotes(env), {}, env, request);
  }
  if (pathname === "/v1/physics/notes" && request.method === "POST") {
    requireOwner(request, env);
    return json(await createPhysicsNote(env, request), { status: 201 }, env, request);
  }
  if (pathname === "/v1/dashboard/reminders" && request.method === "GET") {
    return json(await listReminders(env), {}, env, request);
  }
  if (pathname === "/v1/dashboard/reminders" && request.method === "POST") {
    requireOwner(request, env);
    return json(await createReminder(env, request), { status: 201 }, env, request);
  }
  throw statusError(404, "Route not found.");
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      return json(
        { ok: false, error: error.message || "Unexpected Worker error." },
        { status: error.status || 500 },
        env,
        request
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      env.DB.prepare("INSERT INTO agent_runs (run_type, status, details) VALUES (?, ?, ?)")
        .bind("cloudflare-cron", "ok", JSON.stringify({ cron: event.cron, scheduledTime: event.scheduledTime }))
        .run()
    );
  }
};
