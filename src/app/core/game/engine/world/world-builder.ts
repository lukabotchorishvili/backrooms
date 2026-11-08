import {
  AbstractMesh,
  Color3,
  InstancedMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
} from '@babylonjs/core';
import { LightDefinition, RoomDefinition, StageDefinition, WallSide } from '../../models';
import { CollisionWorld } from '../collision-manager';
import { MaterialLibrary } from '../materials/material-library';

export const WALL_THICKNESS = 0.12;

/** Meshes per room, used for per-room lighting and security camera render lists. */
export class RoomMeshRegistry {
  private readonly rooms = new Map<string, Set<AbstractMesh>>();

  /** All (roomId, meshes) pairs. */
  entries(): [string, AbstractMesh[]][] {
    return [...this.rooms.entries()].map(([id, set]) => [id, [...set]]);
  }

  add(roomId: string, mesh: AbstractMesh): void {
    let set = this.rooms.get(roomId);
    if (!set) {
      set = new Set();
      this.rooms.set(roomId, set);
    }
    set.add(mesh);
  }

  /** Meshes lights must include (instances are lit through their source template). */
  lightTargets(roomId: string): AbstractMesh[] {
    return [...(this.rooms.get(roomId) ?? [])].filter((m) => !(m instanceof InstancedMesh));
  }

  /** Meshes a render target should draw (no invisible templates). */
  renderables(roomId: string): AbstractMesh[] {
    return [...(this.rooms.get(roomId) ?? [])].filter((m) => m.isVisible || m instanceof InstancedMesh);
  }

  roomIds(): string[] {
    return [...this.rooms.keys()];
  }
}

export interface FixtureMesh {
  readonly light: LightDefinition;
  readonly diffuser: Mesh;
  readonly material: StandardMaterial;
}

export interface RoomGeometry {
  readonly room: RoomDefinition;
  readonly floor: Mesh;
  /** Ceiling + fixtures move together for the "lower ceiling" anomaly. */
  readonly ceilingNode: TransformNode;
  readonly fixtures: Map<string, FixtureMesh>;
}

interface Opening {
  start: number;
  end: number;
  bottom: number;
  top: number;
  blocking: boolean;
}

const BASEBOARD_H = 0.1;

/** Builds the static architecture of every room in a stage. */
export class WorldBuilder {
  private readonly geometry = new Map<string, RoomGeometry>();
  private fixtureParts: Mesh[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
    private readonly stage: StageDefinition,
    private readonly collisions: CollisionWorld,
    private readonly meshes: RoomMeshRegistry,
  ) {}

  room(id: string): RoomGeometry | undefined {
    return this.geometry.get(id);
  }

  allRooms(): RoomGeometry[] {
    return [...this.geometry.values()];
  }

  buildAll(): void {
    for (const room of this.stage.rooms) this.geometry.set(room.id, this.buildRoom(room));
  }

  private register(room: RoomDefinition, mesh: AbstractMesh, occluder: boolean): void {
    mesh.metadata = { kind: 'structure', id: room.id, occluder };
    mesh.receiveShadows = true;
    this.meshes.add(room.id, mesh);
  }

