const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const config = require('./config');
const logger = require('./core/logger');
const health = require('./core/health');
const shutdown = require('./core/shutdown');
const router = require('./core/router');
const scheduler = require('./core/scheduler');
const httpServer = require('./core/http');
const db = require('./db');

const stock = require('./modules/stock');
const wiki = require('./modules/wiki');
const weather = require('./modules/weather');
const auction = require('./modules/auction');

async function main() {
  try {
    config.validate({ requireToken: true });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  logger.setLevel(config.logLevel);
  await db.init();
  health.set({ db: 'ok', lite: config.liteMode, renderer: config.liteMode ? 'lite' : 'unknown' });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message],
  });

  const ctx = { client, config, db, logger, router, scheduler, health };

  // Register modules
  auction.register(ctx);
  stock.register(ctx);
  wiki.register(ctx);
  weather.register(ctx);

  client.once(Events.ClientReady, (c) => {
    logger.info('core', 'ready', { user: c.user.tag, guilds: c.guilds.cache.size });
    health.set({ ready: true, gateway: 'ready' });
  });
  client.on(Events.InteractionCreate, (interaction) => router.handleInteraction(interaction, ctx));
  client.on(Events.MessageCreate, (message) => { if (!message.author?.bot) router.handleMessage(message, ctx); });
  client.on(Events.MessageUpdate, (_old, message) => { if (message && !message.author?.bot) router.handleMessage(message, ctx); });
  client.on('shardDisconnect', () => health.set({ gateway: 'disconnected' }));
  client.on('shardResume', () => health.set({ gateway: 'resumed' }));

  const server = httpServer.start(config.port, { onStockIngest: (raw, sig) => stock.ingest(raw, sig) });

  scheduler.start(15000);

  shutdown.register('discord', () => client.destroy());
  shutdown.register('scheduler', () => scheduler.stop());
  shutdown.register('http', () => new Promise(r => server.close(() => r())));
  shutdown.install();

  await client.login(config.token);
}

main().catch((err) => {
  logger.error('core', 'fatal', { err });
  process.exit(1);
});
