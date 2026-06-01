DROP TABLE IF EXISTS anime_generation_jobs_next;

CREATE TABLE anime_generation_jobs_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'cloudflare', 'external')),
  model TEXT NOT NULL DEFAULT '',
  generation_prompt TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  callback_url TEXT NOT NULL DEFAULT '',
  provider_job_id TEXT NOT NULL DEFAULT '',
  provider_response_json TEXT NOT NULL DEFAULT '{}',
  duration TEXT NOT NULL DEFAULT '10s',
  resolution TEXT NOT NULL DEFAULT '1920x1080',
  fps TEXT NOT NULL DEFAULT '24',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  bundle_json TEXT NOT NULL DEFAULT '{}',
  output_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'anime-html',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (scene_id) REFERENCES anime_scenes(id) ON DELETE SET NULL
);

INSERT INTO anime_generation_jobs_next (
  id,
  scene_id,
  title,
  provider,
  model,
  generation_prompt,
  notes,
  duration,
  resolution,
  fps,
  status,
  bundle_json,
  output_url,
  thumbnail_url,
  error,
  source,
  created_at,
  updated_at
)
SELECT
  id,
  scene_id,
  title,
  provider,
  model,
  generation_prompt,
  notes,
  duration,
  resolution,
  fps,
  status,
  bundle_json,
  output_url,
  thumbnail_url,
  error,
  source,
  created_at,
  updated_at
FROM anime_generation_jobs;

DROP TABLE anime_generation_jobs;
ALTER TABLE anime_generation_jobs_next RENAME TO anime_generation_jobs;

CREATE INDEX IF NOT EXISTS idx_anime_generation_jobs_status_created ON anime_generation_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_anime_generation_jobs_scene_created ON anime_generation_jobs(scene_id, created_at);
