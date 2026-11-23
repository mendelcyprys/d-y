// The Daf Yomi backup service: a Cloudflare Worker with one Durable Object
// per sync key. A Durable Object handles one request at a time, so checking
// the revision and saving happen together and two devices can't overwrite
// each other's changes.

import { DurableObject } from 'cloudflare:workers';
import { handle, sha256Hex } from './handler.js';

export class SyncStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS backup (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      rev INTEGER NOT NULL,
      updated TEXT NOT NULL,
      data TEXT NOT NULL
    )`);
  }

  read() {
    const row = this.sql.exec('SELECT rev, updated, data FROM backup WHERE id = 1').toArray()[0];
    return row ? { rev: row.rev, updated: row.updated, data: JSON.parse(row.data) } : { rev: 0, updated: null, data: null };
  }

  write(baseRev, dataText) {
    const current = this.sql.exec('SELECT rev FROM backup WHERE id = 1').toArray()[0]?.rev ?? 0;
    if (current !== baseRev) return { conflict: true, ...this.read() };
    const rev = current + 1;
    const updated = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO backup (id, rev, updated, data) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, updated = excluded.updated, data = excluded.data`,
      rev, updated, dataText,
    );
    return { rev, updated };
  }
}

export default {
  async fetch(request, env) {
    return handle(request, env, async (key) => env.SYNC_STORE.get(env.SYNC_STORE.idFromName(await sha256Hex(key))));
  },
};
