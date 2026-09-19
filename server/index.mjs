import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HttpError } from './cache.mjs';
import { createApiHandler, SECURITY_HEADERS } from './api.mjs';
import { TransitService } from './transit.mjs';
import { DemoService } from './demo.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const headers = SECURITY_HEADERS;

export function createApp({ demo = false, service = demo ? new DemoService() : new TransitService({ appKey: process.env.TFL_APP_KEY || '', nationalRailKey: process.env.NATIONAL_RAIL_API_KEY || '', nationalRailBase: process.env.NATIONAL_RAIL_API_BASE || '' }), staticRoot = defaultRoot } = {}) {
  const root = resolve(staticRoot);
  const handleApi = createApiHandler({ service, demo });
  const json = (res, status, value) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  return createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        throw new HttpError(405, 'Method not allowed.');
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const response = await handleApi({ method: req.method, url: url.href });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(req.method === 'HEAD' ? undefined : await response.text());
        return;
      }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid path.'); }
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) throw new HttpError(404, 'File not found.');
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${root}${sep}`)) throw new HttpError(404, 'File not found.');
      let info;
      try { info = await stat(file); } catch { throw new HttpError(404, 'File not found.'); }
      if (!info.isFile() || !mime[extname(file)]) throw new HttpError(404, 'File not found.');
      res.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      res.end(await readFile(file));
    } catch (cause) {
      const error = cause instanceof HttpError ? cause : new HttpError(cause instanceof URIError ? 400 : 500, cause instanceof URIError ? 'Invalid path.' : 'The request could not be completed.');
      if (res.headersSent) return res.destroy();
      json(res, error.status, { source: demo ? 'demo' : 'tfl', fetchedAt: null, stale: false, error: error.message, data: null });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const demo = process.env.DEMO_MODE === 'true' || process.argv.includes('--demo');
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const server = createApp({ demo });
  server.listen(port, host, () => console.log(`London Transit Live: http://${host}:${port} (${demo ? 'DEMO — illustrative samples only' : 'live TfL mode'})`));
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
