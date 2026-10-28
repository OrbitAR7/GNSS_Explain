/** FNV-1a 32-bit hash, used to derive stable per-satellite seeds. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Mulberry32 PRNG returning values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviate (Box-Muller). */
export function gaussian(rand: () => number = Math.random): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * First-order Gauss-Markov process: exponentially correlated noise with standard
 * deviation `sigma` and correlation time `tau` (s). Used for slowly varying errors
 * such as orbit/clock error and multipath.
 */
export class GaussMarkov {
  private value: number;

  constructor(
    private readonly sigma: number,
    private readonly tau: number,
    rand: () => number = Math.random,
  ) {
    this.value = sigma * gaussian(rand);
  }

  step(dt: number, rand: () => number = Math.random): number {
    if (dt <= 0) return this.value;
    const phi = Math.exp(-dt / this.tau);
    this.value = phi * this.value + this.sigma * Math.sqrt(1 - phi * phi) * gaussian(rand);
    return this.value;
  }

  get current(): number {
    return this.value;
  }
}
