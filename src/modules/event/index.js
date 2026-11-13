const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function extUserId(nameStr) {
  const n = normName(nameStr).replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'player';
  return 'ext:' + n;
}
function participantLabel(p) {
  if (!p) return 'Unknown';
  if (p.user_id && String(p.user_id).startsWith('ext:')) return `**${p.display_name || p.user_tag || p.user_id.slice(4)}** (external)`;
  return `<@${p.user_id}>`;
}

async function findParticipant(eventId, user, nameStr) {
  if (user) return db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [eventId, user.id]);
  if (nameStr) {
    const n = normName(nameStr);
    const rows = await db.all('SELECT * FROM event_participants WHERE event_id=?', [eventId]);
    return rows.find(r => normName(r.display_name || '') === n || normName(r.user_tag || '') === n || String(r.user_id) === extUserId(nameStr)) || null;
  }
  return null;
}

async function createEvent(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  if (!canManageGuild(interaction)) return interaction.reply({ content: 'You need **Manage Events** (or Manage Server/Admin) to create events.', ephemeral: true });
  const nameVal = interaction.options.getString('name', true).trim().slice(0, 100);
  const desc = (interaction.options.getString('description') || '').trim().slice(0, 1000);
  const now = Date.now();
  const res = await db.exec(
    'INSERT INTO events (guild_id, name, description, host_id, host_tag, status, created_at) VALUES (?,?,?,?,?,?,?)',
    [interaction.guildId, nameVal, desc || null, interaction.user.id, interaction.user.tag, 'OPEN', now]
  );
  const id = res.lastInsertRowid ?? res?.lastInsertRowid;
  const e = base({ title: 'Event Created', description: `**${nameVal}**${desc ? `\n${desc}` : ''}`, color: theme.colors.success, mod: 'event' });
  e.addFields(
    { name: 'ID', value: `#${id}`, inline: true },
    { name: 'Host', value: `<@${interaction.user.id}>`, inline: true },
    { name: 'Status', value: 'OPEN', inline: true }
  );
  e.addFields({ name: 'Next steps', value: 'Add players with `/event add` (Discord user or external name), track scores with `/event score`, and view `/event leaderboard`.', inline: false });
  await interaction.reply({ embeds: [e], components: joinLeaveRow({ id, status: 'OPEN' }) });
}

async function listEvents(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const rows = await db.all(
    "SELECT e.*, (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id) AS participant_count FROM events e WHERE e.guild_id = ? ORDER BY (e.status = 'OPEN') DESC, e.created_at DESC LIMIT 25",
    [interaction.guildId]
  );
  if (!rows.length) return interaction.reply({ embeds: [base({ title: 'Events', description: 'No events yet. Create one with `/event create`.', color: theme.colors.neutral, mod: 'event' })], ephemeral: true });
  const lines = rows.map(r => `**#${r.id}** ${r.status === 'OPEN' ? '🟢 OPEN' : '⚪ CLOSED'} — ${String(r.name).slice(0, 100)}\nHost: <@${r.host_id}> • Participants: ${Number(r.participant_count || 0)}${r.description ? `\n${String(r.description).slice(0, 80)}` : ''}`);
  const e = base({ title: 'Server Events', description: lines.join('\n\n').slice(0, 4000), color: theme.colors.brand, mod: 'event' });
  e.addFields({ name: 'Open', value: String(rows.filter(r => r.status === 'OPEN').length), inline: true }, { name: 'Total', value: String(rows.length), inline: true });
  await interaction.reply({ embeds: [e] });
}

async function buildEventView(guildId, id) {
  const ev = await getEvent(id, guildId);
  if (!ev) return null;
  const parts = await db.all('SELECT * FROM event_participants WHERE event_id = ? ORDER BY score DESC, joined_at ASC LIMIT 30', [id]);
  const total = await db.get('SELECT COUNT(*) as c FROM event_participants WHERE event_id = ?', [id]);
  const totalCount = Number(total?.c || 0);
  const pLines = parts.length ? parts.map((p, i) => `${i + 1}. ${participantLabel(p)} \u2014 **${p.score}** pts`).join('\n') : 'No participants yet. Press **Join Event** to enter.';
  const e = base({ title: `Event #${ev.id}: ${ev.name}`, description: ev.description ? String(ev.description).slice(0, 1500) : 'No description.', color: ev.status === 'OPEN' ? theme.colors.brand : theme.colors.neutral, mod: 'event' });
  e.addFields(
    { name: 'Status', value: ev.status, inline: true },
    { name: 'Host', value: `<@${ev.host_id}>`, inline: true },
    { name: 'Participants', value: String(totalCount), inline: true },
    { name: 'Created', value: `<t:${Math.floor(ev.created_at / 1000)}:f>`, inline: true },
    { name: 'Closed', value: ev.closed_at ? `<t:${Math.floor(ev.closed_at / 1000)}:f>` : '\u2014', inline: true },
    { name: `Participants list (${parts.length}${totalCount > parts.length ? ` of ${totalCount}` : ''})`, value: pLines.slice(0, 1024), inline: false }
  );
  return { ev, embeds: [e], components: joinLeaveRow(ev) };
}

