// A tiny database interface that both Cloudflare's Durable Object SQLite and
// Node's built-in SQLite (used in the tests) can provide:
//   db.all(sql, ...params) -> rows      db.run(sql, ...params)

export function durableObjectDb(sql) {
  return {
    all: (query, ...params) => sql.exec(query, ...params).toArray(),
    run: (query, ...params) => {
      sql.exec(query, ...params);
    },
  };
}
