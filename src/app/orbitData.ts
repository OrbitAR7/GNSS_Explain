// Element-set loading for the browser. Order of preference:
//   1. browser cache, if younger than 2 h (CelesTrak's requested minimum refresh interval)
//   2. live CelesTrak download (through the dev-server proxy, then directly)
//   3. the snapshot bundled in public/data/elements (refresh with `npm run update-elements`)
import { parseElementSets, type ElementSet } from '../gnss/elements';
import { SYSTEM_IDS, SYSTEMS, type SystemId } from '../gnss/systems';

const CACHE_KEY = 'gnss-explain.elements.v2';
const CACHE_TTL_MS = 2 * 3600 * 1000;

export type ElementSource = 'celestrak' | 'cache' | 'snapshot';

export interface Provenance {
  source: ElementSource;
  /** When the element sets were retrieved from CelesTrak. */
  retrievedAt: Date | null;
  /** Most recent element-set epoch. */
  latestEpoch: Date | null;
}

export interface LoadedElements {
  sets: Record<SystemId, ElementSet[]>;
  provenance: Record<SystemId, Provenance>;
}

interface CacheRecord {
  retrievedAt: number;
  text: Partial<Record<SystemId, string>>;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function readCache(): CacheRecord | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const record = raw ? (JSON.parse(raw) as CacheRecord) : null;
    return record && Date.now() - record.retrievedAt < CACHE_TTL_MS ? record : null;
  } catch {
    return null;
  }
}

function writeCache(record: CacheRecord): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable (private mode, quota): the live data is still used for this session.
  }
}

async function fetchLive(system: SystemId): Promise<string | null> {
  const query = `/NORAD/elements/gp.php?GROUP=${SYSTEMS[system].celestrakGroup}&FORMAT=tle`;
  for (const url of [`./celestrak${query}`, `https://celestrak.org${query}`]) {
    try {
      const text = await fetchText(url, 8000);
      if (parseElementSets(text).length > 0) return text;
    } catch {
      // Try the next source.
    }
  }
  return null;
}

async function snapshotManifest(): Promise<{ retrievedAt?: string } | null> {
  try {
    return JSON.parse(await fetchText('./data/elements/manifest.json', 4000)) as { retrievedAt?: string };
  } catch {
    return null;
  }
}

const latestEpoch = (sets: ElementSet[]): Date | null =>
  sets.length ? new Date(Math.max(...sets.map((s) => s.epoch.getTime()))) : null;

export async function loadElements(): Promise<LoadedElements> {
  const cached = readCache();
  const fresh: Partial<Record<SystemId, string>> = {};
  const manifest = await snapshotManifest();
  const sets = {} as Record<SystemId, ElementSet[]>;
  const provenance = {} as Record<SystemId, Provenance>;

  await Promise.all(
    SYSTEM_IDS.map(async (id) => {
      let text = cached?.text[id];
      let source: ElementSource = 'cache';
      let retrievedAt: Date | null = cached ? new Date(cached.retrievedAt) : null;
      if (!text) {
        const live = await fetchLive(id);
        if (live) {
          text = live;
          fresh[id] = live;
          source = 'celestrak';
          retrievedAt = new Date();
        }
      }
      if (!text) {
        text = await fetchText(`./data/elements/${SYSTEMS[id].elementsFile}.tle`, 8000);
        source = 'snapshot';
        retrievedAt = manifest?.retrievedAt ? new Date(manifest.retrievedAt) : null;
      }
      sets[id] = parseElementSets(text);
      provenance[id] = { source, retrievedAt, latestEpoch: latestEpoch(sets[id]) };
    }),
  );

  if (Object.keys(fresh).length > 0) {
    writeCache({ retrievedAt: Date.now(), text: { ...(cached?.text ?? {}), ...fresh } });
  }
  return { sets, provenance };
}
