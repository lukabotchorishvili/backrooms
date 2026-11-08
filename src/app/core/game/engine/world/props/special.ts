import { Color3, Mesh, PointLight, Vector3, Vector4 } from '@babylonjs/core';
import { PropBuilder, PropKit } from '../prop-kit';
import { TextSurface } from '../text-surface';

/** Wall/floor/ceiling slab with world-scaled UVs using a room surface material. */
function slab(k: PropKit, w: number, h: number, d: number, material: ReturnType<PropKit['lib']['surface']>, x: number, y: number, z: number, uvScale: number, fullHeight: boolean): Mesh {
  const vh = fullHeight ? 1 : h / uvScale;
  const faceUV = [
    new Vector4(0, 0, w / uvScale, vh),
    new Vector4(0, 0, w / uvScale, vh),
    new Vector4(0, 0, d / uvScale, vh),
    new Vector4(0, 0, d / uvScale, vh),
    new Vector4(0, 0, w / uvScale, d / uvScale),
    new Vector4(0, 0, w / uvScale, d / uvScale),
  ];
  return k.boxWithUV(w, h, d, material, x, y, z, faceUV);
}

export const buildFrontDoors: PropBuilder = (_ctx, k) => {
  // Fills a 3.2 x 2.6 opening; front = -Z (into the reception), outside is +Z.
  const w = 3.2;
  const h = 2.6;
  k.boxUp(w, 0.12, 0.2, 'metal-dark', 0, h - 0.12, 0);
  k.boxUp(0.1, h, 0.2, 'metal-dark', -w / 2 + 0.05, 0, 0);
  k.boxUp(0.1, h, 0.2, 'metal-dark', w / 2 - 0.05, 0, 0);
  k.boxUp(0.06, h - 0.12, 0.16, 'metal-dark', 0, 0, 0);
  for (const sx of [-1, 1]) {
    k.boxUp(w / 2 - 0.1, h - 0.14, 0.02, 'glass', sx * (w / 4), 0.02, 0);
    k.boxUp(0.5, 0.04, 0.05, 'chrome', sx * 0.4, 1.0, -0.06);
    k.boxUp(0.12, 0.05, 0.002, 'paper', sx * 0.4, 1.35, -0.012);
  }
  // the fog outside
  k.plane(w + 4, h + 2, 'outside-fog', 0, h / 2, 1.6, { ry: Math.PI });
  k.plane(w + 4, h + 2, 'void', 0, h / 2, 1.7, { ry: Math.PI });
  k.collider(0, 0, w, 0.3);
};

export const buildEndWall: PropBuilder = (ctx, k) => {
  const width = Number(ctx.placement.params?.['width'] ?? 3);
  const height = Number(ctx.placement.params?.['height'] ?? 3);
  const wallMat = k.lib.surface(ctx.room.surfaces.walls);
  const { scale, fullHeight } = k.lib.surfaceScale(ctx.room.surfaces.walls);
  // wall slab, front face at z = -0.12 (into the corridor)
  const sideW = (width - 1.1) / 2;
  slab(k, sideW, height, 0.14, wallMat, -width / 2 + sideW / 2, height / 2, -0.07, scale, fullHeight);
  slab(k, sideW, height, 0.14, wallMat, width / 2 - sideW / 2, height / 2, -0.07, scale, fullHeight);
  slab(k, 1.1, height - 2.15, 0.14, wallMat, 0, 2.15 + (height - 2.15) / 2, -0.07, scale, fullHeight);
  // fire door
  k.boxUp(1.0, 2.1, 0.05, 'metal', 0, 0, -0.08);
  k.boxUp(1.1, 0.05, 0.16, 'metal-dark', 0, 2.1, -0.08);
  for (const sx of [-1, 1]) k.boxUp(0.05, 2.15, 0.16, 'metal-dark', sx * 0.55, 0, -0.08);
  k.boxUp(0.8, 0.07, 0.06, 'red-paint', 0, 1.0, -0.13);
  k.boxUp(0.36, 0.1, 0.004, 'red-paint', 0, 1.45, -0.106);
  const sign = new TextSurface(k.lib, `${k.id}-sign`, 512, 128, 'sign-plate');
  sign.draw('EMERGENCY EXIT — ALARM WILL SOUND');
  k.plane(0.78, 0.18, sign.material, 0, 1.62, -0.108, { keep: 'sign' });
  // exit light above the door
  const exit = k.lib.canvasMaterial(`${k.id}-exit`, 256, 96, (c, w, h) => {
    c.fillStyle = '#071a0c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#4dff7a';
    c.shadowColor = '#4dff7a';
    c.shadowBlur = 10;
    c.font = 'bold 60px "Arial Narrow", Arial';
    c.textAlign = 'center';
    c.fillText('EXIT', w / 2, h * 0.74);
  }, { emissive: true });
  k.boxUp(0.38, 0.16, 0.08, 'plastic-white', 0, 2.32, -0.18);
  k.plane(0.34, 0.13, exit.material, 0, 2.4, -0.221, { keep: 'exit' });
  k.collider(0, -0.07, width, 0.2);
  k.result.disposeExtra = () => k.lib.release(exit.material);
};

