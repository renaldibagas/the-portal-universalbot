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
  const row = await db.get('SELECT * FROM wiki_cache WHERE key=?', [key]).catch(() => null);
  if (!row) return null;
  if (row.expires_at < now()) return null;
  await db.exec('UPDATE wiki_cache SET hits=hits+1 WHERE key=?', [key]).catch(() => {});
  try { return JSON.parse(row.payload); } catch { return null; }
}
async function cacheSet(key, payload, ttlMs, title = null, pageId = null) {
  const ts = now();
  await db.exec('INSERT OR REPLACE INTO wiki_cache(key,page_id,title,payload,fetched_at,expires_at,hits) VALUES(?,?,?,?,?,?,COALESCE((SELECT hits FROM wiki_cache WHERE key=?),0))',
    [key, pageId, title, JSON.stringify(payload), ts, ts + ttlMs, key]).catch(() => {});
}
async function negGet(key) {
  const row = await db.get('SELECT * FROM wiki_negative WHERE key=?', [key]).catch(() => null);
  return row && row.expires_at >= now();
}
async function negSet(key) {
  await db.exec('INSERT OR REPLACE INTO wiki_negative(key,expires_at) VALUES(?,?)', [key, now() + (config.wikiNegativeTtlMin || 60) * 60 * 1000]).catch(() => {});
}

