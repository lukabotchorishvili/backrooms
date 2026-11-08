import { AbstractMesh } from '@babylonjs/core';
import { StageDefinition } from '../models';
import { DoorSystem } from './world/door-system';
import { DEFAULT_LAYER } from './world/prop-kit';
import { RoomMeshRegistry } from './world/world-builder';

/** Rooms further than this many open doorways from the player are never drawn. */
const MAX_PORTAL_DEPTH = 3;

/**
 * Cheap portal culling for the player camera. The visible set is the player's room plus rooms
 * reachable through open (or glass) doors; meshes of every other room get the default layer bit
 * removed so the main camera skips them. Security cameras use explicit render lists and are not
 * affected. Layer masks are restored on dispose.
 */
export class RoomCuller {
  private readonly meshRooms = new Map<AbstractMesh, string[]>();
  private readonly original = new Map<AbstractMesh, number>();
  private visibleKey = '';

  constructor(
    private readonly stage: StageDefinition,
    registry: RoomMeshRegistry,
    private readonly doors: DoorSystem,
  ) {
    for (const [roomId, meshes] of registry.entries()) {
      for (const mesh of meshes) {
        const rooms = this.meshRooms.get(mesh) ?? [];
        rooms.push(roomId);
        this.meshRooms.set(mesh, rooms);
        if (!this.original.has(mesh)) this.original.set(mesh, mesh.layerMask);
      }
    }
  }

  visibleRooms(playerRoom: string): Set<string> {
    const visible = new Set<string>([playerRoom]);
    let frontier = [playerRoom];
    for (let depth = 0; depth < MAX_PORTAL_DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const room of frontier) {
        for (const door of this.doors.all()) {
          const [a, b] = door.def.rooms;
          const other = a === room ? b : b === room ? a : null;
          if (!other || visible.has(other)) continue;
          const glass = door.def.style === 'glass' || door.def.style === 'double-glass';
          if (glass || door.anim > 0.01 || door.target > 0) {
            visible.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    return visible;
  }

  update(playerRoom: string | null): void {
    if (!playerRoom) return;
    const visible = this.visibleRooms(playerRoom);
    const key = [...visible].sort().join('|');
    if (key === this.visibleKey) return;
    this.visibleKey = key;
    for (const [mesh, rooms] of this.meshRooms) {
      const base = this.original.get(mesh) ?? DEFAULT_LAYER;
      mesh.layerMask = rooms.some((r) => visible.has(r)) ? base : base & ~DEFAULT_LAYER;
    }
  }

  /** Visible set for diagnostics. */
  get current(): string[] {
    return this.visibleKey ? this.visibleKey.split('|') : [];
  }

  dispose(): void {
    for (const [mesh, mask] of this.original) if (!mesh.isDisposed()) mesh.layerMask = mask;
    this.meshRooms.clear();
    this.original.clear();
  }
}
