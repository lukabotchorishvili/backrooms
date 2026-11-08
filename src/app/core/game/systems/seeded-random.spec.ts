import { SeededRandom } from './seeded-random';

describe('SeededRandom', () => {
  it('is deterministic for a seed and resumable from its state', () => {
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);

    const c = new SeededRandom(99);
    c.next();
    const state = c.getState();
    const expected = [c.next(), c.next()];
    const d = new SeededRandom(1);
    d.setState(state);
    expect([d.next(), d.next()]).toEqual(expected);
  });

  it('produces values in [0, 1)', () => {
    const r = new SeededRandom(7);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('weighted() respects weights and never returns zero-weight items', () => {
    const r = new SeededRandom(42);
    const counts: Record<string, number> = { a: 0, b: 0, never: 0 };
    const weights: Record<string, number> = { a: 1, b: 3, never: 0 };
    for (let i = 0; i < 8000; i++) counts[r.weighted(['a', 'b', 'never'], (x) => weights[x])!]++;
    expect(counts['never']).toBe(0);
    const ratio = counts['b'] / counts['a'];
    expect(ratio).toBeGreaterThan(2.6);
    expect(ratio).toBeLessThan(3.4);
  });

  it('weighted() returns undefined when nothing has positive weight', () => {
    expect(new SeededRandom(1).weighted([1, 2, 3], () => 0)).toBeUndefined();
    expect(new SeededRandom(1).weighted([], () => 1)).toBeUndefined();
  });
});
