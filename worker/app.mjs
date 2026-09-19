import { createApiHandler, SECURITY_HEADERS, errorResponse, jsonResponse } from '../server/api.mjs';
import { TflService } from '../server/tfl.mjs';
import { DemoService } from '../server/demo.mjs';
import { HttpError } from '../server/cache.mjs';

export function createWorker({ assets, serviceFactory = ({ demo, appKey }) => demo
  ? new DemoService() : new TflService({ appKey }) }) {
  let activeConfig, api;
  return {
    async fetch(request, env = {}, ctx = {}) {
      const config = { demo: env.DEMO_MODE === 'true', appKey: env.TFL_APP_KEY || '' };
      try {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
          if (!api || activeConfig.demo !== config.demo || activeConfig.appKey !== config.appKey) {
            activeConfig = config;
            api = createApiHandler({ service: serviceFactory(config), demo: config.demo });
          }
          const pending = api(request);
          // Preserve completion of a shared upstream request if its first
          // browser disconnects while another request is waiting on it.
          ctx.waitUntil?.(pending.then(() => undefined, () => undefined));
          return await pending;
        }
        if (!['GET', 'HEAD'].includes(request.method)) return jsonResponse(405,
          { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
        const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        if (path.includes('\0') || path.includes('\\') || path.split('/').some(part => part.startsWith('.')))
          throw new HttpError(404, 'File not found.');
        const asset = Object.hasOwn(assets, path) ? assets[path] : null;
        if (!asset) throw new HttpError(404, 'File not found.');
        return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
          ...SECURITY_HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'no-cache',
        } });
      } catch (error) { return errorResponse(error, config.demo); }
    },
  };
}
