const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../db');
const config = require('../../config');
const logger = require('../../core/logger');
const { base } = require('../../ui/embeds');
const theme = require('../../ui/theme');

const name = 'wiki';

async function api(params) {
  const url = new URL(config.wikiApiUrl);
  params.format = 'json'; params.formatversion = '2';
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ThePortalUniversalBot/1.0' } });
    if (!res.ok) throw new Error('wiki_http_' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

function now() { return Date.now(); }
function norm(s) { return String(s || '').trim().toLowerCase(); }

async function cacheGet(key) {
  const row = await db.get('SELECT * FROM wiki_cache WHERE key=?', [key]);
  if (!row) return null;
  if (row.expires_at < now()) return null;
  await db.exec('UPDATE wiki_cache SET hits=hits+1 WHERE key=?', [key]).catch(() => {});
  try { return JSON.parse(row.payload); } catch { return null; }
}
async function cacheSet(key, payload, ttlMs, title = null, pageId = null) {
  const ts = now();
  await db.exec('INSERT OR REPLACE INTO wiki_cache(key,page_id,title,payload,fetched_at,expires_at,hits) VALUES(?,?,?,?,?,?,COALESCE((SELECT hits FROM wiki_cache WHERE key=?),0))',
    [key, pageId, title, JSON.stringify(payload), ts, ts + ttlMs, key]);
}
async function negGet(key) {
  const row = await db.get('SELECT * FROM wiki_negative WHERE key=?', [key]);
  return row && row.expires_at >= now();
}
async function negSet(key) {
  await db.exec('INSERT OR REPLACE INTO wiki_negative(key,expires_at) VALUES(?,?)', [key, now() + config.wikiNegativeTtlMin * 60 * 1000]);
}

async function search(query, limit = 8) {
  const key = 'search:' + norm(query) + ':' + limit;
  const cached = await cacheGet(key); if (cached) return cached;
  try {
    const data = await api({ action: 'query', list: 'search', srsearch: query, srlimit: limit, srnamespace: 0 });
    const res = (data?.query?.search || []).map(s => ({ title: s.title, snippet: (s.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(), pageid: s.pageid }));
    if (!res.length) await negSet('searchneg:' + norm(query)); else await cacheSet(key, res, 24 * 3600 * 1000);
    return res;
  } catch (e) { logger.warn('wiki', 'search_error', { err: e, query }); return cached || []; }
}

function cleanWikiText(v) {
  return String(v || '')
    .replace(/\[\[File:[^\]]+\]\]/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/'{2,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseInfobox(wikitext) {
  if (!wikitext) return { fields: {}, description: '', image: null };
  const m = wikitext.match(/\{\|\s*class="[^"]*wikitable[^"]*"[\s\S]*?\n\|\}/i) || wikitext.match(/\{\|[\s\S]*?\n\|\}/i);
  const fields = {}; let image = null;
  if (m) {
    const rows = m[0].split(/\n\|-/);
    for (const row of rows) {
      const km = row.match(/!\s*([^|\n]+?)\s*(?:\||\n)/);
      const vm = row.match(/\n\|\s*([\s\S]*)$/);
      if (!km) continue;
      const key = cleanWikiText(km[1].replace(/style="[^"]*"/gi, '').replace(/colspan="[^"]*"/gi, '').replace(/rowspan="[^"]*"/gi, '')).toLowerCase();
      let rawVal = (vm ? vm[1] : '').trim();
      const img = rawVal.match(/\[\[File:([^\]|]+)/i);
      if (img && !image) image = img[1].trim();
      const val = cleanWikiText(rawVal).slice(0, 1000);
      if (key && val) {
        // keep first or append if duplicate key
        if (!fields[key]) fields[key] = val; else if (!fields[key].includes(val)) fields[key] = (fields[key] + '\n' + val).slice(0, 1000);
      }
    }
  }
  let desc = wikitext;
  if (m) desc = desc.replace(m[0], '');
  desc = desc.replace(/\{\{[^{}]*\}\}/g, '').replace(/__\w+__/g, '');
  const paras = desc.split(/\n\n+/).map(p => cleanWikiText(p)).filter(p => p.length > 25 && !/^=+/.test(p));
  const description = (paras.slice(0, 3).join('\n\n') || cleanWikiText(desc)).slice(0, 2000);
  return { fields, description, image };
}

async function getPage(title) {
  const key = 'page:' + norm(title);
  const cached = await cacheGet(key); if (cached) return cached;
  try {
    const data = await api({ action: 'parse', page: title, prop: 'wikitext|displaytitle|sections', redirects: 1 });
    if (data?.error) { await negSet(key); return null; }
    const parse = data.parse || {};
    const wt = typeof parse.wikitext === 'string' ? parse.wikitext : (parse.wikitext?.['*'] || '');
    const info = parseInfobox(wt);
    let imageUrl = null;
    if (info.image) {
      try {
        const id = await api({ action: 'query', titles: 'File:' + info.image, prop: 'imageinfo', iiprop: 'url' });
        const pages = id?.query?.pages || [];
        imageUrl = pages[0]?.imageinfo?.[0]?.url || null;
      } catch {}
    }
    // gather section headings for extra context
    const sections = (parse.sections || []).map(s => s.line).filter(Boolean).slice(0, 12);
    const res = { title: parse.title || title, pageid: parse.pageid, fields: info.fields, description: info.description, imageUrl, sections, url: `https://roblox-the-portal.fandom.com/wiki/${encodeURIComponent((parse.title || title).replace(/ /g, '_'))}` };
    await cacheSet(key, res, config.wikiTtlHours * 3600 * 1000, res.title, res.pageid);
    return res;
  } catch (e) { logger.warn('wiki', 'page_error', { err: e, title }); return null; }
}

async function resolve(query) {
  let page = await getPage(query);
  if (page) return page;
  let results = await search(query, 5);
  if (results.length) { page = await getPage(results[0].title); if (page) return page; }
  const words = String(query).trim().split(/\s+/);
  if (words.length > 1) {
    results = await search(words.slice(0, -1).join(' '), 5);
    if (results.length) { page = await getPage(results[0].title); if (page) return page; }
  }
  if (words[0] && words[0] !== query) {
    results = await search(words[0], 5);
    if (results.length) { page = await getPage(results[0].title); if (page) return page; }
  }
  return null;
}

async function suggest(query, limit = 5) {
  const seen = new Set();
  const out = [];
  const add = (arr) => { for (const r of (arr || [])) { const k = norm(r.title); if (!k || seen.has(k)) continue; seen.add(k); out.push(r); } };
  add(await search(query, limit));
  const words = String(query).trim().split(/\s+/);
  if (out.length < limit && words.length > 1) add(await search(words.slice(0, -1).join(' '), limit));
  if (out.length < limit && words[0]) add(await search(words[0], limit));
  return out.slice(0, limit);
}

function itemEmbed(page) {
  const e = base({ title: page.title, description: (page.description || 'No description available.').slice(0, 2000), color: theme.colors.wiki, mod: 'wiki' });
  const f = page.fields || {};
  const used = new Set();
  const pick = (keys) => {
    for (const k of keys) { const key = k.toLowerCase(); if (f[key]) { used.add(key); return [key, f[key]]; } }
    return null;
  };
  const rows = [
    ['Category', pick(['category', 'type', 'item type'])?.[1]],
    ['Tier', pick(['tier'])?.[1]],
    ['Rarity', pick(['rarity'])?.[1]],
    ['Slot', pick(['slot', 'equipment slot'])?.[1]],
    ['Buy', pick(['buy price', 'buy', 'price'])?.[1]],
    ['Sell', pick(['sell price', 'sell'])?.[1]],
    ['Level', pick(['level', 'level requirement', 'required level', 'req level'])?.[1]],
    ['Damage', pick(['damage', 'attack'])?.[1]],
    ['Defense', pick(['defense', 'defence', 'armor', 'armour'])?.[1]],
  ].filter(([, v]) => v);
  for (const [n, v] of rows.slice(0, 8)) e.addFields({ name: n, value: String(v).slice(0, 300), inline: true });

  const obtain = pick(['how to obtain', 'obtain', 'source', 'obtained from', 'dropped by', 'location'])?.[1];
  if (obtain) e.addFields({ name: 'How to obtain / Source', value: String(obtain).slice(0, 1024), inline: false });
  const stats = pick(['stats', 'effects', 'effect', 'bonuses', 'bonus', 'attributes'])?.[1];
  if (stats) e.addFields({ name: 'Stats / Effects', value: String(stats).slice(0, 1024), inline: false });
  const notes = pick(['notes', 'trivia', 'description'])?.[1];
  if (notes) e.addFields({ name: 'Notes', value: String(notes).slice(0, 512), inline: false });

  // include a few other non-empty infobox fields not yet shown
  const extras = [];
  for (const [k, v] of Object.entries(f)) {
    if (used.has(k)) continue;
    if (!v || String(v).length < 1) continue;
    extras.push([k, v]);
  }
  if (extras.length) {
    const text = extras.slice(0, 10).map(([k, v]) => `**${k.replace(/\b\w/g, c => c.toUpperCase())}:** ${String(v).slice(0, 120)}`).join('\n');
    e.addFields({ name: 'Other details', value: text.slice(0, 1024), inline: false });
  }

  if (page.sections && page.sections.length) e.addFields({ name: 'Sections', value: page.sections.slice(0, 12).join(' • ').slice(0, 512), inline: false });
  if (page.imageUrl) e.setThumbnail(page.imageUrl);
  if (page.url) e.setURL(page.url);
  return e;
}

function encodeTitle(title) {
  return Buffer.from(String(title), 'utf8').toString('base64url').slice(0, 90);
}
function decodeTitle(s) {
  try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch { return null; }
}

async function buildSuggestions(query) {
  const results = await suggest(query, 5);
  if (!results.length) return null;
  const rows = [];
  const row = new ActionRowBuilder();
  for (const r of results.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('wk_p:' + encodeTitle(r.title))
        .setLabel(String(r.title).slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
    );
  }
  rows.push(row);
  const e = base({ title: 'No exact match found', description: `I couldn't find a page for **"${String(query).slice(0, 150)}"**. Did you mean one of these?`, color: theme.colors.wiki, mod: 'wiki' });
  const list = results.map((r, i) => `${i + 1}. **${r.title}**${r.snippet ? ` — ${r.snippet.slice(0, 100)}` : ''}`).join('\n');
  e.addFields({ name: 'Suggestions', value: list.slice(0, 1024), inline: false });
  return { embeds: [e], components: rows };
}

function register(ctx) {
  const handler = async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('wk_p:')) {
      const title = decodeTitle(interaction.customId.slice(5));
      if (!title) return interaction.reply({ content: 'Could not read selection.', ephemeral: true }).catch(() => {});
      await interaction.deferUpdate().catch(() => {});
      const page = await getPage(title);
      if (!page) return interaction.editReply({ content: `Could not load "${title}".`, embeds: [], components: [] }).catch(() => {});
      return interaction.editReply({ content: null, embeds: [itemEmbed(page)], components: [] }).catch(() => {});
    }
  };
  handler.name = name;
  ctx.router.registerPrefix('wk_', handler);

  ctx.router.registerCommand('wiki', async (interaction) => {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();
    const page = await resolve(query);
    if (!page) {
      const sug = await buildSuggestions(query);
      if (sug) { await interaction.editReply(sug); return; }
      await interaction.editReply({ content: `No wiki page found for "${query}". Try different keywords.` });
      return;
    }
    await interaction.editReply({ embeds: [itemEmbed(page)] });
  });
  ctx.router.registerCommand('item', async (interaction) => {
    const query = interaction.options.getString('name', true);
    await interaction.deferReply();
    const page = await resolve(query);
    if (!page) {
      const sug = await buildSuggestions(query);
      if (sug) { await interaction.editReply(sug); return; }
      await interaction.editReply({ content: `No item found for "${query}". Try different keywords.` });
      return;
    }
    await interaction.editReply({ embeds: [itemEmbed(page)] });
  });
}

module.exports = { name, register, search, getPage, resolve, suggest };
