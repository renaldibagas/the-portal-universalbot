/**
 * Stock message parser (ported from the-portal-stock, pure functions).
 */

function extractAllText(message) {
  if (!message) return '';
  const textParts = [];
  if (message.content) textParts.push(message.content);
  if (Array.isArray(message.embeds)) {
    for (const embed of message.embeds) {
      if (embed.title) textParts.push(embed.title);
      if (embed.description) textParts.push(embed.description);
      if (embed.author && embed.author.name) textParts.push(embed.author.name);
      if (embed.footer && embed.footer.text) textParts.push(embed.footer.text);
      if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
          if (field.name) textParts.push(field.name);
          if (field.value) textParts.push(field.value);
        }
      }
    }
  }
  return textParts.join('\n');
}

function findMatchingItems(fullText, targetItems) {
  if (!fullText || !Array.isArray(targetItems)) return [];
  const lowerText = String(fullText).toLowerCase();
  const matched = [];
  for (const item of targetItems) {
    if (item && lowerText.includes(String(item).toLowerCase())) matched.push(item);
  }
  return matched;
}

function parseMerchants(message, targetItems = []) {
  if (!message || !Array.isArray(message.embeds)) return [];
  const merchants = [];
  for (const embed of message.embeds) {
    if (!embed.title) continue;
    const title = String(embed.title).trim();
    const titleParts = title.split('-').map(s => s.trim());
    const name = titleParts[0] || title;
    const rawStatus = titleParts[1] || 'Unknown';
    const isOpen = rawStatus.toLowerCase() === 'open';
    const desc = embed.description || '';
    const restockMatch = desc.match(/Next restock <t:(\d+):[A-Za-z]>/i);
    const opensMatch = desc.match(/Opens <t:(\d+):[A-Za-z]>/i);
    const nextRestockTimestamp = restockMatch ? restockMatch[1] : null;
    const opensTimestamp = opensMatch ? opensMatch[1] : null;
    const cleanItemsText = desc
      .replace(/\n\nNext restock <t:\d+:[A-Za-z]>/gi, '')
      .replace(/Opens <t:\d+:[A-Za-z]>/gi, '')
      .trim();
    const items = cleanItemsText.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('Opens <t:'));
    const normalizedSignature = items.map(item => item.replace(/[*_~`]/g, '').toLowerCase().trim()).sort().join('|');
    const matchedTargetItems = isOpen ? findMatchingItems(cleanItemsText, targetItems) : [];
    merchants.push({ name, title, status: rawStatus, isOpen, items, cleanItemsText, inventorySignature: normalizedSignature, nextRestockTimestamp, opensTimestamp, matchedTargetItems });
  }
  return merchants;
}

module.exports = { extractAllText, findMatchingItems, parseMerchants };
