// The backup service's request handling, kept apart from Cloudflare's
// runtime so it can be tested in Node.
//
//   GET  /v1/state   -> { rev, updated, data }   (rev 0 and data null if empty)
//   PUT  /v1/state   { baseRev, data } -> { rev, updated }
//                    or 409 with the stored { rev, updated, data } when the
//                    backup has changed since baseRev (another device saved).
//
// Every request carries "Authorization: Bearer <sync key>". The key is a long
// random code made by the app; whoever has it can read and write that backup,
// and nothing else. The key itself is never stored, only a hash of it.

export const MAX_BYTES = 1_900_000;
const KEY_PATTERN = /^[a-z0-9]{24,64}$/;

function corsHeaders(origin, allowed) {
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !list.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * openStore(key) returns { read(), write(baseRev, dataText) } for that key's
 * backup; write returns { rev, updated } or { conflict: true, rev, updated, data }.
 */
export async function handle(request, env, openStore) {
  const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
  const { pathname } = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (pathname === '/') return new Response('Daf Yomi backup service\n', { headers: { 'Content-Type': 'text/plain', ...cors } });
  if (pathname !== '/v1/state') return json({ error: 'Not found' }, 404, cors);

  const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!KEY_PATTERN.test(key)) return json({ error: 'Missing or malformed sync key' }, 401, cors);

  if (request.method === 'GET') {
    const store = await openStore(key);
    return json(await store.read(), 200, cors);
  }

  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: 'Backup too large' }, 413, cors);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Body is not JSON' }, 400, cors);
    }
    const { baseRev, data } = body || {};
    if (!Number.isInteger(baseRev) || baseRev < 0 || !data || typeof data !== 'object' || Array.isArray(data)) {
      return json({ error: 'Expected { baseRev, data }' }, 400, cors);
    }
    const store = await openStore(key);
    const result = await store.write(baseRev, JSON.stringify(data));
    if (result.conflict) {
      const { conflict, ...stored } = result;
      return json(stored, 409, cors);
    }
    return json(result, 200, cors);
  }

  return json({ error: 'Method not allowed' }, 405, cors);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
