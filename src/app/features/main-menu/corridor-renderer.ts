/**
 * Pure 2D-canvas renderer for the main-menu backdrop: a one-point-perspective office corridor
 * (ceiling tile grid, fluorescent panels, doors, dim carpet with faint reflections, fog swallowing
 * the far end) plus film grain and vignette. Framework-free; the host component owns the loop.
 *
 * World space is metres: x right, y up, z forward from the camera.
 */

type Rgb = readonly [number, number, number];
type P3 = readonly [number, number, number];

const HALF_W = 1.6;
const CEIL = 2.7;
const EYE = 1.58;
const NEAR = 0.32;
const FAR = 48;
const SLABS = 64;
const PANEL_SPACING = 3.6;
const PANEL_HALF_LEN = 0.6;
const PANEL_HALF_W = 0.3;
const TILE = 0.6;
const DOOR_SPACING = 4.2;
const DOOR_W = 0.95;
const DOOR_H = 2.1;
/** Forward creep of the camera, m/s. Slow enough to feel like drifting, not walking. */
const CREEP = 0.14;
const FOG = 0.068;
const LIGHT_SIGMA2 = 2 * 1.5 * 1.5;
/** Global exposure - the backdrop must stay well below the menu text. */
const EXPOSURE = 0.6;

const C_CEIL: Rgb = [198, 196, 176];
const C_WALL: Rgb = [146, 134, 102];
const C_FLOOR: Rgb = [66, 61, 48];
const C_DOOR: Rgb = [70, 57, 40];
const C_TUBE: Rgb = [236, 242, 222];

interface PanelState {
  readonly base: number;
  readonly sick: boolean;
  readonly phase: number;
  flickerUntil: number;
  value: number;
}

interface Light {
  readonly z: number;
  readonly intensity: number;
}

