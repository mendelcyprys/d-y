// Packs the app's files into a module for the site Worker (site/worker.js),
// so the whole site goes up as one Worker. Run from the project folder:
//   node site/build.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

const FILES = ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'src'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function walk(path) {
  return statSync(path).isDirectory() ? readdirSync(path).sort().flatMap((name) => walk(join(path, name))) : [path];
}

const files = {};
for (const path of FILES.flatMap(walk)) {
  const type = TYPES[extname(path)];
  if (!type) continue;
  const body = readFileSync(path, 'utf8');
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
  files[`/${path}`] = { type, body, etag };
}

writeFileSync('site/files.js', `// Made by site/build.mjs; don't edit.\nexport default ${JSON.stringify(files)};\n`);
console.log(`Packed ${Object.keys(files).length} files (${Math.round(JSON.stringify(files).length / 1024)} KB) into site/files.js`);
