const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('../config');

const commands = [
  new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Auction system')
    .addSubcommand(s => s.setName('status').setDescription('Show active auctions summary')),
  new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Stock tracker')
    .addSubcommand(s => s.setName('status').setDescription('Show merchant stock/dedupe state'))
    .addSubcommand(s => s.setName('menu').setDescription('Open target-role picker (choose targets to get ping roles)')),
  new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Show current weather (card or fallback)'),
  new SlashCommandBuilder()
    .setName('wiki')
    .setDescription('Search The Portal wiki')
    .addStringOption(o => o.setName('query').setDescription('Page/item/merchant name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('item')
    .setDescription('Look up an item on The Portal wiki')
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Host and manage server events')
    .addSubcommand(s => s.setName('create').setDescription('Create a new event')
      .addStringOption(o => o.setName('name').setDescription('Event name').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Event description').setRequired(false))
      .addStringOption(o => o.setName('starts').setDescription('Start time: HH:MM (UTC), YYYY-MM-DD HH:MM, ISO 8601, or unix seconds').setRequired(false)))
    .addSubcommand(s => s.setName('list').setDescription('List events in this server'))
    .addSubcommand(s => s.setName('info').setDescription('Show event details and participants')
      .addIntegerOption(o => o.setName('id').setDescription('Event ID').setRequired(true)))
    .addSubcommand(s => s.setName('add').setDescription('Add a player to an event (Discord user or external name)')
      .addIntegerOption(o => o.setName('id').setDescription('Event ID').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord user to add').setRequired(false))
      .addStringOption(o => o.setName('name').setDescription('Player name/username (for other platforms)').setRequired(false)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a player from an event')
      .addIntegerOption(o => o.setName('id').setDescription('Event ID').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord user to remove').setRequired(false))
      .addStringOption(o => o.setName('name').setDescription('Participant name (for external players)').setRequired(false)))
    .addSubcommand(s => s.setName('score').setDescription('Add, subtract, or set score for a participant')
      .addIntegerOption(o => o.setName('id').setDescription('Event ID').setRequired(true))
      .addIntegerOption(o => o.setName('points').setDescription('Points value').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord participant').setRequired(false))
      .addStringOption(o => o.setName('name').setDescription('Participant name (for external players)').setRequired(false))
      .addStringOption(o => o.setName('mode').setDescription('How to apply points').setRequired(false)
        .addChoices(
          { name: 'add (default)', value: 'add' },
          { name: 'subtract', value: 'subtract' },
          { name: 'set (exact)', value: 'set' }
        )))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Show event leaderboard')
      .addIntegerOption(o => o.setName('id').setDescription('Event ID').setRequired(true)))
    .addSubcommand(s => s.setName('close').setDescription('Close an event')
      .addIntegerOption(o => o.setName('id').setDescription('Event ID').setRequired(true))),
].map(c => c.toJSON());

async function main() {
  config.validate({ requireToken: true });
  const rest = new REST({ version: '10' }).setToken(config.token);
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`Deployed ${commands.length} guild commands to ${config.guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`Deployed ${commands.length} global commands`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
