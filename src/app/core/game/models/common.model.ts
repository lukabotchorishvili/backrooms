/**
 * Shared primitive types used across content definitions, systems and the engine.
 * Everything in /models is plain serialisable data - no Babylon.js or Angular types.
 */

/** [x, y, z] in metres. +X = east, +Y = up, +Z = north. */
export type Vec3 = readonly [number, number, number];

/** Axis-aligned rectangle on the floor plane (XZ), in metres. */
export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** RGB colour, components 0..1. */
export type Rgb = readonly [number, number, number];

export function rectContains(rect: Rect, x: number, z: number, margin = 0): boolean {
  return (
    x >= rect.x0 - margin && x <= rect.x1 + margin && z >= rect.z0 - margin && z <= rect.z1 + margin
  );
}

export function rectCenter(rect: Rect): [number, number] {
  return [(rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2];
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Saturating normaliser: maps 0..inf to 0..1 with value k producing 0.5. */
export function saturate(value: number, k: number): number {
  if (value <= 0) return 0;
  return value / (value + k);
}
