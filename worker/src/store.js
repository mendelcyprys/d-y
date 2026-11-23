// One account's backup, kept as separate items so each save sends only what
// changed: one item per daf ("Arakhin 5": learned, note, reads) plus "start".
//
// Every save gets the next revision number. Asking for "changes since N"
// returns just the items saved after N. Each item remembers its revision, so
// a device saying "I'm changing Arakhin 5, which I last saw at revision 12"
// can be told if someone else has changed it since; the device then combines
// the two and saves again. A deleted item is kept as an empty one, so other
// devices hear about the deletion.

export const PAGE_SIZE = 1000;

export function userStore(db) {
  db.run('CREATE TABLE IF NOT EXISTS items (key TEXT PRIMARY KEY, rev INTEGER NOT NULL, value TEXT)');
  db.run('CREATE INDEX IF NOT EXISTS items_by_rev ON items (rev)');
  db.run('CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL)');

  const currentRev = () => db.all('SELECT rev FROM meta WHERE id = 1')[0]?.rev ?? 0;
  const parse = (value) => (value == null ? null : JSON.parse(value));

  return {
    /** Items saved after revision `since`, oldest first, a page at a time. */
    changes(since = 0) {
      const rows = db.all('SELECT key, rev, value FROM items WHERE rev > ? ORDER BY rev LIMIT ?', since, PAGE_SIZE);
      const more = rows.length === PAGE_SIZE;
      return {
        rev: more ? rows[rows.length - 1].rev : currentRev(),
        more,
        items: rows.map((row) => ({ key: row.key, rev: row.rev, value: parse(row.value) })),
      };
    },

    /**
     * Save items [{ key, value, baseRev }]. An item someone else has saved
     * since its baseRev isn't saved; it comes back in `conflicts` as stored.
     */
    write(items) {
      const revBefore = currentRev();
      let rev = revBefore;
      const written = [];
      const conflicts = [];
      for (const { key, value, baseRev } of items) {
        const row = db.all('SELECT rev, value FROM items WHERE key = ?', key)[0];
        if ((row?.rev ?? 0) > baseRev) {
          conflicts.push({ key, rev: row.rev, value: parse(row.value) });
          continue;
        }
        rev += 1;
        db.run(`INSERT INTO items (key, rev, value) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET rev = excluded.rev, value = excluded.value`,
        key, rev, value == null ? null : JSON.stringify(value));
        written.push({ key, rev });
      }
      if (rev !== revBefore) db.run('INSERT OR REPLACE INTO meta (id, rev) VALUES (1, ?)', rev);
      return { revBefore, rev, written, conflicts };
    },

    deleteAll() {
      db.run('DELETE FROM items');
      db.run('DELETE FROM meta');
    },
  };
}
