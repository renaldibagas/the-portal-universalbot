const crypto = require('crypto');
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../../db');
const config = require('../../config');
const logger = require('../../core/logger');
const health = require('../../core/health');
const { parseMerchants } = require('./parser');

const name = 'stock';

function normTarget(s) { return String(s || '').trim().toLowerCase(); }
function cleanTargetName(s) { return String(s || '').trim().replace(/\s+/g, ' ').slice(0, 80); }

function verifyIngest(rawBody, sigHeader) {
  if (!config.ingestSecret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.ingestSecret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(String(sigHeader || ''));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

async function getExtraTargets() {
  try {
    const rows = await db.all('SELECT DISTINCT target_name FROM stock_target_roles');
    return rows.map(r => r.target_name).filter(Boolean);
  } catch { return []; }
}

async function getEffectiveTargets() {
  const extras = await getExtraTargets();
  const map = new Map();
  for (const t of [...(config.stockTargetItems || []), ...extras]) {
    const n = normTarget(t); if (!n) continue;
    if (!map.has(n)) map.set(n, cleanTargetName(t));
  }
  return Array.from(map.values());
}

async function handleStockMessage(messageLike, guildId = null) {
  if (!config.stockChannelId && !config.ingestSecret) return { ok: false, reason: 'not_configured' };
  const targets = await getEffectiveTargets();
  const merchants = parseMerchants(messageLike, targets);
  if (!merchants.length) return { ok: true, merchants: 0, pings: [] };
  const pings = [];
  for (const m of merchants) {
    const prev = await db.get('SELECT * FROM stock_state WHERE merchant = ?', [m.name]);
    const isNewCycle = m.nextRestockTimestamp && (!prev || prev.last_restock !== String(m.nextRestockTimestamp));
    const sigChanged = !prev || prev.last_signature !== m.inventorySignature;
    let alertedRestock = prev ? prev.alerted_restock : null;
    if (isNewCycle) alertedRestock = null;
    const hasTargets = m.isOpen && m.matchedTargetItems.length > 0;
    const shouldPing = hasTargets && (isNewCycle || sigChanged || alertedRestock !== String(m.nextRestockTimestamp || m.inventorySignature));
    if (shouldPing) {
      pings.push({ merchant: m.name, items: m.matchedTargetItems, restock: m.nextRestockTimestamp });
      alertedRestock = String(m.nextRestockTimestamp || m.inventorySignature);
    }
    await db.exec(
      'INSERT INTO stock_state(merchant,last_restock,last_signature,alerted_restock,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(merchant) DO UPDATE SET last_restock=excluded.last_restock,last_signature=excluded.last_signature,alerted_restock=excluded.alerted_restock,updated_at=excluded.updated_at',
      [m.name, m.nextRestockTimestamp || null, m.inventorySignature || '', alertedRestock, Date.now()]
    );
    if (isNewCycle || sigChanged) {
      await db.exec('INSERT INTO stock_events(merchant,restock_ts,signature,items_json,matched_json,created_at) VALUES(?,?,?,?,?,?)',
        [m.name, m.nextRestockTimestamp || null, m.inventorySignature || '', JSON.stringify(m.items || []), JSON.stringify(m.matchedTargetItems || []), Date.now()]);
    }
  }
  health.set({ stockLastSeen: Date.now() });
  if (pings.length) await sendPing(pings, guildId);
  return { ok: true, merchants: merchants.length, pings };
}

async function getRoleMentionsForItems(items, guildId = null) {
  const norms = [...new Set((items || []).map(normTarget).filter(Boolean))];
  if (!norms.length) return [];
  const mentions = new Set();
  for (const n of norms) {
    let rows;
    if (guildId) rows = await db.all('SELECT role_id FROM stock_target_roles WHERE target_norm=? AND guild_id=?', [n, guildId]);
    else rows = await db.all('SELECT role_id FROM stock_target_roles WHERE target_norm=?', [n]);
    for (const r of rows || []) if (r.role_id) mentions.add(`<@&${r.role_id}>`);
  }
  if (config.stockPingRoleId) mentions.add(`<@&${config.stockPingRoleId}>`);
  return Array.from(mentions);
}

async function sendPing(pings, guildId = null) {
  if (!config.stockWebhookUrl) {
    logger.info('stock', 'ping_detected_no_webhook', { pings });
    return;
  }
  const allItems = pings.flatMap(p => p.items || []);
  const mentions = await getRoleMentionsForItems(allItems, guildId);
  const lines = pings.map(p => `**${p.merchant}**: ${p.items.map(i => `⭐ ${i}`).join(', ')}`);
  const prefix = mentions.length ? mentions.join(' ') + ' ' : '';
  const content = (prefix + 'Target item restock detected:\n' + lines.join('\n')).slice(0, 2000);
  const roleIds = mentions.map(m => m.match(/<@&(\d+)>/)?.[1]).filter(Boolean);
  try {
    const res = await fetch(config.stockWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { roles: roleIds, parse: [] } })
    });
    if (!res.ok) logger.warn('stock', 'webhook_failed', { status: res.status });
  } catch (e) { logger.error('stock', 'webhook_error', { err: e }); }
}

