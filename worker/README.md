# Daf Yomi backup service

A small Cloudflare Worker that keeps an automatic backup of the app's record
(start, learned dafim, notes, passage reads) and lets several devices stay in
step. It runs on the owner's own Cloudflare account, well inside the free plan.

- One Durable Object per sync key, holding the latest backup and a revision
  number in SQLite. A Durable Object handles one request at a time, so "save
  only if nobody else has saved since revision N" is reliable.
- The sync key is a long random code made by the app and shared between
  devices with a link. Only a SHA-256 hash of it is used to find the backup.
- Browsers may only call it from the origins in `ALLOWED_ORIGINS`
  (`wrangler.toml`).

The API and its rules are in `src/handler.js` (tested by `test/worker.test.js`
in the main project); `src/index.js` adds the Durable Object.

## Running and deploying

```bash
npm install
npm run dev       # local copy on http://127.0.0.1:8787
```

To try the app against the local copy, run this in the browser console on
`http://localhost:8000` and reload:
`localStorage.setItem('daf-yomi:sync-url', 'http://127.0.0.1:8787')`.

Deploying needs a Cloudflare API token made from the "Edit Cloudflare Workers"
template, and the account ID:

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run deploy
```

The app finds the service at the address in `src/config.js`.
