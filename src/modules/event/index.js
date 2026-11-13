const { PermissionFlagsBits } = require('discord.js');
const db = require('../../db');
const logger = require('../../core/logger');
const { base } = require('../../ui/embeds');
const theme = require('../../ui/theme');

const name = 'event';

function canManageGuild(interaction) {
  const p = interaction.memberPermissions;
  if (!p) return false;
  return p.has(PermissionFlagsBits.ManageGuild) || p.has(PermissionFlagsBits.ManageEvents) || p.has(PermissionFlagsBits.Administrator);
}

function canManageEvent(interaction, ev) {
  if (!ev) return false;
  if (canManageGuild(interaction)) return true;
  return ev.host_id === interaction.user.id;
}

async function getEvent(id, guildId) {
  return db.get('SELECT * FROM events WHERE id = ? AND guild_id = ?', [id, guildId]);
}

async function createEvent(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  if (!canManageGuild(interaction)) return interaction.reply({ content: 'You need **Manage Events** (or Manage Server/Admin) to create events.', ephemeral: true });
  const nameVal = interaction.options.getString('name', true).trim().slice(0, 100);
  const desc = (interaction.options.getString('description') || '').trim().slice(0, 500);
  const now = Date.now();
  const res = await db.exec(
    'INSERT INTO events (guild_id, name, description, host_id, host_tag, status, created_at) VALUES (?,?,?,?,?,?,?)',
    [interaction.guildId, nameVal, desc || null, interaction.user.id, interaction.user.tag, 'OPEN', now]
  );
  const id = res.lastInsertRowid ?? res?.lastInsertRowid;
  const e = base({ title: 'Event Created', description: `**${nameVal}**${desc ? `\n${desc}` : ''}`, color: theme.colors.success, mod: 'event' });
  e.addFields({ name: 'ID', value: `#${id}`, inline: true }, { name: 'Host', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Status', value: 'OPEN', inline: true });
  await interaction.reply({ embeds: [e] });
}

async function listEvents(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const rows = await db.all('SELECT * FROM events WHERE guild_id = ? ORDER BY status ASC, created_at DESC LIMIT 20', [interaction.guildId]);
  if (!rows.length) return interaction.reply({ embeds: [base({ title: 'Events', description: 'No events yet. Create one with `/event create`.', color: theme.colors.neutral, mod: 'event' })], ephemeral: true });
  const lines = rows.map(r => `**#${r.id}** ${r.status === 'OPEN' ? '🟢' : '⚪'} ${r.name} — host <@${r.host_id}>`);
  const e = base({ title: 'Events', description: lines.join('\n').slice(0, 4000), color: theme.colors.brand, mod: 'event' });
  await interaction.reply({ embeds: [e] });
}

async function infoEvent(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found in this server.`, ephemeral: true });
  const parts = await db.all('SELECT * FROM event_participants WHERE event_id = ? ORDER BY score DESC, joined_at ASC LIMIT 30', [id]);
  const total = await db.get('SELECT COUNT(*) as c FROM event_participants WHERE event_id = ?', [id]);
  const pLines = parts.length ? parts.map((p, i) => `${i + 1}. <@${p.user_id}> — **${p.score}** pts`).join('\n') : 'No participants yet.';
  const e = base({ title: `Event #${ev.id}: ${ev.name}`, description: ev.description || 'No description.', color: ev.status === 'OPEN' ? theme.colors.brand : theme.colors.neutral, mod: 'event' });
  e.addFields(
    { name: 'Status', value: ev.status, inline: true },
    { name: 'Host', value: `<@${ev.host_id}>`, inline: true },
    { name: 'Participants', value: String(total?.c || 0), inline: true },
    { name: 'Top participants', value: pLines.slice(0, 1024), inline: false }
  );
  await interaction.reply({ embeds: [e] });
}

async function addParticipant(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user', true);
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can modify participants.', ephemeral: true });
  if (ev.status !== 'OPEN') return interaction.reply({ content: 'Event is closed.', ephemeral: true });
  await db.exec('INSERT OR IGNORE INTO event_participants (event_id, user_id, user_tag, score, joined_at) VALUES (?,?,?,?,?)', [id, user.id, user.tag, 0, Date.now()]);
  const existing = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, user.id]);
  await interaction.reply({ content: `Added <@${user.id}> to **#${id} ${ev.name}** (score: ${existing?.score ?? 0}).` });
}