export const buildCorridorExtension: PropBuilder = (ctx, k) => {
  const length = Number(ctx.placement.params?.['length'] ?? 6);
  const width = Number(ctx.placement.params?.['width'] ?? 3);
  const height = Number(ctx.placement.params?.['height'] ?? 3);
  const floor = k.lib.surface(ctx.room.surfaces.floor);
  const walls = k.lib.surface(ctx.room.surfaces.walls);
  const ceiling = k.lib.surface(ctx.room.surfaces.ceiling);
  const fs = k.lib.surfaceScale(ctx.room.surfaces.floor).scale;
  const ws = k.lib.surfaceScale(ctx.room.surfaces.walls);
  const cs = k.lib.surfaceScale(ctx.room.surfaces.ceiling).scale;
  // Extends along local +Z from the open end of the corridor.
  const zc = length / 2 - 0.05;
  slab(k, width, 0.04, length + 0.1, floor, 0, -0.02, zc, fs, false);
  slab(k, width, 0.04, length + 0.1, ceiling, 0, height + 0.02, zc, cs, false);
  for (const sx of [-1, 1]) slab(k, 0.14, height, length + 0.1, walls, sx * (width / 2 + 0.07 - 0.14), height / 2, zc, ws.scale, ws.fullHeight);
  k.boxUp(1.2, 0.03, 0.6, 'emissive-panel', 0, height - 0.03, length * 0.55);
  k.boxUp(0.2, 0.1, 0.012, 'paper', -width / 2 + 0.08, 1.4, length * 0.3, { ry: Math.PI / 2 });
  for (const sx of [-1, 1]) k.collider(sx * (width / 2 + 0.0), zc, 0.14, length + 0.1);
};

export const buildFakeDoor: PropBuilder = (ctx, k) => {
  const variant = ctx.placement.variant ?? 'sealed';
  const closet = variant.startsWith('closet');
  const w = closet ? 1.0 : 0.95;
  const h = 2.1;
  // frame
  for (const sx of [-1, 1]) k.boxUp(0.07, h + 0.06, closet ? 0.28 : 0.06, 'wood-dark', sx * (w / 2 + 0.035), 0, closet ? 0 : -0.03);
  k.boxUp(w + 0.14, 0.07, closet ? 0.28 : 0.06, 'wood-dark', 0, h, closet ? 0 : -0.03);
  if (!closet) {
    // behind the "door": raw concrete flush with the wall
    k.boxUp(w, h, 0.01, 'concrete-raw', 0, 0, -0.005);
  }
  const hinge = k.pivot('leaf', -w / 2, 0, closet ? -0.02 : -0.04);
  const leaf = k.boxUp(w - 0.02, h - 0.02, 0.045, 'wood-light', w / 2, 0, 0);
  k.attach(leaf, hinge, 'leaf-mesh');
  const knob = k.sphere(0.06, 'chrome', w - 0.12, 1.0, -0.05);
  k.attach(knob, hinge);
  if (closet) {
    const label = new TextSurface(k.lib, `${k.id}-label`, 256, 64, 'sign-plate');
    label.draw(String(ctx.placement.params?.['label'] ?? 'JANITOR'));
    const plate = k.plane(0.32, 0.08, label.material, w / 2, 1.6, -0.026);
    k.attach(plate, hinge);
  }
  const colliderIndex = k.collider(0, 0, w, 0.12);
  k.result.fakeDoor = { leaf: hinge, colliderIndex, openAngle: closet ? -1.9 : -1.4 };
};

