import { Mesh, StandardMaterial, TransformNode } from '@babylonjs/core';
import { drawPainting, drawPoster } from '../../materials/procedural-textures';
import { PropBuilder, PropKit } from '../prop-kit';
import { TextStyle, TextSurface } from '../text-surface';

/*
 * Wall-mounted props: origin is the wall surface at mounting height, front = -Z.
 * Surface-mounted props (on desks/counters): origin is the bottom centre.
 */

function textPlane(k: PropKit, surface: TextSurface, w: number, h: number, x: number, y: number, z: number, part = 'text'): Mesh {
  const plane = k.plane(w, h, surface.material, x, y, z, { keep: part });
  return plane;
}

function surface(ctxName: string, k: PropKit, w: number, h: number, style: TextStyle, emissive = false, alpha = false): TextSurface {
  return new TextSurface(k.lib, `${ctxName}-${style}`, w, h, style, { emissive, alpha });
}

const SCREEN_TEXT: Record<string, string> = {
  login: 'HALDANE STRATA|USER: ______|PASSWORD: ______',
  player: 'EMPLOYEE 4471|SHIFT 09:00-17:00|STATUS: ACTIVE',
  screensaver: 'H S G',
  memo: 'INTERNAL MEMO|RE: INSPECTIONS|DO NOT LEAVE|THE FLOOR',
  microfiche: 'FLOOR 14 PLAN|REV. 11/09|(TOMORROW)',
};

export const buildComputer: PropBuilder = (ctx, k) => {
  const micro = ctx.placement.variant === 'microfiche';
  k.instance(ctx, micro ? 'microfiche' : 'computer', (t) => {
    if (micro) {
      t.boxUp(0.55, 0.5, 0.5, 'plastic-beige', 0, 0, 0.05);
      t.boxUp(0.5, 0.05, 0.3, 'plastic-dark', 0, 0, -0.32);
    } else {
      t.boxUp(0.42, 0.05, 0.36, 'plastic-beige', 0, 0, 0.08); // base
      t.boxUp(0.4, 0.36, 0.34, 'plastic-beige', 0, 0.06, 0.1); // CRT casing
      t.boxUp(0.3, 0.26, 0.12, 'plastic-beige', 0, 0.1, 0.3); // tube back
      t.boxUp(0.44, 0.025, 0.15, 'plastic-beige', 0, 0, -0.24); // keyboard
      t.boxUp(0.4, 0.01, 0.11, 'plastic-dark', 0, 0.025, -0.24);
      t.boxUp(0.06, 0.03, 0.1, 'plastic-beige', 0.32, 0, -0.22); // mouse
    }
  });
  const style: TextStyle = micro ? 'terminal' : 'crt';
  const text = surface(k.id, k, 256, 192, style, true);
  const screen = textPlane(k, text, micro ? 0.42 : 0.31, micro ? 0.3 : 0.23, 0, micro ? 0.27 : 0.24, micro ? -0.205 : -0.075, 'screen');
  screen.isPickable = true;
  const key = String(ctx.placement.params?.['screen'] ?? 'login');
  k.result.text = text;
  k.result.defaultText = SCREEN_TEXT[key] ?? SCREEN_TEXT['login'];
};

export const buildTerminal: PropBuilder = (_ctx, k) => {
  k.boxUp(0.5, 0.06, 0.42, 'plastic-beige', 0, 0, 0.06);
  k.boxUp(0.48, 0.42, 0.4, 'plastic-beige', 0, 0.06, 0.08);
  k.boxUp(0.36, 0.3, 0.16, 'plastic-beige', 0, 0.1, 0.32);
  k.boxUp(0.5, 0.03, 0.17, 'plastic-beige', 0, 0, -0.26);
  k.boxUp(0.46, 0.012, 0.13, 'plastic-dark', 0, 0.03, -0.26);
  k.boxUp(0.06, 0.015, 0.015, 'emissive-green', 0.18, 0.08, -0.125);
  const text = surface(k.id, k, 512, 384, 'terminal', true);
  textPlane(k, text, 0.38, 0.29, 0, 0.27, -0.125, 'screen');
  k.result.text = text;
  k.result.defaultText = 'HSG FLOOR INSPECTION|SYSTEM v2.3||> READY_||[E] TO BEGIN';
};

export const buildPhone: PropBuilder = (ctx, k) => {
  if (ctx.placement.variant === 'speaker') {
    k.cyl(0.32, 0.36, 0.05, 'plastic-dark', 0, 0, 0, { tess: 3 });
    k.cyl(0.1, 0.12, 0.02, 'metal-dark', 0, 0.05, 0, { tess: 16 });
    const led = k.box(0.03, 0.01, 0.03, 'emissive-screen-off', 0, 0.06, -0.08, { keep: 'led' });
    led.isPickable = true;
    return;
  }
  k.boxUp(0.22, 0.06, 0.2, 'plastic-beige', 0, 0, 0);
  k.boxUp(0.23, 0.04, 0.06, 'plastic-beige', 0, 0.06, 0.06, { rx: -0.2 });
  k.box(0.05, 0.03, 0.21, 'plastic-beige', -0.06, 0.11, 0.06, { ry: Math.PI / 2 });
  for (let i = 0; i < 12; i++) k.boxUp(0.025, 0.008, 0.02, 'plastic-white', -0.04 + (i % 3) * 0.035, 0.06, -0.06 + Math.floor(i / 3) * 0.03);
  k.boxUp(0.02, 0.01, 0.02, 'emissive-red', 0.08, 0.06, -0.07);
};

