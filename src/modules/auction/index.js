const db = require('../../db');
const config = require('../../config');
const logger = require('../../core/logger');
const { base } = require('../../ui/embeds');
const theme = require('../../ui/theme');

const name = 'auction';

// Minimal auction service foundation (compatible with legacy schema). Full command/UI parity
// should be ported from D:/Projects/the-portal-auction into src/modules/auction/*.
async function createAuction(data) {
  const now = Date.now();
  const endsAt = now + data.durationMs;
  const scope = data.scope || 'PUBLIC';
  const res = await db.exec(
    `INSERT INTO auctions (title,description,image_url,host_id,host_tag,starting_bid,current_bid,min_increment,auto_buy,created_at,ends_at,status,channel_id,scope)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?, ?)`,
    [data.title, data.description || '', data.imageUrl || null, data.hostId, data.hostTag, data.startingBid, data.startingBid, data.minIncrement, data.autoBuy || null, now, endsAt, data.channelId, scope]
  );
  const id = res.lastInsertRowid ?? res.lastInsertRowid?.toString?.();
  return db.get('SELECT * FROM auctions WHERE id = ?', [id]);
}

async function getActiveAuctions(scope = null) {
  if (scope) return db.all("SELECT * FROM auctions WHERE status='ACTIVE' AND scope=? ORDER BY id ASC", [scope]);
  return db.all("SELECT * FROM auctions WHERE status='ACTIVE' ORDER BY id ASC");
}

async function claimExpired(limit = 20) {
  // Idempotent claim: mark one-by-one via conditional update in a portable way
  const expired = await db.all("SELECT id FROM auctions WHERE status='ACTIVE' AND ends_at <= ? ORDER BY ends_at ASC LIMIT ?", [Date.now(), limit]);
  const claimed = [];
  for (const row of expired) {
    await db.exec("UPDATE auctions SET status='FINALIZING' WHERE id=? AND status='ACTIVE'", [row.id]);
    const a = await db.get('SELECT * FROM auctions WHERE id=?', [row.id]);
    if (a && a.status === 'FINALIZING') claimed.push(a);
  }
  return claimed;
}

async function handleInteraction(interaction) {
  if (interaction.isRepliable?.()) {
    await interaction.reply({ content: 'Auction UI scaffold loaded. Port full interactions from legacy auction module.', ephemeral: true }).catch(() => {});
  }
}

function register(ctx) {
  const handler = async (interaction) => handleInteraction(interaction);
  handler.name = name;
  ctx.router.registerPrefix('auc_', handler);
  ctx.router.registerCommand('auction', async (interaction) => {
    const sub = interaction.options.getSubcommand?.();
    if (sub === 'status' || !sub) {
      const active = await getActiveAuctions();
      const e = base({ title: 'Auctions', description: active.length ? active.map(a => `#${a.id} **${a.title}** (${a.scope}) — ends <t:${Math.floor(a.ends_at/1000)}:R>`).join('\n') : 'No active auctions.', color: theme.colors.auction, mod: 'auction' });
      await interaction.reply({ embeds: [e], ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Auction command scaffold loaded. Full create/bid/panel/restore flow should be ported from legacy auction module into src/modules/auction/* (service, commands, buttons, overview, restore).', ephemeral: true });
  });
  // scheduler hook
  ctx.scheduler.register('auction_finalize', 15000, async () => {
    const claimed = await claimExpired(10);
    for (const a of claimed) {
      try {
        const finalStatus = a.current_bidder_id ? 'SOLD' : 'ENDED_NO_BIDS';
        await db.exec('UPDATE auctions SET status=?, winner_id=?, winner_tag=?, winning_amount=? WHERE id=?', [finalStatus, a.current_bidder_id || null, a.current_bidder_tag || null, a.current_bidder_id ? a.current_bid : null, a.id]);
        logger.info('auction', 'finalized', { id: a.id, status: finalStatus });
      } catch (e) {
        logger.error('auction', 'finalize_error', { id: a.id, err: e });
        await db.exec("UPDATE auctions SET status='ACTIVE' WHERE id=? AND status='FINALIZING'", [a.id]).catch(() => {});
      }
    }
  });
}

module.exports = { name, register, createAuction, getActiveAuctions, claimExpired };
