const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMerchants, extractAllText, findMatchingItems } = require('../src/modules/stock/parser');

test('extractAllText includes embed content', () => {
  const text = extractAllText({ content: 'hi', embeds: [{ title: 'Arlette - Open', description: 'Corn Seeds x1' }] });
  assert.match(text, /Arlette/);
  assert.match(text, /Corn Seeds/);
});

test('findMatchingItems is case-insensitive', () => {
  const m = findMatchingItems('Corn Seeds and Fish', ['corn seeds', 'Warden Leggings']);
  assert.deepEqual(m, ['corn seeds']);
});

test('parseMerchants parses open merchant and targets', () => {
  const msg = {
    embeds: [{
      title: 'Arlette - Open',
      description: '⭐ **Corn Seeds**\nBread\n\nNext restock <t:1787568300:R>'
    }]
  };
  const merchants = parseMerchants(msg, ['Corn Seeds']);
  assert.equal(merchants.length, 1);
  assert.equal(merchants[0].name, 'Arlette');
  assert.equal(merchants[0].isOpen, true);
  assert.equal(merchants[0].nextRestockTimestamp, '1787568300');
  assert.deepEqual(merchants[0].matchedTargetItems, ['Corn Seeds']);
});

test('parseMerchants handles closed merchant', () => {
  const msg = { embeds: [{ title: 'Breda - Idle', description: 'Opens <t:1787568300:R>' }] };
  const merchants = parseMerchants(msg, ['Corn Seeds']);
  assert.equal(merchants[0].isOpen, false);
  assert.equal(merchants[0].opensTimestamp, '1787568300');
});