export const buildDeskLamp: PropBuilder = (_ctx, k) => {
  k.cyl(0.14, 0.16, 0.03, 'metal-dark', 0, 0, 0);
  k.box(0.02, 0.32, 0.02, 'metal-dark', 0, 0.18, 0.02, { rx: 0.25 });
  k.box(0.02, 0.28, 0.02, 'metal-dark', 0, 0.42, -0.06, { rx: -0.6 });
  k.cyl(0.08, 0.17, 0.12, 'metal-dark', 0, 0.42, -0.16, { rx: 0.5 });
  k.sphere(0.06, 'emissive-amber', 0, 0.44, -0.17);
};

export const buildPlant: PropBuilder = (ctx, k) => {
  const variant = ctx.placement.variant ?? 'fern';
  const leaves = variant === 'red' ? 'leaves-red' : variant === 'ficus' ? 'leaves-ficus' : 'leaves-fern';
  const tall = variant === 'ficus';
  k.cyl(0.42, 0.3, 0.42, 'terracotta', 0, 0, 0, { tess: 18 });
  k.cyl(0.44, 0.44, 0.04, 'terracotta', 0, 0.4, 0, { tess: 18 });
  k.cyl(0.38, 0.38, 0.01, 'soil', 0, 0.39, 0, { tess: 18 });
  if (tall) k.cyl(0.04, 0.06, 0.9, 'wood-dark', 0, 0.4, 0);
  const base = tall ? 0.9 : 0.4;
  const h = tall ? 1.1 : 0.85;
  const w = tall ? 1.0 : 0.9;
  for (let i = 0; i < 3; i++) {
    k.plane(w, h, leaves, 0, base + h / 2, 0, { ry: (i * Math.PI) / 3, double: true });
  }
  k.plane(w * 0.8, w * 0.8, leaves, 0, base + h * 0.55, 0, { rx: Math.PI / 2, double: true });
  k.collider(0, 0, 0.42, 0.42);
};

export const buildWhiteboard: PropBuilder = (ctx, k) => {
  const text = surface(k.id, k, 768, 384, 'whiteboard');
  k.boxUp(2.44, 1.24, 0.03, 'chrome', 0, -0.62, -0.015);
  textPlane(k, text, 2.36, 1.16, 0, 0, -0.032);
  k.boxUp(1.2, 0.03, 0.08, 'chrome', 0, -0.66, -0.06);
  k.boxUp(0.12, 0.02, 0.02, 'emissive-screen-off', -0.3, -0.63, -0.06);
  k.result.text = text;
  k.result.defaultText = String(ctx.placement.params?.['text'] ?? '');
};

export const buildProjectorScreen: PropBuilder = (_ctx, k) => {
  k.boxUp(2.5, 0.1, 0.12, 'plastic-white', 0, 0.85, -0.06);
  k.boxUp(2.4, 1.55, 0.01, 'plastic-white', 0, -0.7, -0.08);
  k.boxUp(2.4, 0.03, 0.03, 'metal-dark', 0, -0.72, -0.08);
};

export const buildWaterCooler: PropBuilder = (_ctx, k) => {
  k.boxUp(0.32, 0.95, 0.32, 'plastic-white', 0, 0, 0);
  k.cyl(0.28, 0.28, 0.42, 'water-blue', 0, 0.98, 0, { tess: 18 });
  k.cyl(0.12, 0.28, 0.06, 'water-blue', 0, 0.95, 0, { tess: 18 });
  k.boxUp(0.04, 0.05, 0.04, 'emissive-red', -0.06, 0.78, -0.17);
  k.boxUp(0.04, 0.05, 0.04, 'plastic-dark', 0.06, 0.78, -0.17);
  k.collider(0, 0, 0.36, 0.36);
};

export const buildPrinter: PropBuilder = (_ctx, k) => {
  k.boxUp(1.0, 0.75, 0.65, 'plastic-white', 0, 0, 0);
  k.boxUp(0.95, 0.25, 0.6, 'plastic-beige', 0, 0.75, 0.02);
  k.boxUp(0.9, 0.04, 0.55, 'plastic-dark', 0, 1.0, 0.02);
  k.boxUp(0.3, 0.08, 0.15, 'plastic-dark', 0.3, 0.9, -0.33, { rx: 0.4 });
  k.boxUp(0.36, 0.03, 0.3, 'plastic-beige', -0.6, 0.6, 0, { rz: 0.1 });
  k.boxUp(0.3, 0.01, 0.22, 'paper', -0.62, 0.64, 0);
  for (let i = 0; i < 3; i++) k.boxUp(0.85, 0.01, 0.01, 'plastic-dark', 0, 0.2 + i * 0.2, -0.33);
  k.boxUp(0.05, 0.02, 0.02, 'emissive-green', 0.15, 0.93, -0.36);
  k.collider(0, 0, 1.3, 0.7);
};

