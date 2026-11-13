// Safe/idempotent helper to copy legacy auctions.db into this project's DATABASE_PATH.
// Usage: node src/scripts/migrate-legacy-auctions.js --from "D:/Projects/the-portal-auction/data/auctions.db" [--force]
const fs = require('fs');
const path = require('path');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const from = arg('--from');
const force = process.argv.includes('--force');
const to = path.resolve(process.env.DATABASE_PATH || './data/auctions.db');

if (!from) { console.error('Missing --from <path-to-old-auctions.db>'); process.exit(1); }
if (!fs.existsSync(from)) { console.error('Source not found:', from); process.exit(1); }
fs.mkdirSync(path.dirname(to), { recursive: true });
if (fs.existsSync(to) && !force) { console.error('Target exists, refusing to overwrite:', to, '(use --force after backup)'); process.exit(1); }
if (fs.existsSync(to) && force) {
  const bak = to + '.bak-' + Date.now();
  fs.copyFileSync(to, bak);
  console.log('Backed up existing target to', bak);
}
fs.copyFileSync(from, to);
for (const ext of ['-wal', '-shm']) { if (fs.existsSync(from + ext)) fs.copyFileSync(from + ext, to + ext); }
console.log('Copied auctions DB:', from, '->', to);
console.log('Run the bot once to apply additive schema migrations (e.g. scope column, stock/wiki tables).');
