import { PropBuilder, PropKit } from '../prop-kit';

/*
 * Furniture builders. Conventions (prop-local space):
 *  - origin = centre of the footprint on the floor; front = -Z (the side a user faces / sits at)
 *  - "back-anchored" wall furniture has its back face at z = 0 and extends towards -Z
 */

const LEG = 0.04;

function tableLegs(k: PropKit, w: number, d: number, h: number, mat: 'metal' | 'metal-dark' | 'wood-dark', inset = 0.06): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.boxUp(LEG, h, LEG, mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
    }
  }
}

export const buildDesk: PropBuilder = (ctx, k) => {
  k.instance(ctx, 'desk', (t) => {
    t.boxUp(1.4, 0.035, 0.7, 'laminate', 0, 0.715, 0, { uv: 1 });
    t.boxUp(0.03, 0.715, 0.66, 'metal-dark', -0.67, 0, 0);
    t.boxUp(0.03, 0.715, 0.66, 'metal-dark', 0.67, 0, 0);
    t.boxUp(1.32, 0.4, 0.02, 'metal-dark', 0, 0.3, 0.3);
  });
  k.collider(0, 0, 1.42, 0.72);
};

export const buildCubicleDesk: PropBuilder = (ctx, k) => {
  k.instance(ctx, 'cubicle-desk', (t) => {
    t.boxUp(1.6, 0.03, 0.75, 'laminate', 0, 0.72, 0, { uv: 1 });
    // partitions (back + sides), fabric with aluminium caps
    t.boxUp(1.62, 1.22, 0.05, 'fabric-partition', 0, 0, 0.42, { uv: 1 });
    t.boxUp(1.62, 0.03, 0.06, 'metal', 0, 1.22, 0.42);
    for (const sx of [-1, 1]) {
      t.boxUp(0.05, 1.22, 0.85, 'fabric-partition', sx * 0.81, 0, 0.0, { uv: 1 });
      t.boxUp(0.06, 0.03, 0.85, 'metal', sx * 0.81, 1.22, 0.0);
    }
    // drawer pedestal
    t.boxUp(0.4, 0.66, 0.6, 'metal', 0.56, 0, 0.04);
    for (let i = 0; i < 3; i++) t.boxUp(0.14, 0.015, 0.01, 'chrome', 0.56, 0.12 + i * 0.2, -0.265);
    t.boxUp(0.03, 0.72, 0.6, 'metal-dark', -0.74, 0, 0.04);
  });
  k.collider(0, 0.02, 1.66, 0.9);
};

export const buildExecutiveDesk: PropBuilder = (_ctx, k) => {
  k.boxUp(2.2, 0.05, 0.95, 'wood-dark', 0, 0.73, 0, { uv: 1 });
  k.boxUp(0.5, 0.73, 0.9, 'wood-dark', -0.83, 0, 0, { uv: 1 });
  k.boxUp(0.5, 0.73, 0.9, 'wood-dark', 0.83, 0, 0, { uv: 1 });
  k.boxUp(1.16, 0.55, 0.03, 'wood-dark', 0, 0.18, 0.44, { uv: 1 });
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.boxUp(0.16, 0.015, 0.012, 'brass', sx * 0.83, 0.16 + i * 0.22, -0.455);
  k.boxUp(0.6, 0.004, 0.4, 'leather', 0, 0.78, -0.12);
  k.collider(0, 0, 2.22, 0.97);
};

export const buildReceptionDesk: PropBuilder = (_ctx, k) => {
  // Front (-Z) = visitor side with raised transaction counter; staff work surface behind.
  k.boxUp(3.6, 1.04, 0.06, 'wood-dark', 0, 0, -0.39, { uv: 1 });
  k.boxUp(3.7, 0.04, 0.34, 'wood-light', 0, 1.04, -0.26, { uv: 1 });
  k.boxUp(3.6, 0.03, 0.62, 'laminate', 0, 0.72, 0.08, { uv: 1 });
  for (const sx of [-1, 1]) k.boxUp(0.06, 1.04, 0.85, 'wood-dark', sx * 1.8, 0, 0, { uv: 1 });
  k.boxUp(3.5, 0.08, 0.02, 'brass', 0, 0.9, -0.425);
  k.boxUp(0.42, 0.66, 0.55, 'metal', -1.3, 0, 0.1);
  k.collider(0, 0, 3.72, 0.88);
};