export const buildVendingMachine: PropBuilder = (_ctx, k) => {
  const d = 0.8;
  k.boxUp(0.95, 1.85, d, 'red-paint', 0, 0, -d / 2);
  const panel = k.lib.canvasMaterial(`${k.id}-panel`, 256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        const x = 14 + c * 58;
        const y = 20 + r * 76;
        ctx.fillStyle = '#20252a';
        ctx.fillRect(x, y, 48, 60);
        ctx.fillStyle = '#e8e4d8';
        ctx.fillRect(x + 10, y + 14, 28, 34);
        ctx.fillStyle = '#7a7466';
        ctx.font = 'bold 7px Arial';
        ctx.fillText('THANK', x + 12, y + 28);
        ctx.fillText('YOU', x + 15, y + 38);
      }
    }
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { emissive: true });
  const window = k.plane(0.66, 1.35, panel.material, -0.1, 1.05, -d - 0.005, { keep: 'window' });
  window.isPickable = true;
  k.boxUp(0.16, 0.5, 0.01, 'plastic-dark', 0.36, 1.0, -d - 0.006);
  k.boxUp(0.7, 0.18, 0.02, 'plastic-dark', -0.08, 0.15, -d - 0.01);
  k.collider(0, -d / 2, 0.97, d + 0.04);
  k.result.disposeExtra = () => k.lib.release(panel.material);
};

export const buildCoffeeMachine: PropBuilder = (_ctx, k) => {
  k.boxUp(0.3, 0.4, 0.34, 'plastic-dark', 0, 0, 0);
  k.boxUp(0.28, 0.06, 0.34, 'metal-dark', 0, 0.4, 0);
  k.cyl(0.13, 0.11, 0.16, 'glass', 0, 0.03, -0.08, { tess: 14 });
  k.cyl(0.1, 0.09, 0.07, 'wood-dark', 0, 0.03, -0.08, { tess: 14 });
  k.boxUp(0.02, 0.02, 0.01, 'emissive-red', 0.1, 0.32, -0.172);
};

export const buildFridge: PropBuilder = (_ctx, k) => {
  const d = 0.7;
  k.boxUp(0.75, 1.8, d, 'plastic-white', 0, 0, -d / 2);
  k.boxUp(0.74, 0.01, 0.01, 'plastic-beige', 0, 1.18, -d - 0.004);
  k.boxUp(0.03, 0.4, 0.04, 'chrome', -0.3, 1.3, -d - 0.02);
  k.boxUp(0.03, 0.5, 0.04, 'chrome', -0.3, 0.55, -d - 0.02);
  k.collider(0, -d / 2, 0.77, d + 0.04);
};

export const buildMicrowave: PropBuilder = (ctx, k) => {
  k.boxUp(0.5, 0.3, 0.38, 'plastic-white', 0, 0, 0);
  k.boxUp(0.32, 0.22, 0.01, 'glass', -0.06, 0.04, -0.195);
  k.boxUp(0.11, 0.22, 0.01, 'plastic-dark', 0.18, 0.04, -0.195);
  const text = surface(k.id, k, 128, 48, 'led', true);
  textPlane(k, text, 0.08, 0.03, 0.18, 0.22, -0.202, 'display');
  k.result.text = text;
  k.result.defaultText = String(ctx.placement.params?.['display'] ?? '12:00');
};

export const buildPainting: PropBuilder = (ctx, k) => {
  const w = 0.95;
  const h = 0.7;
  k.box(w + 0.08, h + 0.08, 0.04, 'frame-gold', 0, 0, -0.02);
  const canvases = new Map<string, StandardMaterial>();
  const material = (variant: string) => {
    let m = canvases.get(variant);
    if (!m) {
      m = k.lib.canvasMaterial(`${k.id}-${variant}`, 512, 384, (c, cw, ch) => drawPainting(c, cw, ch, variant), { specular: 0.1 }).material;
      canvases.set(variant, m);
    }
    return m;
  };
  const art = k.plane(w, h, material(ctx.placement.variant ?? 'lake'), 0, 0, -0.042, { keep: 'canvas' });
  art.isPickable = true;
  k.result.setVariant = (v) => (art.material = material(v));
  k.result.disposeExtra = () => canvases.forEach((m) => k.lib.release(m));
};

export const buildPoster: PropBuilder = (ctx, k) => {
  const w = 0.62;
  const h = 0.88;
  k.box(w + 0.04, h + 0.04, 0.02, 'frame-black', 0, 0, -0.01);
  const mats = new Map<string, StandardMaterial>();
  const material = (variant: string) => {
    let m = mats.get(variant);
    if (!m) {
      m = k.lib.canvasMaterial(`${k.id}-${variant}`, 256, 368, (c, cw, ch) => drawPoster(c, cw, ch, variant), { specular: 0.15 }).material;
      mats.set(variant, m);
    }
    return m;
  };
  const art = k.plane(w, h, material(ctx.placement.variant ?? 'teamwork'), 0, 0, -0.022, { keep: 'art' });
  art.isPickable = true;
  k.result.setVariant = (v) => (art.material = material(v));
  k.result.disposeExtra = () => mats.forEach((m) => k.lib.release(m));
};

