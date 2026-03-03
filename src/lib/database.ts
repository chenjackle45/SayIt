import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export async function initializeDatabase(): Promise<Database> {
  if (db) return db;

  db = await Database.load("sqlite:app.db");

  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA synchronous = NORMAL;");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      processed_text TEXT,
      recording_duration_ms INTEGER NOT NULL,
      transcription_duration_ms INTEGER NOT NULL,
      enhancement_duration_ms INTEGER,
      char_count INTEGER NOT NULL,
      trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
      was_enhanced INTEGER NOT NULL DEFAULT 0,
      was_modified INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp
    ON transcriptions(timestamp DESC);
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
    ON transcriptions(created_at);
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  await db.execute(
    "INSERT OR IGNORE INTO schema_version (version) VALUES (1);",
  );

  // --- Migration v1 → v2: api_usage table ---
  const versionRows = await db.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const currentVersion = versionRows[0]?.version ?? 1;

  if (currentVersion < 2) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id TEXT PRIMARY KEY,
        transcription_id TEXT NOT NULL,
        api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat')),
        model TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        prompt_time_ms REAL,
        completion_time_ms REAL,
        total_time_ms REAL,
        audio_duration_ms INTEGER,
        estimated_cost_ceiling REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcription_id) REFERENCES transcriptions(id)
      );
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
      ON api_usage(transcription_id);
    `);

    await db.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (2);",
    );

    console.log("[database] Migration v1 → v2: created api_usage table");
  }

  console.log("[database] SQLite initialized with WAL mode");

  return db;
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error(
      "[database] Database not initialized. Call initializeDatabase() first.",
    );
  }
  return db;
}
