/**
 * Player collision on the floor plane. The player is a vertical capsule, so on a single flat floor
 * it reduces to a circle vs oriented boxes (walls, furniture, closed doors) in XZ.
 * Pure TypeScript: no Babylon dependency, unit-tested.
 */
export interface BoxCollider {
  readonly id: string;
  cx: number;
  cz: number;
  /** Half extents in local space. */
  hx: number;
  hz: number;
  /** Rotation about Y in radians (Babylon convention). */
  rot: number;
  enabled: boolean;
}

export class CollisionWorld {
  private readonly colliders = new Map<string, BoxCollider>();

  add(collider: BoxCollider): void {
    this.colliders.set(collider.id, collider);
  }

  remove(id: string): void {
    this.colliders.delete(id);
  }

  get(id: string): BoxCollider | undefined {
    return this.colliders.get(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const c = this.colliders.get(id);
    if (c) c.enabled = enabled;
  }

  update(id: string, patch: Partial<Omit<BoxCollider, 'id'>>): void {
    const c = this.colliders.get(id);
    if (c) Object.assign(c, patch);
  }

  get size(): number {
    return this.colliders.size;
  }

  all(): BoxCollider[] {
    return [...this.colliders.values()];
  }

  clear(): void {
    this.colliders.clear();
  }

  /** True when a circle at (x, z) overlaps any enabled collider. */
  overlaps(x: number, z: number, radius: number): boolean {
    for (const c of this.colliders.values()) {
      if (c.enabled && penetration(c, x, z, radius)) return true;
    }
    return false;
  }

  /**
   * Moves a circle from (x, z) by (dx, dz), sliding along obstacles.
   * Movement is sub-stepped so fast motion cannot tunnel through thin walls.
   */
  move(x: number, z: number, dx: number, dz: number, radius: number): [number, number] {
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / (radius * 0.5)));
    let px = x;
    let pz = z;
    for (let s = 0; s < steps; s++) {
      px += dx / steps;
      pz += dz / steps;
      [px, pz] = this.resolve(px, pz, radius);
    }
    return [px, pz];
  }

  /** Pushes a circle out of all overlapping colliders (iterative). */
  resolve(x: number, z: number, radius: number, iterations = 4): [number, number] {
    let px = x;
    let pz = z;
    for (let i = 0; i < iterations; i++) {
      let moved = false;
      for (const c of this.colliders.values()) {
        if (!c.enabled) continue;
        const push = penetration(c, px, pz, radius);
        if (push) {
          px += push[0];
          pz += push[1];
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [px, pz];
  }
}

/** Returns the push vector to separate the circle from the box, or null if not overlapping. */
export function penetration(c: BoxCollider, x: number, z: number, radius: number): [number, number] | null {
  const bound = Math.max(c.hx, c.hz) * 1.415 + radius;
  const wx = x - c.cx;
  const wz = z - c.cz;
  if (Math.abs(wx) > bound || Math.abs(wz) > bound) return null;

  // world -> local (inverse Babylon Y rotation)
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;

  const clx = Math.max(-c.hx, Math.min(c.hx, lx));
  const clz = Math.max(-c.hz, Math.min(c.hz, lz));
  let nx = lx - clx;
  let nz = lz - clz;
  const distSq = nx * nx + nz * nz;
  let pushLocalX: number;
  let pushLocalZ: number;

  if (distSq > 1e-10) {
    if (distSq >= radius * radius) return null;
    const dist = Math.sqrt(distSq);
    const depth = radius - dist;
    nx /= dist;
    nz /= dist;
    pushLocalX = nx * depth;
    pushLocalZ = nz * depth;
  } else {
    // Centre inside the box: push out along the axis of least penetration.
    const px = c.hx - Math.abs(lx) + radius;
    const pz = c.hz - Math.abs(lz) + radius;
    if (px < pz) {
      pushLocalX = (lx >= 0 ? 1 : -1) * px;
      pushLocalZ = 0;
    } else {
      pushLocalX = 0;
      pushLocalZ = (lz >= 0 ? 1 : -1) * pz;
    }
  }
  // local -> world
  return [pushLocalX * cos + pushLocalZ * sin, -pushLocalX * sin + pushLocalZ * cos];
}
