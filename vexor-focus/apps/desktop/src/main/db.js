const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Database } = require('node-sqlite3-wasm');

const CONFIG_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), '.config'),
  'TeamVexor'
);
fs.mkdirSync(CONFIG_DIR, { recursive: true });

const DB_PATH = path.join(CONFIG_DIR, 'vexor.db');

// Remove stale lock files/folders that can block startup after a crash
function cleanLockFiles() {
  for (const name of ['vexor.db-lock', 'vexor.db.lock', 'vexor.db-wal', 'vexor.db-shm']) {
    try { fs.rmSync(path.join(CONFIG_DIR, name), { recursive: true, force: true }); } catch {}
  }
}

let db = null;

function openDb() {
  cleanLockFiles();
  try {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        source        TEXT NOT NULL,
        app           TEXT,
        domain        TEXT,
        title         TEXT,
        started_at    INTEGER NOT NULL,
        ended_at      INTEGER,
        duration_ms   INTEGER NOT NULL DEFAULT 0,
        idle          INTEGER NOT NULL DEFAULT 0,
        focus_session_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_activity_started ON activity(started_at);

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id          TEXT PRIMARY KEY,
        mode        TEXT NOT NULL,
        planned_ms  INTEGER NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        completed   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS categories (
        match     TEXT PRIMARY KEY,
        category  TEXT NOT NULL,
        productive INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    return db;
  } catch (err) {
    console.error('[db] failed to open database:', err.message);
    db = null;
    return null;
  }
}

// Open on module load
openDb();

function getDb() {
  if (!db || !db.isOpen) {
    openDb();
  }
  return db;
}

module.exports = { db: getDb, CONFIG_DIR, DB_PATH, cleanLockFiles, openDb };