  private buildRoom(room: RoomDefinition): RoomGeometry {
    const b = room.bounds;
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;

    // Floor
    const floor = MeshBuilder.CreateGround(`floor-${room.id}`, { width: w, height: d }, this.scene);
    floor.position.set(cx, 0, cz);
    floor.material = this.lib.surface(room.surfaces.floor);
    const fs = this.lib.surfaceScale(room.surfaces.floor).scale;
    planarUV(floor, (x, _y, z) => [(x + cx) / fs, (z + cz) / fs]);
    this.register(room, floor, false);
    floor.isPickable = true;

    // Ceiling (+ fixtures) under a node so it can be lowered
    const ceilingNode = new TransformNode(`ceiling-node-${room.id}`, this.scene);
    const ceiling = MeshBuilder.CreateGround(`ceiling-${room.id}`, { width: w, height: d }, this.scene);
    ceiling.rotation.x = Math.PI;
    ceiling.position.set(cx, room.height, cz);
    ceiling.parent = ceilingNode;
    ceiling.material = this.lib.surface(room.surfaces.ceiling);
    const cs = this.lib.surfaceScale(room.surfaces.ceiling).scale;
    planarUV(ceiling, (x, _y, z) => [(x + cx) / cs, (-z + cz) / cs]);
    this.register(room, ceiling, false);

    // Walls
    const wallMat = this.lib.surface(room.surfaces.walls);
    const wallUV = this.lib.surfaceScale(room.surfaces.walls);
    const pieces: Mesh[] = [];
    const baseboards: Mesh[] = [];
    const sides: WallSide[] = ['north', 'south', 'east', 'west'];
    for (const side of sides) {
      if (room.openSides?.includes(side)) continue;
      const { a, b: bEnd } = sideSpan(room, side);
      const openings = this.openingsFor(room, side);
      let cursor = a;
      const segments: { s: number; e: number; y0: number; y1: number }[] = [];
      for (const o of openings) {
        if (o.start > cursor) segments.push({ s: cursor, e: o.start, y0: 0, y1: room.height });
        if (o.bottom > 0) segments.push({ s: o.start, e: o.end, y0: 0, y1: o.bottom });
        if (o.top < room.height) segments.push({ s: o.start, e: o.end, y0: o.top, y1: room.height });
        if (o.blocking) this.addWallCollider(room, side, o.start, o.end);
        cursor = Math.max(cursor, o.end);
      }
      if (cursor < bEnd) segments.push({ s: cursor, e: bEnd, y0: 0, y1: room.height });
      for (const seg of segments) {
        pieces.push(this.wallPiece(room, side, seg.s, seg.e, seg.y0, seg.y1, wallUV.scale, wallUV.fullHeight));
        if (seg.y0 === 0 && seg.y1 > 1.5) {
          this.addWallCollider(room, side, seg.s, seg.e);
          baseboards.push(this.baseboard(room, side, seg.s, seg.e));
        }
      }
      for (const win of room.windows ?? []) {
        if (win.side === side) this.buildWindow(room, side, win.center, win.width, win.sill, win.top, !!win.blinds);
      }
    }
    const walls = pieces.length > 1 ? Mesh.MergeMeshes(pieces, true, true) : pieces[0];
    if (walls) {
      walls.name = `walls-${room.id}`;
      walls.material = wallMat;
      this.register(room, walls, true);
    }
    if (baseboards.length) {
      const merged = Mesh.MergeMeshes(baseboards, true, true);
      if (merged) {
        merged.name = `baseboards-${room.id}`;
        merged.material = this.lib.get('plastic-dark');
        this.register(room, merged, false);
        merged.isPickable = false;
      }
    }

    // Light fixtures
    const fixtures = new Map<string, FixtureMesh>();
    this.fixtureParts = [];
    for (const light of room.lights) {
      if (light.fixture === 'none') continue;
      const f = this.buildFixture(room, light, ceilingNode);
      fixtures.set(light.id, f);
    }
    // Frames, louvres and cords of every fixture in the room: one multi-material mesh.
    if (this.fixtureParts.length) {
      const merged = Mesh.MergeMeshes(this.fixtureParts, true, true, undefined, false, true);
      if (merged) {
        merged.name = `fixtures-${room.id}`;
        merged.parent = ceilingNode;
        merged.isPickable = false;
        this.register(room, merged, false);
      }
      this.fixtureParts = [];
    }
    return { room, floor, ceilingNode, fixtures };
  }

  /** Door/window/opening/elevator cut-outs on one side, sorted along the wall. */
  private openingsFor(room: RoomDefinition, side: WallSide): Opening[] {
    const b = room.bounds;
    const line = side === 'north' ? b.z1 : side === 'south' ? b.z0 : side === 'east' ? b.x1 : b.x0;
    const axis = side === 'north' || side === 'south' ? 'z' : 'x';
    const result: Opening[] = [];
    for (const door of this.stage.doors) {
      if (door.axis !== axis || Math.abs(door.at - line) > 0.01 || !door.rooms.includes(room.id)) continue;
      result.push({ start: door.center - door.width / 2 - 0.06, end: door.center + door.width / 2 + 0.06, bottom: 0, top: door.height + 0.05, blocking: false });
    }
    const el = this.stage.elevator;
    if (el.lobbyRoomId === room.id && el.axis === axis && Math.abs(el.at - line) < 0.01) {
      result.push({ start: el.center - el.width / 2 - 0.05, end: el.center + el.width / 2 + 0.05, bottom: 0, top: el.height + 0.05, blocking: false });
    }
    for (const win of room.windows ?? []) {
      if (win.side !== side) continue;
      result.push({ start: win.center - win.width / 2, end: win.center + win.width / 2, bottom: win.sill, top: win.top, blocking: true });
    }
    for (const o of room.openings ?? []) {
      if (o.side !== side) continue;
      result.push({ start: o.center - o.width / 2, end: o.center + o.width / 2, bottom: 0, top: o.height, blocking: false });
    }
    return result.sort((p, q) => p.start - q.start);
  }

