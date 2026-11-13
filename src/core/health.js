let state = {
  startedAt: Date.now(),
  ready: false,
  db: 'unknown',
  gateway: 'unknown',
  renderer: 'unknown',
  lite: false,
  queues: {},
  stockLastSeen: null,
};

function set(patch) { Object.assign(state, patch); }
function get() {
  const mem = process.memoryUsage();
  return {
    ok: true,
    uptimeSec: Math.floor((Date.now() - state.startedAt) / 1000),
    ready: state.ready,
    db: state.db,
    gateway: state.gateway,
    renderer: state.renderer,
    lite: !!state.lite,
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapMB: Math.round(mem.heapUsed / 1024 / 1024),
    queues: state.quotes || state.queues || {},
    stockLastSeen: state.stockLastSeen,
  };
}

module.exports = { set, get };
