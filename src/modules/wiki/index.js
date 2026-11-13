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
  const t = setTimeout(() => ctrl.abort(), 8000);
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

async function search(query, limit = 5) {
  const key = 'search:' + norm(query);
  const cached = await cacheGet(key); if (cached) return cached;
  if (await negGet(key)) return [];
  try {
    const data = await api({ action: 'query', list: 'search', srsearch: query, srlimit: limit, srnamespace: 0 });
    const res = (data?.query?.search || []).map(s => ({ title: s.title, snippet: (s.snippet || '').replace(/<[^>]+>/g, ''), pageid: s.pageid }));
    if (!res.length) await negSet(key); else await cacheSet(key, res, 24 * 3600 * 1000);
    return res;
  } catch (e) { logger.warn('wiki', 'search_error', { err: e, query }); return cached || []; }
}

function parseInfobox(wikitext) {
  if (!wikitext) return { fields: {}, description: '', image: null };
  const m = wikitext.match(/\{\|\s*class="wikitable"[\s\S]*?\n\|\}/i) || wikitext.match(/\{\|[\s\S]*?\n\|\}/i);
  const fields = {}; let image = null;
  if (m) {
    const rows = m[0].split(/\n\|-/);
    for (const row of rows) {
      const km = row.match(/!\s*([^|!\n]+?)\s*\|/);
      const vm = row.match(/\|\s*([\s\S]*?)$/m);
      if (!km) continue;
      const key = km[1].replace(/style="[^"]*"/gi, '').replace(/colspan="[^"]*"/gi, '').trim().toLowerCase();
      let val = (vm ? vm[1] : '').trim();
      const img = val.match(/\[\[File:([^\]|]+)/i);
      if (img && !image) image = img[1].trim();
      val = val.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
      val = val.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+\n/g, '\n').trim();
      if (key) fields[key] = val.slice(0, 500);
    }
  }
  // description: first meaningful paragraph after infobox
  let desc = wikitext.replace(m ? m[0] : '', '').replace(/\{\{[^}]+\}\}/g, '').replace(/<[^>]+>/g, '').trim();
  desc = desc.split(/\n\n+/).find(p => p.trim().length > 20) || desc.slice(0, 400);
  desc = desc.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/'{2,}/g, '').trim().slice(0, 600);
  return { fields, description: desc, image };
}

async function getPage(title) {
  const key = 'page:' + norm(title);
  const cached = await cacheGet(key); if (cached) return cached;
  if (await negGet(key)) return null;
  try {
    const data = await api({ action: 'parse', page: title, prop: 'wikitext|displaytitle', redirects: 1 });
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
    const res = { title: parse.title || title, pageid: parse.pageid, fields: info.fields, description: info.description, imageUrl, url: `https://roblox-the-portal.fandom.com/wiki/${encodeURIComponent((parse.title || title).replace(/ /g, '_'))}` };
    await cacheSet(key, res, config.wikiTtlHours * 3600 * 1000, res.title, res.pageid);
    return res;
  } catch (e) { logger.warn('wiki', 'page_error', { err: e, title }); return null; }
}

async function resolve(query) {
  // exact -> search -> token truncation (per a010)
  let page = await getPage(query);
  if (page) return page;
  let results = await search(query, 5);
  if (results.length) { page = await getPage(results[0].title); if (page) return page; }
  const words = String(query).trim().split(/\s+/);
  if (words.length > 1) {
    results = await search(words.slice(0, -1).join(' '), 5);
    if (results.length) { page = await getPage(results[0].title); if (page) return page; }
  }
  results = await search(words[0], 5);
  if (results.length) { page = await getPage(results[0].title); if (page) return page; }
  return null;
}

function itemEmbed(page) {
  const e = base({ title: page.title, description: page.description || 'No description.', color: theme.colors.wiki, mod: 'wiki' });
  const f = page.fields || {};
  const pick = (keys) => keys.map(k => [k, f[k]]).find(([, v]) => v);
  const rows = [
    ['Category', pick(['category', 'type'])?.[1]],
    ['Tier', pick(['tier'])?.[1]],
    ['Rarity', pick(['rarity'])?.[1]],
    ['Buy', pick(['buy price', 'buy'])?.[1]],
    ['Sell', pick(['sell price', 'sell'])?.[1]],
    ['Slot', pick(['slot'])?.[1]],
  ].filter(([, v]) => v);
  for (const [n, v] of rows.slice(0, 6)) e.addFields({ name: n, value: String(v).slice(0, 200), inline: true });
  const obtain = pick(['how to obtain', 'obtain', 'source'])?.[1];
  if (obtain) e.addFields({ name: 'How to obtain', value: String(obtain).slice(0, 500), inline: false });
  if (page.imageUrl) e.setThumbnail(page.imageUrl);
  if (page.url) e.setURL(page.url);
  return e;
}

function register(ctx) {
  ctx.router.registerCommand('wiki', async (interaction) => {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();
    const page = await resolve(query);
    if (!page) { await interaction.editReply({ content: `No wiki page found for "${query}".` }); return; }
    await interaction.editReply({ embeds: [itemEmbed(page)] });
  });
  ctx.router.registerCommand('item', async (interaction) => {
    const query = interaction.options.getString('name', true);
    await interaction.deferReply();
    const page = await resolve(query);
    if (!page) { await interaction.editReply({ content: `No item found for "${query}".` }); return; }
    await interaction.editReply({ embeds: [itemEmbed(page)] });
  });
}

module.exports = { name, register, search, getPage, resolve };
