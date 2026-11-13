PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  host_id TEXT NOT NULL,
  host_tag TEXT NOT NULL,
  starting_bid REAL NOT NULL,
  current_bid REAL DEFAULT 0,
  current_bidder_id TEXT,
  current_bidder_tag TEXT,
  min_increment REAL NOT NULL,
  auto_buy REAL,
  created_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  winner_id TEXT,
  winner_tag TEXT,
  winning_amount REAL,
  anti_snipe_count INTEGER DEFAULT 0,
  scope TEXT DEFAULT 'PUBLIC'
);
CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL,
  bidder_id TEXT NOT NULL,
  bidder_tag TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS strikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  auction_id INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_thread ON auctions(thread_id);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id);

-- Unified additions
CREATE TABLE IF NOT EXISTS stock_state (
  merchant TEXT PRIMARY KEY,
  last_restock TEXT,
  last_signature TEXT,
  alerted_restock TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant TEXT NOT NULL,
  restock_ts TEXT,
  signature TEXT,
  items_json TEXT,
  matched_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_events_created ON stock_events(created_at);

CREATE TABLE IF NOT EXISTS wiki_cache (
  key TEXT PRIMARY KEY,
  page_id INTEGER,
  title TEXT,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  hits INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wiki_negative (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wiki_exp ON wiki_cache(expires_at);

CREATE TABLE IF NOT EXISTS stock_target_roles (
  guild_id TEXT NOT NULL,
  target_norm TEXT NOT NULL,
  target_name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, target_norm)
);
CREATE INDEX IF NOT EXISTS idx_stock_target_roles_target ON stock_target_roles(target_norm);

-- Event hosting
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  host_id TEXT NOT NULL,
  host_tag TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  starts_at INTEGER,
  signup_closes_at INTEGER
);
CREATE TABLE IF NOT EXISTS event_participants (
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_tag TEXT,
  display_name TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_guild ON events(guild_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_event_participants_event ON event_participants(event_id, score DESC);
