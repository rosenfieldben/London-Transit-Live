import { HttpError, TokenBucket } from './cache.mjs';
import { ATTRIBUTION, MODES } from './tfl.mjs';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

export function jsonResponse(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...extraHeaders,
  } });
}

export function errorResponse(cause, demo = false) {
  const error = cause instanceof HttpError ? cause : new HttpError(
    cause instanceof URIError ? 400 : 500,
    cause instanceof URIError ? 'Invalid path.' : 'The request could not be completed.',
  );
  return jsonResponse(error.status, { source: demo ? 'demo' : 'tfl', fetchedAt: null,
    stale: false, error: error.message, data: null }, error.status === 429 ? { 'Retry-After': '10' } : {});
}

// Shared by the local Node server and the deployed Worker. The budget is local
// to this handler, not a global quota across multiple processes or isolates.
export function createApiHandler({ service, demo = false }) {
  const requests = new TokenBucket({ capacity: 60, perMinute: 120 });
  return async function handleApi(request) {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!['GET', 'HEAD'].includes(request.method)) {
        const response = errorResponse(new HttpError(405, 'Method not allowed.'), demo);
        response.headers.set('Allow', 'GET, HEAD');
        return response;
      }
      if (url.pathname === '/api/health') return request.method === 'HEAD'
        ? new Response(null, { headers: SECURITY_HEADERS }) : jsonResponse(200, { ok: true });
      if (request.method !== 'GET') throw new HttpError(405, 'API endpoints require GET.');
      if (!requests.take()) throw new HttpError(429, 'Too many requests. Please try again shortly.');
      if (url.pathname === '/api/config') return jsonResponse(200, { demo, modes: MODES, attribution: ATTRIBUTION });
      if (url.pathname === '/api/lines') return jsonResponse(200, await service.lines());
      const route = url.pathname.match(/^\/api\/lines\/([^/]+)\/route$/);
      if (route) return jsonResponse(200, await service.route(decodeURIComponent(route[1])));
      const arrivals = url.pathname.match(/^\/api\/stations\/([^/]+)\/arrivals$/);
      if (arrivals) return jsonResponse(200, await service.arrivals(decodeURIComponent(arrivals[1]), url.searchParams.get('lineId'), url.searchParams.get('mode')));
      throw new HttpError(404, 'API endpoint not found.');
    } catch (error) { return errorResponse(error, demo); }
  };
}
