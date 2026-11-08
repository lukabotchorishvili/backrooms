import { Injectable } from '@angular/core';
import { MemoryState, PropStateSnapshot, RoomId, RoomMemoryEntry } from '../models';

export type PropChange = 'position' | 'rotation' | 'visibility' | 'variant' | 'text';

export interface PropDiff {
  readonly propId: string;
  readonly changes: readonly PropChange[];
}

const POSITION_EPSILON = 0.05;
const ROTATION_EPSILON = 2;

export function diffSnapshots(baseline: PropStateSnapshot, current: PropStateSnapshot): PropChange[] {
  const changes: PropChange[] = [];
  const dx = baseline.position[0] - current.position[0];
  const dy = baseline.position[1] - current.position[1];
  const dz = baseline.position[2] - current.position[2];
  if (Math.hypot(dx, dy, dz) > POSITION_EPSILON) changes.push('position');
  const dr = Math.abs((((baseline.rotationY - current.rotationY) % 360) + 540) % 360 - 180);
  if (dr > ROTATION_EPSILON) changes.push('rotation');
  if (baseline.visible !== current.visible) changes.push('visibility');
  if ((baseline.variant ?? '') !== (current.variant ?? '')) changes.push('variant');
  if ((baseline.text ?? '') !== (current.text ?? '')) changes.push('text');
  return changes;
}

/**
 * Memory rooms: the first time the player enters a room its tracked props are snapshotted.
 * Later visits can be compared against that baseline. The director uses visit counts and
 * away-time to decide when "memory changes" (room-exit / room-return triggers) may happen.
 */
@Injectable({ providedIn: 'root' })
export class MemoryRoomService {
  private state: MemoryState = { rooms: {} };

  reset(): void {
    this.state = { rooms: {} };
  }

  restore(state: MemoryState): void {
    this.state = JSON.parse(JSON.stringify(state ?? { rooms: {} })) as MemoryState;
  }

  export(): MemoryState {
    return JSON.parse(JSON.stringify(this.state)) as MemoryState;
  }

  /** Records a visit. On first visit the baseline is captured via `capture()`. */
  enter(roomId: RoomId, now: number, capture: () => Record<string, PropStateSnapshot>): { firstVisit: boolean; entry: RoomMemoryEntry } {
    let entry = this.state.rooms[roomId];
    const firstVisit = !entry;
    if (!entry) {
      entry = { firstVisitAt: now, lastExitAt: -1, visits: 0, baseline: capture() };
      this.state.rooms[roomId] = entry;
    }
    entry.visits++;
    return { firstVisit, entry };
  }

  exit(roomId: RoomId, now: number): void {
    const entry = this.state.rooms[roomId];
    if (entry) entry.lastExitAt = now;
  }

  visits(roomId: RoomId): number {
    return this.state.rooms[roomId]?.visits ?? 0;
  }

  visitedRooms(): RoomId[] {
    return Object.keys(this.state.rooms);
  }

  awaySeconds(roomId: RoomId, now: number): number {
    const entry = this.state.rooms[roomId];
    if (!entry || entry.lastExitAt < 0) return 0;
    return now - entry.lastExitAt;
  }

  baseline(roomId: RoomId): Record<string, PropStateSnapshot> | null {
    return this.state.rooms[roomId]?.baseline ?? null;
  }

  /** Differences between the remembered baseline and the room's current state. */
  compare(roomId: RoomId, current: Record<string, PropStateSnapshot>): PropDiff[] {
    const baseline = this.baseline(roomId);
    if (!baseline) return [];
    const diffs: PropDiff[] = [];
    for (const [propId, base] of Object.entries(baseline)) {
      const now = current[propId];
      if (!now) continue;
      const changes = diffSnapshots(base, now);
      if (changes.length) diffs.push({ propId, changes });
    }
    for (const [propId, now] of Object.entries(current)) {
      if (!baseline[propId] && now.visible) diffs.push({ propId, changes: ['visibility'] });
    }
    return diffs;
  }
}
