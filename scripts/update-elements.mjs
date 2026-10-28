// Refreshes the bundled GNSS element sets in public/data/elements.
//
// Primary source: CelesTrak GP data (https://celestrak.org). If CelesTrak is not
// reachable from this network, a public GitHub mirror of the same CelesTrak
// groups is used instead (BeiDou is extracted from the mirror's "active" group).
// Every TLE line is checksum-validated before anything is written.
//
// CelesTrak asks that GP data is not downloaded more often than every 2 hours.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'public/data/elements';
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
const MIRROR = 'https://raw.githubusercontent.com/caelo-works/tle-mirror/main/tle';

const SYSTEMS = [
  { id: 'gps', group: 'gps-ops', mirrorFile: 'gps-ops.tle' },
  { id: 'galileo', group: 'galileo', mirrorFile: 'galileo.tle' },
  { id: 'glonass', group: 'glo-ops', mirrorFile: 'glo-ops.tle' },
  { id: 'beidou', group: 'beidou', mirrorFile: 'active.tle', filter: (name) => name.startsWith('BEIDOU') },
];

function checksumOk(line) {
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

function parseTle(text, filter) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  const sets = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;
    if (!checksumOk(l1) || !checksumOk(l2)) throw new Error(`Checksum failure for ${name.trim()}`);
    if (!filter || filter(name.trim())) sets.push([name.trimEnd(), l1, l2]);
    i += 2;
  }
  return sets;
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchSystem(sys) {
  try {
    const sets = parseTle(await download(`${CELESTRAK}?GROUP=${sys.group}&FORMAT=tle`));
    if (sets.length) return { sets, source: 'CelesTrak' };
  } catch (err) {
    console.warn(`${sys.id}: CelesTrak unavailable (${err.message}); trying mirror`);
  }
  const sets = parseTle(await download(`${MIRROR}/${sys.mirrorFile}`), sys.filter);
  return { sets, source: 'CelesTrak (GitHub mirror caelo-works/tle-mirror)' };
}

mkdirSync(OUT_DIR, { recursive: true });
const manifest = { retrievedAt: new Date().toISOString(), systems: {} };
for (const sys of SYSTEMS) {
  const { sets, source } = await fetchSystem(sys);
  const text = sets.map((s) => s.join('\n')).join('\n') + '\n';
  writeFileSync(`${OUT_DIR}/${sys.id}.tle`, text);
  manifest.systems[sys.id] = {
    group: sys.group,
    source,
    count: sets.length,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
  console.log(`${sys.id.padEnd(8)} ${String(sets.length).padStart(3)} satellites  (${source})`);
}
writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
