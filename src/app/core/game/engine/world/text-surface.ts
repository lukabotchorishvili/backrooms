import { DynamicTexture, StandardMaterial } from '@babylonjs/core';
import { Rgb } from '../../models';
import { MaterialLibrary } from '../materials/material-library';
import { Ctx2D, wrapText } from '../materials/procedural-textures';

export type TextStyle =
  | 'crt'
  | 'terminal'
  | 'paper'
  | 'label'
  | 'handwriting'
  | 'sign-plate'
  | 'led'
  | 'whiteboard'
  | 'directory'
  | 'logo'
  | 'calendar'
  | 'nameplate'
  | 'floor-number'
  | 'arrow';

const MONO = '"Consolas", "Lucida Console", "Courier New", monospace';
const NARROW = '"Bahnschrift", "Arial Narrow", Arial, sans-serif';
const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

const css = (c: Rgb, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/**
 * A canvas-backed surface for in-world text (monitors, signs, notes, clocks...).
 * Text lines are separated with "|". Anomalies change it through `draw()`.
 */
export class TextSurface {
  readonly material: StandardMaterial;
  readonly texture: DynamicTexture;
  text = '';
  color: Rgb | undefined;
  /** Extra per-style data (e.g. calendar month). */
  meta: Record<string, string> = {};
  private off = false;

  constructor(
    lib: MaterialLibrary,
    name: string,
    readonly width: number,
    readonly height: number,
    readonly style: TextStyle,
    options: { emissive?: boolean; alpha?: boolean } = {},
  ) {
    const created = lib.canvasMaterial(name, width, height, () => undefined, {
      emissive: options.emissive,
      alpha: options.alpha,
      specular: style === 'whiteboard' || style === 'nameplate' ? 0.35 : 0.05,
    });
    this.material = created.material;
    this.texture = created.texture;
  }

  setOff(off: boolean): void {
    this.off = off;
    this.redraw();
  }

  draw(text: string, color?: Rgb): void {
    this.text = text;
    this.color = color;
    this.redraw();
  }

  redraw(): void {
    const ctx = this.texture.getContext() as unknown as Ctx2D;
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (this.off) {
      ctx.fillStyle = '#050606';
      ctx.fillRect(0, 0, w, h);
    } else {
      RENDERERS[this.style](ctx, w, h, this.text.split('|'), this.color, this.meta);
    }
    ctx.restore();
    this.texture.update(true);
  }
}

type Renderer = (ctx: Ctx2D, w: number, h: number, lines: string[], color: Rgb | undefined, meta: Record<string, string>) => void;

function scanlines(ctx: Ctx2D, w: number, h: number, alpha: number): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function centeredLines(ctx: Ctx2D, w: number, h: number, lines: string[], size: number, lineHeight: number): void {
  const total = lines.length * lineHeight;
  let y = h / 2 - total / 2 + lineHeight * 0.75;
  ctx.textAlign = 'center';
  for (const line of lines) {
    ctx.font = ctx.font.replace(/\d+px/, `${size}px`);
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }
}

function paperBackground(ctx: Ctx2D, w: number, h: number, tint = '#e8e3d4'): void {
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(120,100,60,0.06)';
  for (let i = 0; i < 40; i++) ctx.fillRect((i * 97) % w, (i * 53) % h, 6, 2);
}

const RENDERERS: Record<TextStyle, Renderer> = {
  crt: (ctx, w, h, lines, color) => {
    ctx.fillStyle = '#071009';
    ctx.fillRect(0, 0, w, h);
    const c = color ?? [0.55, 1, 0.65];
    ctx.fillStyle = css(c);
    ctx.shadowColor = css(c, 0.8);
    ctx.shadowBlur = 8;
    const size = Math.round(Math.min(h / (lines.length + 2), (w / Math.max(...lines.map((l) => l.length), 8)) * 1.7));
    ctx.font = `bold ${size}px ${MONO}`;
    centeredLines(ctx, w, h, lines, size, size * 1.3);
    ctx.shadowBlur = 0;
    scanlines(ctx, w, h, 0.25);
  },
  terminal: (ctx, w, h, lines, color) => {
    ctx.fillStyle = '#0b0d06';
    ctx.fillRect(0, 0, w, h);
    const c = color ?? [1, 0.72, 0.28];
    ctx.fillStyle = css(c);
    ctx.shadowColor = css(c, 0.9);
    ctx.shadowBlur = 10;
    ctx.textAlign = 'left';
    const size = Math.round(h / 11);
    ctx.font = `bold ${size}px ${MONO}`;
    let y = size * 1.5;
    for (const line of lines) {
      ctx.fillText(line, size * 0.8, y);
      y += size * 1.35;
    }
    ctx.shadowBlur = 0;
    scanlines(ctx, w, h, 0.3);
  },
  paper: (ctx, w, h, lines) => {
    paperBackground(ctx, w, h);
    ctx.fillStyle = '#2a2622';
    ctx.textAlign = 'left';
    const size = Math.round(h / 14);
    ctx.font = `${size}px "Courier New", ${MONO}`;
    let y = size * 1.6;
    for (const line of lines) y = wrapText(ctx, line, size, y, w - size * 2, size * 1.25) + size * 0.2;
  },
  label: (ctx, w, h, lines) => {
    paperBackground(ctx, w, h, '#efeadc');
    ctx.fillStyle = '#1d1a16';
    const size = Math.round(h / (lines.length + 1.2));
    ctx.font = `bold ${size}px ${NARROW}`;
    centeredLines(ctx, w, h, lines, size, size * 1.1);
  },
  handwriting: (ctx, w, h, lines) => {
    paperBackground(ctx, w, h, '#ece6d2');
    ctx.strokeStyle = 'rgba(80,110,160,0.35)';
    ctx.lineWidth = 1;
    const size = Math.round(h / 12);
    for (let y = size * 1.4; y < h; y += size * 1.3) {
      ctx.beginPath();
      ctx.moveTo(0, y + 4);
      ctx.lineTo(w, y + 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#1f2d5a';
    ctx.textAlign = 'left';
    ctx.font = `${size}px ${HAND}`;
    let y = size * 1.4;
    for (const line of lines) y = wrapText(ctx, line, size * 0.6, y, w - size * 1.2, size * 1.3);
  },
  'sign-plate': (ctx, w, h, lines) => {
    ctx.fillStyle = '#2b2620';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8c826f';
    ctx.lineWidth = h * 0.06;
    ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    ctx.fillStyle = '#e6dfcc';
    const size = Math.round(h * 0.42);
    ctx.font = `bold ${size}px ${NARROW}`;
    ctx.textAlign = 'center';
    let fit = size;
    while (ctx.measureText(lines[0] ?? '').width > w * 0.86 && fit > 10) {
      fit -= 2;
      ctx.font = `bold ${fit}px ${NARROW}`;
    }
    ctx.fillText(lines[0] ?? '', w / 2, h / 2 + fit * 0.36);
  },
  led: (ctx, w, h, lines, color) => {
    ctx.fillStyle = '#0a0606';
    ctx.fillRect(0, 0, w, h);
    const c = color ?? [1, 0.18, 0.1];
    ctx.fillStyle = css(c);
    ctx.shadowColor = css(c, 1);
    ctx.shadowBlur = 12;
    const size = Math.round(h * 0.7);
    ctx.font = `bold ${size}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(lines[0] ?? '', w / 2, h / 2 + size * 0.35);
    ctx.shadowBlur = 0;
  },
  whiteboard: (ctx, w, h, lines) => {
    ctx.fillStyle = '#f2f3f2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,120,140,0.08)';
    ctx.fillRect(w * 0.55, h * 0.1, w * 0.4, h * 0.3);
    ctx.fillStyle = '#1b3c8a';
    ctx.textAlign = 'left';
    const size = Math.round(h / 8);
    lines.forEach((line, i) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${size}px ${HAND}`;
      ctx.fillText(line, w * 0.06, size * 1.4 + i * size * 1.35);
    });
  },
  directory: (ctx, w, h, lines) => {
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = '#ecebe4';
    ctx.textAlign = 'left';
    const size = Math.round(h / (lines.length + 3));
    lines.forEach((line, i) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${Math.round(size * (i === 0 ? 1.15 : 0.95))}px ${NARROW}`;
      ctx.fillText(line, w * 0.08, size * 1.6 + i * size * 1.22 + (i > 0 ? size * 0.5 : 0));
    });
  },
  logo: (ctx, w, h, lines) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#3a3a38';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;
    ctx.shadowBlur = 6;
    let size = Math.round(h * 0.42);
    ctx.font = `bold ${size}px ${NARROW}`;
    while (ctx.measureText(lines[0] ?? '').width > w * 0.94 && size > 12) {
      size -= 2;
      ctx.font = `bold ${size}px ${NARROW}`;
    }
    ctx.fillText(lines[0] ?? '', w / 2, h * 0.52);
    ctx.font = `${Math.round(h * 0.18)}px ${NARROW}`;
    ctx.fillStyle = '#5a5850';
    ctx.fillText(lines[1] ?? '', w / 2, h * 0.86);
  },
  calendar: (ctx, w, h, lines, _c, meta) => {
    paperBackground(ctx, w, h, '#f0ece0');
    ctx.fillStyle = '#7a1d17';
    ctx.fillRect(0, 0, w, h * 0.16);
    ctx.fillStyle = '#f5efe0';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(h * 0.09)}px ${NARROW}`;
    ctx.fillText(meta['month'] ?? 'NOVEMBER', w / 2, h * 0.115);
    const cols = 7;
    const cw = w / cols;
    const top = h * 0.22;
    const rh = (h * 0.62) / 5;
    ctx.strokeStyle = 'rgba(40,30,20,0.4)';
    ctx.fillStyle = '#2a2420';
    ctx.font = `${Math.round(rh * 0.3)}px ${NARROW}`;
    ctx.textAlign = 'left';
    for (let d = 0; d < 30; d++) {
      const x = (d % cols) * cw;
      const y = top + Math.floor(d / cols) * rh;
      ctx.strokeRect(x, y, cw, rh);
      ctx.fillText(String(d + 1), x + 4, y + rh * 0.32);
    }
    const note = lines.join(' ').trim();
    if (note) {
      ctx.strokeStyle = '#b3201a';
      ctx.lineWidth = 3;
      const x = (8 % cols) * cw;
      const y = top + Math.floor(8 / cols) * rh;
      ctx.beginPath();
      ctx.ellipse(x + cw / 2, y + rh / 2, cw * 0.55, rh * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#b3201a';
      ctx.font = `${Math.round(h * 0.05)}px ${HAND}`;
      ctx.textAlign = 'center';
      wrapText(ctx, note, w / 2, h * 0.9, w * 0.92, h * 0.05);
    }
  },
  nameplate: (ctx, w, h, lines) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#b89a52');
    g.addColorStop(0.5, '#e0c47a');
    g.addColorStop(1, '#8f7438');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#231a0c';
    ctx.textAlign = 'center';
    let size = Math.round(h * 0.42);
    ctx.font = `bold ${size}px ${NARROW}`;
    while (ctx.measureText(lines[0] ?? '').width > w * 0.9 && size > 8) {
      size -= 2;
      ctx.font = `bold ${size}px ${NARROW}`;
    }
    ctx.fillText(lines[0] ?? '', w / 2, h / 2 + size * 0.35);
  },
  'floor-number': (ctx, w, h, lines) => {
    ctx.fillStyle = '#1d1d1c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8d3c5';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(h * 0.78)}px ${NARROW}`;
    ctx.fillText(lines[0] ?? '', w / 2, h * 0.8);
  },
  arrow: (ctx, w, h, lines) => {
    ctx.fillStyle = '#1e3a2c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e4e0d2';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(h * 0.45)}px ${NARROW}`;
    ctx.fillText(lines[0] ?? '', w / 2, h * 0.66);
  },
};
