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

const execFileAsync = promisify(execFile);
const DEFAULT_REPO_ROOT = process.env.TILELLI_REPO_ROOT || "/Users/johnmobley/tilelli/hauwamusiq.github.io";
const MANIFEST_PATH = path.join(DEFAULT_REPO_ROOT, "spec/specification-system.manifest.json");
const DOC_PATH = path.join(DEFAULT_REPO_ROOT, "spec/specification-system.md");
const DEFAULT_MODEL_FLEET_CONFIG = "/Users/johnmobley/.mascom/models/model-fleet-config.json";
const OLLAMA_BIN = process.env.TILELLI_OLLAMA_BIN || "/opt/homebrew/bin/ollama";
const AGENT_ROOT = path.join(DEFAULT_REPO_ROOT, "agents/tilelli");
const TILELLI_API_BASE_URL = process.env.TILELLI_API_BASE_URL || "https://tilelli-api.hauwamusiq.workers.dev";

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
  const modelName = getEnv("TILELLI_MODEL_NAME") || "unset";
  const cloudflareEmail = getEnv("TILELLI_CLOUDFLARE_EMAIL");
  const cloudflareAccountId = getEnv("TILELLI_CLOUDFLARE_ACCOUNT_ID");
  const cloudflareTokenFile = getEnv("TILELLI_CLOUDFLARE_API_TOKEN_FILE");
  const cloudflareToken = getEnv("TILELLI_CLOUDFLARE_API_TOKEN");
  const ghUser = getEnv("TILELLI_GITHUB_USER");
  const checks = [
    { name: "repo root", ok: await repoExists(".") },
    { name: "spec manifest", ok: await repoExists("spec/specification-system.manifest.json") },
    { name: "worker source", ok: await repoExists("workers/tilelli-api/src/index.js") },
    { name: "tilelli edge client", ok: await repoExists("tilelli-edge-client.js") },
    { name: "cloudflare email", ok: Boolean(cloudflareEmail) },
    { name: "cloudflare account id", ok: Boolean(cloudflareAccountId) },
    { name: "cloudflare token file", ok: Boolean(cloudflareTokenFile) },
    { name: "cloudflare api token", ok: Boolean(cloudflareToken) },
    { name: "github user", ok: Boolean(ghUser) },
    { name: "model endpoint", ok: Boolean(modelMode.baseUrl) },
    { name: "model fleet config", ok: Boolean(fleet.config) }
  ];
  const requiredChecks = checks.filter(item => item.name !== "model endpoint" && item.name !== "model fleet config");
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
      available: Boolean(modelMode.baseUrl)
    },
    cloudflare: {
      email: cloudflareEmail || null,
      accountId: cloudflareAccountId || null,
      tokenFile: cloudflareTokenFile || null,
      token: cloudflareToken ? mask(cloudflareToken) : null
    },
    github: {
      user: ghUser || null
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
      "Validate the Worker or migration locally first.",
      "Confirm Cloudflare token scope before deploy.",
      "Apply the change through the existing Wrangler wrapper."
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
  const modelMode = resolveModelMode(fleet.config);
  if (!modelMode.baseUrl) return null;
  const endpoint =
    modelMode.provider === "ollama"
      ? modelMode.baseUrl.replace(/\/$/, "") + "/api/generate"
      : modelMode.baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  const messages = [
    {
      role: "system",
      content: [
        "You are Tilelli's local reasoning layer.",
        "Prefer concise, actionable output.",
        "If the prompt asks for code, produce direct artifacts or a plan with exact file targets.",
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
  return { model: modelMode.model, baseUrl: modelMode.baseUrl, provider: modelMode.provider, message, raw: payload };
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
  if (!modelMode.baseUrl) {
    logLine(JSON.stringify({ ok: false, available: false, reason: "No model endpoint configured", model: modelMode.model, fleetConfigPath: fleet.configPath }, null, 2));
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
    logLine(JSON.stringify({ ok: false, available: true, provider: modelMode.provider, baseUrl: modelMode.baseUrl, model: modelMode.model, fleetConfigPath: fleet.configPath, error: error.message }, null, 2));
    return 1;
  }
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
  if (!subcommand) fail("Usage: tilelli worker <deploy|status|test>");
  const script = path.join(DEFAULT_REPO_ROOT, "scripts/tilelli-wrangler.sh");
  if (subcommand === "deploy") {
    const { stdout, stderr } = await execFileAsync(script, ["deploy", "--config", "workers/tilelli-api/wrangler.toml"], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }
  if (subcommand === "test") {
    const { stdout, stderr } = await execFileAsync("curl", ["-sS", "https://tilelli-api.hauwamusiq.workers.dev/health"], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }
  if (subcommand === "status") {
    const { stdout, stderr } = await execFileAsync(script, ["d1", "list", "--config", "workers/tilelli-api/wrangler.toml"], {
      cwd: DEFAULT_REPO_ROOT,
      maxBuffer: 1024 * 1024
    });
    if (stdout.trim()) logLine(stdout.trim());
    if (stderr.trim()) errorLine(stderr.trim());
    return 0;
  }
  fail(`Unknown worker subcommand: ${subcommand}${rest.length ? ` ${rest.join(" ")}` : ""}`);
}

async function d1Command(args) {
  const [subcommand] = args;
  if (!subcommand) fail("Usage: tilelli d1 <apply-local|apply-remote|list>");
  const script = path.join(DEFAULT_REPO_ROOT, "scripts/tilelli-wrangler.sh");
  const argv =
    subcommand === "apply-local"
      ? ["d1", "execute", "tilelli-core", "--local", "--file", "workers/tilelli-api/schema/0001_initial.sql", "--config", "workers/tilelli-api/wrangler.toml"]
      : subcommand === "apply-remote"
        ? ["d1", "execute", "tilelli-core", "--remote", "--file", "workers/tilelli-api/schema/0001_initial.sql", "--config", "workers/tilelli-api/wrangler.toml"]
        : subcommand === "list"
          ? ["d1", "list", "--config", "workers/tilelli-api/wrangler.toml"]
          : null;

  if (!argv) fail(`Unknown d1 subcommand: ${subcommand}`);
  const { stdout, stderr } = await execFileAsync(script, argv, { cwd: DEFAULT_REPO_ROOT, maxBuffer: 1024 * 1024 });
  if (stdout.trim()) logLine(stdout.trim());
  if (stderr.trim()) errorLine(stderr.trim());
  return 0;
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
      "  tilelli worker <deploy|status|test>",
      "  tilelli d1 <apply-local|apply-remote|list>"
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
