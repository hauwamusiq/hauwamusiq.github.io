/*
Form: Cloudflare Worker JavaScript
Runtime: Cloudflare Workers
Purpose: Tilelli edge API for project inventory, portfolio entries, anime scenes/assets/render/generation jobs/automation rules, physics notes, reminders, audit events, and cron heartbeat.
Inputs: HTTP requests, DB D1 binding, TILELLI_ALLOWED_ORIGINS, TILELLI_OWNER_WRITE_KEY.
Outputs: JSON responses, D1 rows, CORS headers.
Safety: Client writes are validated; owner-only writes require X-Tilelli-Owner-Key; no raw secrets are returned.
Relations: workers/tilelli-api/wrangler.toml, workers/tilelli-api/schema/0001_initial.sql, .github/workflows/tilelli-edge.yml.
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
    media_url: cleanText(body.mediaUrl || body.media_url, 250000),
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

async function listAnimeScenes(env, url) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
  const result = await env.DB.prepare(
    "SELECT * FROM anime_scenes ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return {
    scenes: result.results || [],
    count: result.results?.length || 0
  };
}

async function createAnimeScene(env, request) {
  requireOwner(request, env);
  const body = await readJson(request);
  const title = cleanText(body.title, 180);
  if (!title) throw statusError(400, "Anime scene title is required.");
  const item = {
    title,
    prompt: cleanText(body.prompt, 4000),
    art_style: cleanChoice(body.art_style || body.artStyle, ["shonen", "shojo", "cinematic"], "shonen"),
    setting: cleanText(body.setting || body.scene_setting || body.sceneSetting, 180),
    duration: cleanChoice(body.duration, ["5s", "10s", "15s", "30s"], "10s"),
    aspect_ratio: cleanChoice(body.aspect_ratio || body.aspectRatio || body.aspect, ["16:9", "9:16", "1:1"], "16:9"),
    notes: cleanText(body.notes || body.extra_notes, 4000),
    status: cleanChoice(body.status, ["queued", "draft", "rendering", "ready", "archived"], "queued"),
    output_url: cleanText(body.output_url || body.outputUrl, 1200),
    source: cleanText(body.source, 120) || "anime-html"
  };
  const result = await env.DB.prepare(
    `INSERT INTO anime_scenes
      (title, prompt, art_style, setting, duration, aspect_ratio, notes, status, output_url, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      item.title,
      item.prompt,
      item.art_style,
      item.setting,
      item.duration,
      item.aspect_ratio,
      item.notes,
      item.status,
      item.output_url,
      item.source
    )
    .run();
  await logEvent(env, "anime_scene.created", { id: result.meta.last_row_id, title: item.title }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function updateAnimeScene(env, request, sceneId) {
  requireOwner(request, env);
  const id = Number.parseInt(sceneId, 10);
  if (!Number.isFinite(id)) throw statusError(400, "Anime scene id is required.");
  const current = await env.DB.prepare("SELECT * FROM anime_scenes WHERE id = ?").bind(id).first();
  if (!current) throw statusError(404, "Anime scene not found.");
  const body = await readJson(request);
  const next = {
    title: cleanText(body.title, 180) || current.title,
    prompt: cleanText(body.prompt, 4000) || current.prompt,
    art_style: cleanChoice(body.art_style || body.artStyle, ["shonen", "shojo", "cinematic"], current.art_style),
    setting: cleanText(body.setting || body.scene_setting || body.sceneSetting, 180) || current.setting,
    duration: cleanChoice(body.duration, ["5s", "10s", "15s", "30s"], current.duration),
    aspect_ratio: cleanChoice(body.aspect_ratio || body.aspectRatio || body.aspect, ["16:9", "9:16", "1:1"], current.aspect_ratio),
    notes: cleanText(body.notes || body.extra_notes, 4000) || current.notes,
    status: cleanChoice(body.status, ["queued", "draft", "rendering", "ready", "archived"], current.status),
    output_url: cleanText(body.output_url || body.outputUrl, 1200) || current.output_url,
    source: cleanText(body.source, 120) || current.source
  };
  await env.DB.prepare(
    `UPDATE anime_scenes
      SET title = ?, prompt = ?, art_style = ?, setting = ?, duration = ?, aspect_ratio = ?, notes = ?, status = ?, output_url = ?, source = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  )
    .bind(
      next.title,
      next.prompt,
      next.art_style,
      next.setting,
      next.duration,
      next.aspect_ratio,
      next.notes,
      next.status,
      next.output_url,
      next.source,
      id
    )
    .run();
  await logEvent(env, "anime_scene.updated", { id, title: next.title, status: next.status }, request);
  return { id, ...next };
}

async function listAnimeAssets(env, url) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
  const sceneIdRaw = url.searchParams.get("scene_id") || url.searchParams.get("sceneId");
  const assetKindRaw = url.searchParams.get("asset_kind") || url.searchParams.get("assetKind");
  let query = "SELECT * FROM anime_assets";
  const params = [];
  const clauses = [];

  if (sceneIdRaw) {
    clauses.push("scene_id = ?");
    params.push(Number.parseInt(sceneIdRaw, 10));
  }
  if (assetKindRaw) {
    clauses.push("asset_kind = ?");
    params.push(cleanChoice(assetKindRaw, ["sketch", "reference", "character-sheet", "background", "moodboard", "preset"], "reference"));
  }
  if (clauses.length) query += ` WHERE ${clauses.join(" AND ")}`;
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const result = await env.DB.prepare(query).bind(...params).all();
  return {
    assets: result.results || [],
    count: result.results?.length || 0
  };
}

async function createAnimeAsset(env, request) {
  requireOwner(request, env);
  const body = await readJson(request);
  const title = cleanText(body.title, 180);
  if (!title) throw statusError(400, "Anime asset title is required.");
  const item = {
    scene_id: body.scene_id || body.sceneId ? Number.parseInt(body.scene_id || body.sceneId, 10) || null : null,
    asset_kind: cleanChoice(body.asset_kind || body.assetKind, ["sketch", "reference", "character-sheet", "background", "moodboard", "preset"], "reference"),
    title,
    notes: cleanText(body.notes || body.caption, 4000),
    source_url: cleanText(body.source_url || body.sourceUrl, 1200),
    file_name: cleanText(body.file_name || body.fileName, 240),
    file_type: cleanText(body.file_type || body.fileType, 120),
    preview_data: cleanText(body.preview_data || body.previewData, 8000),
    status: cleanChoice(body.status, ["draft", "linked", "archived"], "draft"),
    source: cleanText(body.source, 120) || "anime-html"
  };
  const result = await env.DB.prepare(
    `INSERT INTO anime_assets
      (scene_id, asset_kind, title, notes, source_url, file_name, file_type, preview_data, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      item.scene_id,
      item.asset_kind,
      item.title,
      item.notes,
      item.source_url,
      item.file_name,
      item.file_type,
      item.preview_data,
      item.status,
      item.source
    )
    .run();
  await logEvent(env, "anime_asset.created", { id: result.meta.last_row_id, title: item.title, asset_kind: item.asset_kind }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function listAnimeRenderJobs(env, url) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
  const sceneIdRaw = url.searchParams.get("scene_id") || url.searchParams.get("sceneId");
  const status = cleanText(url.searchParams.get("status"), 80);
  let query = "SELECT * FROM anime_render_jobs";
  const params = [];
  const clauses = [];

  if (sceneIdRaw) {
    clauses.push("scene_id = ?");
    params.push(Number.parseInt(sceneIdRaw, 10));
  }
  if (status) {
    clauses.push("status = ?");
    params.push(cleanChoice(status, ["queued", "rendering", "ready", "failed"], "queued"));
  }
  if (clauses.length) query += ` WHERE ${clauses.join(" AND ")}`;
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const result = await env.DB.prepare(query).bind(...params).all();
  return {
    jobs: result.results || [],
    count: result.results?.length || 0
  };
}

function serializeRenderBundle(body) {
  const bundle = body.bundle || body.publish_bundle || body.bundle_json || body.bundleJson || body;
  if (typeof bundle === "string") return bundle.trim() || "{}";
  return JSON.stringify(bundle || {});
}

async function syncSceneFromRenderJob(env, job) {
  if (!job.scene_id) return;
  const updates = [];
  const params = [];
  if (job.status === "queued" || job.status === "rendering") {
    updates.push("status = ?");
    params.push("rendering");
  } else if (job.status === "ready") {
    updates.push("status = ?");
    params.push("ready");
    if (job.output_url) {
      updates.push("output_url = ?");
      params.push(job.output_url);
    }
  } else if (job.status === "failed") {
    updates.push("status = ?");
    params.push("queued");
  }
  if (!updates.length) return;
  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  params.push(job.scene_id);
  await env.DB.prepare(`UPDATE anime_scenes SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
}

async function createAnimeRenderJob(env, request) {
  requireOwner(request, env);
  const body = await readJson(request);
  const sceneId = body.scene_id || body.sceneId ? Number.parseInt(body.scene_id || body.sceneId, 10) || null : null;
  const title = cleanText(body.title || body.name || body.scene_title, 180) || "Untitled render job";
  const item = {
    scene_id: sceneId,
    title,
    render_kind: cleanChoice(body.render_kind || body.renderKind, ["still", "clip", "sequence"], "clip"),
    status: cleanChoice(body.status, ["queued", "rendering", "ready", "failed"], "queued"),
    bundle_json: serializeRenderBundle(body),
    output_url: cleanText(body.output_url || body.outputUrl, 1200),
    thumbnail_url: cleanText(body.thumbnail_url || body.thumbnailUrl, 1200),
    error: cleanText(body.error, 4000),
    source: cleanText(body.source, 120) || "anime-html"
  };
  const result = await env.DB.prepare(
    `INSERT INTO anime_render_jobs
      (scene_id, title, render_kind, status, bundle_json, output_url, thumbnail_url, error, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      item.scene_id,
      item.title,
      item.render_kind,
      item.status,
      item.bundle_json,
      item.output_url,
      item.thumbnail_url,
      item.error,
      item.source
    )
    .run();
  await syncSceneFromRenderJob(env, item);
  await logEvent(env, "anime_render_job.created", { id: result.meta.last_row_id, title: item.title, render_kind: item.render_kind }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function updateAnimeRenderJob(env, request, jobId) {
  requireOwner(request, env);
  const id = Number.parseInt(jobId, 10);
  if (!Number.isFinite(id)) throw statusError(400, "Render job id is required.");
  const current = await env.DB.prepare("SELECT * FROM anime_render_jobs WHERE id = ?").bind(id).first();
  if (!current) throw statusError(404, "Render job not found.");
  const body = await readJson(request);
  const next = {
    scene_id: body.scene_id || body.sceneId ? Number.parseInt(body.scene_id || body.sceneId, 10) || current.scene_id : current.scene_id,
    title: cleanText(body.title, 180) || current.title,
    render_kind: cleanChoice(body.render_kind || body.renderKind, ["still", "clip", "sequence"], current.render_kind),
    status: cleanChoice(body.status, ["queued", "rendering", "ready", "failed"], current.status),
    bundle_json: body.bundle || body.publish_bundle || body.bundle_json || body.bundleJson ? serializeRenderBundle(body) : current.bundle_json,
    output_url: cleanText(body.output_url || body.outputUrl, 1200) || current.output_url,
    thumbnail_url: cleanText(body.thumbnail_url || body.thumbnailUrl, 1200) || current.thumbnail_url,
    error: cleanText(body.error, 4000) || current.error,
    source: cleanText(body.source, 120) || current.source
  };
  await env.DB.prepare(
    `UPDATE anime_render_jobs
      SET scene_id = ?, title = ?, render_kind = ?, status = ?, bundle_json = ?, output_url = ?, thumbnail_url = ?, error = ?, source = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  )
    .bind(
      next.scene_id,
      next.title,
      next.render_kind,
      next.status,
      next.bundle_json,
      next.output_url,
      next.thumbnail_url,
      next.error,
      next.source,
      id
    )
    .run();
  await syncSceneFromRenderJob(env, next);
  await logEvent(env, "anime_render_job.updated", { id, title: next.title, status: next.status }, request);
  return { id, ...next };
}

async function listAnimeAutomations(env, url) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
  const result = await env.DB.prepare(
    "SELECT * FROM anime_automation_rules ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return {
    rules: result.results || [],
    count: result.results?.length || 0
  };
}

function serializeAutomationPayload(body) {
  const payload = body.payload || body.payload_json || body.payloadJson || {
    title: body.title || "",
    trigger_type: body.trigger_type || body.triggerType || "manual",
    source_kind: body.source_kind || body.sourceKind || "scene",
    source_ref: body.source_ref || body.sourceRef || "",
    action_kind: body.action_kind || body.actionKind || "render",
    schedule_cron: body.schedule_cron || body.scheduleCron || "",
    notes: body.notes || ""
  };
  if (typeof payload === "string") return payload.trim() || "{}";
  return JSON.stringify(payload || {});
}

async function createAnimeAutomationRule(env, request) {
  requireOwner(request, env);
  const body = await readJson(request);
  const title = cleanText(body.title, 180);
  if (!title) throw statusError(400, "Automation rule title is required.");
  const item = {
    title,
    trigger_type: cleanChoice(body.trigger_type || body.triggerType, ["manual", "review", "archive", "schedule"], "manual"),
    source_kind: cleanChoice(body.source_kind || body.sourceKind, ["scene", "template", "review", "bundle"], "scene"),
    source_ref: cleanText(body.source_ref || body.sourceRef, 180),
    action_kind: cleanChoice(body.action_kind || body.actionKind, ["render", "archive", "clone", "export"], "render"),
    schedule_cron: cleanText(body.schedule_cron || body.scheduleCron, 180),
    status: cleanChoice(body.status, ["active", "paused", "archived"], "active"),
    payload_json: serializeAutomationPayload(body),
    notes: cleanText(body.notes, 4000),
    source: cleanText(body.source, 120) || "anime-html"
  };
  const result = await env.DB.prepare(
    `INSERT INTO anime_automation_rules
      (title, trigger_type, source_kind, source_ref, action_kind, schedule_cron, status, payload_json, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      item.title,
      item.trigger_type,
      item.source_kind,
      item.source_ref,
      item.action_kind,
      item.schedule_cron,
      item.status,
      item.payload_json,
      item.notes,
      item.source
    )
    .run();
  await logEvent(env, "anime_automation_rule.created", { id: result.meta.last_row_id, title: item.title, trigger_type: item.trigger_type }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function updateAnimeAutomationRule(env, request, ruleId) {
  requireOwner(request, env);
  const id = Number.parseInt(ruleId, 10);
  if (!Number.isFinite(id)) throw statusError(400, "Automation rule id is required.");
  const current = await env.DB.prepare("SELECT * FROM anime_automation_rules WHERE id = ?").bind(id).first();
  if (!current) throw statusError(404, "Automation rule not found.");
  const body = await readJson(request);
  const next = {
    title: cleanText(body.title, 180) || current.title,
    trigger_type: cleanChoice(body.trigger_type || body.triggerType, ["manual", "review", "archive", "schedule"], current.trigger_type),
    source_kind: cleanChoice(body.source_kind || body.sourceKind, ["scene", "template", "review", "bundle"], current.source_kind),
    source_ref: cleanText(body.source_ref || body.sourceRef, 180) || current.source_ref,
    action_kind: cleanChoice(body.action_kind || body.actionKind, ["render", "archive", "clone", "export"], current.action_kind),
    schedule_cron: cleanText(body.schedule_cron || body.scheduleCron, 180) || current.schedule_cron,
    status: cleanChoice(body.status, ["active", "paused", "archived"], current.status),
    payload_json: body.payload || body.payload_json || body.payloadJson ? serializeAutomationPayload(body) : current.payload_json,
    notes: cleanText(body.notes, 4000) || current.notes,
    source: cleanText(body.source, 120) || current.source
  };
  await env.DB.prepare(
    `UPDATE anime_automation_rules
      SET title = ?, trigger_type = ?, source_kind = ?, source_ref = ?, action_kind = ?, schedule_cron = ?, status = ?, payload_json = ?, notes = ?, source = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  )
    .bind(
      next.title,
      next.trigger_type,
      next.source_kind,
      next.source_ref,
      next.action_kind,
      next.schedule_cron,
      next.status,
      next.payload_json,
      next.notes,
      next.source,
      id
    )
    .run();
  await logEvent(env, "anime_automation_rule.updated", { id, title: next.title, status: next.status }, request);
  return { id, ...next };
}

async function listAnimeGenerationJobs(env, url) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
  const sceneIdRaw = url.searchParams.get("scene_id") || url.searchParams.get("sceneId");
  const status = cleanText(url.searchParams.get("status"), 80);
  let query = "SELECT * FROM anime_generation_jobs";
  const params = [];
  const clauses = [];

  if (sceneIdRaw) {
    clauses.push("scene_id = ?");
    params.push(Number.parseInt(sceneIdRaw, 10));
  }
  if (status) {
    clauses.push("status = ?");
    params.push(cleanChoice(status, ["queued", "generating", "ready", "failed"], "queued"));
  }
  if (clauses.length) query += ` WHERE ${clauses.join(" AND ")}`;
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const result = await env.DB.prepare(query).bind(...params).all();
  return {
    jobs: result.results || [],
    count: result.results?.length || 0
  };
}

function serializeGenerationBundle(body) {
  const bundle = body.bundle || body.generation_bundle || body.bundle_json || body.bundleJson || body;
  if (typeof bundle === "string") return bundle.trim() || "{}";
  return JSON.stringify(bundle || {});
}

async function syncSceneFromGenerationJob(env, job) {
  if (!job.scene_id) return;
  const updates = [];
  const params = [];
  if (job.status === "queued" || job.status === "generating") {
    updates.push("status = ?");
    params.push("rendering");
  } else if (job.status === "ready") {
    updates.push("status = ?");
    params.push("ready");
    if (job.output_url) {
      updates.push("output_url = ?");
      params.push(job.output_url);
    }
  } else if (job.status === "failed") {
    updates.push("status = ?");
    params.push("queued");
  }
  if (!updates.length) return;
  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  params.push(job.scene_id);
  await env.DB.prepare(`UPDATE anime_scenes SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
}

async function createAnimeGenerationJob(env, request) {
  requireOwner(request, env);
  const body = await readJson(request);
  const sceneId = body.scene_id || body.sceneId ? Number.parseInt(body.scene_id || body.sceneId, 10) || null : null;
  const title = cleanText(body.title || body.name || body.scene_title, 180) || "Untitled generation job";
  const item = {
    scene_id: sceneId,
    title,
    provider: cleanChoice(body.provider, ["local", "cloudflare", "external"], "local"),
    model: cleanText(body.model || body.model_name || body.modelName, 180),
    generation_prompt: cleanText(body.generation_prompt || body.generationPrompt || body.prompt, 4000),
    notes: cleanText(body.notes, 4000),
    duration: cleanChoice(body.duration, ["5s", "10s", "15s", "30s"], "10s"),
    resolution: cleanChoice(body.resolution, ["1920x1080", "1080x1920", "1024x1024"], "1920x1080"),
    fps: cleanChoice(body.fps, ["24", "30", "60"], "24"),
    status: cleanChoice(body.status, ["queued", "generating", "ready", "failed"], "queued"),
    bundle_json: serializeGenerationBundle(body),
    output_url: cleanText(body.output_url || body.outputUrl, 1200),
    thumbnail_url: cleanText(body.thumbnail_url || body.thumbnailUrl, 1200),
    error: cleanText(body.error, 4000),
    source: cleanText(body.source, 120) || "anime-html"
  };
  const result = await env.DB.prepare(
    `INSERT INTO anime_generation_jobs
      (scene_id, title, provider, model, generation_prompt, notes, duration, resolution, fps, status, bundle_json, output_url, thumbnail_url, error, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      item.scene_id,
      item.title,
      item.provider,
      item.model,
      item.generation_prompt,
      item.notes,
      item.duration,
      item.resolution,
      item.fps,
      item.status,
      item.bundle_json,
      item.output_url,
      item.thumbnail_url,
      item.error,
      item.source
    )
    .run();
  await syncSceneFromGenerationJob(env, item);
  await logEvent(env, "anime_generation_job.created", { id: result.meta.last_row_id, title: item.title, provider: item.provider }, request);
  return { id: result.meta.last_row_id, ...item };
}

async function updateAnimeGenerationJob(env, request, jobId) {
  requireOwner(request, env);
  const id = Number.parseInt(jobId, 10);
  if (!Number.isFinite(id)) throw statusError(400, "Generation job id is required.");
  const current = await env.DB.prepare("SELECT * FROM anime_generation_jobs WHERE id = ?").bind(id).first();
  if (!current) throw statusError(404, "Generation job not found.");
  const body = await readJson(request);
  const next = {
    scene_id: body.scene_id || body.sceneId ? Number.parseInt(body.scene_id || body.sceneId, 10) || current.scene_id : current.scene_id,
    title: cleanText(body.title, 180) || current.title,
    provider: cleanChoice(body.provider, ["local", "cloudflare", "external"], current.provider),
    model: cleanText(body.model || body.model_name || body.modelName, 180) || current.model,
    generation_prompt: cleanText(body.generation_prompt || body.generationPrompt || body.prompt, 4000) || current.generation_prompt,
    notes: cleanText(body.notes, 4000) || current.notes,
    duration: cleanChoice(body.duration, ["5s", "10s", "15s", "30s"], current.duration),
    resolution: cleanChoice(body.resolution, ["1920x1080", "1080x1920", "1024x1024"], current.resolution),
    fps: cleanChoice(body.fps, ["24", "30", "60"], current.fps),
    status: cleanChoice(body.status, ["queued", "generating", "ready", "failed"], current.status),
    bundle_json: body.bundle || body.generation_bundle || body.bundle_json || body.bundleJson ? serializeGenerationBundle(body) : current.bundle_json,
    output_url: cleanText(body.output_url || body.outputUrl, 1200) || current.output_url,
    thumbnail_url: cleanText(body.thumbnail_url || body.thumbnailUrl, 1200) || current.thumbnail_url,
    error: cleanText(body.error, 4000) || current.error,
    source: cleanText(body.source, 120) || current.source
  };
  await env.DB.prepare(
    `UPDATE anime_generation_jobs
      SET scene_id = ?, title = ?, provider = ?, model = ?, generation_prompt = ?, notes = ?, duration = ?, resolution = ?, fps = ?, status = ?, bundle_json = ?, output_url = ?, thumbnail_url = ?, error = ?, source = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  )
    .bind(
      next.scene_id,
      next.title,
      next.provider,
      next.model,
      next.generation_prompt,
      next.notes,
      next.duration,
      next.resolution,
      next.fps,
      next.status,
      next.bundle_json,
      next.output_url,
      next.thumbnail_url,
      next.error,
      next.source,
      id
    )
    .run();
  await syncSceneFromGenerationJob(env, next);
  await logEvent(env, "anime_generation_job.updated", { id, title: next.title, status: next.status }, request);
  return { id, ...next };
}

async function listAgentRuns(env) {
  return env.DB.prepare("SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 100").all();
}

async function createAgentRun(env, request) {
  requireOwner(request, env);
  const body = await readJson(request);
  const item = {
    run_type: cleanText(body.run_type || body.runType || body.task?.name || "tilelli-agent-run", 120),
    status: cleanChoice(body.status, ["ok", "warn", "error"], "ok"),
    details: JSON.stringify({
      task: body.task || null,
      modelPlan: body.modelPlan || null,
      verificationResults: body.verificationResults || [],
      createdAt: body.createdAt || new Date().toISOString()
    })
  };
  const result = await env.DB.prepare("INSERT INTO agent_runs (run_type, status, details) VALUES (?, ?, ?)")
    .bind(item.run_type, item.status, item.details)
    .run();
  await logEvent(env, "agent_run.created", { id: result.meta.last_row_id, run_type: item.run_type }, request);
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
  if (pathname === "/v1/anime/scenes" && request.method === "GET") {
    return json(await listAnimeScenes(env, url), {}, env, request);
  }
  if (pathname === "/v1/anime/scenes" && request.method === "POST") {
    return json(await createAnimeScene(env, request), { status: 201 }, env, request);
  }
  const sceneMatch = pathname.match(/^\/v1\/anime\/scenes\/(\d+)$/);
  if (sceneMatch && request.method === "PATCH") {
    return json(await updateAnimeScene(env, request, sceneMatch[1]), {}, env, request);
  }
  if (pathname === "/v1/anime/assets" && request.method === "GET") {
    return json(await listAnimeAssets(env, url), {}, env, request);
  }
  if (pathname === "/v1/anime/assets" && request.method === "POST") {
    return json(await createAnimeAsset(env, request), { status: 201 }, env, request);
  }
  if (pathname === "/v1/anime/renders" && request.method === "GET") {
    return json(await listAnimeRenderJobs(env, url), {}, env, request);
  }
  if (pathname === "/v1/anime/renders" && request.method === "POST") {
    return json(await createAnimeRenderJob(env, request), { status: 201 }, env, request);
  }
  const renderJobMatch = pathname.match(/^\/v1\/anime\/renders\/(\d+)$/);
  if (renderJobMatch && request.method === "PATCH") {
    return json(await updateAnimeRenderJob(env, request, renderJobMatch[1]), {}, env, request);
  }
  if (pathname === "/v1/anime/automations" && request.method === "GET") {
    return json(await listAnimeAutomations(env, url), {}, env, request);
  }
  if (pathname === "/v1/anime/automations" && request.method === "POST") {
    return json(await createAnimeAutomationRule(env, request), { status: 201 }, env, request);
  }
  const automationMatch = pathname.match(/^\/v1\/anime\/automations\/(\d+)$/);
  if (automationMatch && request.method === "PATCH") {
    return json(await updateAnimeAutomationRule(env, request, automationMatch[1]), {}, env, request);
  }
  if (pathname === "/v1/anime/generations" && request.method === "GET") {
    return json(await listAnimeGenerationJobs(env, url), {}, env, request);
  }
  if (pathname === "/v1/anime/generations" && request.method === "POST") {
    return json(await createAnimeGenerationJob(env, request), { status: 201 }, env, request);
  }
  const generationMatch = pathname.match(/^\/v1\/anime\/generations\/(\d+)$/);
  if (generationMatch && request.method === "PATCH") {
    return json(await updateAnimeGenerationJob(env, request, generationMatch[1]), {}, env, request);
  }
  if (pathname === "/v1/agent/runs" && request.method === "GET") {
    return json(await listAgentRuns(env), {}, env, request);
  }
  if (pathname === "/v1/agent/runs" && request.method === "POST") {
    return json(await createAgentRun(env, request), { status: 201 }, env, request);
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