async function onMessage(message, ctx) {
  if (!config.stockChannelId) return;
  if (message.channelId !== config.stockChannelId) return;
  const msgLike = { content: message.content || '', embeds: (message.embeds || []).map(e => (e.toJSON ? e.toJSON() : e)) };
  await handleStockMessage(msgLike, message.guildId || null).catch(e => logger.error('stock', 'handle_error', { err: e }));
}

async function ingest(rawBody, sigHeader) {
  if (!verifyIngest(rawBody, sigHeader)) return { status: 401, body: { ok: false, error: 'bad_signature' } };
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { status: 400, body: { ok: false, error: 'invalid_json' } }; }
  const message = payload.message || payload;
  const r = await handleStockMessage(message, payload.guildId || null);
  return { status: 200, body: r };
}

async function ensureTargetRole(guild, targetName) {
  const tNorm = normTarget(targetName);
  const tName = cleanTargetName(targetName);
  if (!tNorm || !guild) throw new Error('Invalid target or guild');
  const existing = await db.get('SELECT * FROM stock_target_roles WHERE guild_id=? AND target_norm=?', [guild.id, tNorm]);
  if (existing?.role_id) {
    const role = guild.roles.cache.get(existing.role_id) || await guild.roles.fetch(existing.role_id).catch(() => null);
    if (role) return { role, created: false, targetName: existing.target_name || tName };
  }
  const roleName = (`Stock: ${tName}`).slice(0, 100);
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  if (!role) {
    role = await guild.roles.create({ name: roleName, mentionable: true, reason: `Stock target role for ${tName}` });
  }
  await db.exec(
    'INSERT OR REPLACE INTO stock_target_roles(guild_id,target_norm,target_name,role_id,created_at) VALUES(?,?,?,?,?)',
    [guild.id, tNorm, tName, role.id, Date.now()]
  );
  return { role, created: !existing, targetName: tName };
}

async function toggleTargetRole(interaction, targetName) {
  if (!interaction.guild) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({ content: 'I need **Manage Roles** permission to create/give roles.', ephemeral: true });
  }
  const tName = cleanTargetName(targetName);
  if (!tName) return interaction.reply({ content: 'Target name is empty.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  try {
    const { role } = await ensureTargetRole(interaction.guild, tName);
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      return interaction.editReply({ content: `I can’t assign ${role} (role is above my highest role). Move my role higher.` });
    }
    const member = interaction.member;
    const has = member.roles.cache.has(role.id);
    if (has) {
      await member.roles.remove(role, `Stock target opt-out: ${tName}`);
      return interaction.editReply({ content: `Removed ${role} for **${tName}**. You will no longer be pinged for it.` });
    } else {
      await member.roles.add(role, `Stock target opt-in: ${tName}`);
      return interaction.editReply({ content: `Added ${role} for **${tName}**. You’ll be pinged when it restocks (if alerts are configured).` });
    }
  } catch (e) {
    logger.error('stock', 'toggle_role_error', { err: e, target: tName });
    return interaction.editReply({ content: `Failed to set role: ${String(e.message || e).slice(0, 200)}` });
  }
}

