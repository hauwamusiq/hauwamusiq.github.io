-- Form: SQL
-- Runtime: Cloudflare D1 / SQLite
-- Purpose: Initial persistent memory schema for the Tilelli edge backend.
-- Inputs: wrangler d1 execute, Cloudflare D1 binding.
-- Outputs: audit_events, portfolio_entries, physics_notes, dashboard_reminders, and agent_runs tables.
-- Outputs: audit_events, portfolio_entries, anime_scenes, anime_assets, anime_render_jobs, physics_notes, dashboard_reminders, and agent_runs tables.
-- Safety: Uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS to keep first migration idempotent.
-- Relations: workers/tilelli-api/src/index.js, workers/tilelli-api/wrangler.toml.

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT 'tilelli',
  payload TEXT NOT NULL DEFAULT '{}',
  source_ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS portfolio_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK (section IN ('music', 'writing', 'visuals', 'research')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  media_url TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS anime_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  art_style TEXT NOT NULL DEFAULT 'shonen' CHECK (art_style IN ('shonen', 'shojo', 'cinematic')),
  setting TEXT NOT NULL DEFAULT 'neon-city' CHECK (setting IN ('neon-city', 'shrine-forest', 'orbital-lab')),
  duration TEXT NOT NULL DEFAULT '10s',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'draft', 'rendering', 'ready', 'archived')),
  output_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'anime-html',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS physics_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  claim TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  reproduce TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queue' CHECK (status IN ('queue', 'active', 'mastered', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS dashboard_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_entries_visibility ON portfolio_entries(visibility, section, category);
CREATE INDEX IF NOT EXISTS idx_anime_scenes_status_created ON anime_scenes(status, created_at);
CREATE TABLE IF NOT EXISTS anime_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER,
  asset_kind TEXT NOT NULL DEFAULT 'reference' CHECK (asset_kind IN ('sketch', 'reference', 'character-sheet', 'background', 'moodboard', 'preset')),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT '',
  preview_data TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'linked', 'archived')),
  source TEXT NOT NULL DEFAULT 'anime-html',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (scene_id) REFERENCES anime_scenes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anime_assets_kind_created ON anime_assets(asset_kind, created_at);
CREATE INDEX IF NOT EXISTS idx_anime_assets_scene_created ON anime_assets(scene_id, created_at);
CREATE TABLE IF NOT EXISTS anime_render_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER,
  title TEXT NOT NULL,
  render_kind TEXT NOT NULL DEFAULT 'clip' CHECK (render_kind IN ('still', 'clip', 'sequence')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
  bundle_json TEXT NOT NULL DEFAULT '{}',
  output_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'anime-html',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (scene_id) REFERENCES anime_scenes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anime_render_jobs_status_created ON anime_render_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_anime_render_jobs_scene_created ON anime_render_jobs(scene_id, created_at);
CREATE INDEX IF NOT EXISTS idx_physics_notes_status ON physics_notes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_dashboard_reminders_status_due ON dashboard_reminders(status, due_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_type_created ON agent_runs(run_type, created_at);
