/**
 * Deterministic PRNG (mulberry32). The full state is a single uint32, so a run's director can be
 * serialised and replayed exactly. Use `?seed=1234` in the URL to reproduce a run.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  static randomSeed(): number {
    return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * Weighted pick. Items with weight <= 0 are never chosen.
   * Returns undefined when nothing has positive weight.
   */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined {
    let total = 0;
    const weights = items.map((item) => {
      const w = Math.max(0, weightOf(item));
      total += Number.isFinite(w) ? w : 0;
      return Number.isFinite(w) ? w : 0;
    });
    if (total <= 0) return undefined;
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll < 0 && weights[i] > 0) return items[i];
    }
    for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
    return undefined;
  }
}