export const buildOfficeChair: PropBuilder = (ctx, k) => {
  const exec = ctx.placement.variant === 'executive';
  k.instance(ctx, exec ? 'chair-exec' : 'chair-office', (t) => {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      t.box(0.3, 0.035, 0.05, 'plastic-dark', Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, { ry: -a });
      t.sphere(0.05, 'rubber', Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29, { segments: 6 });
    }
    t.cyl(0.05, 0.05, 0.36, 'chrome', 0, 0.06, 0, { tess: 10 });
    const seatMat = exec ? 'leather' : 'fabric-chair';
    t.boxUp(0.5, 0.08, 0.48, seatMat, 0, 0.44, -0.02);
    const backH = exec ? 0.78 : 0.52;
    t.boxUp(0.47, backH, 0.07, seatMat, 0, 0.58, 0.24, { rx: -0.08 });
    t.boxUp(0.06, 0.04, 0.3, 'plastic-dark', -0.27, 0.64, -0.02);
    t.boxUp(0.06, 0.04, 0.3, 'plastic-dark', 0.27, 0.64, -0.02);
    t.boxUp(0.03, 0.14, 0.03, 'plastic-dark', -0.27, 0.5, -0.02);
    t.boxUp(0.03, 0.14, 0.03, 'plastic-dark', 0.27, 0.5, -0.02);
  });
  k.collider(0, 0, 0.52, 0.52);
};

export const buildWaitingChair: PropBuilder = (ctx, k) => {
  const plastic = ctx.placement.variant === 'plastic';
  k.instance(ctx, plastic ? 'chair-plastic' : 'chair-waiting', (t) => {
    const seat = plastic ? 'plastic-white' : 'fabric-chair';
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) t.boxUp(0.025, 0.44, 0.025, 'chrome', sx * 0.2, 0, sz * 0.19);
    }
    t.boxUp(0.46, 0.06, 0.44, seat, 0, 0.44, 0);
    t.boxUp(0.46, 0.42, 0.05, seat, 0, 0.5, 0.21, { rx: -0.1 });
  });
  k.collider(0, 0, 0.5, 0.5);
};

export const buildConferenceTable: PropBuilder = (_ctx, k) => {
  k.boxUp(5, 0.05, 1.5, 'wood-dark', 0, 0.71, 0, { uv: 1.5 });
  k.boxUp(4.9, 0.02, 1.4, 'wood-dark', 0, 0.69, 0);
  for (const sx of [-1, 1]) {
    k.boxUp(0.5, 0.69, 0.5, 'wood-dark', sx * 1.6, 0, 0, { uv: 1 });
    k.boxUp(0.8, 0.04, 0.9, 'metal-dark', sx * 1.6, 0, 0);
  }
  k.boxUp(0.2, 0.02, 0.12, 'plastic-dark', 0, 0.76, 0.3);
  k.collider(0, 0, 5.02, 1.52);
};

export const buildDiningTable: PropBuilder = (_ctx, k) => {
  k.cyl(1.1, 1.1, 0.04, 'laminate', 0, 0.72, 0, { tess: 28 });
  k.cyl(0.08, 0.08, 0.72, 'chrome', 0, 0, 0);
  k.cyl(0.6, 0.6, 0.03, 'metal-dark', 0, 0, 0, { tess: 20 });
  k.collider(0, 0, 0.9, 0.9);
};