async function removeParticipant(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user', true);
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can modify participants.', ephemeral: true });
  await db.exec('DELETE FROM event_participants WHERE event_id=? AND user_id=?', [id, user.id]);
  await interaction.reply({ content: `Removed <@${user.id}> from **#${id} ${ev.name}**.` });
}

async function scoreParticipant(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user', true);
  const points = interaction.options.getInteger('points', true);
  const mode = (interaction.options.getString('mode') || 'add').toLowerCase();
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can give scores.', ephemeral: true });
  if (ev.status !== 'OPEN') return interaction.reply({ content: 'Event is closed.', ephemeral: true });
  let p = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, user.id]);
  if (!p) {
    await db.exec('INSERT INTO event_participants (event_id, user_id, user_tag, score, joined_at) VALUES (?,?,?,?,?)', [id, user.id, user.tag, 0, Date.now()]);
    p = { score: 0 };
  }
  const old = Number(p.score || 0);
  const newScore = mode === 'set' ? points : old + points;
  await db.exec('UPDATE event_participants SET score=?, user_tag=? WHERE event_id=? AND user_id=?', [newScore, user.tag, id, user.id]);
  await interaction.reply({ content: `**#${id} ${ev.name}** — <@${user.id}>: ${old} → **${newScore}** pts (${mode === 'set' ? 'set' : (points >= 0 ? `+${points}` : String(points))}).` });
}

async function leaderboard(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  const rows = await db.all('SELECT * FROM event_participants WHERE event_id = ? ORDER BY score DESC, joined_at ASC LIMIT 25', [id]);
  if (!rows.length) return interaction.reply({ content: `No participants in **#${id} ${ev.name}** yet.` });
  const lines = rows.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} <@${r.user_id}> — **${r.score}** pts`;
  });
  const e = base({ title: `Leaderboard — #${ev.id} ${ev.name}`, description: lines.join('\n').slice(0, 4000), color: theme.colors.brand, mod: 'event' });
  e.addFields({ name: 'Status', value: ev.status, inline: true });
  await interaction.reply({ embeds: [e] });
}

async function closeEvent(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can close it.', ephemeral: true });
  await db.exec('UPDATE events SET status=?, closed_at=? WHERE id=?', ['CLOSED', Date.now(), id]);
  await interaction.reply({ content: `Closed event **#${id} ${ev.name}**.` });
}

function register(ctx) {
  ctx.router.registerCommand('event', async (interaction) => {
    const sub = interaction.options.getSubcommand();
    try {
      switch (sub) {
        case 'create': return await createEvent(interaction);
        case 'list': return await listEvents(interaction);
        case 'info': return await infoEvent(interaction);
        case 'add': return await addParticipant(interaction);
        case 'remove': return await removeParticipant(interaction);
        case 'score': return await scoreParticipant(interaction);
        case 'leaderboard': return await leaderboard(interaction);
        case 'close': return await closeEvent(interaction);
        default: return await interaction.reply({ content: 'Unknown event subcommand.', ephemeral: true });
      }
    } catch (err) {
      logger.error('event', 'command_error', { err, sub });
      const msg = { content: 'Event command failed. Try again.', ephemeral: true };
      if (interaction.deferred || interaction.replied) return interaction.editReply(msg).catch(() => {});
      return interaction.reply(msg).catch(() => {});
    }
  });
}

module.exports = { name, register };
