import { AttentionLevel } from './attention.model';
import { DoorState, InteractionKind, RoomId } from './room.model';

/**
 * Meaningful gameplay events. The engine emits them; GameSessionService routes them to
 * behaviour tracking, attention, the director (event triggers) and progression.
 * Raw input (mouse deltas, key states) never becomes an event.
 */
export type GameEvent =
  | { readonly type: 'room-enter'; readonly roomId: RoomId; readonly previousRoomId: RoomId | null }
  | { readonly type: 'room-exit'; readonly roomId: RoomId; readonly durationSec: number }
  | { readonly type: 'door-interact'; readonly doorId: string; readonly result: DoorState | 'locked-attempt' }
  | { readonly type: 'object-inspect'; readonly propId: string; readonly roomId: RoomId | null }
  | { readonly type: 'object-gaze'; readonly propId: string; readonly roomId: RoomId | null }
  | { readonly type: 'interaction'; readonly propId: string; readonly kind: InteractionKind }
  | { readonly type: 'flashlight'; readonly on: boolean }
  | { readonly type: 'sprint'; readonly active: boolean }
  | { readonly type: 'report-confirmed'; readonly anomalyId: string }
  | { readonly type: 'report-rejected' }
  | { readonly type: 'anomaly-activated'; readonly anomalyId: string }
  | { readonly type: 'anomaly-witnessed'; readonly anomalyId: string }
  | { readonly type: 'flag-set'; readonly flag: string }
  | { readonly type: 'attention-level'; readonly level: AttentionLevel; readonly previous: AttentionLevel }
  | { readonly type: 'escalation-start' }
  | { readonly type: 'escalation-end' }
  | { readonly type: 'elevator-called' }
  | { readonly type: 'terminal-opened' };

export type GameEventType = GameEvent['type'];

/** Minimal synchronous typed event bus (no RxJS needed for frame-synchronous events). */
export class GameEventBus {
  private readonly listeners = new Set<(event: GameEvent) => void>();

  on(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: GameEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
