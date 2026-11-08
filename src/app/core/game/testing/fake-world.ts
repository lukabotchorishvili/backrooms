/**
 * Test support: a scripted stand-in for the 3D world, used by director / completability specs.
 * Not imported by application code.
 */
import { createDefaultContentRegistry } from '../content/content-registry';
import {
  AttentionLevel,
  BEHAVIOR_TENDENCIES,
  BehaviorProfile,
  BehaviorTendency,
  DifficultyConfig,
  DoorState,
  RoomId,
  StageDefinition,
} from '../models';
import { AnomalyDirectorService, DirectorSetup, DirectorWorld } from '../systems/anomaly-director.service';

export const registry = createDefaultContentRegistry();
export const stage: StageDefinition = registry.stages.require('floor-14');

export function profile(scores: Partial<Record<BehaviorTendency, number>> = {}): BehaviorProfile {
  const full = Object.fromEntries(BEHAVIOR_TENDENCIES.map((t) => [t, scores[t] ?? 0])) as Record<BehaviorTendency, number>;
  return { scores: full, dominant: BEHAVIOR_TENDENCIES.filter((t) => full[t] >= 0.55) };
}

export class FakeWorld implements DirectorWorld {
  playerRoomId: RoomId | null = 'open-plan';
  attentionLevel: AttentionLevel = 'low';
  confirmedCount = 0;
  flags = new Set<string>();
  profile: BehaviorProfile = profile();
  doorStates: Record<string, DoorState> = Object.fromEntries(stage.doors.map((d) => [d.id, d.initialState]));
  visits = new Map<RoomId, number>();
  /** Props the player is currently looking at. */
  seen = new Set<string>();
  private readonly adjacency = new Map<RoomId, RoomId[]>();

  constructor() {
    for (const d of stage.doors) {
      const [a, b] = d.rooms;
      this.adjacency.set(a, [...(this.adjacency.get(a) ?? []), b]);
      this.adjacency.set(b, [...(this.adjacency.get(b) ?? []), a]);
    }
  }

  roomVisits(roomId: RoomId): number {
    return this.visits.get(roomId) ?? 0;
  }

  propUnseenSeconds(propId: string): number {
    if (this.seen.has(propId)) return 0;
    const room = stage.rooms.find((r) => r.props.some((p) => p.id === propId));
    return room && room.id === this.playerRoomId ? 0.2 : 999;
  }

  adjacentRooms(roomId: RoomId): readonly RoomId[] {
    return this.adjacency.get(roomId) ?? [];
  }

  enter(roomId: RoomId): void {
    this.playerRoomId = roomId;
    this.visits.set(roomId, this.roomVisits(roomId) + 1);
  }

  visitAll(): void {
    for (const r of stage.rooms) this.visits.set(r.id, Math.max(1, this.roomVisits(r.id)));
  }
}

export function directorSetup(difficulty: DifficultyConfig, seed = 1234): DirectorSetup {
  return {
    stage,
    difficulty,
    anomalies: registry.anomaliesForStage(stage),
    decoys: registry.decoysForStage(stage),
    responses: registry.responsesForStage(stage),
    seed,
  };
}

export function startDirector(difficultyId = 'employee', seed = 1234): AnomalyDirectorService {
  const director = new AnomalyDirectorService();
  director.start(directorSetup(registry.difficulties.require(difficultyId), seed));
  return director;
}
