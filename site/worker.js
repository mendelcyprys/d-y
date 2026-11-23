// Serves the Daf Yomi app from Cloudflare: the same files as the GitHub
// Pages site, packed in by site/build.mjs. Browsers check back each time
// (cheaply, with ETags), so a new version shows up straight away.

import files from './files.js';

const HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const { pathname } = new URL(request.url);
    const file = files[pathname === '/' ? '/index.html' : pathname];
    if (!file) return new Response('Not found', { status: 404, headers: HEADERS });
    const headers = { ...HEADERS, 'Content-Type': file.type, ETag: file.etag };
    if (request.headers.get('If-None-Match') === file.etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : file.body, { headers });
  },
};
