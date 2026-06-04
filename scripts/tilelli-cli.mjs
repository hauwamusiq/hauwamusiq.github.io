#!/usr/bin/env node
/*
Form: Node JavaScript
Runtime: Local Node CLI
Purpose: Tilelli terminal entry point for doctor checks, specification validation, agent forms, model routing, and deterministic fallback reasoning.
Inputs: TILELLI_* env vars, local repo files, optional OpenAI-compatible local model endpoint.
Outputs: Human-readable status, JSON responses when requested, exit codes for automation.
Safety: Never prints secret values; model calls are optional; fallback reasoning is deterministic and non-destructive.
Relations: spec/specification-system.manifest.json, spec/specification-system.md, scripts/tilelli-cloudflare.mjs, workers/tilelli-api/src/index.js.
*/

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { publishQ9RenderArtifacts, q9Contract, reportQ9Storage } from "file:///Users/johnmobley/gravnova/q9/q9-media.mjs";
import { animeImageProviderContract, requestAnimeStill } from "file:///Users/johnmobley/gravnova/q9/anime-models.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO_ROOT = process.env.TILELLI_REPO_ROOT || "/Users/johnmobley/tilelli/hauwamusiq.github.io";
const MANIFEST_PATH = path.join(DEFAULT_REPO_ROOT, "spec/specification-system.manifest.json");
const DOC_PATH = path.join(DEFAULT_REPO_ROOT, "spec/specification-system.md");
const DEFAULT_MODEL_FLEET_CONFIG = "/Users/johnmobley/.mascom/models/model-fleet-config.json";
const OLLAMA_BIN = process.env.TILELLI_OLLAMA_BIN || "/opt/homebrew/bin/ollama";
const FFMPEG_BIN = process.env.TILELLI_FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const AGENT_ROOT = path.join(DEFAULT_REPO_ROOT, "agents/tilelli");
const LOCAL_RENDER_DIR = path.join(DEFAULT_REPO_ROOT, ".tilelli/renders");
const LOCAL_RENDER_WORK_DIR = path.join(DEFAULT_REPO_ROOT, ".tilelli/render-work");
const GRAVNOVA_Q9_ROOT = process.env.GRAVNOVA_Q9_ROOT || "/Users/johnmobley/gravnova/q9";
const LOCAL_MEDIA_ROOT = process.env.GRAVNOVA_Q9_MEDIA_ROOT || path.join(GRAVNOVA_Q9_ROOT, "public");
const ANIME_BACKEND_STATE_PATH = process.env.TILELLI_ANIME_BACKEND_STATE_PATH || path.join(GRAVNOVA_Q9_ROOT, "status", "anime-backend-state.json");
const GENERATION_CALLBACK_KEY_PATH = path.join(DEFAULT_REPO_ROOT, ".tilelli/generation-callback-key");
const TILELLI_MEDIA_PUBLIC_BASE_URL = process.env.TILELLI_MEDIA_PUBLIC_BASE_URL || "http://127.0.0.1:8081/q9-media";
const TILELLI_API_BASE_URL = process.env.TILELLI_API_BASE_URL || "http://127.0.0.1:8787";

function logLine(message = "") {
  process.stdout.write(`${message}\n`);
}

function errorLine(message = "") {
  process.stderr.write(`${message}\n`);
}

