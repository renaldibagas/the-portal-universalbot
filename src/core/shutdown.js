const logger = require('./logger');
const tasks = [];

function register(name, fn) { tasks.push({ name, fn }); }

async function run(signal) {
  logger.info('core', 'shutdown_start', { signal, tasks: tasks.length });
  for (const t of tasks.reverse()) {
    try { await Promise.race([Promise.resolve(t.fn()), new Promise(r => setTimeout(r, 4000))]); }
    catch (e) { logger.error('core', 'shutdown_task_error', { task: t.name, err: e }); }
  }
  logger.info('core', 'shutdown_done', {});
}

function install() {
  let done = false;
  const handler = async (sig) => {
    if (done) return; done = true;
    try { await run(sig); } finally { process.exit(0); }
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('uncaughtException', (err) => { logger.error('core', 'uncaught_exception', { err }); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.error('core', 'unhandled_rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) }); });
}

module.exports = { register, install };