  private wallPiece(room: RoomDefinition, side: WallSide, s: number, e: number, y0: number, y1: number, scale: number, fullHeight: boolean): Mesh {
    const width = e - s;
    const height = y1 - y0;
    const plane = MeshBuilder.CreatePlane(`wall-${room.id}`, { width, height }, this.scene);
    const inset = WALL_THICKNESS / 2;
    const b = room.bounds;
    const mid = (s + e) / 2;
    const yc = (y0 + y1) / 2;
    switch (side) {
      case 'north':
        plane.position.set(mid, yc, b.z1 - inset);
        break;
      case 'south':
        plane.position.set(mid, yc, b.z0 + inset);
        plane.rotation.y = Math.PI;
        break;
      case 'east':
        plane.position.set(b.x1 - inset, yc, mid);
        plane.rotation.y = Math.PI / 2;
        break;
      case 'west':
        plane.position.set(b.x0 + inset, yc, mid);
        plane.rotation.y = -Math.PI / 2;
        break;
    }
    // u follows the viewer's right-hand direction; v is height (full-height textures: 0..1)
    const rightSign = side === 'north' || side === 'west' ? 1 : -1;
    const startAlong = side === 'north' || side === 'west' ? s : -e;
    const u0 = (rightSign > 0 ? startAlong : startAlong) / scale;
    const u1 = u0 + width / scale;
    const v0 = fullHeight ? y0 / room.height : y0 / scale;
    const v1 = fullHeight ? y1 / room.height : y1 / scale;
    setQuadUV(plane, u0, u1, v0, v1);
    return plane;
  }

  private baseboard(room: RoomDefinition, side: WallSide, s: number, e: number): Mesh {
    const len = e - s;
    const depth = 0.018;
    const inset = WALL_THICKNESS / 2 + depth / 2;
    const b = room.bounds;
    const horizontal = side === 'north' || side === 'south';
    const box = MeshBuilder.CreateBox('baseboard', { width: horizontal ? len : depth, height: BASEBOARD_H, depth: horizontal ? depth : len }, this.scene);
    const mid = (s + e) / 2;
    if (side === 'north') box.position.set(mid, BASEBOARD_H / 2, b.z1 - inset);
    if (side === 'south') box.position.set(mid, BASEBOARD_H / 2, b.z0 + inset);
    if (side === 'east') box.position.set(b.x1 - inset, BASEBOARD_H / 2, mid);
    if (side === 'west') box.position.set(b.x0 + inset, BASEBOARD_H / 2, mid);
    return box;
  }

  private addWallCollider(room: RoomDefinition, side: WallSide, s: number, e: number): void {
    const b = room.bounds;
    const t = WALL_THICKNESS;
    const mid = (s + e) / 2;
    const len = e - s;
    const id = `wall-${room.id}-${side}-${s.toFixed(2)}`;
    if (side === 'north') this.collisions.add({ id, cx: mid, cz: b.z1 - t / 2, hx: len / 2, hz: t / 2, rot: 0, enabled: true });
    if (side === 'south') this.collisions.add({ id, cx: mid, cz: b.z0 + t / 2, hx: len / 2, hz: t / 2, rot: 0, enabled: true });
    if (side === 'east') this.collisions.add({ id, cx: b.x1 - t / 2, cz: mid, hx: t / 2, hz: len / 2, rot: 0, enabled: true });
    if (side === 'west') this.collisions.add({ id, cx: b.x0 + t / 2, cz: mid, hx: t / 2, hz: len / 2, rot: 0, enabled: true });
  }