export const buildFilingCabinet: PropBuilder = (ctx, k) => {
  const restricted = ctx.placement.variant === 'restricted';
  const d = 0.62;
  k.boxUp(0.47, 1.32, d, restricted ? 'metal-dark' : 'metal', 0, 0, -d / 2);
  for (let i = 0; i < 4; i++) {
    const y = 0.06 + i * 0.32;
    k.boxUp(0.43, 0.28, 0.01, restricted ? 'metal-dark' : 'metal', 0, y, -d - 0.004);
    k.boxUp(0.14, 0.02, 0.025, 'chrome', 0, y + 0.2, -d - 0.015);
    k.boxUp(0.08, 0.03, 0.005, 'paper', 0, y + 0.24, -d - 0.012);
  }
  if (restricted) {
    k.boxUp(0.3, 0.07, 0.005, 'red-paint', 0, 1.18, -d - 0.012);
    k.boxUp(0.05, 0.06, 0.03, 'brass', 0.16, 0.95, -d - 0.02);
  }
  k.collider(0, -d / 2, 0.5, d + 0.04);
};

export const buildBookshelf: PropBuilder = (_ctx, k) => {
  const w = 1.0;
  const h = 2.0;
  const d = 0.35;
  k.boxUp(w, 0.03, d, 'wood-dark', 0, h - 0.03, -d / 2);
  k.boxUp(w, h, 0.02, 'wood-dark', 0, 0, -0.01);
  for (const sx of [-1, 1]) k.boxUp(0.03, h, d, 'wood-dark', sx * (w / 2 - 0.015), 0, -d / 2);
  for (let i = 0; i < 5; i++) {
    const y = 0.05 + i * 0.39;
    k.boxUp(w - 0.06, 0.025, d - 0.02, 'wood-dark', 0, y, -d / 2);
    if (i < 4) k.boxUp(w - 0.14, 0.3, 0.26, 'binder-mix', -0.02 + (i % 2) * 0.03, y + 0.025, -0.16);
  }
  k.collider(0, -d / 2, w + 0.02, d + 0.04);
};

export const buildMetalShelf: PropBuilder = (ctx, k) => {
  const length = Number(ctx.placement.params?.['length'] ?? 2);
  const d = 0.45;
  const h = 2.1;
  for (const sx of [-1, 1]) for (const sz of [0, 1]) k.boxUp(0.035, h, 0.035, 'metal', sx * (length / 2 - 0.02), 0, -0.02 - sz * (d - 0.04));
  for (let i = 0; i < 5; i++) {
    const y = 0.1 + i * 0.48;
    k.boxUp(length, 0.02, d, 'metal', 0, y, -d / 2);
    if (i < 4) {
      for (let b = 0; b < Math.floor(length / 0.45); b++) {
        if ((b + i) % 3 === 2) continue;
        const bw = 0.32 + ((b * 7 + i) % 3) * 0.04;
        k.boxUp(bw, 0.24 + ((b + i) % 2) * 0.06, 0.34, 'cardboard', -length / 2 + 0.25 + b * 0.45, y + 0.02, -d / 2);
      }
    }
  }
  k.collider(0, -d / 2, length + 0.04, d + 0.04);
};

export const buildArchiveShelf: PropBuilder = (ctx, k) => {
  k.instance(ctx, 'archive-shelf', (t) => {
    const length = 4.4;
    const d = 0.5;
    const h = 2.3;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) t.boxUp(0.04, h, 0.04, 'metal-dark', sx * (length / 2 - 0.03), 0, sz * (d / 2 - 0.03));
    for (let i = 0; i < 5; i++) {
      const y = 0.08 + i * 0.52;
      t.boxUp(length, 0.02, d, 'metal-dark', 0, y, 0);
      if (i < 4) {
        for (let b = 0; b < 12; b++) {
          if ((b * 5 + i * 3) % 7 === 0) continue;
          t.boxUp(0.32, 0.27, 0.42, 'cardboard', -length / 2 + 0.2 + b * 0.36, y + 0.02, ((b + i) % 2) * 0.02);
          t.boxUp(0.12, 0.06, 0.005, 'paper', -length / 2 + 0.2 + b * 0.36, y + 0.15, -0.215);
          t.boxUp(0.12, 0.06, 0.005, 'paper', -length / 2 + 0.2 + b * 0.36, y + 0.15, 0.215);
        }
      }
    }
  });
  k.collider(0, 0, 4.44, 0.54);
};