/** Deterministic 0..1 hash so panels/doors keep their identity while the camera creeps. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function rgb(c: Rgb, k: number): string {
  return `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export class CorridorRenderer {
  private w = 1;
  private h = 1;
  private f = 1;
  private cx = 0;
  private cy = 0;
  private readonly panels = new Map<number, PanelState>();
  private readonly grain: CanvasPattern[] = [];
  private vignette: CanvasGradient | null = null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly animated: boolean,
  ) {
    this.buildGrain();
  }

  resize(width: number, height: number): void {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.f = this.h * 0.92;
    const g = this.ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.22,
      this.w / 2,
      this.h / 2,
      Math.hypot(this.w, this.h) * 0.6,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.88)');
    this.vignette = g;
  }

  /** Draw one frame. `t` is seconds since start, `dt` seconds since the previous frame. */
  render(t: number, dt: number): void {
    const ctx = this.ctx;
    const animated = this.animated;
    const camZ = animated ? t * CREEP : 0;
    this.cx = this.w / 2 + (animated ? Math.sin(t * 0.11) * this.w * 0.004 : 0);
    this.cy = this.h * 0.46 + (animated ? Math.sin(t * 0.17) * this.h * 0.003 : 0);

    const lights = this.updateLights(camZ, t, dt);
    const shade = (z: number): number => {
      let sum = 0;
      for (const l of lights) {
        const d = z - l.z;
        sum += l.intensity * Math.exp(-(d * d) / LIGHT_SIGMA2);
      }
      return Math.exp(-z * FOG) * (0.1 + 0.9 * Math.min(1.15, sum)) * EXPOSURE;
    };

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050504';
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawShell(shade);
    this.drawGrid(camZ);
    this.drawDoors(camZ, shade);
    this.drawPanels(lights);
    this.drawReflections(lights);
    this.drawExitSign();
    this.drawVoid();
    this.drawGrain();
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  /* ------------------------------------------------------------------ geometry */

  private px(x: number, z: number): number {
    return this.cx + (x * this.f) / z;
  }

  private py(y: number, z: number): number {
    return this.cy - ((y - EYE) * this.f) / z;
  }

  private quad(a: P3, b: P3, c: P3, d: P3, fill: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(this.px(a[0], a[2]), this.py(a[1], a[2]));
    ctx.lineTo(this.px(b[0], b[2]), this.py(b[1], b[2]));
    ctx.lineTo(this.px(c[0], c[2]), this.py(c[1], c[2]));
    ctx.lineTo(this.px(d[0], d[2]), this.py(d[1], d[2]));
    ctx.closePath();
    ctx.fill();
  }

  private line(path: Path2D, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    path.moveTo(this.px(x0, z0), this.py(y0, z0));
    path.lineTo(this.px(x1, z1), this.py(y1, z1));
  }

  /* ------------------------------------------------------------------ lights */

  private panel(k: number): PanelState {
    let p = this.panels.get(k);
    if (!p) {
      const h = hash(k);
      const base = h < 0.07 ? 0.04 : h < 0.22 ? 0.72 : 1;
      p = { base, sick: h >= 0.07 && h < 0.12, phase: hash(k + 17) * Math.PI * 2, flickerUntil: 0, value: base };
      this.panels.set(k, p);
    }
    return p;
  }

  private updateLights(camZ: number, t: number, dt: number): Light[] {
    const kStart = Math.floor((camZ + NEAR - PANEL_HALF_LEN) / PANEL_SPACING);
    const kEnd = Math.ceil((camZ + FAR) / PANEL_SPACING);
    const lights: Light[] = [];
    for (let k = kStart; k <= kEnd; k++) {
      const p = this.panel(k);
      this.updatePanel(p, t, dt);
      lights.push({ z: k * PANEL_SPACING + 1.4 - camZ, intensity: p.value });
    }
    for (const k of this.panels.keys()) if (k < kStart - 2) this.panels.delete(k);
    return lights;
  }

  private updatePanel(p: PanelState, t: number, dt: number): void {
    if (!this.animated) {
      p.value = p.base;
      return;
    }
    if (p.sick) {
      // A failing ballast: mostly on, with brief dips.
      p.value = Math.random() < 0.06 ? p.base * (0.15 + Math.random() * 0.4) : p.base * (0.86 + Math.random() * 0.1);
      return;
    }
    if (t < p.flickerUntil) {
      p.value = Math.random() < 0.4 ? p.base * 0.1 : p.base * (0.72 + Math.random() * 0.28);
      return;
    }
    if (Math.random() < dt * 0.03) p.flickerUntil = t + 0.1 + Math.random() * 0.45;
    p.value = p.base * (0.975 + 0.025 * Math.sin(t * 6.1 + p.phase));
  }

  /* ------------------------------------------------------------------ passes */

  /** Floor, ceiling and walls as depth slabs, back to front, each shaded by nearby panels + fog. */
  private drawShell(shade: (z: number) => number): void {
    const ratio = FAR / NEAR;
    for (let i = SLABS - 1; i >= 0; i--) {
      const za = NEAR * Math.pow(ratio, i / SLABS);
      const zb = NEAR * Math.pow(ratio, (i + 1) / SLABS) * 1.02;
      const b = shade((za + zb) / 2);
      this.quad([-HALF_W, 0, za], [HALF_W, 0, za], [HALF_W, 0, zb], [-HALF_W, 0, zb], rgb(C_FLOOR, b * 0.9));
      this.quad([-HALF_W, CEIL, za], [HALF_W, CEIL, za], [HALF_W, CEIL, zb], [-HALF_W, CEIL, zb], rgb(C_CEIL, b * 0.78));
      this.quad([-HALF_W, 0, za], [-HALF_W, CEIL, za], [-HALF_W, CEIL, zb], [-HALF_W, 0, zb], rgb(C_WALL, b * 0.8));
      this.quad([HALF_W, 0, za], [HALF_W, CEIL, za], [HALF_W, CEIL, zb], [HALF_W, 0, zb], rgb(C_WALL, b * 0.95));
    }
  }

  private drawGrid(camZ: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = 1;

    // Suspended ceiling: longitudinal runners + cross tees.
    const ceiling = new Path2D();
    for (const x of [-1.2, -0.6, 0, 0.6, 1.2]) this.line(ceiling, x, CEIL, NEAR, x, CEIL, FAR);
    for (let n = Math.ceil((camZ + NEAR) / TILE); n * TILE - camZ < 30; n++) {
      const z = n * TILE - camZ;
      this.line(ceiling, -HALF_W, CEIL, z, HALF_W, CEIL, z);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.stroke(ceiling);

    // Carpet tile seams, barely there.
    const floor = new Path2D();
    for (const x of [-0.8, 0, 0.8]) this.line(floor, x, 0, NEAR, x, 0, FAR);
    for (let n = Math.ceil((camZ + NEAR) / 0.8); n * 0.8 - camZ < 22; n++) {
      const z = n * 0.8 - camZ;
      this.line(floor, -HALF_W, 0, z, HALF_W, 0, z);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.stroke(floor);

    // Corners and skirting boards.
    const edges = new Path2D();
    for (const side of [-1, 1]) {
      this.line(edges, side * HALF_W, CEIL, NEAR, side * HALF_W, CEIL, FAR);
      this.line(edges, side * HALF_W, 0.1, NEAR, side * HALF_W, 0.1, FAR);
      this.line(edges, side * HALF_W, 0, NEAR, side * HALF_W, 0, FAR);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.34)';
    ctx.stroke(edges);
  }

  private drawDoors(camZ: number, shade: (z: number) => number): void {
    const ctx = this.ctx;
    const jStart = Math.floor((camZ + NEAR - DOOR_W - 1.2) / DOOR_SPACING);
    const jEnd = Math.ceil((camZ + FAR * 0.7) / DOOR_SPACING);
    const frames = new Path2D();
    for (let j = jStart; j <= jEnd; j++) {
      if (hash(j * 3.1 + 5) < 0.28) continue;
      const side = hash(j * 7.7 + 1) < 0.5 ? -1 : 1;
      let z1 = j * DOOR_SPACING + 1.2 - camZ;
      const z2 = z1 + DOOR_W;
      if (z2 <= NEAR) continue;
      z1 = Math.max(z1, NEAR);
      const x = side * (HALF_W - 0.005);
      this.quad([x, 0, z1], [x, DOOR_H, z1], [x, DOOR_H, z2], [x, 0, z2], rgb(C_DOOR, shade((z1 + z2) / 2) * 0.9));
      this.line(frames, x, 0, z1, x, DOOR_H, z1);
      this.line(frames, x, DOOR_H, z1, x, DOOR_H, z2);
      this.line(frames, x, DOOR_H, z2, x, 0, z2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke(frames);
  }

  private drawPanels(lights: readonly Light[]): void {
    const y = CEIL - 0.004;
    for (const l of lights) {
      const z2 = l.z + PANEL_HALF_LEN;
      if (z2 <= NEAR) continue;
      const z1 = Math.max(l.z - PANEL_HALF_LEN, NEAR);
      const glow = Math.exp(-l.z * FOG * 0.55);
      // Soft halo on the tiles around the diffuser.
      this.quad(
        [-0.6, y, Math.max(z1 - 0.3, NEAR)],
        [0.6, y, Math.max(z1 - 0.3, NEAR)],
        [0.6, y, z2 + 0.3],
        [-0.6, y, z2 + 0.3],
        rgba(C_TUBE, 0.09 * l.intensity * glow),
      );
      // The diffuser itself; dead tubes stay visible as a grey panel.
      this.quad(
        [-PANEL_HALF_W, y, z1],
        [PANEL_HALF_W, y, z1],
        [PANEL_HALF_W, y, z2],
        [-PANEL_HALF_W, y, z2],
        rgb(C_TUBE, (0.16 + 0.8 * l.intensity) * glow * 0.9),
      );
    }
  }

  /** Planar reflections of the panels on the (slightly glossy) floor - the floor shows what is above. */
  private drawReflections(lights: readonly Light[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.px(-HALF_W, NEAR), this.py(0, NEAR));
    ctx.lineTo(this.px(HALF_W, NEAR), this.py(0, NEAR));
    ctx.lineTo(this.px(HALF_W, FAR), this.py(0, FAR));
    ctx.lineTo(this.px(-HALF_W, FAR), this.py(0, FAR));
    ctx.closePath();
    ctx.clip();
    const y = -CEIL;
    for (const l of lights) {
      const z2 = l.z + PANEL_HALF_LEN;
      if (z2 <= NEAR) continue;
      const z1 = Math.max(l.z - PANEL_HALF_LEN, NEAR);
      const glow = Math.exp(-l.z * FOG * 0.7) * l.intensity;
      this.quad([-0.42, y, z1 - 0.35], [0.42, y, z1 - 0.35], [0.42, y, z2 + 0.35], [-0.42, y, z2 + 0.35], rgba(C_TUBE, 0.035 * glow));
      this.quad([-0.24, y, z1], [0.24, y, z1], [0.24, y, z2], [-0.24, y, z2], rgba(C_TUBE, 0.06 * glow));
    }
    ctx.restore();
  }

  /** A dim exit sign at the end of the corridor. It never gets any closer. */
  private drawExitSign(): void {
    const z = 31;
    const a = 0.32 * Math.exp(-z * FOG * 0.35);
    this.quad([-0.2, 2.42, z], [0.2, 2.42, z], [0.2, 2.28, z], [-0.2, 2.28, z], `rgba(108,186,118,${a.toFixed(3)})`);
  }

  private drawVoid(): void {
    const ctx = this.ctx;
    const r = this.h * 0.17;
    const g = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, r);
    g.addColorStop(0, 'rgba(3,3,2,0.9)');
    g.addColorStop(1, 'rgba(3,3,2,0)');
    ctx.fillStyle = g;
    ctx.fillRect(this.cx - r, this.cy - r, r * 2, r * 2);
  }

  /* ------------------------------------------------------------------ film */

  private buildGrain(): void {
    if (typeof document === 'undefined') return;
    const size = 128;
    for (let n = 0; n < 4; n++) {
      const tile = document.createElement('canvas');
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext('2d');
      if (!tctx) return;
      const img = tctx.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v * 0.94;
        img.data[i + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      const pattern = this.ctx.createPattern(tile, 'repeat');
      if (pattern) this.grain.push(pattern);
    }
  }

  private drawGrain(): void {
    if (!this.grain.length) return;
    const ctx = this.ctx;
    const pattern = this.grain[this.animated ? Math.floor(Math.random() * this.grain.length) : 0];
    const ox = this.animated ? Math.floor(Math.random() * 128) : 0;
    const oy = this.animated ? Math.floor(Math.random() * 128) : 0;
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, this.w + 128, this.h + 128);
    ctx.restore();
  }
}
