import {
  AbstractMesh,
  Mesh,
  MeshBuilder,
  Scene,
  Light,
  StandardMaterial,
  TransformNode,
  Vector4,
} from '@babylonjs/core';
import { PropPlacement, RoomDefinition, StageDefinition } from '../../models';
import { MaterialLibrary, PropMaterialId } from '../materials/material-library';
import { TextSurface } from './text-surface';

/** Layer only security cameras render (the player camera excludes it). */
export const CAMERA_ONLY_LAYER = 0x10000000;
export const DEFAULT_LAYER = 0x0fffffff;

export interface LocalCollider {
  /** Centre in prop-local space. */
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
  /** Extra local rotation (radians). */
  readonly rot?: number;
}

export interface ClockHands {
  readonly hour: TransformNode;
  readonly minute: TransformNode;
  readonly second: TransformNode;
}

export interface FakeDoorController {
  readonly leaf: TransformNode;
  /** Index into BuiltProp.colliders that the closed leaf occupies. */
  readonly colliderIndex: number;
  readonly openAngle: number;
}

export interface BuiltProp {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[];
  readonly parts: Map<string, AbstractMesh | TransformNode>;
  readonly colliders: LocalCollider[];
  text?: TextSurface;
  /** Default text drawn into the text surface. */
  defaultText?: string;
  setVariant?: (variant: string) => void;
  clock?: ClockHands;
  fakeDoor?: FakeDoorController;
  /** Per-frame animation (fans, LEDs, curtains). */
  update?: (dt: number, time: number) => void;
  /** Prop-owned lights; the factory restricts them to the prop's own meshes. */
  lights?: Light[];
  /** Releases per-instance materials/textures. */
  disposeExtra?: () => void;
}

export interface PropBuildContext {
  readonly scene: Scene;
  readonly lib: MaterialLibrary;
  readonly stage: StageDefinition;
  readonly room: RoomDefinition;
  readonly placement: PropPlacement;
  /** Per-room template cache for GPU instancing (templates are invisible sources). */
  template(key: string, build: () => Mesh): Mesh;
}

export type PropBuilder = (ctx: PropBuildContext, kit: PropKit) => void;

type Mat = PropMaterialId | StandardMaterial;

/**
 * Small modelling toolkit. Parts are created in prop-local space; `merge()` bakes static parts
 * into one multi-material mesh parented to the prop root (one draw call per material).
 */
export class PropKit {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[] = [];
  readonly parts = new Map<string, AbstractMesh | TransformNode>();
  readonly colliders: LocalCollider[] = [];
  private pending: Mesh[] = [];
  private counter = 0;
  result: Partial<BuiltProp> = {};

  constructor(
    readonly scene: Scene,
    readonly lib: MaterialLibrary,
    readonly id: string,
  ) {
    this.root = new TransformNode(`prop-${id}`, scene);
  }

  private mat(m: Mat): StandardMaterial {
    return typeof m === 'string' ? this.lib.get(m) : m;
  }

  private name(kind: string): string {
    return `${this.id}-${kind}-${this.counter++}`;
  }