export const buildWallSign: PropBuilder = (ctx, k) => {
  const variant = ctx.placement.variant ?? 'plate';
  const text = String(ctx.placement.params?.['text'] ?? '');
  if (variant === 'logo') {
    const s = surface(k.id, k, 1024, 256, 'logo', false, true);
    textPlane(k, s, 3.2, 0.8, 0, 0, -0.01);
    k.result.text = s;
    k.result.defaultText = `${text}|${String(ctx.placement.params?.['sub'] ?? '')}`;
    return;
  }
  if (variant === 'directory') {
    const s = surface(k.id, k, 384, 512, 'directory');
    k.box(0.78, 1.04, 0.04, 'frame-black', 0, 0, -0.02);
    textPlane(k, s, 0.72, 0.98, 0, 0, -0.042);
    k.result.text = s;
    k.result.defaultText = text;
    return;
  }
  if (variant === 'floor-number') {
    const s = surface(k.id, k, 256, 256, 'floor-number');
    textPlane(k, s, 0.5, 0.5, 0, 0, -0.01);
    k.result.text = s;
    k.result.defaultText = text;
    return;
  }
  const s = surface(k.id, k, 512, 128, variant === 'arrow' ? 'arrow' : 'sign-plate');
  k.box(1.02, 0.27, 0.02, 'frame-black', 0, 0, -0.01);
  textPlane(k, s, 1.0, 0.25, 0, 0, -0.022);
  k.result.text = s;
  k.result.defaultText = text;
};

export const buildNote: PropBuilder = (ctx, k) => {
  const s = surface(k.id, k, 256, 192, 'label');
  textPlane(k, s, 0.24, 0.18, 0, 0, -0.004);
  k.result.text = s;
  k.result.defaultText = String(ctx.placement.params?.['text'] ?? '');
};

export const buildCalendar: PropBuilder = (ctx, k) => {
  const s = surface(k.id, k, 256, 384, 'calendar');
  s.meta['month'] = String(ctx.placement.params?.['month'] ?? 'NOVEMBER');
  textPlane(k, s, 0.4, 0.6, 0, 0, -0.006);
  k.box(0.42, 0.02, 0.012, 'metal-dark', 0, 0.3, -0.006);
  k.result.text = s;
  k.result.defaultText = String(ctx.placement.params?.['note'] ?? '');
};

export const buildWallClock: PropBuilder = (_ctx, k) => {
  const face = k.lib.canvasMaterial(`${k.id}-face`, 256, 256, (c, w, h) => {
    c.fillStyle = '#efece2';
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1b1b1b';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r1 = w * 0.46;
      const r2 = i % 5 === 0 ? w * 0.39 : w * 0.43;
      c.save();
      c.translate(w / 2, h / 2);
      c.rotate(a);
      c.fillRect(-(i % 5 === 0 ? 2.5 : 1), -r1, i % 5 === 0 ? 5 : 2, r1 - r2);
      c.restore();
    }
    c.font = 'bold 26px "Arial Narrow", Arial';
    c.textAlign = 'center';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.fillText(String(i), w / 2 + Math.sin(a) * w * 0.31, h / 2 - Math.cos(a) * w * 0.31 + 9);
    }
    c.font = '10px Arial';
    c.fillText('HSG', w / 2, h * 0.68);
  }, { specular: 0.3, alpha: true });
  k.cyl(0.34, 0.34, 0.05, 'plastic-dark', 0, 0, -0.025, { rx: -Math.PI / 2, tess: 32 });
  const faceMesh = k.plane(0.31, 0.31, face.material, 0, 0, -0.052, { keep: 'face' });
  faceMesh.isPickable = true;
  const hand = (name: string, length: number, width: number, mat: 'plastic-dark' | 'red-paint', z: number) => {
    const pivot = k.pivot(name, 0, 0, z);
    const m = k.box(width, length, 0.004, mat, 0, length / 2 - 0.015, 0);
    k.attach(m, pivot);
    return pivot;
  };
  k.result.clock = {
    hour: hand('hour', 0.085, 0.012, 'plastic-dark', -0.056),
    minute: hand('minute', 0.125, 0.008, 'plastic-dark', -0.06),
    second: hand('second', 0.135, 0.003, 'red-paint', -0.064),
  };
  k.sphere(0.014, 'plastic-dark', 0, 0, -0.066);
  k.result.disposeExtra = () => k.lib.release(face.material);
};