async function refreshOverview(interaction, id) {
  const view = await buildEventView(interaction.guildId, id).catch(() => null);
  if (!view) return false;
  try { await interaction.update({ embeds: view.embeds, components: view.components }); return true; } catch { return false; }
}

async function infoEvent(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const view = await buildEventView(interaction.guildId, id);
  if (!view) return interaction.reply({ content: `Event #${id} not found in this server.`, ephemeral: true });
  await interaction.reply({ embeds: view.embeds, components: view.components });
}

async function addParticipant(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user');
  const nameStr = (interaction.options.getString('name') || '').trim().slice(0, 80);
  if (!user && !nameStr) return interaction.reply({ content: 'Provide a Discord **user** or an external **name** (for players on other platforms).', ephemeral: true });
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can modify participants.', ephemeral: true });
  if (ev.status !== 'OPEN') return interaction.reply({ content: 'Event is closed.', ephemeral: true });

  let userId, userTag, displayName, label;
  if (user) {
    userId = user.id;
    userTag = user.tag;
    displayName = nameStr || user.globalName || user.username || user.tag;
    label = `<@${user.id}>${nameStr ? ` (${nameStr})` : ''}`;
  } else {
    userId = extUserId(nameStr);
    userTag = nameStr;
    displayName = nameStr;
    label = `**${nameStr}** (external)`;
  }
  await db.exec(
    'INSERT OR IGNORE INTO event_participants (event_id, user_id, user_tag, display_name, score, joined_at) VALUES (?,?,?,?,?,?)',
    [id, userId, userTag, displayName, 0, Date.now()]
  );
  const existing = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, userId]);
  if (existing && (existing.display_name !== displayName || existing.user_tag !== userTag)) {
    await db.exec('UPDATE event_participants SET user_tag=?, display_name=? WHERE event_id=? AND user_id=?', [userTag, displayName, id, userId]).catch(() => {});
  }
  await interaction.reply({ content: `Added ${label} to **#${id} ${ev.name}** (score: ${existing?.score ?? 0}).` });
}

async function removeParticipant(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user');
  const nameStr = (interaction.options.getString('name') || '').trim();
  if (!user && !nameStr) return interaction.reply({ content: 'Provide a Discord **user** or the participant **name** to remove.', ephemeral: true });
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can modify participants.', ephemeral: true });
  const p = await findParticipant(id, user, nameStr);
  if (!p) return interaction.reply({ content: `Participant not found in **#${id} ${ev.name}**.`, ephemeral: true });
  await db.exec('DELETE FROM event_participants WHERE event_id=? AND user_id=?', [id, p.user_id]);
  await interaction.reply({ content: `Removed ${participantLabel(p)} from **#${id} ${ev.name}**.` });
}

async function scoreParticipant(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const id = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user');
  const nameStr = (interaction.options.getString('name') || '').trim();
  const points = interaction.options.getInteger('points', true);
  const mode = (interaction.options.getString('mode') || 'add').toLowerCase();
  if (!user && !nameStr) return interaction.reply({ content: 'Provide a Discord **user** or the participant **name**.', ephemeral: true });
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (!canManageEvent(interaction, ev)) return interaction.reply({ content: 'Only the event host or someone with Manage Events can give scores.', ephemeral: true });
  if (ev.status !== 'OPEN') return interaction.reply({ content: 'Event is closed.', ephemeral: true });

  let p = await findParticipant(id, user, nameStr);
  if (!p) {
    // auto-add if we have enough info
    if (user) {
      await db.exec('INSERT OR IGNORE INTO event_participants (event_id, user_id, user_tag, display_name, score, joined_at) VALUES (?,?,?,?,?,?)', [id, user.id, user.tag, nameStr || user.globalName || user.username || user.tag, 0, Date.now()]);
      p = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, user.id]);
    } else {
      const uid = extUserId(nameStr);
      await db.exec('INSERT OR IGNORE INTO event_participants (event_id, user_id, user_tag, display_name, score, joined_at) VALUES (?,?,?,?,?,?)', [id, uid, nameStr, nameStr, 0, Date.now()]);
      p = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, uid]);
    }
  }
  const old = Number(p.score || 0);
  let newScore;
  let desc;
  if (mode === 'set') { newScore = points; desc = 'set'; }
  else if (mode === 'subtract') { newScore = old - Math.abs(points); desc = `-${Math.abs(points)}`; }
  else { newScore = old + points; desc = points >= 0 ? `+${points}` : String(points); } // add (supports negative too)
  await db.exec('UPDATE event_participants SET score=? WHERE event_id=? AND user_id=?', [newScore, id, p.user_id]);
  await interaction.reply({ content: `**#${id} ${ev.name}** — ${participantLabel(p)}: ${old} → **${newScore}** pts (${desc}).` });
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
    return `${medal} ${participantLabel(r)} — **${r.score}** pts`;
  });
  const e = base({ title: `Leaderboard — #${ev.id} ${ev.name}`, description: lines.join('\n').slice(0, 4000), color: theme.colors.brand, mod: 'event' });
  e.addFields({ name: 'Status', value: ev.status, inline: true }, { name: 'Participants shown', value: String(rows.length), inline: true });
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