export const buildBoxes: PropBuilder = (ctx, k) => {
  const stack = ctx.placement.variant !== 'low';
  k.boxUp(0.5, 0.36, 0.4, 'cardboard', 0, 0, 0);
  k.boxUp(0.46, 0.3, 0.38, 'cardboard', 0.03, 0.36, 0.01, { ry: 0.12 });
  if (stack) k.boxUp(0.4, 0.28, 0.34, 'cardboard', -0.02, 0.66, 0, { ry: -0.08 });
  k.boxUp(0.42, 0.3, 0.36, 'cardboard', 0.0, 0, -0.45, { ry: 0.3 });
  k.collider(0, -0.2, 0.62, 0.95);
};

export const buildBench: PropBuilder = (_ctx, k) => {
  k.boxUp(1.6, 0.05, 0.42, 'wood-light', 0, 0.42, 0, { uv: 1 });
  for (const sx of [-1, 1]) {
    k.boxUp(0.05, 0.42, 0.36, 'metal-dark', sx * 0.7, 0, 0);
  }
  k.collider(0, 0, 1.62, 0.46);
};

export const buildKitchenCounter: PropBuilder = (ctx, k) => {
  const length = Number(ctx.placement.params?.['length'] ?? 3);
  const d = 0.62;
  k.boxUp(length, 0.86, d - 0.04, 'plastic-white', 0, 0, -d / 2 + 0.02);
  k.boxUp(length + 0.02, 0.05, d, 'laminate', 0, 0.86, -d / 2, { uv: 1 });
  const doors = Math.floor(length / 0.6);
  for (let i = 0; i < doors; i++) {
    const x = -length / 2 + 0.3 + i * 0.6;
    k.boxUp(0.56, 0.7, 0.015, 'plastic-beige', x, 0.08, -d + 0.01);
    k.boxUp(0.1, 0.015, 0.02, 'chrome', x, 0.68, -d - 0.005);
  }
  // sink
  k.boxUp(0.5, 0.02, 0.36, 'chrome', length / 2 - 0.55, 0.905, -d / 2);
  k.cyl(0.03, 0.03, 0.25, 'chrome', length / 2 - 0.55, 0.91, -0.08);
  k.box(0.18, 0.025, 0.025, 'chrome', length / 2 - 0.55, 1.15, -0.16);
  k.collider(0, -d / 2, length + 0.04, d + 0.04);
};

export const buildSecurityDesk: PropBuilder = (ctx, k) => {
  const length = 3;
  k.boxUp(length, 0.04, 0.9, 'laminate', 0, 0.72, 0, { uv: 1 });
  k.boxUp(length, 0.72, 0.04, 'metal-dark', 0, 0, 0.43);
  for (const sx of [-1, 1]) k.boxUp(0.04, 0.72, 0.86, 'metal-dark', sx * (length / 2 - 0.02), 0, 0);
  // Monitor bank: 2x2 on a shelf
  k.boxUp(length - 0.2, 0.04, 0.4, 'metal-dark', 0, 1.18, 0.2);
  const screens: [number, number][] = [
    [-0.75, 0.76],
    [0.75, 0.76],
    [-0.75, 1.22],
    [0.75, 1.22],
  ];
  screens.forEach(([x, y], i) => {
    k.boxUp(0.62, 0.44, 0.38, 'plastic-dark', x, y, 0.22);
    const screen = k.plane(0.54, 0.38, 'emissive-screen-off', x, y + 0.22, 0.02, { keep: `screen-${i}` });
    screen.isPickable = true;
  });
  // console keyboard
  k.boxUp(0.5, 0.03, 0.18, 'plastic-dark', 0, 0.76, -0.2);
  k.boxUp(0.2, 0.03, 0.14, 'plastic-dark', 0.5, 0.76, -0.22);
  k.collider(0, 0, length + 0.02, 0.92);
  void ctx;
};