export const buildExitSign: PropBuilder = (ctx, k) => {
  const arrow = String(ctx.placement.params?.['arrow'] ?? '');
  const mat = k.lib.canvasMaterial(`${k.id}-exit`, 256, 96, (c, w, h) => {
    c.fillStyle = '#071a0c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#4dff7a';
    c.shadowColor = '#4dff7a';
    c.shadowBlur = 10;
    c.font = 'bold 56px "Arial Narrow", Arial';
    c.textAlign = 'center';
    c.fillText(arrow === 'right' ? 'EXIT →' : arrow === 'left' ? '← EXIT' : 'EXIT', w / 2, h * 0.72);
  }, { emissive: true });
  k.boxUp(0.36, 0.16, 0.06, 'plastic-white', 0, -0.08, 0);
  k.plane(0.33, 0.13, mat.material, 0, 0, -0.031, { keep: 'face-a' });
  k.plane(0.33, 0.13, mat.material, 0, 0, 0.031, { keep: 'face-b', ry: Math.PI });
  k.boxUp(0.02, 0.2, 0.02, 'metal', 0, 0.08, 0);
  k.result.disposeExtra = () => k.lib.release(mat.material);
};

export const buildFireExtinguisher: PropBuilder = (_ctx, k) => {
  k.boxUp(0.12, 0.08, 0.04, 'metal-dark', 0, 0.1, -0.02);
  k.cyl(0.15, 0.15, 0.48, 'red-paint', 0, -0.32, -0.1, { tess: 16 });
  k.sphere(0.15, 'red-paint', 0, 0.16, -0.1, { sy: 0.6 });
  k.boxUp(0.05, 0.08, 0.05, 'metal-dark', 0, 0.18, -0.1);
  k.box(0.02, 0.2, 0.02, 'rubber', 0.08, 0.0, -0.12, { rz: 0.3 });
  k.boxUp(0.1, 0.12, 0.002, 'paper', 0, -0.15, -0.176);
};

export const buildTrashCan: PropBuilder = (_ctx, k) => {
  k.cyl(0.3, 0.26, 0.36, 'metal-dark', 0, 0, 0, { tess: 16 });
  k.cyl(0.27, 0.27, 0.01, 'rubber', 0, 0.355, 0, { tess: 16 });
  k.boxUp(0.12, 0.03, 0.1, 'paper', 0.03, 0.3, 0.02, { ry: 0.6 });
  k.collider(0, 0, 0.3, 0.3);
};

export const buildServerRack: PropBuilder = (_ctx, k) => {
  const d = 0.8;
  k.boxUp(0.6, 2.0, d, 'metal-dark', 0, 0, 0);
  const leds = k.lib.canvasMaterial(`${k.id}-leds`, 128, 256, () => undefined, { emissive: true });
  const panel = k.plane(0.5, 1.7, leds.material, 0, 1.0, -d / 2 - 0.005, { keep: 'leds' });
  panel.isPickable = true;
  let accum = 0;
  let phase = 0;
  const redraw = () => {
    const c = leds.texture.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#0b0c0e';
    c.fillRect(0, 0, 128, 256);
    for (let r = 0; r < 14; r++) {
      c.fillStyle = '#16181b';
      c.fillRect(6, 6 + r * 18, 116, 14);
      for (let i = 0; i < 8; i++) {
        const on = ((phase + i * 3 + r * 5) % 7) < 3;
        c.fillStyle = on ? (i % 3 === 0 ? '#ffb340' : '#40ff6a') : '#132016';
        c.fillRect(70 + i * 6, 10 + r * 18, 3, 3);
      }
    }
    leds.texture.update(true);
  };
  redraw();
  k.result.update = (dt) => {
    accum += dt;
    if (accum > 0.5) {
      accum = 0;
      phase++;
      redraw();
    }
  };
  k.collider(0, 0, 0.62, d + 0.02);
  k.result.disposeExtra = () => k.lib.release(leds.material);
};

export const buildLogbook: PropBuilder = (_ctx, k) => {
  k.boxUp(0.42, 0.02, 0.3, 'frame-black', 0, 0, 0);
  const s = surface(k.id, k, 384, 256, 'handwriting');
  k.plane(0.4, 0.28, s.material, 0, 0.022, 0, { rx: Math.PI / 2, keep: 'page' });
  k.result.text = s;
  k.result.defaultText = '03:12 ALL QUIET|ELEVATOR B STILL OUT OF SERVICE';
};

export const buildNameplate: PropBuilder = (ctx, k) => {
  k.box(0.32, 0.075, 0.03, 'wood-dark', 0, 0.035, 0.0, { rx: -0.35 });
  const s = surface(k.id, k, 512, 112, 'nameplate');
  k.plane(0.3, 0.065, s.material, 0, 0.038, -0.017, { rx: -0.35, keep: 'plate' });
  k.result.text = s;
  k.result.defaultText = String(ctx.placement.params?.['text'] ?? '');
};