function buildMenuComponents(targets) {
  const opts = targets.slice(0, 25).map(t => ({ label: String(t).slice(0, 100), value: normTarget(t).slice(0, 100) || String(t).slice(0, 100), description: 'Toggle ping role for this target'.slice(0, 100) }));
  const rows = [];
  if (opts.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('stk_role_select')
        .setPlaceholder('Choose target(s) to get/remove ping roles')
        .setMinValues(1)
        .setMaxValues(Math.min(opts.length, 10))
        .addOptions(opts)
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stk_role_custom_btn').setLabel('Custom target').setStyle(ButtonStyle.Secondary)
  ));
  return rows;
}

async function openMenu(interaction) {
  const targets = await getEffectiveTargets();
  const desc = targets.length
    ? `Pick target item(s) below to **toggle** your ping role (bot creates role if needed).\nTargets: ${targets.slice(0, 25).map(t => `\`${t}\``).join(', ')}${targets.length > 25 ? ` (+${targets.length - 25} more)` : ''}`
    : 'No targets configured yet. Use **Custom target** to add one (creates a role you can be pinged for).';
  const components = buildMenuComponents(targets);
  await interaction.reply({ content: desc.slice(0, 1900), components, ephemeral: true });
}

async function handleInteraction(interaction, ctx) {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'stk_role_select') {
      if (!interaction.guild) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      const targets = await getEffectiveTargets();
      const byNorm = new Map(targets.map(t => [normTarget(t), t]));
      await interaction.deferReply({ ephemeral: true });
      const results = [];
      const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
      if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply({ content: 'I need **Manage Roles** permission to create/give roles.' });
      }
      for (const val of (interaction.values || []).slice(0, 10)) {
        const tName = byNorm.get(normTarget(val)) || cleanTargetName(val);
        try {
          const { role } = await ensureTargetRole(interaction.guild, tName);
          if (me.roles.highest.comparePositionTo(role) <= 0) { results.push(`⚠️ ${tName}: move my role above ${role.name}`); continue; }
          const has = interaction.member.roles.cache.has(role.id);
          if (has) { await interaction.member.roles.remove(role); results.push(`➖ ${tName}: removed ${role}`); }
          else { await interaction.member.roles.add(role); results.push(`➕ ${tName}: added ${role}`); }
        } catch (e) { results.push(`❌ ${tName}: ${String(e.message || e).slice(0, 80)}`); }
      }
      return interaction.editReply({ content: (results.join('\n') || 'No changes.').slice(0, 1900) });
    }
    if (interaction.isButton() && interaction.customId === 'stk_role_custom_btn') {
      const modal = new ModalBuilder().setCustomId('stk_role_custom_modal').setTitle('Custom stock target');
      const input = new TextInputBuilder().setCustomId('target_name').setLabel('Target item name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('e.g. Warden Leggings');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'stk_role_custom_modal') {
      const tName = interaction.fields.getTextInputValue('target_name');
      return toggleTargetRole(interaction, tName);
    }
  } catch (e) {
    logger.error('stock', 'interaction_error', { err: e, id: interaction.customId });
    const msg = { content: 'Stock action failed. Try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.editReply(msg).catch(() => {});
    return interaction.reply(msg).catch(() => {});
  }
}

function register(ctx) {
  const handler = async (interaction, c) => handleInteraction(interaction, c);
  handler.name = name;
  handler.onMessage = (m, c) => onMessage(m, c);
  ctx.router.registerPrefix('stk_', handler);
  ctx.router.registerCommand('stock', async (interaction) => {
    const sub = interaction.options.getSubcommand?.() || 'status';
    if (sub === 'status') {
      const rows = await db.all('SELECT * FROM stock_state ORDER BY merchant');
      const roleCount = await db.get('SELECT COUNT(*) as c FROM stock_target_roles').catch(() => ({ c: 0 }));
      const desc = (rows.length ? rows.map(r => `**${r.merchant}**: restock ${r.last_restock ? `<t:${r.last_restock}:R>` : 'n/a'}${r.alerted_restock ? ' (alerted)' : ''}`).join('\n') : 'No stock state yet.')
        + `\n\nTarget roles configured: ${roleCount?.c || 0}`;
      await interaction.reply({ content: desc.slice(0, 1900), ephemeral: true });
      return;
    }
    if (sub === 'menu') {
      return openMenu(interaction);
    }
    await interaction.reply({ content: 'Unknown stock subcommand.', ephemeral: true });
  });
}

module.exports = { name, register, onMessage, ingest, handleStockMessage, ensureTargetRole };
