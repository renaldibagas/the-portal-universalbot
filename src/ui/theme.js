module.exports = {
  colors: {
    brand: 0x5865F2,
    auction: 0x5865F2,
    stock: 0x57F287,
    stockWarn: 0xFEE75C,
    danger: 0xED4245,
    weather: 0x9B59B6,
    wiki: 0x00A8FC,
    neutral: 0x2B2D31,
    success: 0x57F287,
    warning: 0xFEE75C,
  },
  footer: (mod, ctx) => `The Portal • ${mod}${ctx ? ' • ' + ctx : ''}`,
};
