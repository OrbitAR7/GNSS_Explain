const nf = new Map<string, Intl.NumberFormat>();

export function num(value: number, digits = 0): string {
  const key = String(digits);
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    nf.set(key, f);
  }
  return f.format(value);
}

/** Distance with an appropriate unit: 4.2 m, 312 m, 1.8 km, 20,184 km. */
export function distance(m: number): string {
  const a = Math.abs(m);
  if (a >= 10_000) return `${num(m / 1000)} km`;
  if (a >= 1000) return `${num(m / 1000, 1)} km`;
  if (a >= 10) return `${num(m)} m`;
  return `${num(m, 1)} m`;
}

export function latitude(deg: number, digits = 6): string {
  return `${Math.abs(deg).toFixed(digits)}° ${deg >= 0 ? 'N' : 'S'}`;
}

export function longitude(deg: number, digits = 6): string {
  return `${Math.abs(deg).toFixed(digits)}° ${deg >= 0 ? 'E' : 'W'}`;
}

/** Time interval in engineering units: 71.234 ms, 3.20 µs, 12 ns. */
export function interval(seconds: number): string {
  const a = Math.abs(seconds);
  if (a >= 1) return `${num(seconds, 2)} s`;
  if (a >= 1e-3) return `${num(seconds * 1e3, 3)} ms`;
  if (a >= 1e-6) return `${num(seconds * 1e6, 2)} µs`;
  return `${num(seconds * 1e9, 1)} ns`;
}

export function utcTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
