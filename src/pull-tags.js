// Bring the server's tags down into tags.csv, so they can be committed.
//
//   palindex                                   (in another terminal: the SSH tunnel)
//   node src/pull-tags.js [--url URL] [--out FILE]
//
// The default URL is the tunnel's local end, 18081. To pull from a local `npm run serve`
// instead, pass --url http://localhost:8081/api/tags.csv.
//
// Tags edited on the live site live in the server's archive.db, which is gitignored.
// This is the backup: it fetches /api/tags.csv over the admin port -- only reachable
// through the tunnel -- and writes it over tags.csv. Review the diff, then commit.

import fs from 'fs/promises';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : fallback;
};

const url = flag('--url', 'http://localhost:18081/api/tags.csv');
const out = flag('--out', 'tags.csv');

let res;
try {
  res = await fetch(url);
} catch {
  console.error(`Could not reach ${url}. Is the SSH tunnel open?`);
  console.error('  palindex   (or: ssh -N -L 18081:127.0.0.1:8081 deploy@167.233.141.19)');
  process.exit(1);
}
if (!res.ok) {
  console.error(`${url} answered HTTP ${res.status}.`);
  process.exit(1);
}

const csv = await res.text();
// The header alone means no tagged pages, which is a legitimate answer; anything without
// it is not tags.csv, and must not be written over it.
if (!csv.startsWith('local_path,')) {
  console.error(`${url} did not return tags.csv; leaving ${out} alone.`);
  process.exit(1);
}

await fs.writeFile(out, csv, 'utf8');
const rows = csv.trim().split('\n').length - 1;
console.log(`Wrote ${out}: ${rows} tagged ${rows === 1 ? 'page' : 'pages'}. Review with git diff, then commit.`);