function joinLeaveRow(ev) {
  const open = ev.status === 'OPEN';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`evt_j:${ev.id}`).setLabel('Join Event').setStyle(ButtonStyle.Success).setDisabled(!open),
    new ButtonBuilder().setCustomId(`evt_l:${ev.id}`).setLabel('Leave Event').setStyle(ButtonStyle.Danger).setDisabled(!open)
  );
  return [row];
}

async function joinEvent(interaction, id) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  if (ev.status !== 'OPEN') return interaction.reply({ content: `**#${ev.id} ${ev.name}** is closed.`, ephemeral: true });
  const u = interaction.user;
  const displayName = interaction.member?.displayName || u.globalName || u.username || u.tag;
  const existing = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, u.id]);
  if (existing) {
    const okDup = await refreshOverview(interaction, id);
    const noteDup = { content: `You are already in **#${ev.id} ${ev.name}** (${existing.score} pts).`, ephemeral: true };
    return okDup ? interaction.followUp(noteDup).catch(() => {}) : interaction.reply(noteDup).catch(() => {});
  }
  await db.exec('INSERT OR IGNORE INTO event_participants (event_id, user_id, user_tag, display_name, score, joined_at) VALUES (?,?,?,?,?,?)', [id, u.id, u.tag, displayName, 0, Date.now()]);
  const cnt = await db.get('SELECT COUNT(*) as c FROM event_participants WHERE event_id=?', [id]).catch(() => ({ c: 0 }));
  const ok = await refreshOverview(interaction, id);
  const note = { content: `Joined **#${ev.id} ${ev.name}** as ${displayName}. ${Number(cnt?.c || 0)} participant(s) now.`, ephemeral: true };
  return ok ? interaction.followUp(note).catch(() => {}) : interaction.reply(note).catch(() => {});
}

async function leaveEvent(interaction, id) {
  if (!interaction.guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
  const ev = await getEvent(id, interaction.guildId);
  if (!ev) return interaction.reply({ content: `Event #${id} not found.`, ephemeral: true });
  const u = interaction.user;
  const existing = await db.get('SELECT * FROM event_participants WHERE event_id=? AND user_id=?', [id, u.id]);
  if (!existing) {
    const okMissing = await refreshOverview(interaction, id);
    const noteMissing = { content: `You are not in **#${ev.id} ${ev.name}**.`, ephemeral: true };
    return okMissing ? interaction.followUp(noteMissing).catch(() => {}) : interaction.reply(noteMissing).catch(() => {});
  }
  await db.exec('DELETE FROM event_participants WHERE event_id=? AND user_id=?', [id, u.id]);
  const ok = await refreshOverview(interaction, id);
  const note = { content: `Left **#${ev.id} ${ev.name}**.`, ephemeral: true };
  return ok ? interaction.followUp(note).catch(() => {}) : interaction.reply(note).catch(() => {});
}

function register(ctx) {
  const buttons = async (interaction) => {
    try {
      const id = interaction.customId || '';
      const m = id.match(/^evt_([jl]):(\d+)$/);
      if (!m) return interaction.reply({ content: 'Unknown event control.', ephemeral: true }).catch(() => {});
      const eventId = parseInt(m[2], 10);
      return m[1] === 'j' ? await joinEvent(interaction, eventId) : await leaveEvent(interaction, eventId);
    } catch (err) {
      logger.error('event', 'button_error', { err, id: interaction.customId });
      const msg = { content: 'Event action failed. Try again.', ephemeral: true };
      if (interaction.deferred || interaction.replied) return interaction.editReply(msg).catch(() => {});
      return interaction.reply(msg).catch(() => {});
    }
  };
  buttons.name = name;
  ctx.router.registerPrefix('evt_', buttons);

  ctx.router.registerCommand('event', async (interaction) => {
    const sub = interaction.options.getSubcommand(false) || 'list';
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