export const buildPhotoFrame: PropBuilder = (_ctx, k) => {
  k.box(0.2, 0.16, 0.015, 'frame-gold', 0, 0.08, 0, { rx: -0.2 });
  const photo = k.lib.canvasMaterial(`${k.id}-photo`, 128, 96, (c, w, h) => {
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#d8e4ec');
    sky.addColorStop(0.55, '#f2efe4');
    sky.addColorStop(0.56, '#d9c9a0');
    sky.addColorStop(1, '#c4b088');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = ['#40506a', '#7a3a2a', '#3d5a3a'][i];
      c.fillRect(30 + i * 26, 40, 14, 34);
      c.fillStyle = '#fff6ea';
      c.beginPath();
      c.arc(37 + i * 26, 34, 7, 0, Math.PI * 2);
      c.fill();
    }
  });
  k.plane(0.17, 0.13, photo.material, 0, 0.08, -0.009, { rx: -0.2, keep: 'photo' });
  k.box(0.02, 0.12, 0.02, 'frame-gold', 0, 0.05, 0.05, { rx: 0.5 });
  k.result.disposeExtra = () => k.lib.release(photo.material);
};

export const buildDeskFan: PropBuilder = (_ctx, k) => {
  k.cyl(0.14, 0.16, 0.03, 'plastic-white', 0, 0, 0);
  k.cyl(0.03, 0.03, 0.2, 'plastic-white', 0, 0.03, 0);
  k.boxUp(0.1, 0.1, 0.12, 'plastic-white', 0, 0.2, 0.03);
  const hub = k.pivot('blades', 0, 0.25, -0.05);
  for (let i = 0; i < 3; i++) {
    const blade = k.box(0.05, 0.11, 0.004, 'plastic-white', 0, 0.06, 0, {});
    const bp = k.pivot(`blade-${i}`, 0, 0, 0, hub);
    bp.rotation.z = (i / 3) * Math.PI * 2;
    k.attach(blade, bp);
  }
  k.torus(0.28, 0.006, 'chrome', 0, 0.25, -0.06, { rx: Math.PI / 2 });
  k.result.update = (dt) => {
    hub.rotation.z += dt * 18;
  };
};

export const buildCurtains: PropBuilder = (ctx, k) => {
  const width = Number(ctx.placement.params?.['width'] ?? 2.6);
  const h = 2.55;
  k.cyl(0.03, 0.03, width + 0.3, 'metal-dark', 0, 2.6, -0.05, { rz: Math.PI / 2 });
  const pivots: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const pivot = k.pivot(`curtain-${side}`, side * (width / 2 - 0.25), 2.6, -0.06);
    pivots.push(pivot);
    k.attach(k.box(0.55, h, 0.04, 'fabric-curtain', 0, -h / 2, 0), pivot);
    for (let f = 0; f < 3; f++) k.attach(k.box(0.06, h, 0.06, 'fabric-curtain', -0.2 + f * 0.2, -h / 2, -0.02), pivot);
  }
  k.result.update = (_dt, t) => {
    pivots[0].rotation.x = Math.sin(t * 0.7) * 0.012 + Math.sin(t * 1.9) * 0.004;
    pivots[1].rotation.x = Math.sin(t * 0.6 + 1) * 0.012 + Math.sin(t * 2.3) * 0.004;
  };
};

export const buildPaSpeaker: PropBuilder = (_ctx, k) => {
  k.box(0.3, 0.2, 0.1, 'plastic-white', 0, 0, -0.05);
  for (let i = 0; i < 6; i++) k.box(0.24, 0.01, 0.005, 'plastic-dark', 0, -0.06 + i * 0.025, -0.102);
};

export const buildBadgeReader: PropBuilder = (_ctx, k) => {
  k.box(0.09, 0.14, 0.03, 'plastic-dark', 0, 0, -0.015);
  k.box(0.06, 0.06, 0.002, 'metal-dark', 0, 0.01, -0.031);
  const led = k.box(0.015, 0.015, 0.006, 'emissive-red', 0, 0.055, -0.032, { keep: 'led' });
  led.isPickable = true;
};

export const buildElevatorCallPanel: PropBuilder = (_ctx, k) => {
  k.box(0.16, 0.32, 0.02, 'metal-brushed', 0, 0, -0.01);
  k.cyl(0.05, 0.05, 0.015, 'chrome', 0, 0.06, -0.02, { rx: -Math.PI / 2 });
  k.cyl(0.05, 0.05, 0.015, 'chrome', 0, -0.06, -0.02, { rx: -Math.PI / 2 });
  const up = k.cyl(0.036, 0.036, 0.006, 'emissive-screen-off', 0, 0.06, -0.03, { rx: -Math.PI / 2, keep: 'button-up' });
  const down = k.cyl(0.036, 0.036, 0.006, 'emissive-screen-off', 0, -0.06, -0.03, { rx: -Math.PI / 2, keep: 'button-down' });
  up.isPickable = true;
  down.isPickable = true;
};

export const buildElevatorIndicator: PropBuilder = (ctx, k) => {
  k.box(0.5, 0.2, 0.03, 'metal-brushed', 0, 0, -0.015);
  const s = surface(k.id, k, 256, 96, 'led', true);
  k.plane(0.42, 0.15, s.material, 0, 0, -0.032, { keep: 'display' });
  k.result.text = s;
  k.result.defaultText = ctx.placement.variant === 'dead' ? '' : '--';
};

