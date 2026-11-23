// The backup service's HTTP interface, kept apart from Cloudflare's runtime
// so it can be tested in Node.
//
//   POST /v1/signup          { username, password }          -> { username, token, recoveryCode }
//   POST /v1/login           { username, password }          -> { username, token }
//   POST /v1/recover         { username, recoveryCode, newPassword } -> { username, token, recoveryCode }
// With "Authorization: Bearer <token>":
//   GET  /v1/me                                              -> { username }
//   POST /v1/logout
//   POST /v1/password        { password, newPassword }       -> { username, token }
//   POST /v1/delete-account  { password }
//   GET  /v1/changes?since=N                                 -> { rev, more, items: [{ key, rev, value }] }
//   POST /v1/changes         { items: [{ key, value, baseRev }] } -> { revBefore, rev, written, conflicts }
//
// deps.accounts() is the accounts store and deps.store(userId) one
// account's backup; in Cloudflare they're Durable Objects.

export const MAX_BYTES = 1_900_000;
const MAX_ITEMS = 2000;
const MAX_ITEM_BYTES = 200_000;
const ITEM_KEY = /^(start|recent|[A-Za-z][A-Za-z ]{1,30} \d{1,3})$/;

function corsHeaders(origin, allowed) {
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !list.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/** Turn an accounts result into a response. */
function reply(result, cors) {
  if (result?.error) return json({ error: result.error, message: result.message }, result.status || 400, cors);
  const { ok, ...body } = result || {};
  return json(body, 200, cors);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BYTES) return { tooLarge: true };
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { bad: true };
  } catch {
    return { bad: true };
  }
}

function checkItems(items) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return 'Expected up to 2000 items';
  for (const item of items) {
    if (!item || typeof item !== 'object' || !ITEM_KEY.test(item.key || '')) return 'Bad item key';
    if (!Number.isInteger(item.baseRev) || item.baseRev < 0) return 'Bad baseRev';
    if (item.value !== null && (typeof item.value !== 'object' || Array.isArray(item.value))) return 'Bad item value';
    if (item.value !== null && JSON.stringify(item.value).length > MAX_ITEM_BYTES) return 'Item too large';
  }
  return null;
}

export async function handle(request, env, deps) {
  const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const address = request.headers.get('CF-Connecting-IP') || '';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (route === 'GET /') return new Response('Daf Yomi backup service\n', { headers: { 'Content-Type': 'text/plain', ...cors } });

  const open = ['POST /v1/signup', 'POST /v1/login', 'POST /v1/recover'];
  const signedIn = ['GET /v1/me', 'POST /v1/logout', 'POST /v1/password', 'POST /v1/delete-account', 'GET /v1/changes', 'POST /v1/changes'];
  if (!open.includes(route) && !signedIn.includes(route)) {
    const known = [...open, ...signedIn].some((r) => r.endsWith(` ${url.pathname}`));
    return json({ error: known ? 'Method not allowed' : 'Not found' }, known ? 405 : 404, cors);
  }

  let body = {};
  if (request.method === 'POST') {
    const parsed = await readJson(request);
    if (parsed.tooLarge) return json({ error: 'Too large' }, 413, cors);
    if (parsed.bad) return json({ error: 'Body is not a JSON object' }, 400, cors);
    body = parsed.body;
  }

  const accounts = deps.accounts();
  if (route === 'POST /v1/signup') return reply(await accounts.signup(body.username, body.password, address), cors);
  if (route === 'POST /v1/login') return reply(await accounts.login(body.username, body.password, address), cors);
  if (route === 'POST /v1/recover') return reply(await accounts.recover(body.username, body.recoveryCode, body.newPassword), cors);

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await accounts.verify(token);
  if (!user) return json({ error: 'signed_out', message: 'Please log in again.' }, 401, cors);

  switch (route) {
    case 'GET /v1/me':
      return json({ username: user.username }, 200, cors);
    case 'POST /v1/logout':
      return reply(await accounts.logout(token), cors);
    case 'POST /v1/password':
      return reply(await accounts.changePassword(user.id, body.password, body.newPassword), cors);
    case 'POST /v1/delete-account': {
      const result = await accounts.deleteAccount(user.id, body.password);
      if (result.ok) await deps.store(user.id).deleteAll();
      return reply(result, cors);
    }
    case 'GET /v1/changes': {
      const since = Number(url.searchParams.get('since') || 0);
      if (!Number.isInteger(since) || since < 0) return json({ error: 'Bad since' }, 400, cors);
      return json(await deps.store(user.id).changes(since), 200, cors);
    }
    case 'POST /v1/changes': {
      const problem = checkItems(body.items);
      if (problem) return json({ error: problem }, 400, cors);
      return json(await deps.store(user.id).write(body.items), 200, cors);
    }
    default:
      return json({ error: 'Not found' }, 404, cors);
  }
}
