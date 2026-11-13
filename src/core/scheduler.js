const logger = require('./logger');

const jobs = [];
let timer = null;
let running = false;

function register(name, intervalMs, fn) {
  jobs.push({ name, intervalMs, fn, lastRun: 0, lastOk: null });
}

async function tick() {
  if (running) return; // overlap protection
  running = true;
  try {
    const now = Date.now();
    for (const job of jobs) {
      if (now - job.lastRun < job.intervalMs) continue;
      job.lastRun = now;
      try {
        await job.fn();
        job.lastOk = now;
      } catch (err) {
        logger.error('scheduler', 'job_error', { job: job.name, err });
      }
    }
  } finally {
    running = false;
  }
}

function start(baseIntervalMs = 15000) {
  if (timer) return;
  timer = setInterval(tick, baseIntervalMs);
  timer.unref?.();
  setTimeout(tick, 1000).unref?.(); // initial pass
  logger.info('scheduler', 'started', { baseIntervalMs, jobs: jobs.length });
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function status() { return jobs.map(j => ({ name: j.name, intervalMs: j.intervalMs, lastRun: j.lastRun, lastOk: j.lastOk })); }

module.exports = { register, start, stop, status };