export const buildElevatorCarPanel: PropBuilder = (_ctx, k) => {
  k.box(0.26, 0.6, 0.02, 'metal-brushed', 0, 0, -0.01);
  const labels = ['14', '13', '12', '2', '1', 'G'];
  labels.forEach((_, i) => {
    k.cyl(0.04, 0.04, 0.01, 'chrome', -0.05 + (i % 2) * 0.1, 0.18 - Math.floor(i / 2) * 0.09, -0.022, { rx: -Math.PI / 2 });
  });
  const g = k.cyl(0.042, 0.042, 0.006, 'emissive-screen-off', 0.05, 0.0, -0.03, { rx: -Math.PI / 2, keep: 'button-g' });
  g.isPickable = true;
  k.box(0.07, 0.07, 0.01, 'brass', 0, -0.19, -0.022);
  k.cyl(0.02, 0.02, 0.012, 'frame-black', 0, -0.19, -0.03, { rx: -Math.PI / 2 });
  k.box(0.14, 0.03, 0.002, 'paper', 0, -0.24, -0.024);
};

export const buildWaterFountain: PropBuilder = (_ctx, k) => {
  k.boxUp(0.42, 0.25, 0.32, 'chrome', 0, 0.75, -0.16);
  k.boxUp(0.3, 0.05, 0.22, 'metal-dark', 0, 0.98, -0.17);
  k.boxUp(0.12, 0.75, 0.1, 'metal', 0, 0, -0.05);
  k.boxUp(0.04, 0.06, 0.04, 'chrome', 0.08, 1.0, -0.14);
  k.collider(0, -0.16, 0.44, 0.34);
};

export const buildFireAlarm: PropBuilder = (_ctx, k) => {
  k.box(0.12, 0.16, 0.05, 'red-paint', 0, 0, -0.025);
  k.box(0.08, 0.03, 0.03, 'plastic-white', 0, 0.0, -0.06);
  k.box(0.1, 0.02, 0.002, 'plastic-white', 0, 0.06, -0.051);
};

export const buildCeilingVent: PropBuilder = (_ctx, k) => {
  k.boxUp(0.6, 0.02, 0.6, 'metal', 0, -0.02, 0);
  for (let i = 0; i < 7; i++) k.boxUp(0.52, 0.025, 0.012, 'metal-dark', 0, -0.035, -0.24 + i * 0.08);
};

export const buildRadiator: PropBuilder = (_ctx, k) => {
  for (let i = 0; i < 14; i++) k.boxUp(0.05, 0.6, 0.12, 'plastic-white', -0.42 + i * 0.065, 0.12, -0.08);
  k.boxUp(0.92, 0.04, 0.1, 'plastic-white', 0, 0.12, -0.08);
  k.boxUp(0.92, 0.04, 0.1, 'plastic-white', 0, 0.68, -0.08);
  k.collider(0, -0.08, 0.95, 0.16);
};

export const buildUmbrellaStand: PropBuilder = (_ctx, k) => {
  k.cyl(0.26, 0.24, 0.5, 'metal-dark', 0, 0, 0, { tess: 14 });
  k.cyl(0.02, 0.02, 0.85, 'frame-black', 0.04, 0.05, 0, { rz: 0.12 });
  k.cyl(0.02, 0.02, 0.8, 'red-paint', -0.05, 0.05, 0.03, { rz: -0.1 });
  k.torus(0.08, 0.02, 'frame-black', 0.1, 0.92, 0, { rx: Math.PI / 2 });
  k.collider(0, 0, 0.28, 0.28);
};

export const buildMug: PropBuilder = (_ctx, k) => {
  k.cyl(0.08, 0.075, 0.1, 'plastic-white', 0, 0, 0, { tess: 14 });
  k.cyl(0.07, 0.07, 0.005, 'wood-dark', 0, 0.085, 0, { tess: 14 });
  k.torus(0.06, 0.012, 'plastic-white', 0.05, 0.05, 0, { rx: Math.PI / 2 });
};

export const buildPaperStack: PropBuilder = (_ctx, k) => {
  for (let i = 0; i < 4; i++) k.boxUp(0.22, 0.008, 0.3, 'paper', (i % 2) * 0.01, i * 0.009, 0, { ry: (i - 1.5) * 0.06 });
  k.boxUp(0.24, 0.006, 0.32, 'cardboard', 0.02, 0.036, 0, { ry: 0.1 });
};

export const buildMemo: PropBuilder = (_ctx, k) => {
  const s = surface(k.id, k, 256, 320, 'paper');
  k.plane(0.21, 0.27, s.material, 0, 0.004, 0, { rx: Math.PI / 2, keep: 'sheet' }).isPickable = true;
  k.result.text = s;
  k.result.defaultText = 'MAINTENANCE|SERVICE ELEVATOR|LOWER LEVELS|KEY: STORAGE, HOOK 3';
};