function fail(message, exitCode = 1) {
  errorLine(message);
  process.exit(exitCode);
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

function parseJsonSafe(text, fallback = null) {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function mask(value) {
  if (!value) return "(missing)";
  return value.length <= 8 ? `${value.slice(0, 2)}…` : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function getEnv(name) {
  return process.env[name] || "";
}

async function repoExists(relPath) {
  try {
    await fs.access(path.join(DEFAULT_REPO_ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readModelFleetConfig() {
  const configPath = process.env.TILELLI_MODEL_FLEET_CONFIG || DEFAULT_MODEL_FLEET_CONFIG;
  try {
    const config = await readJson(configPath);
    return { configPath, config };
  } catch {
    return { configPath, config: null };
  }
}

function resolveModelMode(fleetConfig) {
  const explicitBaseUrl = getEnv("TILELLI_MODEL_BASE_URL");
  if (explicitBaseUrl) {
    return {
      provider: "openai-compatible",
      baseUrl: explicitBaseUrl,
      model: getEnv("TILELLI_MODEL_NAME") || "qwen",
      apiKey: getEnv("TILELLI_MODEL_API_KEY") || ""
    };
  }

  if (fleetConfig?.ollama?.endpoint) {
    return {
      provider: "ollama",
      baseUrl: normalizeLoopbackUrl(fleetConfig.ollama.endpoint),
      model: getEnv("TILELLI_MODEL_NAME") || fleetConfig.model_tiers?.small?.ollama_model_name || "qwen",
      apiKey: ""
    };
  }

  return {
    provider: null,
    baseUrl: null,
    model: getEnv("TILELLI_MODEL_NAME") || "qwen",
    apiKey: ""
  };
}

function normalizeLoopbackUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return value;
  }
  return value;
}

function inferPromptRole(prompt = "") {
  const lowered = String(prompt || "").toLowerCase();
  if (/\b(code|bug|fix|build|deploy|patch|script|function|class|file|nginx|worker|api|render|html|css|js|json|yaml|sql)\b/.test(lowered)) {
    return "code";
  }
  if (/\b(why|explain|reason|analy[sz]e|compare|investigate|reflect|what does|how does|should we)\b/.test(lowered)) {
    return "reasoning";
  }
  return "general";
}

function modelCandidatesForRole(role, fleetConfig) {
  const explicitCoder = process.env.TILELLI_CODE_MODEL_NAME || "qwen2.5-coder:7b";
  const explicitReasoner = process.env.TILELLI_REASONING_MODEL_NAME || "deepseek-r1:7b";
  const fleetCoder = fleetConfig?.model_tiers?.small?.ollama_model_name || "";
  const fleetReasoner = fleetConfig?.model_tiers?.medium?.ollama_model_name || "";
  const general = process.env.TILELLI_MODEL_NAME || explicitCoder;
  const fallback = process.env.TILELLI_MODEL_FALLBACK_NAME || explicitCoder;

  if (role === "code") {
    return [explicitCoder, fleetCoder, general, fallback];
  }
  if (role === "reasoning") {
    return [explicitReasoner, fleetReasoner, explicitCoder, general, fallback];
  }
  return [general, explicitCoder, explicitReasoner, fleetCoder, fleetReasoner, fallback];
}

async function listLocalModelNames(baseUrl, apiKey = "") {
  if (!baseUrl) return [];
  const endpoint = baseUrl.replace(/\/$/, "") + "/api/tags";
  try {
    const response = await fetch(endpoint, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });
    const body = await response.json().catch(() => ({}));
    const models = Array.isArray(body?.models) ? body.models : [];
    return models.map(model => String(model?.name || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function chooseModelName(candidates, availableNames) {
  const available = new Set((availableNames || []).map(name => String(name).trim()));
  for (const candidate of candidates || []) {
    if (candidate && available.has(candidate)) return candidate;
  }
  return (candidates || []).find(Boolean) || "";
}

async function gitStatus() {
  try {
    const { stdout } = await execFileAsync("git", ["-C", DEFAULT_REPO_ROOT, "status", "--short"], { maxBuffer: 1024 * 1024 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch (error) {
    return [`git status failed: ${error.message}`];
  }
}

async function doctor() {
  const nodeVersion = process.version;
  const repoRoot = DEFAULT_REPO_ROOT;
  const fleet = await readModelFleetConfig();
  const modelMode = resolveModelMode(fleet.config);
  const codeModel = await resolveModelSelection(fleet.config, "code");
  const reasoningModel = await resolveModelSelection(fleet.config, "reasoning");
  const modelName = getEnv("TILELLI_MODEL_NAME") || "unset";
  const ghUser = getEnv("TILELLI_GITHUB_USER");
  const mediaPublicBaseUrl = getEnv("TILELLI_MEDIA_PUBLIC_BASE_URL") || TILELLI_MEDIA_PUBLIC_BASE_URL;
  const apiBaseUrl = getEnv("TILELLI_API_BASE_URL") || TILELLI_API_BASE_URL;
  const q9Storage = await reportQ9Storage();
  const animeBackendState = await readJsonIfExists(ANIME_BACKEND_STATE_PATH);
  const checks = [
    { name: "repo root", ok: await repoExists(".") },
    { name: "spec manifest", ok: await repoExists("spec/specification-system.manifest.json") },
    { name: "worker source", ok: await repoExists("workers/tilelli-api/src/index.js") },
    { name: "tilelli edge client", ok: await repoExists("tilelli-edge-client.js") },
    { name: "github user", ok: Boolean(ghUser) },
    { name: "api base url", ok: Boolean(apiBaseUrl) },
    { name: "model endpoint", ok: Boolean(modelMode.baseUrl) },
    { name: "model fleet config", ok: Boolean(fleet.config) },
    { name: "q9 media public base url", ok: Boolean(mediaPublicBaseUrl) }
  ];
  const requiredChecks = checks.filter(
    item =>
      item.name !== "model endpoint" &&
      item.name !== "model fleet config" &&
      item.name !== "q9 media public base url"
  );
  const status = {
    ok: requiredChecks.every(item => item.ok),
    optional: {
      modelEndpointConfigured: Boolean(modelMode.baseUrl),
      modelFleetConfigPresent: Boolean(fleet.config)
    },
    nodeVersion,
    repoRoot,
    model: {
      provider: modelMode.provider,
      baseUrl: modelMode.baseUrl || null,
      name: modelName === "unset" ? null : modelName,
      fleetConfigPath: fleet.config ? fleet.configPath : null,
      available: Boolean(modelMode.baseUrl),
      code: codeModel,
      reasoning: reasoningModel
    },
    github: {
      user: ghUser || null
    },
    api: {
      baseUrl: apiBaseUrl || null
    },
    media: {
      publicBaseUrl: mediaPublicBaseUrl || null,
      q9Root: GRAVNOVA_Q9_ROOT,
      q9MediaRoot: LOCAL_MEDIA_ROOT,
      storage: q9Storage
    },
    animeImageProvider: {
      ...animeImageProviderContract(),
      backendState: animeBackendState
    },
    checks
  };
  logLine(JSON.stringify(status, null, 2));
  return status.ok ? 0 : 1;
}

async function validateHeader(filePath, requiredFields) {
  const raw = await fs.readFile(filePath, "utf8");
  const header = raw.slice(0, 1600);
  const missing = requiredFields.filter(field => !new RegExp(`${field}:`, "i").test(header));
  return { filePath, missing };
}

async function validateJsonForm(filePath, requiredFields) {
  const data = await readJson(filePath);
  const required = requiredFields.map(field => field.charAt(0).toLowerCase() + field.slice(1));
  const missing = required.filter(field => !(field in data));
  return { filePath, missing };
}

async function validateSpec() {
  const manifest = await readJson(MANIFEST_PATH);
  const requiredArtifacts = [
    ...manifest.initialArtifacts,
    "workers/tilelli-api/wrangler.toml",
    "workers/tilelli-api/src/index.js",
    "scripts/tilelli-cloudflare.mjs",
    "scripts/check-html.mjs"
  ];
  const requiredFields = manifest.requiredHeaderFields || [];
  const report = [];

  for (const relPath of requiredArtifacts) {
    const absPath = path.join(DEFAULT_REPO_ROOT, relPath);
    const exists = await fs
      .access(absPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      report.push({ filePath: relPath, missing: ["file missing"] });
      continue;
    }

    const ext = path.extname(relPath).toLowerCase();
    if (ext === ".json") {
      const { missing } = await validateJsonForm(absPath, requiredFields);
      if (missing.length) report.push({ filePath: relPath, missing });
      continue;
    }

    if ([".html", ".md", ".js", ".mjs", ".toml", ".sql", ".yml", ".yaml", ".sh"].includes(ext)) {
      const { missing } = await validateHeader(absPath, requiredFields);
      if (missing.length) report.push({ filePath: relPath, missing });
    }
  }

  const ok = report.length === 0;
  const result = {
    ok,
    manifest: MANIFEST_PATH,
    checked: requiredArtifacts.length,
    issues: report
  };
  logLine(JSON.stringify(result, null, 2));
  return ok ? 0 : 1;
}

async function resolveModelSelection(fleetConfig, role = "general") {
  const modelMode = resolveModelMode(fleetConfig);
  if (!modelMode.baseUrl) {
    return {
      role,
      provider: modelMode.provider,
      baseUrl: null,
      model: modelMode.model,
      available: false,
      availableModels: []
    };
  }
  const availableModels = await listLocalModelNames(modelMode.baseUrl, modelMode.apiKey);
  const candidates = modelCandidatesForRole(role, fleetConfig);
  const model = chooseModelName(candidates, availableModels);
  return {
    role,
    provider: modelMode.provider,
    baseUrl: modelMode.baseUrl,
    model: model || modelMode.model,
    available: Boolean(modelMode.baseUrl),
    availableModels,
    candidates
  };
}

async function validateAgentForms() {
  const files = [
    "base-agent.json",
    "coding-agent.json",
    "forms/capability-request.schema.json",
    "forms/deployer-token.request.json",
    "forms/coding-task.schema.json",
    "forms/coding-task.request.json"
  ];
  const report = [];

  for (const relPath of files) {
    const absPath = path.join(AGENT_ROOT, relPath);
    const exists = await fs.access(absPath).then(() => true).catch(() => false);
    if (!exists) {
      report.push({ filePath: `agents/tilelli/${relPath}`, missing: ["file missing"] });
      continue;
    }

    try {
      await readJson(absPath);
    } catch (error) {
      report.push({ filePath: `agents/tilelli/${relPath}`, missing: [error.message] });
    }
  }

  const result = {
    ok: report.length === 0,
    checked: files.length,
    issues: report
  };
  logLine(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

function splitCommandLine(commandLine) {
  const cleaned = String(commandLine || "").trim();
  if (!cleaned) return null;
  if (/[|&;<>(){}]/.test(cleaned)) {
    throw new Error(`Unsupported shell metacharacter in verification command: ${commandLine}`);
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { command: parts[0], args: parts.slice(1) };
}

async function runVerificationCommand(commandLine) {
  const parsed = splitCommandLine(commandLine);
  if (!parsed) {
    return { command: commandLine, ok: false, error: "Empty command." };
  }

  const allowed = new Set(["node", "tilelli", "git", "npm", "pnpm", "bun"]);
  if (!allowed.has(parsed.command)) {
    return { command: commandLine, ok: false, error: `Command not allowed: ${parsed.command}` };
  }

  try {
    const { stdout, stderr } = await execFileAsync(parsed.command, parsed.args, {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024 * 5
    });
    return {
      command: commandLine,
      ok: true,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error) {
    return {
      command: commandLine,
      ok: false,
      error: error.message,
      stdout: error.stdout ? String(error.stdout).trim() : "",
      stderr: error.stderr ? String(error.stderr).trim() : ""
    };
  }
}

async function readOwnerKey() {
  const keyPath = path.join(DEFAULT_REPO_ROOT, ".tilelli/owner-write-key");
  try {
    const key = await fs.readFile(keyPath, "utf8");
    return key.trim();
  } catch {
    return "";
  }
}

async function readGenerationCallbackKey() {
  try {
    const key = await fs.readFile(GENERATION_CALLBACK_KEY_PATH, "utf8");
    return key.trim();
  } catch {
    return "";
  }
}

function safeSlug(value) {
  const cleaned = String(value || "tilelli-render").trim().toLowerCase();
  return cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "tilelli-render";
}

function parseResolution(value) {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!match) return { width: 1024, height: 1024 };
  const width = Number.parseInt(match[1], 10) || 1024;
  const height = Number.parseInt(match[2], 10) || 1024;
  return { width, height };
}

function parseDurationSeconds(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 5;
  if (text.endsWith("s")) return Math.max(1, Number.parseFloat(text.slice(0, -1)) || 5);
  if (text.endsWith("m")) return Math.max(1, (Number.parseFloat(text.slice(0, -1)) || 1) * 60);
  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 5;
}

function ffmpegEscapePath(filePath) {
  return String(filePath || "").replace(/'/g, "\\'");
}

function escapeFilterText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
}

function normalizeStoryBeatText(beat, index) {
  if (!beat) return `Beat ${index + 1}`;
  if (typeof beat === "string") return beat.trim() || `Beat ${index + 1}`;
  return (
    beat.text ||
    beat.caption ||
    beat.description ||
    beat.action ||
    beat.scene ||
    beat.title ||
    `Beat ${index + 1}`
  );
}

function buildRenderCopy(bundle, jobId = "") {
  const scene = bundle?.scene || {};
  const storyboard = Array.isArray(bundle?.storyboard) ? bundle.storyboard : [];
  return {
    title: scene.title || bundle?.render?.title || `Tilelli render ${jobId || ""}`.trim(),
    prompt: scene.prompt || bundle?.render?.prompt || "",
    setting: scene.setting || "",
    style: scene.art_style || scene.artStyle || "",
    beats: storyboard.slice(0, 3).map((beat, index) => normalizeStoryBeatText(beat, index))
  };
}

function looksAnimeStyle(bundle = {}) {
  const text = [
    bundle?.scene?.art_style,
    bundle?.scene?.artStyle,
    bundle?.render?.style,
    bundle?.title,
    bundle?.scene?.title,
    bundle?.scene?.prompt,
    bundle?.generation_prompt
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /anime|manga|shonen|shoujo|cel|cel-shaded|cel shaded/.test(text);
}

async function loadGenerationJob(jobId) {
  const response = await fetch(`${TILELLI_API_BASE_URL}/v1/anime/generations?limit=100`);
  if (!response.ok) throw new Error(`Unable to load generation jobs (${response.status}).`);
  const data = await response.json();
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const job = jobs.find(item => Number(item.id) === Number(jobId));
  if (!job) throw new Error(`Generation job ${jobId} not found.`);
  return job;
}

async function writeRenderAssets(bundle, jobId = "") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const renderSlug = safeSlug(bundle?.scene?.title || bundle?.render?.title || jobId || "tilelli-render");
  const workDir = path.join(LOCAL_RENDER_WORK_DIR, `${stamp}-${renderSlug}`);
  await fs.mkdir(workDir, { recursive: true, mode: 0o700 });

  const copy = buildRenderCopy(bundle, jobId);
  const titlePath = path.join(workDir, "title.txt");
  const promptPath = path.join(workDir, "prompt.txt");
  const metaPath = path.join(workDir, "meta.txt");
  const beatsPaths = copy.beats.map((_, index) => path.join(workDir, `beat-${index + 1}.txt`));

  await fs.writeFile(titlePath, `${copy.title}\n`, { mode: 0o600 });
  await fs.writeFile(promptPath, `${copy.prompt || "No prompt provided."}\n`, { mode: 0o600 });
  await fs.writeFile(metaPath, [copy.style ? `Style: ${copy.style}` : null, copy.setting ? `Setting: ${copy.setting}` : null].filter(Boolean).join("  "), {
    mode: 0o600
  });
  for (let index = 0; index < beatsPaths.length; index += 1) {
    await fs.writeFile(beatsPaths[index], `${copy.beats[index]}\n`, { mode: 0o600 });
  }

  return { workDir, titlePath, promptPath, metaPath, beatsPaths, copy };
}

async function generateAnimeStillFallback(bundle, options = {}) {
  const width = Number.parseInt(options.width || 1024, 10) || 1024;
  const height = Number.parseInt(options.height || 1024, 10) || 1024;
  const { workDir, titlePath, promptPath, metaPath, beatsPaths, copy } = await writeRenderAssets(bundle, options.jobId || "");
  const outputDir = options.outputDir || LOCAL_RENDER_DIR;
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const slug = safeSlug(copy.title || options.jobId || "anime-still");
  const outputPath = path.join(outputDir, `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  const assets = { titlePath, promptPath, metaPath, beatsPaths };
  const animeStyle = looksAnimeStyle(bundle);
  let filterGraph = buildRenderFilterGraph(assets, { duration: 1, fps: 1, width, height, animeStyle }, true);
  const renderArgs = () => [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x090712:s=${width}x${height}:r=1:d=1`,
    "-frames:v",
    "1",
    "-vf",
    filterGraph,
    outputPath
  ];

  try {
    await execFileAsync(FFMPEG_BIN, renderArgs(), {
      cwd: workDir,
      maxBuffer: 1024 * 1024 * 10
    });
  } catch (error) {
    const errorText = `${error.message}\n${error.stderr || ""}\n${error.stdout || ""}`;
    if (!/drawtext|Filter not found|No such filter/i.test(errorText)) {
      throw error;
    }
    filterGraph = buildRenderFilterGraph(assets, { duration: 1, fps: 1, width, height, animeStyle }, false);
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x090712:s=${width}x${height}:r=1:d=1`,
        "-frames:v",
        "1",
        "-vf",
        filterGraph,
        outputPath
      ],
      {
        cwd: workDir,
        maxBuffer: 1024 * 1024 * 10
      }
    );
  }

  return {
    outputPath,
    metadata: { ...copy, renderMode: animeStyle ? "fallback-anime-still" : "fallback-still" },
    workDir
  };
}

async function generateAnimeStill(bundle, options = {}) {
  const providerOptions = {
    jobId: options.jobId || "",
    width: options.width || 1024,
    height: options.height || 1024
  };
  const provider = await requestAnimeStill(bundle, providerOptions).catch(error => ({
    ok: false,
    error: error?.message || String(error)
  }));
  if (provider?.ok && provider.outputPath) {
    try {
      await fs.access(provider.outputPath);
      return {
        outputPath: provider.outputPath,
        outputUrl: provider.outputUrl || "",
        metadata: {
          provider: provider.provider || animeImageProviderContract().provider,
          mode: provider.mode || animeImageProviderContract().mode,
          backend: provider.backend || provider.metadata?.backend || null,
          backendMode: provider.backendMode || provider.metadata?.backendMode || null,
          source: "provider",
          providerMetadata: provider.metadata || null
        }
      };
    } catch {
      // Fall through to fallback still generation.
    }
  }

  const fallback = await generateAnimeStillFallback(bundle, options);
  return {
    outputPath: fallback.outputPath,
    outputUrl: "",
    metadata: {
      provider: animeImageProviderContract().provider,
      mode: provider?.ok ? "provider-missing-file" : fallback.metadata?.renderMode || "fallback-still",
      backend: provider?.backend || provider?.metadata?.backend || "expert",
      backendMode: provider?.backendMode || provider?.metadata?.backendMode || fallback.metadata?.renderMode || "fallback-still",
      source: "fallback",
      providerMetadata: provider?.metadata || null,
      fallback: fallback.metadata || null
    }
  };
}

function buildRenderFilterGraph(assets, options = {}, includeTextOverlay = true) {
  const durationSeconds = parseDurationSeconds(options.duration || "5s");
  const fps = Number.parseInt(options.fps || "24", 10) || 24;
  const width = Number.parseInt(options.width || 1280, 10) || 1280;
  const height = Number.parseInt(options.height || 720, 10) || 720;
  const beatPositions = [Math.max(240, Math.round(height * 0.66)), Math.max(280, Math.round(height * 0.73)), Math.max(320, Math.round(height * 0.8))];
  const animeStyle = Boolean(options.animeStyle);

  if (includeTextOverlay) {
    const filterParts = [
      `fps=${fps}`,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0b1020`,
      "format=yuv420p",
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x120818@0.35:t=fill",
      `drawbox=x='(w-720)/2+25*sin(t*1.2)':y='h-170':w=720:h=6:color=0xff4fd8@0.35:t=fill`
    ];
    const font = "/System/Library/Fonts/Supplemental/Arial.ttf";
    filterParts.push(
      `drawtext=fontfile='${ffmpegEscapePath(font)}':textfile='${ffmpegEscapePath(assets.titlePath)}':fontcolor=white:fontsize=56:x=(w-text_w)/2+14*sin(t*1.5):y=110+6*cos(t*1.7)`,
      `drawtext=fontfile='${ffmpegEscapePath(font)}':textfile='${ffmpegEscapePath(assets.metaPath)}':fontcolor=white@0.86:fontsize=26:x=(w-text_w)/2:y=190`,
      `drawtext=fontfile='${ffmpegEscapePath(font)}':textfile='${ffmpegEscapePath(assets.promptPath)}':fontcolor=white@0.92:fontsize=30:line_spacing=12:x=(w-text_w)/2:y=250`
    );
    assets.beatsPaths.forEach((beatPath, index) => {
      const start = index * (durationSeconds / 3);
      const end = Math.min(durationSeconds, start + durationSeconds / 2.2);
      filterParts.push(
        `drawtext=fontfile='${ffmpegEscapePath(font)}':textfile='${ffmpegEscapePath(beatPath)}':fontcolor=white@0.96:fontsize=28:x=(w-text_w)/2:y=${beatPositions[index] || beatPositions[0]}:enable='between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})'`
      );
    });
    return filterParts.join(",");
  }

  if (animeStyle) {
    const skylineBaseY = Math.round(height * 0.66);
    const skylineHeights = [32, 58, 44, 78, 52, 94, 38, 66, 84, 48, 56, 72, 40, 88, 46, 68, 54, 100, 42, 76, 60, 92];
    const animeParts = [
      `fps=${fps}`,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x090712`,
      "format=yuv420p",
      `drawbox=x=0:y=0:w=iw:h=ih:color=0x0a1030@0.72:t=fill`,
      `drawbox=x=0:y=0:w=iw:h=${Math.round(height * 0.18)}:color=0x12306e@0.55:t=fill`,
      `drawbox=x=0:y=${Math.round(height * 0.18)}:w=iw:h=${Math.round(height * 0.28)}:color=0x3d114f@0.20:t=fill`,
      `drawbox=x=0:y=${Math.round(height * 0.46)}:w=iw:h=${Math.round(height * 0.12)}:color=0x06111f@0.58:t=fill`,
      `drawbox=x='(w-260)/2+90*sin(t*0.55)':y='${Math.round(height * 0.12)}+14*cos(t*0.8)':w=260:h=260:color=0xffd66b@0.12:t=fill`,
      `drawbox=x='40+60*sin(t*0.85)':y='${Math.round(height * 0.18)}+30*cos(t*0.95)':w=220:h=120:color=0xff4fd8@0.16:t=fill`,
      `drawbox=x='w-320+80*cos(t*0.7)':y='${Math.round(height * 0.24)}+25*sin(t*1.1)':w=220:h=110:color=0x5eead4@0.14:t=fill`,
      `drawbox=x='(w-520)/2+25*sin(t*1.2)':y='${Math.round(height * 0.58)}':w=520:h=8:color=0xffffff@0.18:t=fill`
    ];
    skylineHeights.forEach((barHeight, index) => {
      const x = Math.round((width / skylineHeights.length) * index);
      const color = index % 3 === 0 ? "0x110b1f@0.88" : index % 3 === 1 ? "0x230f2d@0.82" : "0x08172a@0.86";
      animeParts.push(`drawbox=x=${x}:y=${skylineBaseY - barHeight}:w=${Math.ceil(width / skylineHeights.length) - 2}:h=${barHeight}:color=${color}:t=fill`);
    });
    beatPositions.forEach((y, index) => {
      const start = index * (durationSeconds / 3);
      const end = Math.min(durationSeconds, start + durationSeconds / 2.2);
      const color = index === 0 ? "0xff7ac6@0.26" : index === 1 ? "0x67d5ff@0.22" : "0xffffff@0.18";
      animeParts.push(
        `drawbox=x='(w-740)/2+18*sin(t*1.15)':y=${y}:w=740:h=10:color=${color}:t=fill:enable='between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})'`
      );
    });
    animeParts.push("gblur=sigma=8:steps=2", "eq=saturation=1.35:contrast=1.12:brightness=0.03");
    return animeParts.join(",");
  }

  const filterParts = [
    `fps=${fps}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0b1020`,
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x120818@0.35:t=fill",
    `drawbox=x='(w-340)/2+120*sin(t*0.75)':y='120+50*cos(t*1.1)':w=340:h=10:color=0xffffff@0.18:t=fill`,
    `drawbox=x='40+70*sin(t*0.9)':y='80+40*cos(t*1.3)':w=180:h=180:color=0xff4fd8@0.14:t=fill`,
    `drawbox=x='w-240+50*cos(t*1.4)':y='h-260+35*sin(t*1.1)':w=160:h=160:color=0x22d3ee@0.12:t=fill`,
    `drawbox=x='(w-110)/2+65*sin(t*1.7)':y='(h-110)/2+25*cos(t*1.5)':w=110:h=110:color=0x8b5cf6@0.08:t=fill`
  ];
  assets.beatsPaths.forEach((_, index) => {
    const start = index * (durationSeconds / 3);
    const end = Math.min(durationSeconds, start + durationSeconds / 2.2);
    const y = beatPositions[index] || beatPositions[0];
    const color = index === 0 ? "0xff4fd8@0.4" : index === 1 ? "0x22d3ee@0.4" : "0xffffff@0.3";
    filterParts.push(
      `drawbox=x='(w-620)/2+20*sin(t*1.3)':y=${y}:w=620:h=8:color=${color}:t=fill:enable='between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})'`
    );
  });
  filterParts.push(
    `drawbox=x='0':y='0':w='iw':h='iw*0.06':color=0xff4fd8@0.12:t=fill:enable='between(t\\,0\\,${durationSeconds.toFixed(2)})'`,
    `drawbox=x='0':y='h-iw*0.06':w='iw':h='iw*0.06':color=0x22d3ee@0.10:t=fill:enable='between(t\\,0\\,${durationSeconds.toFixed(2)})'`
  );
  return filterParts.join(",");
}

async function renderMp4FromBundle(bundle, options = {}) {
  const durationSeconds = parseDurationSeconds(options.duration || bundle?.render?.duration || "5s");
  const fps = Number.parseInt(options.fps || bundle?.render?.fps || "24", 10) || 24;
  const width = Number.parseInt(options.width || 1280, 10) || 1280;
  const height = Number.parseInt(options.height || 720, 10) || 720;
  const { workDir, titlePath, promptPath, metaPath, beatsPaths, copy } = await writeRenderAssets(bundle, options.jobId || "");
  const outputDir = options.outputDir || LOCAL_RENDER_DIR;
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const slug = safeSlug(copy.title || options.jobId || "tilelli-render");
  const outputPath = path.join(outputDir, `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`);
  const thumbnailPath = outputPath.replace(/\.mp4$/i, ".jpg");
  const assets = { titlePath, promptPath, metaPath, beatsPaths };
  const animeStyle = looksAnimeStyle(bundle);
  let filterGraph = buildRenderFilterGraph(assets, { duration: durationSeconds, fps, width, height, animeStyle }, true);
  const renderArgs = () => [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x090712:s=${width}x${height}:r=${fps}:d=${durationSeconds}`,
    "-vf",
    filterGraph,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];

  let renderRun;
  let renderMode = "text-overlay";
  try {
    renderRun = await execFileAsync(FFMPEG_BIN, renderArgs(), {
      cwd: workDir,
      maxBuffer: 1024 * 1024 * 10
    });
  } catch (error) {
    const errorText = `${error.message}\n${error.stderr || ""}\n${error.stdout || ""}`;
    if (!/drawtext|Filter not found|No such filter/i.test(errorText)) {
      throw error;
    }

    renderMode = animeStyle ? "fallback-anime" : "fallback-shapes";
    filterGraph = buildRenderFilterGraph(assets, { duration: durationSeconds, fps, width, height, animeStyle }, false);
    renderRun = await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x090712:s=${width}x${height}:r=${fps}:d=${durationSeconds}`,
        "-vf",
        filterGraph,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath
      ],
      {
        cwd: workDir,
        maxBuffer: 1024 * 1024 * 10
      }
    );
  }

  let thumbnail = "";
  let thumbnailMeta = null;
  try {
    const stillResult = await generateAnimeStill(bundle, {
      jobId: options.jobId || "",
      width,
      height,
      outputDir,
      duration: durationSeconds,
      fps
    });
    thumbnail = stillResult.outputPath || "";
    thumbnailMeta = stillResult.metadata || null;
  } catch {
    try {
      await execFileAsync(FFMPEG_BIN, [
        "-y",
        "-ss",
        "1",
        "-i",
        outputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        thumbnailPath
      ], {
        cwd: workDir,
        maxBuffer: 1024 * 1024 * 10
      });
      thumbnail = thumbnailPath;
    } catch {
      thumbnail = "";
    }
  }

  return {
    outputPath,
    thumbnailPath: thumbnail,
    stdout: renderRun.stdout.trim(),
    stderr: renderRun.stderr.trim(),
    metadata: { ...copy, renderMode, thumbnailMeta },
    workDir,
    durationSeconds,
    fps
  };
}

async function callbackRenderCompletion(generationId, renderResult, bundle) {
  const callbackKey = await readGenerationCallbackKey();
  if (!callbackKey) {
    return { ok: false, reason: "Missing generation callback key." };
  }
  const published = await publishQ9RenderArtifacts(renderResult, bundle, {
    mediaRoot: LOCAL_MEDIA_ROOT,
    publicBaseUrl: TILELLI_MEDIA_PUBLIC_BASE_URL
  });
  const outputUrl = published.outputUrl || `file://${renderResult.outputPath}`;
  const thumbnailUrl = published.thumbnailUrl || (renderResult.thumbnailPath ? `file://${renderResult.thumbnailPath}` : "");
  const body = {
    status: "ready",
    provider_job_id: path.basename(renderResult.outputPath, ".mp4"),
    output_url: outputUrl,
    thumbnail_url: thumbnailUrl,
    completed_at: new Date().toISOString(),
    provider_response_json: {
      renderer: "tilelli-cli",
      mode: "local-ffmpeg",
      q9_contract: q9Contract(),
      anime_image_provider: animeImageProviderContract(),
      bundle: bundle || null,
      output_path: renderResult.outputPath,
      thumbnail_path: renderResult.thumbnailPath || "",
      thumbnail_metadata: renderResult.metadata?.thumbnailMeta || null,
      duration_seconds: renderResult.durationSeconds,
      fps: renderResult.fps
    }
  };
  const response = await fetch(`${TILELLI_API_BASE_URL}/v1/anime/generations/${generationId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tilelli-Generation-Callback-Key": callbackKey
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJsonSafe(text, { raw: text }),
    outputUrl,
    thumbnailUrl,
    published
  };
}

function normalizeGenerationBundle(job) {
  const bundle = parseJsonSafe(job?.bundle_json, {}) || {};
  const scene = bundle.scene || {};
  const render = bundle.render || {};
  return {
    ...bundle,
    title: bundle.title || job?.title || render.title || "Tilelli render",
    provider: bundle.provider || job?.provider || "local",
    model: bundle.model || job?.model || "mock-renderer",
    generation_prompt: bundle.generation_prompt || job?.generation_prompt || "",
    notes: bundle.notes || job?.notes || "",
    scene: {
      title: scene.title || job?.title || bundle.title || render.title || "Tilelli render",
      prompt: scene.prompt || job?.generation_prompt || bundle.generation_prompt || "",
      setting: scene.setting || bundle.setting || "",
      art_style: scene.art_style || scene.artStyle || bundle.style || bundle.art_style || ""
    },
    storyboard: Array.isArray(bundle.storyboard) ? bundle.storyboard : [],
    render: {
      ...render,
      title: render.title || job?.title || bundle.title || "Tilelli render",
      prompt: render.prompt || job?.generation_prompt || bundle.generation_prompt || "",
      duration: render.duration || job?.duration || bundle.duration || "5s",
      resolution: render.resolution || job?.resolution || bundle.resolution || "1024x1024",
      fps: render.fps || job?.fps || bundle.fps || "24"
    }
  };
}

async function renderCommand(args) {
  const [subcommand, target, ...rest] = args;
  if (!subcommand) fail("Usage: tilelli render <generation|bundle>");

  if (subcommand === "generation") {
    if (!target) fail("Usage: tilelli render generation <id>");
    const job = await loadGenerationJob(target);
    const bundle = normalizeGenerationBundle(job);
    const resolution = parseResolution(bundle.render.resolution);
    const renderResult = await renderMp4FromBundle(bundle, {
      jobId: job.id,
      duration: bundle.render.duration,
      fps: bundle.render.fps,
      width: resolution.width,
      height: resolution.height
    });
    const callbackResult = await callbackRenderCompletion(job.id, renderResult, bundle);
    const result = {
      ok: renderResult.outputPath ? true : false,
      jobId: Number(job.id),
      callback: callbackResult,
      outputPath: renderResult.outputPath,
      thumbnailPath: renderResult.thumbnailPath,
      workDir: renderResult.workDir,
      durationSeconds: renderResult.durationSeconds,
      fps: renderResult.fps,
      metadata: renderResult.metadata
    };
    logLine(JSON.stringify(result, null, 2));
    return renderResult.outputPath ? 0 : 1;
  }

  if (subcommand === "bundle") {
    if (!target) fail("Usage: tilelli render bundle <bundle.json>");
    const absPath = path.isAbsolute(target) ? target : path.join(DEFAULT_REPO_ROOT, target);
    const raw = await fs.readFile(absPath, "utf8");
    const bundle = parseJsonSafe(raw, null);
    if (!bundle) fail(`Invalid JSON bundle: ${absPath}`);
    const renderBundle = normalizeGenerationBundle({
      ...bundle,
      bundle_json: raw,
      title: bundle.title || bundle.scene?.title || "Tilelli render"
    });
    const resolution = parseResolution(renderBundle.render.resolution);
    const renderResult = await renderMp4FromBundle(renderBundle, {
      jobId: bundle.job_id || bundle.id || bundle.title || "bundle",
      duration: renderBundle.render.duration,
      fps: renderBundle.render.fps,
      width: resolution.width,
      height: resolution.height
    });
    const result = {
      ok: renderResult.outputPath ? true : false,
      bundlePath: absPath,
      outputPath: renderResult.outputPath,
      thumbnailPath: renderResult.thumbnailPath,
      workDir: renderResult.workDir,
      durationSeconds: renderResult.durationSeconds,
      fps: renderResult.fps,
      metadata: renderResult.metadata
    };
    logLine(JSON.stringify(result, null, 2));
    return renderResult.outputPath ? 0 : 1;
  }

  fail(`Unknown render subcommand: ${subcommand}${rest.length ? ` ${rest.join(" ")}` : ""}`);
}

function validateCodingTaskShape(task) {
  const issues = [];
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return ["Task must be an object."];
  }
  const requiredStrings = [
    ["name", value => typeof value === "string" && /^tilelli-[a-z0-9-]+$/.test(value), "Must be a TILELLI-namespaced name."],
    ["objective", value => typeof value === "string" && value.trim().length >= 12, "Must be a descriptive string."],
    ["runtime", value => typeof value === "string" && value.trim().length >= 3, "Must declare runtime metadata."],
    ["purpose", value => typeof value === "string" && value.trim().length >= 8, "Must declare purpose metadata."]
  ];

  for (const [field, predicate, message] of requiredStrings) {
    if (!predicate(task[field])) issues.push(`${field}: ${message}`);
  }

  for (const field of ["form", "inputs", "outputs", "safety", "relations"]) {
    if (!(field in task)) issues.push(`${field}: missing`);
  }

  if (task.form !== "JSON") issues.push("form: must equal JSON");
  if (!Array.isArray(task.scope) || task.scope.length === 0) issues.push("scope: must be a non-empty array");
  if (!Array.isArray(task.verification) || task.verification.length === 0) issues.push("verification: must be a non-empty array");
  if (task.ownerOnlyWrites !== true) issues.push("ownerOnlyWrites: must be true");
  return issues;
}

async function syncAgentRun(record) {
  const ownerKey = await readOwnerKey();
  if (!ownerKey) return { synced: false, reason: "No local owner key file." };
  const url = `${TILELLI_API_BASE_URL}/v1/agent/runs`;
  const payload = JSON.stringify(record);
  const attempts = [];

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tilelli-Owner-Key": ownerKey
      },
      body: payload
    });
    const body = await response.json().catch(() => ({}));
    attempts.push({ method: "fetch", ok: response.ok, status: response.status, body });
    if (response.ok) return { synced: true, attempts };
  } catch (error) {
    attempts.push({ method: "fetch", ok: false, error: error.message });
  }

  try {
    const { stdout, stderr } = await execFileAsync("curl", [
      "-sS",
      "-X",
      "POST",
      url,
      "-H",
      "Content-Type: application/json",
      "-H",
      `X-Tilelli-Owner-Key: ${ownerKey}`,
      "--data-raw",
      payload
    ], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024 * 2
    });
    const body = stdout.trim() ? JSON.parse(stdout) : {};
    attempts.push({ method: "curl", ok: true, status: 200, body, stderr: stderr.trim() });
    return { synced: true, attempts };
  } catch (error) {
    attempts.push({
      method: "curl",
      ok: false,
      error: error.message,
      stdout: error.stdout ? String(error.stdout).trim() : "",
      stderr: error.stderr ? String(error.stderr).trim() : ""
    });
  }

  return { synced: false, attempts };
}

async function writeLocalAgentRun(record) {
  const outDir = path.join(DEFAULT_REPO_ROOT, ".tilelli/agent-runs");
  await fs.mkdir(outDir, { recursive: true, mode: 0o700 }).catch(() => {});
  const safeName = String(record.task?.name || "tilelli-run").replace(/[^a-z0-9-]+/gi, "-");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outDir, `${stamp}-${safeName}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

function hyperheuristicFallback(prompt, context = {}) {
  const lowered = prompt.toLowerCase();
  const intent = lowered.match(/\b(plan|design|spec|debug|fix|write|build|deploy|test|analyze|route|schema|worker|d1|cron)\b/)?.[1] || "general";
  const response = {
    mode: "deterministic-fallback",
    intent,
    summary: `Tilelli fallback analysis for: ${prompt}`,
    recommended_next_steps: []
  };

  if (intent === "debug" || lowered.includes("bug")) {
    response.recommended_next_steps.push(
      "Run the relevant local check command before editing code.",
      "Isolate browser, Worker, or CLI behavior separately.",
      "Compare the live behavior to the repo state and the configured env vars."
    );
  } else if (intent === "deploy" || intent === "worker" || intent === "d1") {
    response.recommended_next_steps.push(
      "Validate the local server or migration locally first.",
      "Confirm the local API and media paths before publish.",
      "Apply the change through the local Tilelli stack."
    );
  } else {
    response.recommended_next_steps.push(
      "State the objective in one sentence.",
      "Pick the smallest executable artifact that can satisfy it.",
      "Add verification before broadening the system."
    );
  }

  if (context.repoRoot) {
    response.context = {
      repoRoot: context.repoRoot,
      modelConfigured: Boolean(context.modelBaseUrl)
    };
  }

  return response;
}

async function callLocalModel(prompt) {
  const fleet = await readModelFleetConfig();
  const role = getEnv("TILELLI_MODEL_ROLE") || inferPromptRole(prompt);
  const modelMode = await resolveModelSelection(fleet.config, role);
  if (!modelMode.baseUrl) return null;
  const endpoint =
    modelMode.provider === "ollama"
      ? modelMode.baseUrl.replace(/\/$/, "") + "/api/generate"
      : modelMode.baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  const systemPrompt = role === "reasoning"
    ? "You are Tilelli's local reasoning layer. Explain clearly, reason step-by-step in concise visible form, and prefer concrete conclusions."
    : role === "code"
      ? "You are Tilelli's local coding layer. Produce exact file targets, diffs, and commands. Prefer code and concrete implementation details."
      : "You are Tilelli's local reasoning layer. Prefer concise, actionable output.";
  const messages = [
    {
      role: "system",
      content: [
        systemPrompt,
        "Never claim to have executed external systems unless the tool output is provided."
      ].join(" ")
    },
    { role: "user", content: prompt }
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(modelMode.apiKey ? { Authorization: `Bearer ${modelMode.apiKey}` } : {})
    },
    body:
      modelMode.provider === "ollama"
        ? JSON.stringify({
            model: modelMode.model,
            prompt,
            stream: false,
            options: {
              temperature: 0.2
            }
          })
        : JSON.stringify({
            model: modelMode.model,
            messages,
            temperature: 0.2
          })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Model request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  const message =
    modelMode.provider === "ollama"
      ? payload?.response
      : payload?.choices?.[0]?.message?.content;
  if (!message) throw new Error("Model response did not include a message.");
  return {
    role,
    model: modelMode.model,
    baseUrl: modelMode.baseUrl,
    provider: modelMode.provider,
    availableModels: modelMode.availableModels || [],
    message,
    raw: payload
  };
}

async function ask(promptArgs) {
  const prompt = promptArgs.join(" ").trim();
  if (!prompt) fail("Usage: tilelli ask <prompt>");

  try {
    const model = await callLocalModel(prompt);
    if (model) {
      logLine(model.message.trim());
      return 0;
    }
  } catch (error) {
    logLine(`Model unavailable, using deterministic fallback: ${error.message}`);
  }

  const fallback = hyperheuristicFallback(prompt, {
    repoRoot: DEFAULT_REPO_ROOT,
    modelBaseUrl: getEnv("TILELLI_MODEL_BASE_URL")
  });
  logLine(JSON.stringify(fallback, null, 2));
  return 0;
}

async function modelStatus() {
  const fleet = await readModelFleetConfig();
  const modelMode = resolveModelMode(fleet.config);
  const codeModel = await resolveModelSelection(fleet.config, "code");
  const reasoningModel = await resolveModelSelection(fleet.config, "reasoning");
  if (!modelMode.baseUrl) {
    logLine(JSON.stringify({ ok: false, available: false, reason: "No model endpoint configured", model: modelMode.model, fleetConfigPath: fleet.configPath, codeModel, reasoningModel }, null, 2));
    return 1;
  }

  const endpoint =
    modelMode.provider === "ollama"
      ? modelMode.baseUrl.replace(/\/$/, "") + "/api/tags"
      : modelMode.baseUrl.replace(/\/$/, "") + "/v1/models";
  try {
    const response = await fetch(endpoint, {
      headers: modelMode.apiKey ? { Authorization: `Bearer ${modelMode.apiKey}` } : {}
    });
    const body = await response.json().catch(() => ({}));
    logLine(
      JSON.stringify(
        {
          ok: response.ok,
          available: true,
          provider: modelMode.provider,
          baseUrl: modelMode.baseUrl,
          model: modelMode.model,
          codeModel,
          reasoningModel,
          fleetConfigPath: fleet.configPath,
          endpoint,
          body
        },
        null,
        2
      )
    );
    return response.ok ? 0 : 1;
  } catch (error) {
    logLine(JSON.stringify({ ok: false, available: true, provider: modelMode.provider, baseUrl: modelMode.baseUrl, model: modelMode.model, codeModel, reasoningModel, fleetConfigPath: fleet.configPath, error: error.message }, null, 2));
    return 1;
  }
}

async function animeStatus() {
  const contract = animeImageProviderContract();
  const backendState = await readJsonIfExists(ANIME_BACKEND_STATE_PATH);
  const status = {
    ok: Boolean(contract.ready),
    provider: contract.provider,
    mode: contract.mode,
    command: contract.command,
    url: contract.url || null,
    timeoutMs: contract.timeoutMs,
    backendStatePath: contract.backendStatePath,
    backendState,
    ready: Boolean(contract.ready)
  };
  logLine(JSON.stringify(status, null, 2));
  return status.ok ? 0 : 1;
}

async function q9Status() {
  const contract = q9Contract();
  const storage = await reportQ9Storage();
  const status = {
    ok: true,
    contract,
    storage,
    mediaPublicBaseUrl: TILELLI_MEDIA_PUBLIC_BASE_URL,
    q9Root: GRAVNOVA_Q9_ROOT,
    localMediaRoot: LOCAL_MEDIA_ROOT
  };
  logLine(JSON.stringify(status, null, 2));
  return 0;
}

async function modelPull(args) {
  const [modelName] = args;
  if (!modelName) fail("Usage: tilelli model pull <model-name>");
  const { stdout, stderr } = await execFileAsync(OLLAMA_BIN, ["pull", modelName], {
    cwd: DEFAULT_REPO_ROOT,
    maxBuffer: 1024 * 1024 * 10
  });
  if (stdout.trim()) logLine(stdout.trim());
  if (stderr.trim()) errorLine(stderr.trim());
  return 0;
}

async function agentCommand(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) fail("Usage: tilelli agent <profile|forms|validate|mint|run>");

  if (subcommand === "profile") {
    const profileName = rest[0] || "base";
    if (profileName === "base") {
      const agent = await readJson(path.join(AGENT_ROOT, "base-agent.json"));
      logLine(JSON.stringify(agent, null, 2));
      return 0;
    }
    if (profileName === "coding") {
      const agent = await readJson(path.join(AGENT_ROOT, "coding-agent.json"));
      logLine(JSON.stringify(agent, null, 2));
      return 0;
    }
    fail(`Unknown agent profile: ${profileName}`);
  }

  if (subcommand === "forms") {
    const forms = [
      "base-agent.json",
      "coding-agent.json",
      "forms/capability-request.schema.json",
      "forms/deployer-token.request.json",
      "forms/coding-task.schema.json",
      "forms/coding-task.request.json"
    ];
    const result = [];
    for (const relPath of forms) {
      const absPath = path.join(AGENT_ROOT, relPath);
      const exists = await fs.access(absPath).then(() => true).catch(() => false);
      result.push({ file: `agents/tilelli/${relPath}`, ok: exists });
    }
    logLine(JSON.stringify({ ok: result.every(item => item.ok), forms: result }, null, 2));
    return result.every(item => item.ok) ? 0 : 1;
  }

  if (subcommand === "validate") {
    return validateAgentForms();
  }

  if (subcommand === "mint") {
    const requestPath = rest[0];
    if (!requestPath) fail("Usage: tilelli agent mint <request.json>");
    const script = path.join(DEFAULT_REPO_ROOT, "scripts/tilelli-cloudflare.mjs");
    const { stdout, stderr } = await execFileAsync(script, ["mint-token", requestPath], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }

  if (subcommand === "run") {
    const requestPath = rest[0];
    if (!requestPath) fail("Usage: tilelli agent run <task.json>");
    const absPath = path.isAbsolute(requestPath) ? requestPath : path.join(DEFAULT_REPO_ROOT, requestPath);
    const task = await readJson(absPath);
    const issues = validateCodingTaskShape(task);
    if (issues.length) {
      logLine(JSON.stringify({ ok: false, taskPath: absPath, issues }, null, 2));
      return 1;
    }

    const prompt = [
      `Coding task: ${task.name}`,
      `Objective: ${task.objective}`,
      `Scope: ${task.scope.join(", ")}`,
      `Verification: ${task.verification.join("; ")}`,
      task.notes ? `Notes: ${task.notes}` : null
    ]
      .filter(Boolean)
      .join("\n");

    let modelPlan = null;
    try {
      const model = await callLocalModel(prompt);
      if (model) {
        modelPlan = model.message.trim();
      }
    } catch (error) {
      modelPlan = `Model unavailable: ${error.message}`;
    }

    const verificationResults = [];
    for (const commandLine of task.verification) {
      verificationResults.push(await runVerificationCommand(commandLine));
    }

    const record = {
      task,
      modelPlan,
      verificationResults,
      createdAt: new Date().toISOString()
    };
    const localPath = await writeLocalAgentRun(record);
    const syncResult = await syncAgentRun(record);
    const result = {
      ok: verificationResults.every(item => item.ok),
      taskPath: absPath,
      localPath,
      sync: syncResult,
      modelPlan,
      verificationResults
    };
    logLine(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  fail(`Unknown agent subcommand: ${subcommand}`);
}

async function modelServe(args) {
  const background = args.includes("--background");
  if (background) {
    const { stdout, stderr } = await execFileAsync("brew", ["services", "start", "ollama"], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }

  const child = execFileAsync(OLLAMA_BIN, ["serve"], {
    cwd: DEFAULT_REPO_ROOT,
    maxBuffer: 1024 * 1024
  });
  logLine("Starting Ollama in the foreground. Use Ctrl+C to stop.");
  const { stdout, stderr } = await child;
  if (stdout.trim()) logLine(stdout.trim());
  if (stderr.trim()) errorLine(stderr.trim());
  return 0;
}

async function workerCommand(args) {
  const [subcommand, ...rest] = args;
  fail(`Legacy worker path removed. Use tilelli local ${subcommand || "<serve|db>"} instead.`);
}

async function d1Command(args) {
  const [subcommand] = args;
  fail(`Legacy D1 path removed. Use tilelli local db init instead of ${subcommand || "d1"}.`);
}

async function localCommand(args) {
  const [subcommand, ...rest] = args;
  const script = path.join(DEFAULT_REPO_ROOT, "scripts/tilelli-local-stack.mjs");
  if (!subcommand || subcommand === "serve") {
    const child = execFileAsync("node", [script, "serve"], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    logLine("Starting local Tilelli stack. Use Ctrl+C to stop.");
    const { stdout, stderr } = await child;
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }
  if (subcommand === "db") {
    const { stdout, stderr } = await execFileAsync("node", [script, "db", "init"], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }
  fail(`Unknown local subcommand: ${subcommand}${rest.length ? ` ${rest.join(" ")}` : ""}`);
}

function usage() {
  logLine(
    [
      "Tilelli CLI",
      "",
      "Usage:",
      "  tilelli doctor",
      "  tilelli spec",
      "  tilelli ask <prompt>",
      "  tilelli agent <profile|forms|validate|mint>",
      "  tilelli agent run <task.json>",
      "  tilelli model status",
      "  tilelli model fleet",
      "  tilelli model pull <model-name>",
      "  tilelli model serve [--background]",
      "  tilelli anime status",
      "  tilelli render <generation|bundle>",
      "  tilelli local <serve|db>"
    ].join("\n")
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "-h" || command === "--help") {
    usage();
    return 0;
  }

  switch (command) {
    case "doctor":
      return doctor();
    case "spec":
      return validateSpec();
    case "ask":
      return ask(args);
    case "agent":
      return agentCommand(args);
    case "model":
      if (args[0] === "status") return modelStatus();
      if (args[0] === "fleet") {
        const fleet = await readModelFleetConfig();
        logLine(
          JSON.stringify(
            {
              ok: Boolean(fleet.config),
              configPath: fleet.configPath,
              provider: fleet.config?.ollama ? "ollama" : null,
              hasConfig: Boolean(fleet.config),
              endpoint: fleet.config?.ollama?.endpoint || null
            },
            null,
            2
          )
        );
        return fleet.config ? 0 : 1;
      }
      if (args[0] === "pull") return modelPull(args.slice(1));
      if (args[0] === "serve") return modelServe(args.slice(1));
      fail("Usage: tilelli model status");
      break;
    case "worker":
      return workerCommand(args);
    case "d1":
      return d1Command(args);
    case "local":
      return localCommand(args);
    case "render":
      return renderCommand(args);
    case "anime":
      if (args[0] === "status") return animeStatus();
      fail("Usage: tilelli anime status");
      break;
    case "q9":
      if (args[0] === "status") return q9Status();
      fail("Usage: tilelli q9 status");
      break;
    default:
      fail(`Unknown command: ${command}`);
  }
}

main().then(
  code => process.exit(code),
  error => {
    fail(error?.message || String(error));
  }
);
