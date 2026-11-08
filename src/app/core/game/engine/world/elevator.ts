import { AbstractMesh, Color3, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { ElevatorDefinition, ElevatorInteriorId, RoomDefinition, StageDefinition } from '../../models';
import { CollisionWorld } from '../collision-manager';
import { MaterialLibrary } from '../materials/material-library';
import { RoomMeshRegistry } from './world-builder';
import { TextSurface } from './text-surface';

export type ElevatorPhase = 'locked' | 'idle' | 'arriving' | 'opening' | 'open' | 'closing' | 'closed-inside';

/**
 * The working elevator: frame, sliding doors, car interior (+ alternative dressings), car light.
 * Geometry is built in a local frame where the doors face -X (the lobby) when axis = 'x'.
 */
export class Elevator {
  readonly root: TransformNode;
  readonly carCenter: Vector3;
  readonly carLight: PointLight;
  phase: ElevatorPhase = 'locked';
  private readonly doorLeft: Mesh;
  private readonly doorRight: Mesh;
  private readonly interiors = new Map<ElevatorInteriorId, TransformNode>();
  private readonly carMeshes: AbstractMesh[] = [];
  /** Static parts merged into one multi-material mesh after construction (fewer draw calls). */
  private staticQueue: Mesh[] = [];
  private merged: Mesh | null = null;
  private doorAnim = 0;
  private doorTarget = 0;
  private readonly doorColliderId = 'elevator-doors';
  private readonly def: ElevatorDefinition;
  private readonly lobby: RoomDefinition;

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
    stage: StageDefinition,
    private readonly collisions: CollisionWorld,
    private readonly roomMeshes: RoomMeshRegistry,
    origin?: Vector3,
  ) {
    this.def = stage.elevator;
    const lobby = stage.rooms.find((r) => r.id === this.def.lobbyRoomId);
    if (!lobby) throw new Error('Elevator lobby room missing');
    this.lobby = lobby;
    const car = this.def.car;
    this.carCenter = new Vector3((car.x0 + car.x1) / 2, 0, (car.z0 + car.z1) / 2);
    this.root = new TransformNode('elevator', scene);
    if (origin) this.root.position.copyFrom(origin);

    const w = this.def.width;
    const h = this.def.height;
    const at = this.def.at;
    const c = this.def.center;
    const metal = lib.get('metal-brushed');

    // frame on the lobby side
    this.add(this.box(0.12, h + 0.2, 0.18, at - 0.04, (h + 0.2) / 2, c - w / 2 - 0.09, metal));
    this.add(this.box(0.12, h + 0.2, 0.18, at - 0.04, (h + 0.2) / 2, c + w / 2 + 0.09, metal));
    this.add(this.box(0.12, 0.2, w + 0.36, at - 0.04, h + 0.1, c, metal));
    // sliding doors
    this.doorLeft = this.box(0.05, h, w / 2 + 0.02, at + 0.03, h / 2, c - w / 4, metal);
    this.doorRight = this.box(0.05, h, w / 2 + 0.02, at + 0.03, h / 2, c + w / 4, metal);
    for (const d of [this.doorLeft, this.doorRight]) {
      d.metadata = { kind: 'structure', id: 'elevator-door', occluder: true };
      this.roomMeshes.add(this.lobby.id, d);
    }
    this.collisions.add({ id: this.doorColliderId, cx: at + 0.03, cz: c, hx: 0.08, hz: w / 2 + 0.05, rot: 0, enabled: true });

    // car shell
    const cx0 = car.x0 + 0.08;
    const cx1 = car.x1;
    const cz0 = car.z0;
    const cz1 = car.z1;
    const ch = h + 0.25;
    const floor = lib.get('rubber');
    this.carPart(this.box(cx1 - cx0, 0.04, cz1 - cz0, (cx0 + cx1) / 2, -0.02, (cz0 + cz1) / 2, floor));
    this.carPart(this.box(cx1 - cx0, 0.04, cz1 - cz0, (cx0 + cx1) / 2, ch, (cz0 + cz1) / 2, metal));
    this.carPart(this.box(0.06, ch, cz1 - cz0, cx1 - 0.03, ch / 2, (cz0 + cz1) / 2, metal));
    this.carPart(this.box(cx1 - cx0, ch, 0.06, (cx0 + cx1) / 2, ch / 2, cz0 + 0.03, metal));
    this.carPart(this.box(cx1 - cx0, ch, 0.06, (cx0 + cx1) / 2, ch / 2, cz1 - 0.03, metal));
    const sideW = (cz1 - cz0 - w) / 2;
    this.carPart(this.box(0.06, ch, sideW, cx0 + 0.03, ch / 2, cz0 + sideW / 2, metal));
    this.carPart(this.box(0.06, ch, sideW, cx0 + 0.03, ch / 2, cz1 - sideW / 2, metal));
    this.carPart(this.box(0.06, ch - h, w, cx0 + 0.03, h + (ch - h) / 2, c, metal));
    // handrail + ceiling panel
    this.carPart(this.box(0.04, 0.04, cz1 - cz0 - 0.3, cx1 - 0.1, 0.95, (cz0 + cz1) / 2, lib.get('chrome')));
    const panel = this.box(1.2, 0.02, 1.2, (cx0 + cx1) / 2, ch - 0.02, (cz0 + cz1) / 2, lib.get('emissive-panel'));
    this.carPart(panel);
    for (const [x, z, hw, hd] of [
      [cx1, (cz0 + cz1) / 2, 0.12, cz1 - cz0],
      [(cx0 + cx1) / 2, cz0, cx1 - cx0, 0.12],
      [(cx0 + cx1) / 2, cz1, cx1 - cx0, 0.12],
    ] as const) {
      this.collisions.add({ id: `car-${x}-${z}`, cx: x, cz: z, hx: hw / 2, hz: hd / 2, rot: 0, enabled: true });
    }
    this.collisions.add({ id: 'car-front-a', cx: cx0 + 0.03, cz: cz0 + sideW / 2, hx: 0.06, hz: sideW / 2, rot: 0, enabled: true });
    this.collisions.add({ id: 'car-front-b', cx: cx0 + 0.03, cz: cz1 - sideW / 2, hx: 0.06, hz: sideW / 2, rot: 0, enabled: true });

    this.carLight = new PointLight('car-light', new Vector3((cx0 + cx1) / 2, ch - 0.3, (cz0 + cz1) / 2), scene);
    this.carLight.diffuse = new Color3(1, 0.96, 0.88);
    this.carLight.specular = new Color3(0.2, 0.2, 0.2);
    this.carLight.intensity = 0.8;
    this.carLight.range = 4.5;
    this.carLight.parent = this.root;

    // decorative out-of-service elevator
    if (this.def.secondaryCenter !== undefined) {
      const s = this.def.secondaryCenter;
      this.add(this.box(0.12, h + 0.2, 0.18, at - 0.04, (h + 0.2) / 2, s - w / 2 - 0.09, metal));
      this.add(this.box(0.12, h + 0.2, 0.18, at - 0.04, (h + 0.2) / 2, s + w / 2 + 0.09, metal));
      this.add(this.box(0.12, 0.2, w + 0.36, at - 0.04, h + 0.1, s, metal));
      this.add(this.box(0.03, h, w / 2, at - 0.13, h / 2, s - w / 4 - 0.005, metal));
      this.add(this.box(0.03, h, w / 2, at - 0.13, h / 2, s + w / 4 + 0.005, metal));
    }
    this.merged = Mesh.MergeMeshes(this.staticQueue, true, true, undefined, false, true);
    this.staticQueue = [];
    if (this.merged) {
      this.merged.name = 'elevator-static';
      this.merged.metadata = { kind: 'structure', id: 'elevator', occluder: true };
      this.merged.receiveShadows = true;
      this.roomMeshes.add(this.lobby.id, this.merged);
      this.carMeshes.push(this.merged);
    }
    this.buildInteriors();
    this.carLight.includedOnlyMeshes = [...this.carMeshes, ...this.interiorMeshes()];
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, material: StandardMaterial): Mesh {
    const m = MeshBuilder.CreateBox('elevator-part', { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y, z);
    m.material = material;
    m.parent = this.root;
    m.metadata = { kind: 'structure', id: 'elevator', occluder: true };
    m.receiveShadows = true;
    return m;
  }

  private add(mesh: Mesh): void {
    this.staticQueue.push(mesh);
  }

  private carPart(mesh: Mesh): void {
    this.staticQueue.push(mesh);
  }

  private interiorMeshes(): AbstractMesh[] {
    return [...this.interiors.values()].flatMap((n) => n.getChildMeshes());
  }

  private buildInteriors(): void {
    const car = this.def.car;
    const node = new TransformNode('interior-reception', this.scene);
    node.parent = this.root;
    const x0 = car.x0 + 0.12;
    const x1 = car.x1 - 0.07;
    const z0 = car.z0 + 0.07;
    const z1 = car.z1 - 0.07;
    const h = this.def.height + 0.2;
    const wall = this.lib.surface('wall-cream');
    const floor = this.lib.surface('terrazzo');
    const part = (m: Mesh) => {
      m.parent = node;
      m.metadata = { kind: 'structure', id: 'elevator', occluder: true };
      this.roomMeshes.add(this.lobby.id, m);
    };
    const plane = (w: number, hh: number, x: number, y: number, z: number, ry: number, mat: StandardMaterial) => {
      const p = MeshBuilder.CreatePlane('replica', { width: w, height: hh }, this.scene);
      p.position.set(x, y, z);
      p.rotation.y = ry;
      p.material = mat;
      part(p);
      return p;
    };
    plane(z1 - z0, h, x1, h / 2, (z0 + z1) / 2, Math.PI / 2, wall);
    plane(x1 - x0, h, (x0 + x1) / 2, h / 2, z0, Math.PI, wall);
    plane(x1 - x0, h, (x0 + x1) / 2, h / 2, z1, 0, wall);
    const f = MeshBuilder.CreateGround('replica-floor', { width: x1 - x0, height: z1 - z0 }, this.scene);
    f.position.set((x0 + x1) / 2, 0.005, (z0 + z1) / 2);
    f.material = floor;
    part(f);
    // miniature reception counter with a terminal
    const desk = MeshBuilder.CreateBox('replica-desk', { width: 0.5, height: 1.05, depth: 1.2 }, this.scene);
    desk.position.set(x1 - 0.3, 0.525, (z0 + z1) / 2);
    desk.material = this.lib.get('wood-dark');
    part(desk);
    const screen = new TextSurface(this.lib, 'replica-screen', 256, 192, 'terminal', { emissive: true });
    screen.draw('WELCOME BACK|EMPLOYEE 4471||SHIFT: 09:00');
    const s = MeshBuilder.CreatePlane('replica-screen', { width: 0.3, height: 0.22 }, this.scene);
    s.position.set(x1 - 0.42, 1.25, (z0 + z1) / 2);
    s.rotation.y = Math.PI / 2;
    s.material = screen.material;
    part(s);
    const logo = new TextSurface(this.lib, 'replica-logo', 512, 128, 'logo', { alpha: true });
    logo.draw('HALDANE STRATA GROUP|FLOOR 14');
    plane(1.6, 0.4, x1 - 0.01, 2.05, (z0 + z1) / 2, Math.PI / 2, logo.material);
    node.setEnabled(false);
    this.interiors.set('reception-replica', node);
  }

  setInterior(id: ElevatorInteriorId): void {
    for (const [key, node] of this.interiors) node.setEnabled(key === id);
  }

  setPhase(phase: ElevatorPhase): void {
    this.phase = phase;
    if (phase === 'opening' || phase === 'open') this.doorTarget = 1;
    if (phase === 'closing' || phase === 'closed-inside' || phase === 'locked' || phase === 'idle' || phase === 'arriving') this.doorTarget = 0;
  }

  doorsFullyClosed(): boolean {
    return this.doorAnim <= 0.001;
  }

  doorsFullyOpen(): boolean {
    return this.doorAnim >= 0.999;
  }

  /** Position on the lobby side of the doors (for door sounds). */
  doorPosition(): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(this.def.at, 1.2, this.def.center), this.root.getWorldMatrix());
  }

  /** Is a world point inside the car (with margin)? */
  contains(x: number, z: number): boolean {
    const car = this.def.car;
    const o = this.root.position;
    return x > car.x0 + o.x + 0.25 && x < car.x1 + o.x - 0.1 && z > car.z0 + o.z + 0.1 && z < car.z1 + o.z - 0.1;
  }

  update(dt: number): void {
    if (this.doorAnim === this.doorTarget) return;
    const speed = 0.7;
    this.doorAnim = this.doorTarget > this.doorAnim ? Math.min(1, this.doorAnim + dt * speed) : Math.max(0, this.doorAnim - dt * speed);
    const e = this.doorAnim * this.doorAnim * (3 - 2 * this.doorAnim);
    const w = this.def.width;
    const slide = (w / 2) * 0.95 * e;
    this.doorLeft.position.z = this.def.center - w / 4 - slide;
    this.doorRight.position.z = this.def.center + w / 4 + slide;
    this.collisions.setEnabled(this.doorColliderId, this.doorAnim < 0.75);
  }

  dispose(): void {
    this.merged?.dispose();
    this.root.dispose(false, false);
    this.carLight.dispose();
  }
}
