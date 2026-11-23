# Daf Yomi backup service

A small Cloudflare Worker that holds accounts and keeps each account's
record (start, learned dafim, notes, passage reads) backed up, so the app
can keep several devices in step. It runs on the owner's Cloudflare account,
well inside the free plan.

- **Accounts** (`src/accounts.js`, one Durable Object for all of them):
  usernames and passwords (stored as PBKDF2-SHA256 hashes with a random
  salt), session tokens (only their hashes are stored; they last a year from
  last use), and a recovery code per account for resetting a forgotten
  password. Repeated failed attempts are slowed down.
- **Backups** (`src/store.js`, one Durable Object per account): the record in
  pieces, one per daf plus the starting point, each with the revision at
  which it was last saved. The app fetches only pieces changed since its
  last revision and sends only pieces it changed. A save names the revision
  each piece was based on; a piece someone else changed since is sent back
  instead, for the app to combine and resend. A Durable Object handles one
  request at a time, which makes this reliable.
- **The API** is in `src/handler.js`. Browsers may only call it from the
  origins in `ALLOWED_ORIGINS` (`wrangler.toml`).

All of this is tested in Node, on Node's built-in SQLite, by the main
project's `npm test` (see `test/server.js`); `src/index.js` only adds the
Durable Objects.

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

Changing a Durable Object class (adding, renaming or removing one) needs a
new `[[migrations]]` entry in `wrangler.toml`. The app finds the service at
the address in `src/config.js`.
