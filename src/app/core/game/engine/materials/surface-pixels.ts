/*
 * Pure procedural surface recipes (no Babylon / DOM). Shared by the main thread and the
 * procedural worker (workers/procedural.worker.ts), which renders them off the main thread.
 */
import { SurfaceMaterialId } from '../../models';
import { SeededRandom } from '../../systems/seeded-random';

/* ----------------------------------------------------------------------------------------- */
/* Noise                                                                                       */
/* ----------------------------------------------------------------------------------------- */

/** Tileable value noise on an integer lattice. */
export class TileNoise {
  private readonly values: Float32Array;

  constructor(private readonly period: number, seed: number) {
    const rng = new SeededRandom(seed);
    this.values = new Float32Array(period * period);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng.next();
  }

  private v(x: number, y: number): number {
    const p = this.period;
    return this.values[(((y % p) + p) % p) * p + (((x % p) + p) % p)];
  }

  /** u, v in lattice units (0..period wraps). */
  sample(u: number, v: number): number {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.v(x0, y0);
    const b = this.v(x0 + 1, y0);
    const c = this.v(x0, y0 + 1);
    const d = this.v(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** Fractal noise, tileable over a [0,1) square. */
export function fbm(noises: TileNoise[], u: number, v: number, baseFreq: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = baseFreq;
  let norm = 0;
  for (const n of noises) {
    sum += n.sample(u * freq, v * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function octaves(seed: number, base: number, count: number): TileNoise[] {
  return Array.from({ length: count }, (_, i) => new TileNoise(base * 2 ** i, seed + i * 977));
}

export type Rgb255 = [number, number, number];

export interface PixelSurface {
  readonly size: number;
  /** Returns colour (0..255) and height (0..1) for normalised coordinates. */
  pixel(u: number, v: number, x: number, y: number): { c: Rgb255; h: number };
  readonly bumpStrength?: number;
}

export interface SurfacePixels {
  readonly size: number;
  readonly color: Uint8Array;
  readonly normal?: Uint8Array;
}

/** Renders a recipe into RGBA colour (+ optional tangent-space normal map from its height field). */
export function renderSurfacePixels(surface: PixelSurface, withBump: boolean): SurfacePixels {
  const size = surface.size;
  const color = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { c, h } = surface.pixel(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      color[i] = c[0];
      color[i + 1] = c[1];
      color[i + 2] = c[2];
      color[i + 3] = 255;
      heights[y * size + x] = h;
    }
  }
  if (!withBump) return { size, color };
  const strength = surface.bumpStrength ?? 2;
  const normal = new Uint8Array(size * size * 4);
  const hAt = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return { size, color, normal };
}

/**
 * Wall textures span the full wall height. Texture row 0 maps to UV v = 0, which the world
 * builder puts at the floor; so for walls v is 'height above floor' (0 = floor, 1 = ceiling).
 */
const WALL_V_FROM_FLOOR = true;
const wallHeight = (v: number) => (WALL_V_FROM_FLOOR ? v : 1 - v);

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a: Rgb255, b: Rgb255, t: number): Rgb255 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb255, f: number): Rgb255 => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
const hash2 = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* ---- recipes ------------------------------------------------------------------------------ */

export function carpetSurface(base: Rgb255, seed: number, size = 512): PixelSurface {
  const low = octaves(seed, 4, 3);
  const loops = new TileNoise(128, seed + 5);
  return {
    size,
    bumpStrength: 3,
    pixel: (u, v, x, y) => {
      const stain = fbm(low, u, v, 1);
      const fiber = loops.sample(u * 128, v * 128);
      const speck = hash2(x, y, seed);
      const wear = Math.max(0, stain - 0.55) * 1.6;
      let c = shade(base, 0.78 + fiber * 0.3 + (speck - 0.5) * 0.18);
      c = mix(c, shade(base, 0.6), wear * 0.6);
      if (speck > 0.985) c = shade(c, 1.35);
      return { c, h: fiber * 0.7 + speck * 0.3 };
    },
  };
}

export function paintSurface(base: Rgb255, seed: number, size = 512): PixelSurface {
  const low = octaves(seed, 3, 3);
  const roller = new TileNoise(64, seed + 9);
  return {
    size,
    bumpStrength: 0.9,
    pixel: (u, v, x, y) => {
      const hgt = wallHeight(v);
      const n = fbm(low, u, v, 1);
      const r = roller.sample(u * 64, v * 16);
      const grain = hash2(x, y, seed) - 0.5;
      let c = shade(base, 0.9 + n * 0.12 + r * 0.05 + grain * 0.04);
      // grime near the floor and yellowing near the ceiling
      const floorGrime = Math.max(0, (0.18 - hgt) / 0.18) ** 2;
      c = mix(c, shade(base, 0.62), floorGrime * 0.55);
      const top = Math.max(0, (hgt - 0.88) / 0.12);
      c = mix(c, [c[0], c[1] * 0.97, c[2] * 0.85], top * 0.5);
      // faint vertical drip stains
      const drip = Math.max(0, roller.sample(u * 64, 0.5) - 0.78) * (0.4 + (1 - hgt) * 0.6);
      c = shade(c, 1 - drip * 0.6);
      return { c, h: r * 0.6 + n * 0.4 };
    },
  };
}

export function woodPanelSurface(seed: number, size = 512): PixelSurface {
  const grain = octaves(seed, 4, 3);
  const plankCount = 6;
  return {
    size,
    bumpStrength: 2.2,
    pixel: (u, v, x) => {
      const plank = Math.floor(u * plankCount);
      const local = u * plankCount - plank;
      const tone = 0.85 + hash2(plank, 1, seed) * 0.25;
      const g = fbm(grain, u * 0.35 + plank * 0.13, v * 3, 2);
      const rings = Math.sin((g * 18 + local * 2) * Math.PI) * 0.5 + 0.5;
      let c: Rgb255 = mix([92, 58, 34], [128, 84, 50], rings * 0.6 + g * 0.4);
      c = shade(c, tone);
      const groove = local < 0.015 || local > 0.985 ? 0.45 : 1;
      c = shade(c, groove);
      const floorGrime = Math.max(0, (0.15 - wallHeight(v)) / 0.15);
      c = shade(c, 1 - floorGrime * 0.25);
      return { c, h: groove < 1 ? 0 : 0.6 + rings * 0.1 + (x % 2) * 0.01 };
    },
  };
}

export function blockWallSurface(base: Rgb255, seed: number, size = 512): PixelSurface {
  const low = octaves(seed, 8, 3);
  const rows = 15; // 3 m / 0.2 m
  const cols = 5; // 2 m / 0.4 m
  return {
    size,
    bumpStrength: 3,
    pixel: (u, v, x, y) => {
      const row = Math.floor(v * rows);
      const offset = row % 2 ? 0.5 : 0;
      const cu = u * cols + offset;
      const fu = cu - Math.floor(cu);
      const fv = v * rows - row;
      const mortar = fu < 0.03 || fu > 0.97 || fv < 0.05 || fv > 0.95;
      const n = fbm(low, u, v, 1);
      const pit = hash2(x, y, seed) > 0.97 ? 0.8 : 1;
      let c = shade(base, (0.82 + n * 0.25) * pit * (0.95 + hash2(Math.floor(cu), row, seed) * 0.1));
      if (mortar) c = shade(base, 0.7);
      const floorGrime = Math.max(0, (0.2 - wallHeight(v)) / 0.2);
      c = shade(c, 1 - floorGrime * 0.3);
      return { c, h: mortar ? 0.1 : 0.7 + n * 0.3 };
    },
  };
}

export function concreteSurface(base: Rgb255, seed: number, size = 512): PixelSurface {
  const low = octaves(seed, 4, 4);
  const cracks = new TileNoise(16, seed + 77);
  return {
    size,
    bumpStrength: 2.5,
    pixel: (u, v, x, y) => {
      const n = fbm(low, u, v, 1);
      const speck = hash2(x, y, seed);
      const crackField = Math.abs(cracks.sample(u * 16, v * 16) - 0.5);
      const crack = crackField < 0.012 ? 0.55 : 1;
      let c = shade(base, (0.75 + n * 0.45) * crack * (0.95 + speck * 0.1));
      const stain = Math.max(0, n - 0.62) * 2;
      c = mix(c, shade(base, 0.55), stain * 0.5);
      return { c, h: n * 0.8 + speck * 0.2 - (crack < 1 ? 0.3 : 0) };
    },
  };
}

export function terrazzoSurface(seed: number, size = 512): PixelSurface {
  const low = octaves(seed, 4, 2);
  const chipColors: Rgb255[] = [
    [120, 112, 100],
    [60, 58, 55],
    [170, 150, 120],
    [140, 90, 70],
    [210, 205, 195],
  ];
  return {
    size,
    bumpStrength: 0.6,
    pixel: (u, v, x, y) => {
      const n = fbm(low, u, v, 1);
      let c: Rgb255 = shade([196, 188, 172], 0.92 + n * 0.12);
      // chips: cellular-ish lookup on a 48 grid
      const gx = Math.floor(u * 48);
      const gy = Math.floor(v * 48);
      const cx = (gx + hash2(gx, gy, seed)) / 48;
      const cy = (gy + hash2(gx, gy, seed + 1)) / 48;
      const r = 0.004 + hash2(gx, gy, seed + 2) * 0.007;
      if (Math.hypot(u - cx, v - cy) < r) c = chipColors[Math.floor(hash2(gx, gy, seed + 3) * chipColors.length)];
      // tile seams every 0.5 of the texture
      const seam = (u * 2) % 1 < 0.004 || (v * 2) % 1 < 0.004;
      if (seam) c = shade(c, 0.7);
      c = shade(c, 0.97 + (hash2(x, y, seed) - 0.5) * 0.05);
      return { c, h: seam ? 0 : 0.5 };
    },
  };
}

export function linoleumSurface(seed: number, size = 512): PixelSurface {
  const low = octaves(seed, 4, 3);
  return {
    size,
    bumpStrength: 1,
    pixel: (u, v, x, y) => {
      const tiles = 4; // texture = 1.2 m -> 30 cm tiles
      const tx = Math.floor(u * tiles);
      const ty = Math.floor(v * tiles);
      const checker = (tx + ty) % 2 === 0;
      const base: Rgb255 = checker ? [184, 176, 150] : [92, 110, 92];
      const n = fbm(low, u, v, 1);
      let c = shade(base, 0.85 + n * 0.2 + (hash2(x, y, seed) - 0.5) * 0.06);
      const fu = u * tiles - tx;
      const fv = v * tiles - ty;
      const seam = fu < 0.01 || fu > 0.99 || fv < 0.01 || fv > 0.99;
      if (seam) c = shade(c, 0.6);
      const scuff = Math.max(0, n - 0.6) * 1.5;
      c = mix(c, [70, 66, 58], scuff * 0.35);
      return { c, h: seam ? 0 : 0.5 + n * 0.1 };
    },
  };
}

export function ceilingTileSurface(seed: number, stained: boolean, size = 512): PixelSurface {
  const low = octaves(seed, 4, 3);
  return {
    size,
    bumpStrength: 4,
    pixel: (u, v, x, y) => {
      const tiles = 2; // texture = 1.2 m -> 60 cm tiles
      const tx = Math.floor(u * tiles);
      const ty = Math.floor(v * tiles);
      const fu = u * tiles - tx;
      const fv = v * tiles - ty;
      const grid = fu < 0.018 || fu > 0.982 || fv < 0.018 || fv > 0.982;
      const n = fbm(low, u, v, 1);
      let c: Rgb255 = shade([214, 210, 196], 0.9 + n * 0.1);
      const perforation = hash2(x >> 1, y >> 1, seed) > 0.93;
      if (perforation) c = shade(c, 0.8);
      if (stained) {
        const stain = Math.max(0, fbm(low, u + 0.31, v + 0.17, 1) - 0.58) * 3.5;
        c = mix(c, [150, 120, 70], Math.min(1, stain) * 0.55);
      }
      if (grid) c = [176, 174, 168];
      return { c, h: grid ? 1 : perforation ? 0.3 : 0.55 };
    },
  };
}

export function brushedMetalSurface(seed: number, size = 256): PixelSurface {
  const streak = new TileNoise(256, seed);
  return {
    size,
    bumpStrength: 0.5,
    pixel: (u, v) => {
      const s = streak.sample(u * 4, v * 256);
      const c = shade([150, 152, 156], 0.85 + s * 0.25);
      return { c, h: s };
    },
  };
}

export function fabricSurface(base: Rgb255, seed: number, size = 256): PixelSurface {
  return {
    size,
    bumpStrength: 2,
    pixel: (_u, _v, x, y) => {
      const weave = ((x % 4 < 2) !== (y % 4 < 2) ? 1 : 0.85) * (0.92 + hash2(x, y, seed) * 0.12);
      return { c: shade(base, weave), h: weave };
    },
  };
}

export function woodGrainSurface(base: Rgb255, seed: number, size = 256): PixelSurface {
  const grain = octaves(seed, 4, 3);
  return {
    size,
    bumpStrength: 1,
    pixel: (u, v) => {
      const g = fbm(grain, u * 0.5, v * 4, 2);
      const rings = Math.sin(g * 30) * 0.5 + 0.5;
      return { c: shade(base, 0.82 + rings * 0.2 + g * 0.1), h: rings };
    },
  };
}

/* ---- room surface table (id -> recipe) ----------------------------------------------------- */

export interface SurfaceRecipe {
  /** Metres per texture repeat (u along surface, v across). */
  readonly scale: number;
  /** Walls: the texture spans the full wall height instead of repeating vertically. */
  readonly fullHeight?: boolean;
  readonly specular: number;
  readonly build: (size: number) => PixelSurface;
}

export const SURFACE_RECIPES: Record<SurfaceMaterialId, SurfaceRecipe> = {
  'carpet-blue': { scale: 2, specular: 0.02, build: (s) => carpetSurface([62, 74, 96], 11, s) },
  'carpet-brown': { scale: 2, specular: 0.02, build: (s) => carpetSurface([96, 70, 52], 12, s) },
  'carpet-gray': { scale: 2, specular: 0.02, build: (s) => carpetSurface([88, 88, 90], 13, s) },
  'carpet-green': { scale: 2, specular: 0.02, build: (s) => carpetSurface([70, 84, 66], 14, s) },
  linoleum: { scale: 1.2, specular: 0.25, build: (s) => linoleumSurface(21, s) },
  concrete: { scale: 3, specular: 0.06, build: (s) => concreteSurface([120, 118, 112], 22, s) },
  terrazzo: { scale: 2, specular: 0.35, build: (s) => terrazzoSurface(23, s) },
  'wall-beige': { scale: 2, fullHeight: true, specular: 0.05, build: (s) => paintSurface([196, 182, 152], 31, s) },
  'wall-cream': { scale: 2, fullHeight: true, specular: 0.05, build: (s) => paintSurface([214, 204, 178], 32, s) },
  'wall-green': { scale: 2, fullHeight: true, specular: 0.06, build: (s) => paintSurface([150, 168, 140], 33, s) },
  'wall-gray': { scale: 2, fullHeight: true, specular: 0.06, build: (s) => paintSurface([160, 160, 156], 34, s) },
  'wall-blue': { scale: 2, fullHeight: true, specular: 0.05, build: (s) => paintSurface([120, 136, 150], 35, s) },
  'wall-wood': { scale: 2, fullHeight: true, specular: 0.12, build: (s) => woodPanelSurface(36, s) },
  'wall-concrete': { scale: 2, fullHeight: true, specular: 0.04, build: (s) => blockWallSurface([140, 138, 130], 37, s) },
  'ceiling-tile': { scale: 1.2, specular: 0.02, build: (s) => ceilingTileSurface(41, true, s) },
  'ceiling-concrete': { scale: 3, specular: 0.02, build: (s) => concreteSurface([84, 84, 82], 42, s) },
  'metal-brushed': { scale: 1, specular: 0.4, build: (s) => brushedMetalSurface(43, Math.min(256, s)) },
};
