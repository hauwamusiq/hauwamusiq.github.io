/*
Form: Cloudflare Worker JavaScript
Runtime: Cloudflare Workers
Purpose: Anime renderer adapter for Tilelli generation jobs. Accepts a generation handoff, optionally proxies to an upstream renderer, and can callback into Tilelli with a ready or failed result.
Inputs: HTTP requests, generation bundle payloads, TILELLI_GENERATION_CALLBACK_KEY, TILELLI_RENDERER_MODE, TILELLI_RENDERER_UPSTREAM_URL, TILELLI_RENDERER_AUTO_COMPLETE.
Outputs: JSON acknowledgements, callback POSTs to the Tilelli API, and optional proxy responses.
Safety: Never stores owner secrets; only accepts the renderer callback key through env; mock mode is local-test only.
Relations: workers/tilelli-api/src/index.js, workers/tilelli-api/wrangler.toml, docs/tilelli-edge.md.
*/

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, limit = 4000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanChoice(value, allowed, fallback) {
  const cleaned = cleanText(value, 80).toLowerCase();
  return allowed.includes(cleaned) ? cleaned : fallback;
}

function parseJsonSafe(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...(init.headers || {})
    }
  });
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

function requireCallbackKey(env) {
  const expected = cleanText(env.TILELLI_GENERATION_CALLBACK_KEY, 200);
  if (!expected) throw statusError(503, "Generation callback key is not configured.");
  return expected;
}

function makeProviderJobId(prefix = "tilelli-render") {
  const suffix = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}`.slice(-8);
  return `${prefix}-${Date.now()}-${suffix}`;
}

function buildMockArtifact(jobId, bundle, body) {
  const title = cleanText(body.job?.title || bundle?.scene?.title || "Untitled scene", 160);
  return {
    output_url: `mock://tilelli-renderer/${jobId}.mp4`,
    thumbnail_url: `mock://tilelli-renderer/${jobId}.jpg`,
    title,
    status: "ready",
    completed_at: new Date().toISOString(),
    provider_response_json: {
      renderer: "tilelli-renderer",
      mode: "mock",
      accepted_at: body.accepted_at || new Date().toISOString(),
      title,
      job_id: jobId,
      bundle_scene_title: bundle?.scene?.title || "",
      bundle_setting: bundle?.scene?.setting || ""
    }
  };
}

async function postCallback(url, key, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tilelli-Generation-Callback-Key": key
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJsonSafe(text, { raw: text })
  };
}

async function handleRender(request, env, ctx) {
  const body = await readJson(request);
  const bundle = parseJsonSafe(body.bundle || body.generation_bundle || body.bundle_json || {}, {});
  const mode = cleanChoice(env.TILELLI_RENDERER_MODE, ["mock", "proxy"], "mock");
  const providerJobId = cleanText(body.provider_job_id || body.providerJobId || makeProviderJobId(), 180);
  const acceptedAt = new Date().toISOString();

  if (mode === "proxy") {
    const upstream = cleanText(env.TILELLI_RENDERER_UPSTREAM_URL, 1000);
    if (!upstream) throw statusError(503, "Renderer upstream URL is not configured.");
    const upstreamResponse = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ...body, provider_job_id: providerJobId, accepted_at: acceptedAt })
    });
    const text = await upstreamResponse.text();
    return new Response(text, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
        ...corsHeaders()
      }
    });
  }

  const responsePayload = {
    ok: true,
    renderer: "tilelli-renderer",
    mode,
    status: "generating",
    provider_job_id: providerJobId,
    accepted_at: acceptedAt
  };

  const autoComplete = String(env.TILELLI_RENDERER_AUTO_COMPLETE || "1").trim() !== "0" && body.auto_complete !== false;
  if (autoComplete && body.callbacks?.complete) {
    const callbackKey = requireCallbackKey(env);
    const completion = buildMockArtifact(providerJobId, bundle, { ...body, accepted_at: acceptedAt });
    ctx.waitUntil(
      postCallback(body.callbacks.complete, callbackKey, completion).catch(async error => {
        if (body.callbacks?.fail) {
          await postCallback(body.callbacks.fail, callbackKey, {
            status: "failed",
            provider_job_id: providerJobId,
            error: error.message || "Renderer callback failed",
            completed_at: new Date().toISOString()
          }).catch(() => {});
        }
      })
    );
  }

  return json(responsePayload, { status: 202 });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (url.pathname === "/health") {
    return json({
      ok: true,
      service: "tilelli-renderer",
      mode: cleanChoice(env.TILELLI_RENDERER_MODE, ["mock", "proxy"], "mock"),
      at: new Date().toISOString()
    });
  }
  if (url.pathname === "/v1/render/anime" && request.method === "POST") {
    return handleRender(request, env, ctx);
  }
  throw statusError(404, "Route not found.");
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      return json(
        { ok: false, error: error.message || "Unexpected Worker error." },
        { status: error.status || 500 }
      );
    }
  }
};
