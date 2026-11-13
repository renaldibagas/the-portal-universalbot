const http = require('http');
const logger = require('./logger');
const health = require('./health');

function start(port, { onStockIngest } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/readyz')) {
        const body = JSON.stringify(health.get());
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/ingest/stock' && typeof onStockIngest === 'function') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 65536) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const raw = Buffer.concat(chunks).toString('utf8');
        const sig = req.headers['x-portal-signature'] || '';
        const result = await onStockIngest(raw, sig, req.headers);
        res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body || { ok: true }));
        return;
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      logger.error('http', 'request_error', { err: e, path: req.url });
      if (!res.headersSent) res.writeHead(500);
      res.end('error');
    }
  });
  server.listen(port, () => logger.info('http', 'listening', { port }));
  return server;
}

module.exports = { start };
