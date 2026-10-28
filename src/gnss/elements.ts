// Two-line element set parsing and validation.

export interface ElementSet {
  name: string;
  norad: number;
  line1: string;
  line2: string;
  /** Element set epoch (UTC). */
  epoch: Date;
}

/** Modulo-10 checksum defined for NORAD two-line elements (minus signs count as 1). */
export function tleChecksumValid(line: string): boolean {
  if (line.length < 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line.charAt(i);
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line.charAt(68));
}

function tleEpoch(line1: string): Date {
  const yy = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86_400_000);
}

/** Parses three-line (name + two lines) element text. Throws on a checksum failure. */
export function parseElementSets(text: string): ElementSet[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const sets: ElementSet[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (name === undefined || line1 === undefined || line2 === undefined) break;
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
    if (!tleChecksumValid(line1) || !tleChecksumValid(line2)) {
      throw new Error(`Element set checksum failure: ${name.trim()}`);
    }
    sets.push({ name: name.trim(), norad: Number(line1.slice(2, 7)), line1, line2, epoch: tleEpoch(line1) });
    i += 2;
  }
  return sets;
}