  /** Box centred at (x, y, z). `uv` = metres per texture repeat (default: stretch). */
  box(w: number, h: number, d: number, m: Mat, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; uv?: number; keep?: string } = {}): Mesh {
    const faceUV = o.uv
      ? [
          new Vector4(0, 0, w / o.uv, h / o.uv),
          new Vector4(0, 0, w / o.uv, h / o.uv),
          new Vector4(0, 0, d / o.uv, h / o.uv),
          new Vector4(0, 0, d / o.uv, h / o.uv),
          new Vector4(0, 0, w / o.uv, d / o.uv),
          new Vector4(0, 0, w / o.uv, d / o.uv),
        ]
      : undefined;
    const mesh = MeshBuilder.CreateBox(this.name('box'), { width: w, height: h, depth: d, faceUV, wrap: true }, this.scene);
    return this.place(mesh, m, x, y, z, o);
  }

  /** Box with explicit per-face UVs (front, back, right, left, top, bottom). */
  boxWithUV(w: number, h: number, d: number, m: Mat, x: number, y: number, z: number, faceUV: Vector4[]): Mesh {
    const mesh = MeshBuilder.CreateBox(this.name('box'), { width: w, height: h, depth: d, faceUV, wrap: true }, this.scene);
    return this.place(mesh, m, x, y, z, {});
  }

  /** Box whose bottom sits at yBottom. */
  boxUp(w: number, h: number, d: number, m: Mat, x: number, yBottom: number, z: number, o: { rx?: number; ry?: number; rz?: number; uv?: number; keep?: string } = {}): Mesh {
    return this.box(w, h, d, m, x, yBottom + h / 2, z, o);
  }

  cyl(dTop: number, dBottom: number, h: number, m: Mat, x: number, yBottom: number, z: number, o: { tess?: number; rx?: number; ry?: number; rz?: number; keep?: string } = {}): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      this.name('cyl'),
      { diameterTop: dTop, diameterBottom: dBottom, height: h, tessellation: o.tess ?? 16 },
      this.scene,
    );
    return this.place(mesh, m, x, yBottom + h / 2, z, o);
  }

  sphere(d: number, m: Mat, x: number, y: number, z: number, o: { segments?: number; sy?: number; keep?: string } = {}): Mesh {
    const mesh = MeshBuilder.CreateSphere(this.name('sph'), { diameter: d, segments: o.segments ?? 10 }, this.scene);
    if (o.sy) mesh.scaling.y = o.sy;
    return this.place(mesh, m, x, y, z, o);
  }

  plane(w: number, h: number, m: Mat, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; double?: boolean; keep?: string } = {}): Mesh {
    const mesh = MeshBuilder.CreatePlane(this.name('pln'), { width: w, height: h, sideOrientation: o.double ? Mesh.DOUBLESIDE : Mesh.FRONTSIDE }, this.scene);
    return this.place(mesh, m, x, y, z, o);
  }

  torus(d: number, thickness: number, m: Mat, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; keep?: string } = {}): Mesh {
    const mesh = MeshBuilder.CreateTorus(this.name('tor'), { diameter: d, thickness, tessellation: 18 }, this.scene);
    return this.place(mesh, m, x, y, z, o);
  }

  private place(mesh: Mesh, m: Mat, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; keep?: string }): Mesh {
    mesh.material = this.mat(m);
    mesh.position.set(x, y, z);
    if (o.rx) mesh.rotation.x = o.rx;
    if (o.ry) mesh.rotation.y = o.ry;
    if (o.rz) mesh.rotation.z = o.rz;
    if (o.keep) {
      this.keep(o.keep, mesh);
    } else {
      this.pending.push(mesh);
    }
    return mesh;
  }

  /** Keeps a mesh separate (animated / text / swappable) and parents it to the root. */
  keep(name: string, mesh: Mesh | TransformNode, parent: TransformNode = this.root): void {
    mesh.parent = parent;
    this.parts.set(name, mesh);
    if (mesh instanceof AbstractMesh) this.meshes.push(mesh);
  }

  /** A pivot node for animated sub-assemblies (door leaves, clock hands). */
  pivot(name: string, x: number, y: number, z: number, parent: TransformNode = this.root): TransformNode {
    const node = new TransformNode(`${this.id}-${name}`, this.scene);
    node.parent = parent;
    node.position.set(x, y, z);
    this.parts.set(name, node);
    return node;
  }

  /** Mesh parented to a pivot, kept separate. */
  attach(mesh: Mesh, pivot: TransformNode, partName?: string): Mesh {
    const idx = this.pending.indexOf(mesh);
    if (idx >= 0) this.pending.splice(idx, 1);
    mesh.parent = pivot;
    this.meshes.push(mesh);
    if (partName) this.parts.set(partName, mesh);
    return mesh;
  }

  collider(x: number, z: number, w: number, d: number, rot = 0): number {
    this.colliders.push({ x, z, hx: w / 2, hz: d / 2, rot });
    return this.colliders.length - 1;
  }

  /** Merges every pending (non-kept) part into one mesh under the root. */
  merge(): Mesh | null {
    const parts = this.pending;
    this.pending = [];
    if (parts.length === 0) return null;
    const merged = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!merged) return null;
    merged.name = `${this.id}-body`;
    merged.parent = this.root;
    this.meshes.push(merged);
    this.parts.set('body', merged);
    return merged;
  }

  /** Detaches pending parts into a standalone merged mesh (used to build instancing templates). */
  takeMerged(name: string): Mesh | null {
    const parts = this.pending;
    this.pending = [];
    if (parts.length === 0) return null;
    const merged = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (merged) merged.name = name;
    return merged;
  }

  /** Uses a per-room template mesh via GPU instancing. */
  instance(ctx: PropBuildContext, key: string, build: (k: PropKit) => void): void {
    const template = ctx.template(key, () => {
      const temp = new PropKit(this.scene, this.lib, `${ctx.room.id}-${key}`);
      build(temp);
      const mesh = temp.takeMerged(`tpl-${ctx.room.id}-${key}`);
      temp.root.dispose();
      if (!mesh) throw new Error(`Template ${key} produced no geometry`);
      return mesh;
    });
    const inst = template.createInstance(`${this.id}-inst`);
    inst.parent = this.root;
    this.meshes.push(inst);
    this.parts.set('body', inst);
  }

  finish(): BuiltProp {
    this.merge();
    return {
      root: this.root,
      meshes: this.meshes,
      parts: this.parts,
      colliders: this.colliders,
      ...this.result,
    };
  }
}
