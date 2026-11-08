import { AbstractMesh, Color3, Matrix, Mesh, MeshBuilder, PointLight, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { EndingDestinationId } from '../../models';
import { CollisionWorld } from '../collision-manager';
import { MaterialLibrary } from '../materials/material-library';
import { setQuadUV } from '../world/world-builder';

export interface DestinationScene {
  readonly root: TransformNode;
  /** Car-local origin of the destination elevator car (player is teleported relative to it). */
  readonly carOrigin: Vector3;
  readonly meshes: AbstractMesh[];
  /** Opens the doors of the destination car (0..1). */
  setDoors(t: number): void;
  clamp(x: number, z: number): [number, number];
  dispose(): void;
}

export type DestinationBuilder = (ctx: {
  scene: Scene;
  lib: MaterialLibrary;
  collisions: CollisionWorld;
  /** World-space centre of the original car (destination is built far away and mirrored). */
  carCenter: Vector3;
  carSize: { x: number; z: number };
  doorWidth: number;
}) => DestinationScene;

const OFFSET = new Vector3(600, 0, 0);

/**
 * "Floor -inf": an endless open-plan office in fog, seen from a copy of the elevator car.
 * Built lazily when Ending C starts. Desks and lights are thin instances (cheap).
 */
const infiniteFloor: DestinationBuilder = ({ scene, lib, collisions, carCenter, carSize, doorWidth }) => {
  const root = new TransformNode('destination-infinite', scene);
  const meshes: AbstractMesh[] = [];
  const carOrigin = carCenter.add(OFFSET);
  const doorX = carOrigin.x - carSize.x / 2;
  const add = (m: Mesh) => {
    m.parent = root;
    meshes.push(m);
    m.isPickable = false;
    return m;
  };
  // Car copy
  const metal = lib.get('metal-brushed');
  const shell = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = MeshBuilder.CreateBox('dest-car', { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z);
    b.material = metal;
    return add(b);
  };
  shell(carSize.x, 0.04, carSize.z, carOrigin.x, -0.02, carOrigin.z).material = lib.get('rubber');
  shell(carSize.x, 0.04, carSize.z, carOrigin.x, 2.55, carOrigin.z);
  shell(0.06, 2.55, carSize.z, carOrigin.x + carSize.x / 2, 1.27, carOrigin.z);
  shell(carSize.x, 2.55, 0.06, carOrigin.x, 1.27, carOrigin.z - carSize.z / 2);
  shell(carSize.x, 2.55, 0.06, carOrigin.x, 1.27, carOrigin.z + carSize.z / 2);
  const side = (carSize.z - doorWidth) / 2;
  shell(0.06, 2.55, side, doorX, 1.27, carOrigin.z - carSize.z / 2 + side / 2);
  shell(0.06, 2.55, side, doorX, 1.27, carOrigin.z + carSize.z / 2 - side / 2);
  const doorL = shell(0.05, 2.3, doorWidth / 2, doorX - 0.03, 1.15, carOrigin.z - doorWidth / 4);
  const doorR = shell(0.05, 2.3, doorWidth / 2, doorX - 0.03, 1.15, carOrigin.z + doorWidth / 4);
  shell(1.2, 0.02, 1.2, carOrigin.x, 2.52, carOrigin.z).material = lib.get('emissive-panel');

  // The endless office, west of the doors
  const size = 360;
  const floor = add(MeshBuilder.CreateGround('dest-floor', { width: size, height: size }, scene));
  floor.position.set(doorX - size / 2, 0, carOrigin.z);
  floor.material = lib.surface('carpet-blue');
  const fs = lib.surfaceScale('carpet-blue').scale;
  floor.scaling.set(1, 1, 1);
  setQuadUVGround(floor, size / fs);
  const ceiling = add(MeshBuilder.CreateGround('dest-ceiling', { width: size, height: size }, scene));
  ceiling.rotation.x = Math.PI;
  ceiling.position.set(doorX - size / 2, 3, carOrigin.z);
  ceiling.material = lib.surface('ceiling-tile');
  setQuadUVGround(ceiling, size / lib.surfaceScale('ceiling-tile').scale);

  // Desk template (thin instances)
  const deskParts: Mesh[] = [];
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial) => {
    const m = MeshBuilder.CreateBox('d', { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z);
    m.material = mat;
    deskParts.push(m);
  };
  part(1.6, 0.03, 0.75, 0, 0.735, 0, lib.get('laminate'));
  part(1.62, 1.22, 0.05, 0, 0.61, 0.42, lib.get('fabric-partition'));
  part(0.05, 1.22, 0.85, -0.81, 0.61, 0, lib.get('fabric-partition'));
  part(0.4, 0.36, 0.34, 0.1, 0.93, 0.15, lib.get('plastic-beige'));
  part(0.5, 0.08, 0.48, 0, 0.48, -0.72, lib.get('fabric-chair'));
  part(0.47, 0.5, 0.07, 0, 0.76, -0.5, lib.get('fabric-chair'));
  const desk = Mesh.MergeMeshes(deskParts, true, true, undefined, false, true);
  const lightPanel = MeshBuilder.CreateBox('dest-panel', { width: 1.2, height: 0.02, depth: 0.6 }, scene);
  lightPanel.material = lib.get('emissive-panel');
  add(lightPanel);
  const deskColliders: string[] = [];
  if (desk) {
    add(desk);
    const matrices: Matrix[] = [];
    for (let row = 0; row < 40; row++) {
      for (let col = -12; col <= 12; col++) {
        const x = doorX - 4 - row * 3.4;
        const z = carOrigin.z + col * 2.0;
        if (row < 1 && Math.abs(col) < 2) continue;
        const rot = (row + col) % 2 === 0 ? 0 : Math.PI;
        matrices.push(Matrix.Compose(new Vector3(1, 1, 1), Quaternion.RotationAxis(Vector3.Up(), rot + Math.PI / 2), new Vector3(x, 0, z)));
        if (row < 6 && Math.abs(col) < 6) {
          const id = `dest-desk-${row}-${col}`;
          collisions.add({ id, cx: x, cz: z, hx: 0.5, hz: 0.85, rot: 0, enabled: true });
          deskColliders.push(id);
        }
      }
    }
    desk.thinInstanceAdd(matrices);
    const lights: Matrix[] = [];
    for (let row = 0; row < 60; row++) {
      for (let col = -18; col <= 18; col += 3) {
        lights.push(Matrix.Translation(doorX - 3 - row * 3.4, 2.98, carOrigin.z + col * 2));
      }
    }
    lightPanel.thinInstanceAdd(lights);
  }
  const glow = new PointLight('dest-light', new Vector3(doorX - 5, 2.6, carOrigin.z), scene);
  glow.diffuse = new Color3(0.82, 0.9, 1);
  glow.intensity = 0.9;
  glow.range = 26;
  glow.includedOnlyMeshes = meshes;
  const carLight = new PointLight('dest-car-light', new Vector3(carOrigin.x, 2.3, carOrigin.z), scene);
  carLight.intensity = 0.7;
  carLight.range = 4.5;
  carLight.includedOnlyMeshes = meshes;
  const wallIds = ['dest-car-back', 'dest-car-n', 'dest-car-s'];
  collisions.add({ id: wallIds[0], cx: carOrigin.x + carSize.x / 2, cz: carOrigin.z, hx: 0.08, hz: carSize.z / 2, rot: 0, enabled: true });
  collisions.add({ id: wallIds[1], cx: carOrigin.x, cz: carOrigin.z - carSize.z / 2, hx: carSize.x / 2, hz: 0.08, rot: 0, enabled: true });
  collisions.add({ id: wallIds[2], cx: carOrigin.x, cz: carOrigin.z + carSize.z / 2, hx: carSize.x / 2, hz: 0.08, rot: 0, enabled: true });

  return {
    root,
    carOrigin,
    meshes,
    setDoors: (t) => {
      const e = t * t * (3 - 2 * t);
      doorL.position.z = carOrigin.z - doorWidth / 4 - (doorWidth / 2) * 0.95 * e;
      doorR.position.z = carOrigin.z + doorWidth / 4 + (doorWidth / 2) * 0.95 * e;
    },
    clamp: (x, z) => [Math.max(doorX - 60, Math.min(carOrigin.x + carSize.x / 2 - 0.3, x)), Math.max(carOrigin.z - 30, Math.min(carOrigin.z + 30, z))],
    dispose: () => {
      for (const id of [...wallIds, ...deskColliders]) collisions.remove(id);
      glow.dispose();
      carLight.dispose();
      root.dispose(false, false);
    },
  };
};

function setQuadUVGround(mesh: Mesh, repeat: number): void {
  // CreateGround with 1 subdivision has 4 vertices; scale its 0..1 UVs.
  const uvs = mesh.getVerticesData('uv');
  if (!uvs) return;
  mesh.setVerticesData('uv', uvs.map((v) => v * repeat));
}

export const DESTINATIONS: Readonly<Record<Exclude<EndingDestinationId, 'none'>, DestinationBuilder>> = {
  'infinite-floor': infiniteFloor,
};

export { setQuadUV };
