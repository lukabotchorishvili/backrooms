import { AbstractMesh, Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { DoorDefinition, DoorState, PropPlacement, RoomDefinition, StageDefinition, Vec3 } from '../../models';
import { CollisionWorld } from '../collision-manager';
import { MaterialLibrary, PropMaterialId } from '../materials/material-library';
import { ObjectFactory } from './object-factory';
import { PropRegistry } from './prop-registry';
import { RoomMeshRegistry } from './world-builder';

interface Leaf {
  readonly pivot: TransformNode;
  readonly closedAngle: number;
  readonly openAngle: number;
  readonly width: number;
  readonly hinge: { x: number; z: number };
  readonly closedId: string;
  readonly openId: string;
}

export interface DoorRuntime {
  readonly def: DoorDefinition;
  state: DoorState;
  anim: number;
  target: number;
  speed: number;
  readonly leaves: Leaf[];
  readonly meshes: AbstractMesh[];
  readonly position: Vec3;
}

const OPEN_FRACTION = 0.93;

/** World direction of a node's local +X for a given Y rotation (Babylon convention). */
function dirOf(theta: number): { x: number; z: number } {
  return { x: Math.cos(theta), z: -Math.sin(theta) };
}

function angleFor(x: number, z: number): number {
  return Math.atan2(-z, x);
}

/**
 * Doors: frames, hinged leaves (single/double), state machine, animated swing, colliders that
 * follow the leaf, nameplates (registered as props `sign-<id>`) and gaze targets (`door-<id>`).
 */
export class DoorSystem {
  private readonly doors = new Map<string, DoorRuntime>();

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
    private readonly stage: StageDefinition,
    private readonly collisions: CollisionWorld,
    private readonly roomMeshes: RoomMeshRegistry,
    private readonly props: PropRegistry,
    private readonly factory: ObjectFactory,
  ) {}

  get(id: string): DoorRuntime | undefined {
    return this.doors.get(id);
  }

  all(): DoorRuntime[] {
    return [...this.doors.values()];
  }

  states(): Record<string, DoorState> {
    const out: Record<string, DoorState> = {};
    for (const d of this.doors.values()) out[d.def.id] = d.state;
    return out;
  }

  buildAll(): void {
    for (const def of this.stage.doors) this.doors.set(def.id, this.build(def));
  }

  private room(id: string): RoomDefinition {
    const r = this.stage.rooms.find((x) => x.id === id);
    if (!r) throw new Error(`Door references unknown room ${id}`);
    return r;
  }

  private build(def: DoorDefinition): DoorRuntime {
    const [ra, rb] = def.rooms.map((id) => this.room(id));
    const along = def.axis === 'z' ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const centerOf = (r: RoomDefinition) => (def.axis === 'z' ? (r.bounds.z0 + r.bounds.z1) / 2 : (r.bounds.x0 + r.bounds.x1) / 2);
    const swingSign = centerOf(rb) > def.at ? 1 : -1;
    const normal = def.axis === 'z' ? { x: 0, z: swingSign } : { x: swingSign, z: 0 };
    const pos = (t: number) => (def.axis === 'z' ? { x: t, z: def.at } : { x: def.at, z: t });

    const meshes: AbstractMesh[] = [];
    const glass = def.style === 'glass' || def.style === 'double-glass';
    const double = def.style === 'double-wood' || def.style === 'double-glass';
    const leafMat: PropMaterialId = def.style === 'metal' ? 'metal' : glass ? 'glass' : 'wood-light';
    const frameMat: PropMaterialId = glass ? 'metal-dark' : def.style === 'metal' ? 'metal-dark' : 'wood-dark';

    // Frame (casing) spanning both walls
    const frameParts: Mesh[] = [];
    const depth = 0.3;
    for (const side of [-1, 1]) {
      const p = pos(def.center + side * (def.width / 2 + 0.04));
      const jamb = MeshBuilder.CreateBox('jamb', { width: def.axis === 'z' ? 0.08 : depth, height: def.height + 0.06, depth: def.axis === 'z' ? depth : 0.08 }, this.scene);
      jamb.position.set(p.x, (def.height + 0.06) / 2, p.z);
      frameParts.push(jamb);
    }
    const hp = pos(def.center);
    const header = MeshBuilder.CreateBox('header', { width: def.axis === 'z' ? def.width + 0.16 : depth, height: 0.08, depth: def.axis === 'z' ? depth : def.width + 0.16 }, this.scene);
    header.position.set(hp.x, def.height + 0.04, hp.z);
    frameParts.push(header);
    const threshold = MeshBuilder.CreateBox('threshold', { width: def.axis === 'z' ? def.width : depth - 0.04, height: 0.012, depth: def.axis === 'z' ? depth - 0.04 : def.width }, this.scene);
    threshold.position.set(hp.x, 0.006, hp.z);
    frameParts.push(threshold);
    const frame = Mesh.MergeMeshes(frameParts, true, true);
    if (frame) {
      frame.name = `door-frame-${def.id}`;
      frame.material = this.lib.get(frameMat);
      frame.metadata = { kind: 'structure', id: def.id, occluder: true };
      meshes.push(frame);
    }

    // Leaves
    const leaves: Leaf[] = [];
    const leafCount = double ? 2 : 1;
    const leafWidth = (def.width - 0.02) / leafCount;
    for (let i = 0; i < leafCount; i++) {
      const fromStart = i === 0;
      const hingeT = fromStart ? def.center - def.width / 2 + 0.01 : def.center + def.width / 2 - 0.01;
      const extend = fromStart ? along : { x: -along.x, z: -along.z };
      const closedAngle = angleFor(extend.x, extend.z);
      const plus = dirOf(closedAngle + Math.PI / 2);
      const delta = plus.x * normal.x + plus.z * normal.z > 0 ? Math.PI / 2 : -Math.PI / 2;
      const openAngle = closedAngle + delta * OPEN_FRACTION;
      const hinge = pos(hingeT);
      const pivot = new TransformNode(`door-pivot-${def.id}-${i}`, this.scene);
      pivot.position.set(hinge.x, 0, hinge.z);
      pivot.rotation.y = closedAngle;

      const parts: Mesh[] = [];
      const h = def.height - 0.02;
      const leafBox = (w: number, hh: number, d: number, x: number, y: number, z: number, m: PropMaterialId) => {
        const mesh = MeshBuilder.CreateBox('leaf', { width: w, height: hh, depth: d }, this.scene);
        mesh.position.set(x, y, z);
        mesh.material = this.lib.get(m);
        parts.push(mesh);
        return mesh;
      };
      if (glass) {
        leafBox(leafWidth, 0.08, 0.05, leafWidth / 2, 0.04, 0, 'metal-dark');
        leafBox(leafWidth, 0.08, 0.05, leafWidth / 2, h - 0.04, 0, 'metal-dark');
        leafBox(0.06, h, 0.05, 0.03, h / 2, 0, 'metal-dark');
        leafBox(0.06, h, 0.05, leafWidth - 0.03, h / 2, 0, 'metal-dark');
        leafBox(leafWidth - 0.1, h - 0.14, 0.012, leafWidth / 2, h / 2, 0, 'glass');
        leafBox(0.04, 0.4, 0.06, leafWidth - 0.12, 1.05, -0.05, 'chrome');
        leafBox(0.04, 0.4, 0.06, leafWidth - 0.12, 1.05, 0.05, 'chrome');
      } else {
        leafBox(leafWidth, h, 0.045, leafWidth / 2, h / 2, 0, leafMat);
        if (def.style === 'metal') leafBox(0.25, 0.35, 0.05, leafWidth / 2, 1.55, 0, 'glass');
        leafBox(leafWidth - 0.04, 0.22, 0.05, leafWidth / 2, 0.13, 0, def.style === 'metal' ? 'metal-dark' : 'brass');
        for (const s of [-1, 1]) {
          leafBox(0.13, 0.025, 0.025, leafWidth - 0.14, 1.0, s * 0.05, 'chrome');
          leafBox(0.06, 0.1, 0.012, leafWidth - 0.09, 1.0, s * 0.026, 'chrome');
        }
      }
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
      if (merged) {
        merged.name = `door-leaf-${def.id}-${i}`;
        merged.parent = pivot;
        merged.metadata = { kind: 'door', id: def.id, occluder: !glass };
        meshes.push(merged);
      }
      const closedId = `door-${def.id}-closed-${i}`;
      const openId = `door-${def.id}-open-${i}`;
      const mid = { x: hinge.x + extend.x * (leafWidth / 2), z: hinge.z + extend.z * (leafWidth / 2) };
      this.collisions.add({
        id: closedId,
        cx: mid.x,
        cz: mid.z,
        hx: def.axis === 'z' ? leafWidth / 2 : 0.06,
        hz: def.axis === 'z' ? 0.06 : leafWidth / 2,
        rot: 0,
        enabled: true,
      });
      const od = dirOf(openAngle);
      this.collisions.add({
        id: openId,
        cx: hinge.x + od.x * (leafWidth / 2),
        cz: hinge.z + od.z * (leafWidth / 2),
        hx: leafWidth / 2,
        hz: 0.03,
        rot: openAngle,
        enabled: false,
      });
      leaves.push({ pivot, closedAngle, openAngle, width: leafWidth, hinge, closedId, openId });
    }

    for (const mesh of meshes) {
      mesh.receiveShadows = true;
      this.roomMeshes.add(ra.id, mesh);
      this.roomMeshes.add(rb.id, mesh);
    }

    const runtime: DoorRuntime = {
      def,
      state: def.initialState,
      anim: def.initialState === 'open' ? 1 : 0,
      target: def.initialState === 'open' ? 1 : 0,
      speed: 1.8,
      leaves,
      meshes,
      position: [hp.x, 1.2, hp.z],
    };
    this.applyAnim(runtime);
    this.props.addWatch(`door-${def.id}`, () => runtime.meshes.filter((m) => m.metadata?.kind === 'door'));
    if (def.sign) this.buildSign(def);
    return runtime;
  }

  private buildSign(def: DoorDefinition): void {
    const room = this.room(def.signRoom ?? def.rooms[0]);
    const b = room.bounds;
    const inset = 0.075;
    let position: Vec3;
    let rotationY: number;
    const y = Math.min(def.height + 0.28, room.height - 0.2);
    if (def.axis === 'z') {
      const north = Math.abs(b.z1 - def.at) < 0.01;
      position = [def.center, y, north ? def.at - inset : def.at + inset];
      rotationY = north ? 0 : 180;
    } else {
      const east = Math.abs(b.x1 - def.at) < 0.01;
      position = [east ? def.at - inset : def.at + inset, y, def.center];
      rotationY = east ? 90 : 270;
    }
    const placement: PropPlacement = {
      id: `sign-${def.id}`,
      type: 'wall-sign',
      position,
      rotationY,
      scale: 0.7,
      params: { text: def.sign ?? '' },
      tracked: true,
      interaction: { kind: 'inspect', name: 'Door sign', note: `Door sign above the door: "${def.sign}".` },
    };
    const built = this.factory.build(placement, room);
    this.props.add(placement, room, built);
    this.props.watchProp(placement.id);
  }

  /** Player pressed E on a door. Returns the resulting state (or 'locked-attempt'). */
  toggle(id: string): DoorState | 'locked-attempt' {
    const d = this.doors.get(id);
    if (!d) return 'closed';
    if (d.state === 'locked') return 'locked-attempt';
    this.setState(id, d.state === 'open' ? 'closed' : 'open');
    return d.state;
  }

  setState(id: string, state: DoorState, options: { instant?: boolean; slam?: boolean } = {}): void {
    const d = this.doors.get(id);
    if (!d) return;
    d.state = state;
    d.target = state === 'open' ? 1 : 0;
    d.speed = options.slam ? 7 : 1.8;
    if (options.instant) {
      d.anim = d.target;
      this.applyAnim(d);
    }
  }

  isMoving(id: string): boolean {
    const d = this.doors.get(id);
    return !!d && d.anim !== d.target;
  }

  update(dt: number): void {
    for (const d of this.doors.values()) {
      if (d.anim === d.target) continue;
      const step = dt * d.speed;
      d.anim = d.target > d.anim ? Math.min(d.target, d.anim + step) : Math.max(d.target, d.anim - step);
      this.applyAnim(d);
    }
  }

  private applyAnim(d: DoorRuntime): void {
    const t = d.anim;
    const eased = t * t * (3 - 2 * t);
    for (const leaf of d.leaves) {
      leaf.pivot.rotation.y = leaf.closedAngle + (leaf.openAngle - leaf.closedAngle) * eased;
      this.collisions.setEnabled(leaf.closedId, t < 0.2);
      this.collisions.setEnabled(leaf.openId, t > 0.85);
    }
  }

  worldPosition(id: string): Vector3 {
    const d = this.doors.get(id);
    return d ? new Vector3(d.position[0], d.position[1], d.position[2]) : Vector3.Zero();
  }

  dispose(): void {
    for (const d of this.doors.values()) {
      for (const m of d.meshes) m.dispose();
      for (const l of d.leaves) l.pivot.dispose();
    }
    this.doors.clear();
  }
}
