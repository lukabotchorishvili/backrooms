import { CollisionWorld, penetration } from './collision-manager';

const box = (id: string, cx: number, cz: number, hx: number, hz: number, rot = 0) => ({ id, cx, cz, hx, hz, rot, enabled: true });

describe('CollisionWorld', () => {
  it('pushes a circle out of an axis-aligned box', () => {
    const push = penetration(box('a', 0, 0, 1, 1), 1.2, 0, 0.3)!;
    expect(push[0]).toBeCloseTo(0.1);
    expect(push[1]).toBeCloseTo(0);
    expect(penetration(box('a', 0, 0, 1, 1), 1.31, 0, 0.3)).toBeNull();
  });

  it('handles rotated boxes', () => {
    // a 2 x 0.2 wall rotated 90 degrees runs along Z
    const wall = box('w', 0, 0, 1, 0.1, Math.PI / 2);
    expect(penetration(wall, 0.2, 0.8, 0.3)).not.toBeNull();
    expect(penetration(wall, 0.0, 1.5, 0.3)).toBeNull();
    const [px] = penetration(wall, 0.3, 0, 0.3)!;
    expect(px).toBeGreaterThan(0);
  });

  it('resolves a centre that is inside the box along the shallowest axis', () => {
    const [px, pz] = penetration(box('a', 0, 0, 1, 0.2), 0.1, 0.15, 0.3)!;
    expect(px).toBe(0);
    expect(pz).toBeCloseTo(0.35);
  });

  it('slides along walls instead of stopping', () => {
    const w = new CollisionWorld();
    w.add(box('wall', 0, 1, 5, 0.1));
    const [x, z] = w.move(0, 0.5, 1, 1, 0.3);
    expect(x).toBeCloseTo(1, 1);
    expect(z).toBeLessThanOrEqual(0.61);
  });

  it('does not tunnel through thin walls on large steps', () => {
    const w = new CollisionWorld();
    w.add(box('thin', 0, 0, 3, 0.05));
    const [, z] = w.move(0, -1, 0, 2.5, 0.3);
    expect(z).toBeLessThan(0);
  });

  it('ignores disabled colliders (open doors)', () => {
    const w = new CollisionWorld();
    w.add(box('door', 0, 0, 0.5, 0.05));
    expect(w.overlaps(0, 0.1, 0.3)).toBe(true);
    w.setEnabled('door', false);
    expect(w.overlaps(0, 0.1, 0.3)).toBe(false);
    const [, z] = w.move(0, -1, 0, 2, 0.3);
    expect(z).toBeCloseTo(1);
  });
});
