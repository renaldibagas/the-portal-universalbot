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