export const buildClosetVignette: PropBuilder = (ctx, k) => {
  // A tiny room behind the closet door (+Z) dressed as a copy of the player's desk.
  const inner = 1.2;
  const depth = 2.0;
  const h = 2.3;
  const wallMat = 'concrete-raw';
  k.boxUp(inner + 0.3, h, 0.1, wallMat, 0, 0, depth + 0.05);
  for (const sx of [-1, 1]) k.boxUp(0.1, h, depth, wallMat, sx * (inner / 2 + 0.05), 0, depth / 2);
  k.boxUp(inner + 0.3, 0.05, depth + 0.1, wallMat, 0, h, depth / 2);
  k.boxUp(inner, 0.02, depth, k.lib.surface(ctx.stage.rooms.find((r) => r.id === 'open-plan')?.surfaces.floor ?? 'carpet-blue'), 0, -0.01, depth / 2);
  // replica desk facing the door
  k.boxUp(1.1, 0.03, 0.6, 'laminate', 0, 0.72, depth - 0.45);
  for (const sx of [-1, 1]) k.boxUp(0.03, 0.72, 0.55, 'metal-dark', sx * 0.52, 0, depth - 0.45);
  k.boxUp(0.4, 0.36, 0.34, 'plastic-beige', 0, 0.78, depth - 0.4);
  const screen = new TextSurface(k.lib, `${k.id}-screen`, 256, 192, 'crt', { emissive: true });
  screen.draw('EMPLOYEE 4471|YOUR DESK|HAS BEEN MOVED');
  k.plane(0.31, 0.23, screen.material, 0, 0.98, depth - 0.575, { keep: 'screen' });
  k.cyl(0.08, 0.075, 0.1, 'plastic-white', 0.35, 0.75, depth - 0.4, { tess: 12 });
  k.boxUp(0.46, 0.06, 0.44, 'fabric-chair', 0, 0.44, depth - 1.05);
  k.boxUp(0.44, 0.5, 0.06, 'fabric-chair', 0, 0.5, depth - 1.27);
  k.cyl(0.05, 0.05, 0.44, 'chrome', 0, 0, depth - 1.05);
  k.sphere(0.08, 'emissive-amber', 0, h - 0.12, depth / 2);
  // A bare bulb of its own: the storage room light does not reach in here.
  const bulb = new PointLight(`${k.id}-bulb`, new Vector3(0, h - 0.2, depth / 2), k.scene);
  bulb.parent = k.root;
  bulb.diffuse = new Color3(1, 0.82, 0.6);
  bulb.specular = new Color3(0.2, 0.17, 0.12);
  bulb.intensity = 0.9;
  bulb.range = 3.2;
  k.result.lights = [bulb];
  k.result.disposeExtra = () => bulb.dispose();
  k.collider(0, depth + 0.05, inner + 0.3, 0.12);
  for (const sx of [-1, 1]) k.collider(sx * (inner / 2 + 0.05), depth / 2, 0.12, depth);
  k.collider(0, depth - 0.45, 1.12, 0.62);
};

export const buildFigure: PropBuilder = (_ctx, k) => {
  // Deliberately too tall and too thin. Only security cameras ever see it.
  k.cyl(0.26, 0.3, 1.25, 'figure', 0, 0.62, 0, { tess: 10 });
  k.cyl(0.12, 0.12, 0.66, 'figure', -0.07, 0, 0, { tess: 8 });
  k.cyl(0.12, 0.12, 0.66, 'figure', 0.07, 0, 0, { tess: 8 });
  k.cyl(0.07, 0.08, 0.95, 'figure', -0.2, 0.95, 0, { tess: 8, rz: 0.05 });
  k.cyl(0.07, 0.08, 0.95, 'figure', 0.2, 0.95, 0, { tess: 8, rz: -0.05 });
  k.sphere(0.24, 'figure', 0, 2.0, 0, { sy: 1.25 });
};
