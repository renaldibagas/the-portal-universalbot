const { EmbedBuilder } = require('discord.js');
const theme = require('./theme');

function base({ title, description, color, mod, ctx, timestamp = false }) {
  const e = new EmbedBuilder().setColor(color || theme.colors.brand);
  if (title) e.setTitle(String(title).slice(0, 256));
  if (description) e.setDescription(String(description).slice(0, 4096));
  e.setFooter({ text: theme.footer(mod || 'bot', ctx) });
  if (timestamp) e.setTimestamp();
  return e;
}

function errorEmbed(message, { mod = 'bot', id } = {}) {
  return base({
    title: 'Something went wrong',
    description: String(message || 'Try again in a moment.').slice(0, 1000),
    color: theme.colors.danger,
    mod,
    ctx: id ? `ref ${id}` : undefined,
  });
}

function emptyEmbed(title, description, mod = 'bot') {
  return base({ title, description, color: theme.colors.neutral, mod });
}

module.exports = { base, errorEmbed, emptyEmbed, theme };
