const logger = require('./logger');

const prefixes = new Map(); // prefix -> handler module
const commands = new Map(); // commandName -> handler

function registerPrefix(prefix, handler) { prefixes.set(prefix, handler); }
function registerCommand(name, handler) { commands.set(name, handler); }

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (e) { logger.warn('router', 'reply_failed', { err: e }); }
}

async function handleInteraction(interaction, ctx) {
  try {
    if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
      const h = commands.get(interaction.commandName);
      if (h) return await h(interaction, ctx);
      if (!interaction.isAutocomplete()) await safeReply(interaction, { content: 'Unknown command.', ephemeral: true });
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const id = interaction.customId || '';
      for (const [prefix, h] of prefixes.entries()) {
        if (id.startsWith(prefix)) return await h(interaction, ctx);
      }
      await safeReply(interaction, { content: 'This control is from an older or unknown version.', ephemeral: true });
      return;
    }
  } catch (err) {
    logger.error('router', 'interaction_error', { err, id: interaction.customId, cmd: interaction.commandName });
    const msg = { content: 'Something went wrong. Try again in a moment.', ephemeral: true };
    try { await safeReply(interaction, msg); } catch {}
  }
}

async function handleMessage(message, ctx) {
  for (const [, h] of prefixes.entries()) {
    if (typeof h.onMessage === 'function') {
      try { await h.onMessage(message, ctx); } catch (e) { logger.error('router', 'message_error', { err: e, mod: h.name }); }
    }
  }
}

module.exports = { registerPrefix, registerCommand, handleInteraction, handleMessage };
