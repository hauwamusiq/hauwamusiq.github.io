-- Form: SQL
-- Runtime: Cloudflare D1 / SQLite
-- Purpose: Relax anime scene settings from a fixed enum to freeform text.
-- Inputs: wrangler d1 execute, Cloudflare D1 binding.
-- Outputs: anime_scenes table with freeform setting values preserved.
-- Safety: Rebuilds the table in a transaction and copies existing rows across.
-- Relations: workers/tilelli-api/src/index.js, workers/tilelli-api/schema/0001_initial.sql.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

ALTER TABLE anime_scenes RENAME TO anime_scenes_old;

CREATE TABLE anime_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  art_style TEXT NOT NULL DEFAULT 'shonen' CHECK (art_style IN ('shonen', 'shojo', 'cinematic')),
  setting TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '10s',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'draft', 'rendering', 'ready', 'archived')),
  output_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'anime-html',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO anime_scenes (
  id, title, prompt, art_style, setting, duration, aspect_ratio, notes, status, output_url, source, created_at, updated_at
)
SELECT
  id, title, prompt, art_style, COALESCE(setting, ''), duration, aspect_ratio, notes, status, output_url, source, created_at, updated_at
FROM anime_scenes_old;

DROP TABLE anime_scenes_old;

CREATE INDEX IF NOT EXISTS idx_anime_scenes_status_created ON anime_scenes(status, created_at);

COMMIT;

PRAGMA foreign_keys = ON;
