require('dotenv').config();
const path = require('path');

function splitCsv(v) {
  return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}
function toInt(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function toBool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const cfg = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  port: toInt(process.env.PORT, 3000),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  currencySymbol: process.env.CURRENCY_SYMBOL || '$',

  publicOverviewChannelId: process.env.PUBLIC_OVERVIEW_CHANNEL_ID || '',
  publicAuctionChannelId: process.env.PUBLIC_AUCTION_CHANNEL_ID || '',
  publicTagOngoingId: process.env.PUBLIC_TAG_ONGOING_ID || '',
  publicTagEndedId: process.env.PUBLIC_TAG_ENDED_ID || '',
  guildOverviewChannelId: process.env.GUILD_OVERVIEW_CHANNEL_ID || '',
  guildAuctionChannelId: process.env.GUILD_AUCTION_CHANNEL_ID || '',
  guildTagOngoingId: process.env.GUILD_TAG_ONGOING_ID || '',
  guildTagEndedId: process.env.GUILD_TAG_ENDED_ID || '',
  logChannelId: process.env.LOG_CHANNEL_ID || '',

  exclusiveRoleIds: splitCsv(process.env.EXCLUSIVE_ROLE_IDS || process.env.EXCLUSIVE_ROLE_ID),
  auctionManagerRoleId: process.env.AUCTION_MANAGER_ROLE_ID || '',
  adminRoleIds: splitCsv(process.env.ADMIN_ROLE_IDS),

  stockChannelId: process.env.STOCK_CHANNEL_ID || '',
  stockTargetItems: splitCsv(process.env.STOCK_TARGET_ITEMS || 'Warden Leggings,Warden Robes,Camp Rucksack,Corn Seeds'),
  stockWebhookUrl: process.env.STOCK_WEBHOOK_URL || '',
  stockPingRoleId: process.env.STOCK_PING_ROLE_ID || '',
  ingestSecret: process.env.INGEST_SECRET || '',

  wikiApiUrl: process.env.WIKI_API_URL || 'https://roblox-the-portal.fandom.com/api.php',
  wikiTtlHours: toInt(process.env.WIKI_TTL_HOURS, 168),
  wikiNegativeTtlMin: toInt(process.env.WIKI_NEGATIVE_TTL_MIN, 60),

  weatherChannelIds: splitCsv(process.env.WEATHER_CHANNEL_IDS),
  pythonBin: process.env.PYTHON_BIN || 'python',
  liteMode: toBool(process.env.LITE_MODE, false),

  databasePath: path.resolve(process.env.DATABASE_PATH || './data/auctions.db'),
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
};

cfg.embedColor = 0x5865F2;
cfg.successColor = 0x57F287;
cfg.warningColor = 0xFEE75C;
cfg.dangerColor = 0xED4245;
cfg.antiSnipeTriggerMinutes = 10;
cfg.antiSnipeExtensionHours = 3;

function getMemberRoleIds(member) {
  if (!member) return [];
  if (member.roles?.cache) return Array.from(member.roles.cache.keys());
  if (Array.isArray(member.roles)) return member.roles.map(r => (typeof r === 'string' ? r : r.id)).filter(Boolean);
  if (member._roles && Array.isArray(member._roles)) return member._roles;
  return [];
}
cfg.getMemberRoleIds = getMemberRoleIds;
cfg.hasManagerPermission = (member) => {
  if (!member) return false;
  if (member.permissions?.has?.('Administrator')) return true;
  const roleIds = getMemberRoleIds(member);
  if (cfg.auctionManagerRoleId && roleIds.includes(cfg.auctionManagerRoleId)) return true;
  return cfg.adminRoleIds.some(id => roleIds.includes(id));
};
cfg.hasExclusiveAccess = (member) => {
  if (!member) return false;
  if (cfg.hasManagerPermission(member)) return true;
  const roleIds = getMemberRoleIds(member);
  return cfg.exclusiveRoleIds.some(id => roleIds.includes(id));
};

function validate({ requireToken = true } = {}) {
  const errors = [];
  if (requireToken && !cfg.token) errors.push('DISCORD_TOKEN is required');
  if (requireToken && !cfg.clientId) errors.push('CLIENT_ID is required');
  if (process.env.DISCORD_USER_TOKEN) errors.push('DISCORD_USER_TOKEN is forbidden (selfbot). Remove it.');
  // Auction scope IDs are optional to allow partial module use, but warnable by callers.
  if (errors.length) throw new Error('Config error:\n- ' + errors.join('\n- '));
  return cfg;
}

cfg.validate = validate;
module.exports = cfg;
