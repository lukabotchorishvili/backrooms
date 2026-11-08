import { Constants, DynamicTexture, RawTexture, Scene, Texture } from '@babylonjs/core';
import { SeededRandom } from '../../systems/seeded-random';
import { PixelSurface, SurfacePixels, renderSurfacePixels } from './surface-pixels';

export * from './surface-pixels';

/** Canvas 2D context as exposed by Babylon's DynamicTexture. */
export type Ctx2D = CanvasRenderingContext2D;

export interface SurfaceMaps {
  readonly diffuse: Texture;
  readonly bump?: Texture;
}

function toTexture(scene: Scene, data: Uint8Array, size: number, name: string): Texture {
  const tex = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
  tex.name = name;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Uploads pre-rendered pixels (from the worker or the main thread) as textures. */
export function texturesFromPixels(scene: Scene, name: string, pixels: SurfacePixels): SurfaceMaps {
  const diffuse = toTexture(scene, pixels.color, pixels.size, `${name}-diffuse`);
  return pixels.normal ? { diffuse, bump: toTexture(scene, pixels.normal, pixels.size, `${name}-normal`) } : { diffuse };
}

export function generateSurface(scene: Scene, name: string, surface: PixelSurface, withBump = true): SurfaceMaps {
  return texturesFromPixels(scene, name, renderSurfacePixels(surface, withBump));
}

/* ----------------------------------------------------------------------------------------- */
/* Canvas-drawn textures                                                                      */
/* ----------------------------------------------------------------------------------------- */

export function canvasTexture(
  scene: Scene,
  name: string,
  width: number,
  height: number,
  draw: (ctx: Ctx2D, w: number, h: number) => void,
  options: { alpha?: boolean; mipmaps?: boolean } = {},
): DynamicTexture {
  const tex = new DynamicTexture(name, { width, height }, scene, options.mipmaps ?? true);
  const ctx = tex.getContext() as unknown as Ctx2D;
  ctx.clearRect(0, 0, width, height);
  draw(ctx, width, height);
  tex.hasAlpha = !!options.alpha;
  tex.update(true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** Leaves on transparent background (alpha-tested). */
export function drawLeaves(ctx: Ctx2D, w: number, h: number, kind: 'fern' | 'ficus' | 'red', seed: number): void {
  const rng = new SeededRandom(seed);
  const palettes: Record<string, string[]> = {
    fern: ['#2f5a2a', '#3d6e30', '#4f8040', '#294d24'],
    ficus: ['#1f4a26', '#2d5f31', '#3b7340', '#214226'],
    red: ['#6d1414', '#8a1d1d', '#a52a24', '#561010'],
  };
  const colors = palettes[kind];
  ctx.clearRect(0, 0, w, h);
  const leaves = kind === 'fern' ? 90 : 60;
  for (let i = 0; i < leaves; i++) {
    const x = w * (0.15 + rng.next() * 0.7);
    const y = h * (0.05 + rng.next() * 0.85);
    const len = (kind === 'fern' ? 0.16 : 0.12) * w * (0.6 + rng.next() * 0.6);
    const angle = (rng.next() - 0.5) * Math.PI * 1.2 - Math.PI / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    ctx.beginPath();
    const width = kind === 'fern' ? len * 0.18 : len * 0.38;
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -width, len, 0);
    ctx.quadraticCurveTo(len * 0.5, width, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  }
}

/** Night fog seen through exterior windows. */
export function drawFogOutside(ctx: Ctx2D, w: number, h: number, seed: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d1116');
  g.addColorStop(0.55, '#1b2129');
  g.addColorStop(1, '#0b0d10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rng = new SeededRandom(seed);
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * w;
    const y = h * (0.45 + rng.next() * 0.25);
    const r = 6 + rng.next() * 18;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, 'rgba(255,214,160,0.22)');
    glow.addColorStop(1, 'rgba(255,214,160,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(160,170,180,0.06)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, h * (0.3 + i * 0.08), w, h * 0.04);
}

export function drawPainting(ctx: Ctx2D, w: number, h: number, variant: string): void {
  if (variant === 'portrait') {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2d241c');
    bg.addColorStop(1, '#14100c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1b20';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 1.02, w * 0.36, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8a58a';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.42, w * 0.17, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b3a2c';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.27, w * 0.18, h * 0.08, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // closed eyes
    ctx.strokeStyle = '#3a2a22';
    ctx.lineWidth = 3;
    for (const dx of [-0.06, 0.06]) {
      ctx.beginPath();
      ctx.arc(w * (0.5 + dx), h * 0.41, w * 0.03, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,220,180,0.55)';
    ctx.font = `bold ${Math.round(h * 0.045)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText('J. HALDANE — FOUNDER', w / 2, h * 0.93);
    return;
  }
  // lake landscape
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#d9d8d2');
  sky.addColorStop(1, '#b9bab4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);
  ctx.fillStyle = '#6f746f';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.55);
  for (let x = 0; x <= w; x += w / 12) ctx.lineTo(x, h * (0.47 + Math.sin(x * 0.03) * 0.03));
  ctx.lineTo(w, h * 0.55);
  ctx.fill();
  const water = ctx.createLinearGradient(0, h * 0.55, 0, h);
  water.addColorStop(0, '#8c918e');
  water.addColorStop(1, '#4e5452');
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  ctx.strokeStyle = 'rgba(230,230,225,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const y = h * (0.6 + i * 0.022);
    ctx.beginPath();
    ctx.moveTo(w * 0.1 + (i % 3) * 20, y);
    ctx.lineTo(w * 0.9 - (i % 4) * 25, y);
    ctx.stroke();
  }
  if (variant === 'lake-figure') {
    ctx.fillStyle = '#16181a';
    const fx = w * 0.62;
    const fy = h * 0.68;
    ctx.fillRect(fx - w * 0.012, fy - h * 0.12, w * 0.024, h * 0.12);
    ctx.beginPath();
    ctx.arc(fx, fy - h * 0.14, w * 0.015, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,22,24,0.35)';
    ctx.fillRect(fx - w * 0.012, fy, w * 0.024, h * 0.05);
  }
}

export function drawPoster(ctx: Ctx2D, w: number, h: number, variant: string): void {
  const presets: Record<string, { bg: string; fg: string; title: string; sub: string; figures?: number }> = {
    'always-here': { bg: '#24384a', fg: '#e9e3d0', title: 'WE ARE ALWAYS', sub: 'HERE FOR YOU', figures: 0.28 },
    teamwork: { bg: '#5a2a24', fg: '#efe6d2', title: 'TEAMWORK', sub: 'NONE OF US IS AS SMART AS ALL OF US', figures: 0.28 },
    listening: { bg: '#5a2a24', fg: '#efe6d2', title: 'THE FLOOR', sub: 'IS LISTENING', figures: 0.12 },
    safety: { bg: '#c4a032', fg: '#1c1a14', title: 'SAFETY FIRST', sub: 'REPORT ALL IRREGULARITIES' },
    hygiene: { bg: '#2f5245', fg: '#e8efe6', title: 'WASH YOUR HANDS', sub: 'WE ARE COUNTING' },
    cctv: { bg: '#1c1c1f', fg: '#d4d0c4', title: 'CCTV IN OPERATION', sub: 'FOR YOUR PROTECTION' },
  };
  const p = presets[variant] ?? presets['teamwork'];
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(w * 0.06, h * 0.06, w * 0.88, h * 0.55);
  if (p.figures !== undefined) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (const side of [-1, 1]) {
      const cx = w * (0.5 + side * p.figures * 0.6);
      ctx.beginPath();
      ctx.arc(cx, h * 0.24, w * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - w * 0.08, h * 0.31, w * 0.16, h * 0.26);
    }
  } else {
    ctx.strokeStyle = p.fg;
    ctx.lineWidth = w * 0.03;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.32, w * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = p.fg;
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(h * 0.075)}px "Arial Narrow", Arial, sans-serif`;
  ctx.fillText(p.title, w / 2, h * 0.72);
  ctx.font = `${Math.round(h * 0.036)}px "Arial Narrow", Arial, sans-serif`;
  wrapText(ctx, p.sub, w / 2, h * 0.8, w * 0.84, h * 0.045);
  ctx.font = `${Math.round(h * 0.022)}px Arial, sans-serif`;
  ctx.globalAlpha = 0.6;
  ctx.fillText('HALDANE STRATA GROUP · HUMAN RESOURCES', w / 2, h * 0.95);
  ctx.globalAlpha = 1;
}

export function wrapText(ctx: Ctx2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
  return yy + lineHeight;
}

/** Radial flashlight cookie (hot centre, soft ring, dark edge). */
export function drawFlashlightCookie(ctx: Ctx2D, w: number, h: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.22, 'rgba(250,240,215,0.95)');
  g.addColorStop(0.45, 'rgba(200,190,170,0.55)');
  g.addColorStop(0.6, 'rgba(230,220,200,0.62)');
  g.addColorStop(0.75, 'rgba(120,115,105,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