  private buildWindow(room: RoomDefinition, side: WallSide, center: number, width: number, sill: number, top: number, blinds: boolean): void {
    const b = room.bounds;
    const node = new TransformNode(`window-${room.id}-${center}`, this.scene);
    const line = side === 'north' ? b.z1 : side === 'south' ? b.z0 : side === 'east' ? b.x1 : b.x0;
    // local frame: x along wall, -Z into the room
    if (side === 'north') {
      node.position.set(center, 0, line);
    } else if (side === 'south') {
      node.position.set(center, 0, line);
      node.rotation.y = Math.PI;
    } else if (side === 'east') {
      node.position.set(line, 0, center);
      node.rotation.y = Math.PI / 2;
    } else {
      node.position.set(line, 0, center);
      node.rotation.y = -Math.PI / 2;
    }
    const h = top - sill;
    const parts: Mesh[] = [];
    const box = (w: number, hh: number, d: number, x: number, y: number, z: number) => {
      const m = MeshBuilder.CreateBox('win', { width: w, height: hh, depth: d }, this.scene);
      m.position.set(x, y, z);
      parts.push(m);
      return m;
    };
    box(width + 0.12, 0.05, 0.22, 0, sill - 0.025, -0.06); // sill
    box(width + 0.12, 0.06, 0.16, 0, top + 0.03, 0);
    box(0.06, h, 0.16, -width / 2 - 0.03, sill + h / 2, 0);
    box(0.06, h, 0.16, width / 2 + 0.03, sill + h / 2, 0);
    box(0.04, h, 0.06, 0, sill + h / 2, 0);
    if (blinds) {
      for (let y = top - 0.08; y > sill + h * 0.45; y -= 0.06) box(width, 0.004, 0.06, 0, y, -0.1).rotation.x = 0.7;
      box(width + 0.04, 0.05, 0.08, 0, top - 0.03, -0.1);
    }
    const frame = Mesh.MergeMeshes(parts, true, true);
    if (frame) {
      frame.parent = node;
      frame.material = this.lib.get('metal-dark');
      this.register(room, frame, false);
    }
    const glass = MeshBuilder.CreatePlane('glass', { width, height: h }, this.scene);
    glass.parent = node;
    glass.position.set(0, sill + h / 2, 0.02);
    glass.material = this.lib.get('glass');
    this.register(room, glass, false);
    glass.isPickable = false;
    const outside = MeshBuilder.CreatePlane('outside', { width: width + 3, height: h + 2 }, this.scene);
    outside.parent = node;
    outside.position.set(0, sill + h / 2, 1.4);
    outside.material = this.lib.get('outside-fog');
    this.register(room, outside, false);
    outside.isPickable = false;
  }

  private buildFixture(room: RoomDefinition, light: LightDefinition, parent: TransformNode): FixtureMesh {
    const [x, , z] = light.position;
    const y = room.height;
    const size = light.fixture === 'strip' ? [1.2, 0.18] : light.fixture === 'bulb' ? [0.14, 0.14] : [1.2, 0.6];
    const material = new StandardMaterial(`fixture-${light.id}`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = new Color3(0.95, 0.97, 1);
    material.diffuseColor = new Color3(1, 1, 1);
    let diffuser: Mesh;
    if (light.fixture === 'bulb') {
      diffuser = MeshBuilder.CreateSphere(`bulb-${light.id}`, { diameter: 0.14, segments: 8 }, this.scene);
      diffuser.position.set(x, y - 0.32, z);
      const cord = MeshBuilder.CreateCylinder(`cord-${light.id}`, { diameter: 0.01, height: 0.25 }, this.scene);
      cord.position.set(x, y - 0.13, z);
      cord.material = this.lib.get('rubber');
      this.fixtureParts.push(cord);
    } else {
      const frame = MeshBuilder.CreateBox(`troffer-${light.id}`, { width: size[0] + 0.05, height: 0.04, depth: size[1] + 0.05 }, this.scene);
      frame.position.set(x, y - 0.015, z);
      frame.material = this.lib.get('metal');
      this.fixtureParts.push(frame);
      diffuser = MeshBuilder.CreatePlane(`diffuser-${light.id}`, { width: size[0], height: size[1] }, this.scene);
      diffuser.rotation.x = -Math.PI / 2;
      diffuser.position.set(x, y - 0.037, z);
      // faint louvre grid
      if (light.fixture === 'panel') {
        for (const off of [-size[0] / 4, size[0] / 4]) {
          const louvre = MeshBuilder.CreateBox('louvre', { width: 0.015, height: 0.02, depth: size[1] }, this.scene);
          louvre.position.set(x + off, y - 0.045, z);
          louvre.material = this.lib.get('metal');
          this.fixtureParts.push(louvre);
        }
      }
    }
    diffuser.material = material;
    diffuser.parent = parent;
    diffuser.isPickable = false;
    this.register(room, diffuser, false);
    return { light, diffuser, material };
  }
}

function sideSpan(room: RoomDefinition, side: WallSide): { a: number; b: number } {
  const b = room.bounds;
  return side === 'north' || side === 'south' ? { a: b.x0, b: b.x1 } : { a: b.z0, b: b.z1 };
}

/** Sets UVs of a Babylon CreatePlane mesh (vertex order: BL, BR, TR, TL). */
export function setQuadUV(mesh: Mesh, u0: number, u1: number, v0: number, v1: number): void {
  mesh.setVerticesData(VertexBuffer.UVKind, [u0, v0, u1, v0, u1, v1, u0, v1]);
}

/** Computes UVs from local vertex positions. */
export function planarUV(mesh: Mesh, fn: (x: number, y: number, z: number) => [number, number]): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!pos) return;
  const uvs: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const [u, v] = fn(pos[i], pos[i + 1], pos[i + 2]);
    uvs.push(u, v);
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}
