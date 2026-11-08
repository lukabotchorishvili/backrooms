import { AnomalyCategory, AnomalyRuntimeState } from './anomaly.model';
import { AttentionState } from './attention.model';
import { Vec3 } from './common.model';
import { BehaviorMetrics } from './player-profile.model';
import { DoorState, RoomId } from './room.model';
import { ObjectiveId } from './stage.model';

export type GamePhase =
  | 'idle'
  | 'loading'
  | 'awaiting-start'
  | 'intro'
  | 'playing'
  | 'paused'
  | 'terminal'
  | 'notebook'
  | 'security'
  | 'ending'
  | 'error';

export type ObservationSource =
  | { readonly kind: 'prop'; readonly propId: string }
  | { readonly kind: 'anomaly'; readonly anomalyId: string }
  | { readonly kind: 'decoy'; readonly decoyId: string };

/** A notebook entry. The source is hidden from the player. */
export interface Observation {
  readonly id: string;
  /** Run time in seconds. */
  readonly time: number;
  /** In-game shift clock, e.g. "10:42". */
  readonly clock: string;
  readonly roomId: RoomId;
  readonly alternateRoomIds?: readonly RoomId[];
  readonly subject: string;
  readonly text: string;
  readonly source: ObservationSource;
  reported: boolean;
}

export interface AnomalyReport {
  readonly observationId: string;
  readonly roomId: RoomId;
  readonly category: AnomalyCategory;
}

export type ReportOutcome = 'confirmed' | 'rejected' | 'mismatch' | 'duplicate' | 'invalid';

export interface ReportResult {
  readonly outcome: ReportOutcome;
  readonly anomalyId?: string;
  readonly headline: string;
  readonly detail: string;
  readonly attentionDelta: number;
}

export interface ReportRecord {
  readonly time: number;
  readonly observationId: string;
  readonly roomId: RoomId;
  readonly category: AnomalyCategory;
  readonly outcome: ReportOutcome;
}

export interface DirectorState {
  seed: number;
  rngState: number;
  elapsed: number;
  sinceLastSelection: number;
  sinceLastDecoy: number;
  anomalies: Record<string, AnomalyRuntimeState>;
  history: string[];
  eventCounts: Record<string, number>;
}

export interface RoomMemoryEntry {
  firstVisitAt: number;
  lastExitAt: number;
  visits: number;
  /** Baseline snapshot of tracked props: propId -> serialised state. */
  baseline: Record<string, PropStateSnapshot>;
}

export interface PropStateSnapshot {
  readonly position: Vec3;
  readonly rotationY: number;
  readonly visible: boolean;
  readonly variant?: string;
  readonly text?: string;
}

export interface MemoryState {
  rooms: Record<RoomId, RoomMemoryEntry>;
}

export interface ProgressionState {
  objective: ObjectiveId;
  flags: string[];
  /** Ending locked in when the elevator was called (null until then). */
  pendingEndingId: string | null;
}

/** Everything needed to resume a run. Serialisable - no engine objects. */
export interface RunSnapshot {
  readonly stageId: string;
  readonly difficultyId: string;
  readonly seed: number;
  readonly elapsed: number;
  readonly savedAtClock: string;
  readonly player: {
    readonly position: Vec3;
    readonly yawDeg: number;
    readonly pitchDeg: number;
    readonly flashlight: boolean;
  };
  readonly attention: AttentionState;
  readonly investigation: {
    readonly observations: Observation[];
    readonly confirmedAnomalyIds: string[];
    readonly reports: ReportRecord[];
  };
  readonly director: DirectorState;
  readonly memory: MemoryState;
  readonly progression: ProgressionState;
  readonly doors: Record<string, DoorState>;
  readonly behavior: BehaviorMetrics;
}

/** HUD-facing interaction prompt. */
export interface InteractionPrompt {
  readonly key: string;
  readonly verb: string;
  readonly target: string;
  readonly disabled?: boolean;
}
