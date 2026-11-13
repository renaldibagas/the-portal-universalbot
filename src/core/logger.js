const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function setLevel(lvl) { current = LEVELS[String(lvl).toLowerCase()] || current; }

function redact(v) {
  if (v == null) return v;
  const s = String(v);
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]')
    .replace(/(token[=:]\s*)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/(https:\/\/discord\.com\/api\/webhooks\/)[^\s"]+/gi, '$1[REDACTED]');
}

function log(level, mod, event, fields = {}) {
  if ((LEVELS[level] || 20) < current) return;
  const entry = { ts: new Date().toISOString(), level, mod, event };
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) {
      entry[k] = { message: redact(v.message), stack: redact(v.stack) };
    } else if (typeof v === 'string') {
      entry[k] = redact(v);
    } else {
      entry[k] = v;
    }
  }
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  setLevel,
  debug: (mod, event, f) => log('debug', mod, event, f),
  info: (mod, event, f) => log('info', mod, event, f),
  warn: (mod, event, f) => log('warn', mod, event, f),
  error: (mod, event, f) => log('error', mod, event, f),
};
