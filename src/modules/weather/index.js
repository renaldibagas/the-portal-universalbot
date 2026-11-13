const { spawn } = require('child_process');
const path = require('path');
const config = require('../../config');
const logger = require('../../core/logger');
const health = require('../../core/health');
const { base } = require('../../ui/embeds');
const theme = require('../../ui/theme');

const name = 'weather';
let failCount = 0;
let disabled = false;

function fallbackEmbed(reason) {
  const e = base({ title: 'Weather', description: 'Weather card renderer unavailable. Showing fallback status.', color: theme.colors.weather, mod: 'weather' });
  e.addFields({ name: 'Status', value: String(reason || 'Renderer disabled/unavailable').slice(0, 300), inline: false });
  e.addFields({ name: 'Mode', value: config.liteMode ? 'LITE_MODE (text-only)' : 'Fallback', inline: true });
  return e;
}

async function renderCard(payload) {
  if (config.liteMode || disabled) return { ok: false, reason: 'disabled' };
  const script = path.join(process.cwd(), 'python', 'render_card.py');
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (done) return; done = true; clearTimeout(timer); resolve(res); };
    let child;
    try {
      child = spawn(config.pythonBin, [script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { return finish({ ok: false, reason: 'spawn_error', err: e }); }
    const out = []; const err = []; let outSize = 0;
    child.stdout.on('data', d => { outSize += d.length; if (outSize <= 8 * 1024 * 1024) out.push(d); });
    child.stderr.on('data', d => err.push(d));
    child.on('error', (e) => finish({ ok: false, reason: e.code === 'ENOENT' ? 'python_missing' : 'proc_error', err: e }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, reason: 'exit_' + code, stderr: Buffer.concat(err).toString('utf8').slice(0, 500) });
      finish({ ok: true, buffer: Buffer.concat(out) });
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish({ ok: false, reason: 'timeout' }); }, 10000);
    try { child.stdin.write(JSON.stringify(payload || {})); child.stdin.end(); } catch {}
  });
}

function register(ctx) {
  health.set({ renderer: config.liteMode ? 'lite' : 'unknown' });
  ctx.router.registerCommand('weather', async (interaction) => {
    await interaction.deferReply();
    if (config.liteMode) { await interaction.editReply({ embeds: [fallbackEmbed('LITE_MODE enabled')] }); return; }
    const res = await renderCard({ kind: 'weather' }).catch(e => ({ ok: false, reason: 'error', err: e }));
    if (!res.ok) {
      failCount++; if (failCount >= 2) disabled = true;
      health.set({ renderer: 'down' });
      await interaction.editReply({ embeds: [fallbackEmbed(res.reason || 'render_failed')] });
      return;
    }
    failCount = 0; disabled = false; health.set({ renderer: 'ok' });
    await interaction.editReply({ files: [{ attachment: res.buffer, name: 'weather.png' }] });
  });
}

module.exports = { name, register, renderCard };