async function search(query, limit = 8) {
  const key = 'search2:' + norm(query) + ':' + limit;
  const cached = await cacheGet(key); if (cached) return cached;
  try {
    const data = await api({ action: 'query', list: 'search', srsearch: query, srlimit: limit, srnamespace: 0 });
    const res = (data?.query?.search || []).map(s => ({ title: s.title, snippet: (s.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(), pageid: s.pageid }));
    if (res.length) await cacheSet(key, res, 24 * 3600 * 1000); else await negSet('sneg:' + norm(query));
    return res;
  } catch (e) { logger.warn('wiki', 'search_error', { err: e, query }); return cached || []; }
}

function stripFiles(s) {
  return String(s || '').replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
}

function convertTablesToText(text, maxRows = 12) {
  let s = String(text || '');
  // handle each wikitable block
  s = s.replace(/\{\|[\s\S]*?\|\}/g, (table) => {
    const rows = table.split(/\n\|-/).map(r => r.trim()).filter(Boolean);
    const parsed = [];
    let headers = null;
    for (let row of rows) {
      if (/^\{\|/.test(row)) row = row.replace(/^\{\|[^\n]*\n?/, '');
      if (/^\|\}/.test(row)) continue;
      const cells = [];
      const lines = row.split('\n');
      let isHeaderRow = false;
      for (const line of lines) {
        const l = line.trim();
        if (!l || /^\{\|/.test(l) || /^\|\}/.test(l)) continue;
        if (/^!/.test(l)) {
          isHeaderRow = true;
          const parts = l.replace(/^!+/, '').split(/!!|\|/);
          const cellText = cleanCell(parts[parts.length - 1] || '');
          if (cellText) cells.push(cellText);
        } else if (/^\|/.test(l)) {
          const raw = l.replace(/^\|+/, '');
          let val = raw;
          const attrMatch = raw.match(/^\s*(?:style|colspan|rowspan|class|align)="[^"]*"\s*\|\s*([\s\S]*)$/i);
          if (attrMatch) val = attrMatch[1];
          const cellText = cleanCell(val);
          if (cellText) cells.push(cellText);
        }
      }
      if (!cells.length) continue;
      if (isHeaderRow && !headers) headers = cells;
      else parsed.push(cells);
    }
    if (!parsed.length && !headers) return '';
    const linesOut = [];
    for (let i = 0; i < parsed.length && i < maxRows; i++) {
      const row = parsed[i];
      if (headers && headers.length) {
        const parts = row.map((c, idx) => {
          const h = headers[idx] || headers[headers.length - 1] || `Col ${idx + 1}`;
          return `**${h}:** ${c}`;
        });
        linesOut.push('• ' + parts.join(' | '));
      } else {
        linesOut.push('• ' + row.join(' — '));
      }
    }
    if (parsed.length > maxRows) linesOut.push(`• …and ${parsed.length - maxRows} more`);
    return linesOut.join('\n');
  });
  return s;
}

function cleanWikiText(v, opts = {}) {
  let s = String(v || '');
  const maxRows = Number.isFinite(opts.maxRows) ? opts.maxRows : 12;
  s = convertTablesToText(s, maxRows);
  s = stripFiles(s);
  s = s.replace(/\[\[Category:[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/<br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<ref[^>]*\/>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/^----+\s*$/gm, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/'{2,}/g, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function cleanCell(raw) {
  let s = String(raw || '');
  s = s.replace(/<br\s*\/?\s*>/gi, '\n');
  s = stripFiles(s);
  s = s.replace(/\[\[Category:[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^>]*\/>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/'{2,}/g, '');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function pickMainImageFromInfobox(boxText) {
  const files = [];
  const re = /\[\[File:([^\]|#]+)(?:[^\]]*)\]\]/gi;
  let m;
  while ((m = re.exec(boxText))) files.push({ name: m[1].trim(), raw: m[0], idx: m.index });
  if (!files.length) return null;
  const scored = files.map((f, i) => {
    let score = 0;
    if (/icon|tria|coin|gold|silver/i.test(f.name)) score -= 6;
    if (/px/.test(f.raw)) {
      const pm = f.raw.match(/(\d+)\s*px/i);
      if (pm) {
        const px = parseInt(pm[1], 10);
        score += Math.min(6, px / 40);
        if (px <= 32) score -= 5;
      }
    } else {
      score += 3;
    }
    if (i === 0) score += 2;
    return { ...f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].name;
}

function parseInfoboxTable(boxText) {
  const fields = {};
  if (!boxText) return { fields, image: null };
  const image = pickMainImageFromInfobox(boxText);
  const rows = boxText.split(/\n\|-/);
  for (const row of rows) {
    const lines = row.split('\n').map(l => l.replace(/\r$/, ''));
    let key = null;
    let value = null;
    for (const line of lines) {
      if (/^\|\}/.test(line.trim())) continue;
      if (/^!/.test(line)) {
        const parts = line.replace(/^!/, '').split('|');
        key = cleanCell(parts[parts.length - 1] || '');
      } else if (/^\|/.test(line)) {
        const raw = line.replace(/^\|/, '');
        let valRaw = raw;
        const attrMatch = raw.match(/^\s*(?:style|colspan|rowspan|class|align)="[^"]*"\s*\|\s*([\s\S]*)$/i);
        if (attrMatch) valRaw = attrMatch[1];
        const cleaned = cleanCell(valRaw);
        if (cleaned) value = value ? (value + '\n' + cleaned) : cleaned;
      }
    }
    if (key && value) {
      const k = norm(key);
      if (!k || k.length > 60) continue;
      if (!fields[k]) fields[k] = value.slice(0, 1200);
      else if (!fields[k].includes(value)) fields[k] = (fields[k] + '\n' + value).slice(0, 1200);
    }
  }
  return { fields, image };
}

function extractSections(wikitext) {
  const text = String(wikitext || '');
  const re = /^==+\s*([^=]+?)\s*==+\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(text))) matches.push({ title: m[1].trim(), index: m.index, start: m.index + m[0].length });
  const out = {};
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(cur.start, end).trim();
    out[norm(cur.title)] = { title: cur.title, raw: body, text: cleanWikiText(body, { maxRows: 400 }).slice(0, 16000) };
  }
  return out;
}

function summarizeLead(wikitext, infoboxMatch) {
  let s = String(wikitext || '');
  if (infoboxMatch) s = s.replace(infoboxMatch, '');
  s = s.replace(/\{\{DISPLAYTITLE:[^}]+\}\}/gi, '');
  s = s.replace(/^----+\s*$/gm, '');
  const secIdx = s.search(/^==+\s*[^=]+?\s*==+\s*$/m);
  if (secIdx >= 0) s = s.slice(0, secIdx);
  const cleaned = cleanWikiText(s);
  const paras = cleaned.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 8);
  return paras.slice(0, 2).join('\n\n').slice(0, 1200);
}

async function getPage(title) {
  const key = 'page3:' + norm(title);
  const cached = await cacheGet(key); if (cached) return cached;
  try {
    const data = await api({ action: 'parse', page: title, prop: 'wikitext|sections|displaytitle', redirects: 1 });
    if (data?.error) { await negSet('pneg:' + norm(title)); return null; }
    const parse = data.parse || {};
    const wt = typeof parse.wikitext === 'string' ? parse.wikitext : (parse.wikitext?.['*'] || '');
    const box = wt.match(/\{\|\s*class="[^"]*wikitable[^"]*"[\s\S]*?\n\|\}/i) || wt.match(/\{\|[\s\S]*?\n\|\}/i);
    const info = box ? parseInfoboxTable(box[0]) : { fields: {}, image: null };
    const sections = extractSections(wt);
    const lead = summarizeLead(wt, box ? box[0] : null);
    const descSection = sections['description']?.text || '';
    const description = (lead + (lead && descSection ? '\n\n' : '') + descSection).trim().slice(0, 1800) || 'No description available.';

    let imageUrl = null;
    if (info.image) {
      try {
        const id = await api({ action: 'query', titles: 'File:' + info.image, prop: 'imageinfo', iiprop: 'url' });
        const pages = id?.query?.pages || [];
        imageUrl = pages[0]?.imageinfo?.[0]?.url || null;
      } catch {}
    }

    const sectionList = (parse.sections || []).map(s => s.line).filter(Boolean).slice(0, 15);
    const detailSections = {};
    const preferred = ['how to obtain', 'used in', 'stats', 'effects', 'notes', 'trivia', 'recipe', 'recipes', 'crafting', 'upgrade', 'upgrades', 'drops'];
    for (const keyName of preferred) {
      if (sections[keyName]?.text) detailSections[keyName] = sections[keyName].text;
    }
    for (const [k, v] of Object.entries(sections)) {
      if (detailSections[k]) continue;
      if (v.text && v.text.length > 20) detailSections[k] = v.text.slice(0, 6000);
    }

    const res = {
      title: parse.title || title,
      pageid: parse.pageid,
      fields: info.fields,
      description,
      imageUrl,
      sections: sectionList,
      detailSections,
      url: `https://roblox-the-portal.fandom.com/wiki/${encodeURIComponent((parse.title || title).replace(/ /g, '_'))}`
    };
    await cacheSet(key, res, (config.wikiTtlHours || 168) * 3600 * 1000, res.title, res.pageid);
    return res;
  } catch (e) { logger.warn('wiki', 'page_error', { err: e, title }); return null; }
}

// Resolve only on an exact page hit (redirects included). Anything ambiguous falls
// through to the suggestion picker so the user chooses the page themselves.
async function resolve(query) {
  return await getPage(query);
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

function encodeTitle(title) {
  return Buffer.from(String(title), 'utf8').toString('base64url').slice(0, 80);
}
function decodeTitle(s) {
  try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch { return null; }
}

const SECTION_BUTTONS = [
  { key: 'how to obtain', label: 'How to Obtain', code: 'ob' },
  { key: 'used in', label: 'Used In', code: 'ui' },
  { key: 'stats', label: 'Stats', code: 'st' },
  { key: 'effects', label: 'Effects', code: 'ef' },
  { key: 'recipe', label: 'Recipe', code: 'rc' },
  { key: 'recipes', label: 'Recipes', code: 'rs' },
  { key: 'crafting', label: 'Crafting', code: 'cr' },
  { key: 'drops', label: 'Drops', code: 'dr' },
  { key: 'trivia', label: 'Trivia', code: 'tr' },
  { key: 'notes', label: 'Notes', code: 'no' },
];

function findSectionCode(key) {
  const k = norm(key);
  const found = SECTION_BUTTONS.find(b => b.key === k);
  if (found) return found;
  return { key: k, label: k.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80), code: 'x_' + Buffer.from(k).toString('base64url').slice(0, 10) };
}
function resolveSectionCode(code, detailSections) {
  const direct = SECTION_BUTTONS.find(b => b.code === code);
  if (direct) return direct.key;
  if (code && code.startsWith('x_')) {
    const enc = code.slice(2);
    try {
      const k = Buffer.from(enc, 'base64url').toString('utf8');
      if (detailSections && detailSections[k] != null) return k;
    } catch {}
    for (const k of Object.keys(detailSections || {})) {
      if (Buffer.from(k).toString('base64url').slice(0, 10) === enc) return k;
    }
  }
  return null;
}

function itemEmbed(page, { compact = true } = {}) {
  const f = page.fields || {};
  const details = page.detailSections || {};
  const used = new Set();
  const pick = (keys) => {
    for (const k of keys) {
      const kk = norm(k);
      if (f[kk]) { used.add(kk); return [kk, f[kk]]; }
    }
    return null;
  };

  const keyRows = [
    ['Category', pick(['category', 'type', 'item type'])?.[1]],
    ['Tier', pick(['tier'])?.[1]],
    ['Rarity', pick(['rarity'])?.[1]],
    ['Stack', pick(['stack limit', 'stack', 'max stack'])?.[1]],
    ['Slot', pick(['slot', 'equipment slot'])?.[1]],
    ['Buy', pick(['buy price', 'buy', 'price', 'cost'])?.[1]],
    ['Sell', pick(['sell price', 'sell'])?.[1]],
    ['Level', pick(['level', 'level requirement', 'required level', 'req level'])?.[1]],
  ].filter(([, v]) => v);

  const desc = (page.description || 'No description available.').slice(0, compact ? 900 : 1800);
  const e = base({ title: page.title, description: desc, color: theme.colors.wiki, mod: 'wiki' });
  for (const [n, v] of keyRows.slice(0, 10)) e.addFields({ name: n, value: String(v).slice(0, 250), inline: true });

  if (compact) {
    // overview keeps only the description + key stats; detail sections live behind buttons
  } else {
    for (const [k, v] of Object.entries(details)) {
      if (!v) continue;
      const label = k.replace(/\b\w/g, c => c.toUpperCase());
      e.addFields({ name: label.slice(0, 256), value: String(v).slice(0, 1024), inline: false });
    }
  }

  const extras = [];
  for (const [k, v] of Object.entries(f)) {
    if (used.has(k)) continue;
    if (!v) continue;
    extras.push([k, v]);
  }
  if (extras.length) {
    const text = extras.slice(0, 8).map(([k, v]) => `**${k.replace(/\b\w/g, c => c.toUpperCase())}:** ${String(v).slice(0, 120)}`).join('\n');
    if (text) e.addFields({ name: 'More info', value: text.slice(0, 1024), inline: false });
  }

  if (page.imageUrl) e.setThumbnail(page.imageUrl);
  if (page.url) e.setURL(page.url);
  return e;
}

function detailButtons(page) {
  const details = page.detailSections || {};
  const tEnc = encodeTitle(page.title);
  const btns = [];
  const prefer = ['how to obtain', 'used in', 'stats', 'effects', 'recipe', 'recipes', 'crafting', 'drops', 'trivia', 'notes'];
  const added = new Set();
  for (const k of prefer) {
    if (!details[k]) continue;
    const b = findSectionCode(k);
    btns.push(new ButtonBuilder().setCustomId(`wk_s:${b.code}:${tEnc}`).setLabel(b.label.slice(0, 80)).setStyle(ButtonStyle.Primary));
    added.add(k);
    if (btns.length >= 4) break;
  }
  for (const k of Object.keys(details)) {
    if (added.has(k) || btns.length >= 4) continue;
    const b = findSectionCode(k);
    btns.push(new ButtonBuilder().setCustomId(`wk_s:${b.code}:${tEnc}`).setLabel(b.label.slice(0, 80)).setStyle(ButtonStyle.Secondary));
    added.add(k);
  }
  if (!btns.length) return [];
  return [new ActionRowBuilder().addComponents(btns.slice(0, 5))];
}

async function buildSuggestions(query) {
  const results = await suggest(query, 8);
  if (!results.length) return null;
  const row = new ActionRowBuilder();
  const ranked = [...results].sort((a, b) => {
    const q = norm(query);
    const score = (t) => { const n = norm(t); return n === q ? 0 : n.startsWith(q) ? 1 : 2; };
    return score(a.title) - score(b.title);
  });
  for (const r of ranked.slice(0, 5)) {
    row.addComponents(new ButtonBuilder().setCustomId('wk_p:' + encodeTitle(r.title)).setLabel(String(r.title).slice(0, 80)).setStyle(ButtonStyle.Secondary));
  }
  const e = base({ title: 'Which page do you want?', description: `No page is titled exactly **"${String(query).slice(0, 150)}"**. Pick one of these matches:`, color: theme.colors.wiki, mod: 'wiki' });
  const list = ranked.map((r, i) => `${i + 1}. **${r.title}**${r.snippet ? ` — ${r.snippet.slice(0, 120)}` : ''}`).join('\n');
  e.addFields({ name: 'Matches', value: list.slice(0, 1024), inline: false });
  return { embeds: [e], components: [row] };
}

function chunkText(text, limit = 3900) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function sectionEmbeds(page, sectionKey) {
  const details = page.detailSections || {};
  const text = details[sectionKey];
  const label = sectionKey.replace(/\b\w/g, c => c.toUpperCase());
  const chunks = chunkText(text || 'No details available for this section.');
  return chunks.slice(0, 10).map((chunk, i) => {
    const title = chunks.length > 1 ? `${page.title} — ${label} (${i + 1}/${chunks.length})` : `${page.title} — ${label}`;
    const e = base({ title, description: chunk, color: theme.colors.wiki, mod: 'wiki' });
    if (i === 0 && page.imageUrl) e.setThumbnail(page.imageUrl);
    if (page.url) e.setURL(page.url + '#' + encodeURIComponent(label.replace(/ /g, '_')));
    return e;
  });
}

function register(ctx) {
  const handler = async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId.startsWith('wk_p:')) {
        const title = decodeTitle(interaction.customId.slice(5));
        if (!title) return interaction.reply({ content: 'Could not read selection.', ephemeral: true }).catch(() => {});
        await interaction.deferUpdate().catch(() => {});
        const page = await getPage(title);
        if (!page) return interaction.editReply({ content: `Could not load "${title}".`, embeds: [], components: [] }).catch(() => {});
        return interaction.editReply({ content: null, embeds: [itemEmbed(page, { compact: true })], components: detailButtons(page) }).catch(() => {});
      }
      if (interaction.isButton() && interaction.customId.startsWith('wk_s:')) {
        const rest = interaction.customId.slice(5);
        const idx = rest.indexOf(':');
        if (idx < 0) return interaction.reply({ content: 'Invalid selection.', ephemeral: true }).catch(() => {});
        const code = rest.slice(0, idx);
        const title = decodeTitle(rest.slice(idx + 1));
        if (!title) return interaction.reply({ content: 'Could not read selection.', ephemeral: true }).catch(() => {});
        await interaction.deferUpdate().catch(() => {});
        const page = await getPage(title);
        if (!page) return interaction.editReply({ content: `Could not load "${title}".`, embeds: [], components: [] }).catch(() => {});
        const secKey = resolveSectionCode(code, page.detailSections || {});
        if (!secKey || !(page.detailSections || {})[secKey]) {
          return interaction.editReply({ content: null, embeds: [itemEmbed(page, { compact: false })], components: detailButtons(page) }).catch(() => {});
        }
        const tEnc = encodeTitle(page.title);
        const rows = detailButtons(page);
        const overviewBtn = new ButtonBuilder().setCustomId('wk_o:' + tEnc).setLabel('Overview').setStyle(ButtonStyle.Secondary);
        let navRow;
        if (rows[0]) {
          const comps = rows[0].components.slice(0, 4);
          comps.push(overviewBtn);
          navRow = new ActionRowBuilder().addComponents(comps);
        } else {
          navRow = new ActionRowBuilder().addComponents(overviewBtn);
        }
        return interaction.editReply({ content: null, embeds: sectionEmbeds(page, secKey), components: [navRow] }).catch(() => {});
      }
      if (interaction.isButton() && interaction.customId.startsWith('wk_o:')) {
        const title = decodeTitle(interaction.customId.slice(5));
        if (!title) return interaction.reply({ content: 'Could not read selection.', ephemeral: true }).catch(() => {});
        await interaction.deferUpdate().catch(() => {});
        const page = await getPage(title);
        if (!page) return interaction.editReply({ content: `Could not load "${title}".`, embeds: [], components: [] }).catch(() => {});
        return interaction.editReply({ content: null, embeds: [itemEmbed(page, { compact: true })], components: detailButtons(page) }).catch(() => {});
      }
    } catch (e) {
      logger.error('wiki', 'interaction_error', { err: e, id: interaction.customId });
      try { if (interaction.deferred || interaction.replied) await interaction.editReply({ content: 'Wiki action failed.', embeds: [], components: [] }); else await interaction.reply({ content: 'Wiki action failed.', ephemeral: true }); } catch {}
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
      if (sug) { await interaction.editReply({ ...sug, content: null }); return; }
      await interaction.editReply({ content: `No wiki page found for "${query}". Try different keywords.` });
      return;
    }
    await interaction.editReply({ embeds: [itemEmbed(page, { compact: true })], components: detailButtons(page) });
  });
  ctx.router.registerCommand('item', async (interaction) => {
    const query = interaction.options.getString('name', true);
    await interaction.deferReply();
    const page = await resolve(query);
    if (!page) {
      const sug = await buildSuggestions(query);
      if (sug) { await interaction.editReply({ ...sug, content: null }); return; }
      await interaction.editReply({ content: `No item found for "${query}". Try different keywords.` });
      return;
    }
    await interaction.editReply({ embeds: [itemEmbed(page, { compact: true })], components: detailButtons(page) });
  });
}

module.exports = { name, register, search, getPage, resolve, suggest };
