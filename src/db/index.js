const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../core/logger');

let isTurso = false;
let turso = null;
let sqlite = null;
let initPromise = null;
const stmtCache = new Map();

function ensureDir(filePath) {
  const dir = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (config.tursoDatabaseUrl && config.tursoAuthToken) {
      const { createClient } = require('@libsql/client');
      turso = createClient({ url: config.tursoDatabaseUrl, authToken: config.tursoAuthToken });
      isTurso = true;
      logger.info('db', 'connected_turso', { url: config.tursoDatabaseUrl });
    } else {
      const Database = require('better-sqlite3');
      ensureDir(config.databasePath);
      sqlite = new Database(path.resolve(config.databasePath));
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      logger.info('db', 'connected_sqlite', { path: config.databasePath });
    }
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await execScript(schema);
    // best-effort legacy compat (use direct execution; init() is in progress)
    await execDirect("ALTER TABLE auctions ADD COLUMN scope TEXT DEFAULT 'PUBLIC'").catch(() => null);
    await execDirect("ALTER TABLE event_participants ADD COLUMN display_name TEXT").catch(() => null);
    await execScript(`CREATE TABLE IF NOT EXISTS stock_target_roles (
  guild_id TEXT NOT NULL,
  target_norm TEXT NOT NULL,
  target_name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, target_norm)
);
CREATE INDEX IF NOT EXISTS idx_stock_target_roles_target ON stock_target_roles(target_norm);`);
  })();
  return initPromise;
}

function prepare(sql) {
  if (isTurso) return null;
  let stmt = stmtCache.get(sql);
  if (!stmt) { stmt = sqlite.prepare(sql); stmtCache.set(sql, stmt); }
  return stmt;
}

async function execDirect(sql, args = []) {
  if (isTurso) return turso.execute({ sql, args });
  return prepare(sql).run(...args);
}

async function exec(sql, args = []) {
  await init();
  return execDirect(sql, args);
}
async function get(sql, args = []) {
  await init();
  if (isTurso) { const r = await turso.execute({ sql, args }); return r.rows[0] || null; }
  return prepare(sql).get(...args) || null;
}
async function all(sql, args = []) {
  await init();
  if (isTurso) { const r = await turso.execute({ sql, args }); return r.rows || []; }
  return prepare(sql).all(...args) || [];
}
async function execScript(sqlText) {
  const statements = sqlText.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
  for (const s of statements) {
    if (isTurso) await turso.execute(s).catch(e => logger.warn('db', 'schema_stmt_warn', { err: e, stmt: s.slice(0, 80) }));
    else sqlite.exec(s);
  }
}

function isTursoMode() { return isTurso; }

module.exports = { init, exec, get, all, isTursoMode };