export const buildKeyHook: PropBuilder = (_ctx, k) => {
  k.box(0.4, 0.12, 0.02, 'wood-light', 0, 0, -0.01);
  for (let i = 0; i < 4; i++) k.cyl(0.012, 0.012, 0.05, 'brass', -0.15 + i * 0.1, -0.02, -0.04, { rx: Math.PI / 2 });
  const key = k.box(0.025, 0.07, 0.006, 'brass', 0.05, -0.065, -0.05, { keep: 'key' });
  key.isPickable = true;
  const tag = k.box(0.04, 0.05, 0.003, 'paper', 0.05, -0.12, -0.05, { keep: 'key-tag' });
  tag.isPickable = true;
};

export const buildBreakerPanel: PropBuilder = (_ctx, k) => {
  k.box(0.45, 0.65, 0.1, 'metal', 0, 0, -0.05);
  k.box(0.43, 0.63, 0.01, 'metal', 0, 0, -0.105);
  k.box(0.03, 0.08, 0.02, 'chrome', 0.18, 0, -0.115);
  k.box(0.2, 0.04, 0.002, 'paper', 0, 0.25, -0.111);
};

export const buildWallMap: PropBuilder = (ctx, k) => {
  const stage = ctx.stage;
  const xs = stage.rooms.flatMap((r) => [r.bounds.x0, r.bounds.x1]);
  const zs = stage.rooms.flatMap((r) => [r.bounds.z0, r.bounds.z1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const here = ctx.placement.position;
  const mat = k.lib.canvasMaterial(`${k.id}-map`, 512, 384, (c, w, h) => {
    c.fillStyle = '#efeadb';
    c.fillRect(0, 0, w, h);
    const pad = 36;
    const sx = (w - pad * 2) / (maxX - minX);
    const sz = (h - pad * 2 - 30) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    const X = (x: number) => pad + (x - minX) * s;
    const Z = (z: number) => h - pad - (z - minZ) * s;
    c.strokeStyle = '#2b2a28';
    c.lineWidth = 2;
    c.font = 'bold 10px "Arial Narrow", Arial';
    c.textAlign = 'center';
    for (const r of stage.rooms) {
      c.fillStyle = r.id === ctx.room.id ? '#d9d2bc' : '#f6f2e6';
      c.fillRect(X(r.bounds.x0), Z(r.bounds.z1), (r.bounds.x1 - r.bounds.x0) * s, (r.bounds.z1 - r.bounds.z0) * s);
      c.strokeRect(X(r.bounds.x0), Z(r.bounds.z1), (r.bounds.x1 - r.bounds.x0) * s, (r.bounds.z1 - r.bounds.z0) * s);
      c.fillStyle = '#2b2a28';
      c.fillText(r.name.toUpperCase(), X((r.bounds.x0 + r.bounds.x1) / 2), Z((r.bounds.z0 + r.bounds.z1) / 2) + 3);
    }
    c.fillStyle = '#efeadb';
    for (const d of stage.doors) {
      const half = (d.width / 2) * s;
      if (d.axis === 'x') c.fillRect(X(d.at) - 3, Z(d.center) - half, 6, half * 2);
      else c.fillRect(X(d.center) - half, Z(d.at) - 3, half * 2, 6);
    }
    c.fillStyle = '#c0261c';
    c.beginPath();
    c.arc(X(here[0]), Z(here[2]), 6, 0, Math.PI * 2);
    c.fill();
    c.font = 'bold 12px "Arial Narrow", Arial';
    c.fillText('YOU ARE HERE', X(here[0]), Z(here[2]) - 10);
    c.fillStyle = '#2b2a28';
    c.font = 'bold 16px "Arial Narrow", Arial';
    c.fillText(`${stage.floorLabel} — EVACUATION PLAN`, w / 2, 24);
  }, { specular: 0.15 });
  k.box(0.74, 0.56, 0.02, 'frame-black', 0, 0, -0.01);
  k.plane(0.7, 0.52, mat.material, 0, 0, -0.021, { keep: 'map' }).isPickable = true;
  k.result.disposeExtra = () => k.lib.release(mat.material);
};

export const buildMopBucket: PropBuilder = (_ctx, k) => {
  k.cyl(0.36, 0.3, 0.32, 'yellow-plastic', 0, 0, 0, { tess: 16 });
  k.cyl(0.3, 0.3, 0.01, 'concrete-raw', 0, 0.28, 0, { tess: 16 });
  k.cyl(0.025, 0.025, 1.3, 'wood-light', 0.06, 0.2, 0.04, { rz: 0.25 });
  k.collider(0, 0, 0.38, 0.38);
};

export const buildLadder: PropBuilder = (_ctx, k) => {
  const pivot = k.pivot('frame', 0, 0, 0.25);
  pivot.rotation.x = -0.22;
  for (const sx of [-1, 1]) k.attach(k.boxUp(0.04, 2.2, 0.06, 'metal', sx * 0.2, 0, 0), pivot);
  for (let i = 0; i < 7; i++) k.attach(k.boxUp(0.4, 0.03, 0.05, 'metal', 0, 0.25 + i * 0.29, 0), pivot);
  k.collider(0, 0, 0.5, 0.45);
};

