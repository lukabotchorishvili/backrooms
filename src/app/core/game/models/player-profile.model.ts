import { RoomId } from './room.model';

/**
 * Behavioural tendencies the building can recognise. They are NOT mutually exclusive:
 * each one gets an independent 0..1 score.
 */
export const BEHAVIOR_TENDENCIES = [
  'curious',
  'cautious',
  'rusher',
  'repetitive',
  'avoidant',
  'observant',
  'door-checker',
] as const;
export type BehaviorTendency = (typeof BEHAVIOR_TENDENCIES)[number];

/** Raw counters/accumulators. Only meaningful events are recorded - never raw mouse input. */
export interface BehaviorMetrics {
  totalTime: number;
  moveTime: number;
  sprintTime: number;
  slowMoveTime: number;
  stillTime: number;
  darkTime: number;
  flashlightTime: number;
  /** Accumulated yaw (degrees) turned while moving slowly or standing - "checking surroundings". */
  lookAroundDegrees: number;
  doorInteractions: number;
  lockedDoorAttempts: number;
  roomEntries: number;
  roomRevisits: number;
  backtracks: number;
  inspections: number;
  uniqueInspections: number;
  gazes: number;
  interactions: number;
  flashlightToggles: number;
  sprintStarts: number;
  correctReports: number;
  falseReports: number;
  anomaliesWitnessed: number;
  roomTime: Record<RoomId, number>;
  roomVisits: Record<RoomId, number>;
  objectGazes: Record<string, number>;
  inspectedProps: string[];
  firstRoomEntryClock: Record<RoomId, string>;
}

/** Metrics normalised to 0..1 so tendencies can be computed with weights. */
export interface NormalizedBehavior {
  doorFrequency: number;
  inspectionRate: number;
  objectCoverage: number;
  revisitRatio: number;
  backtrackRate: number;
  sprintRatio: number;
  slowMoveRatio: number;
  stillRatio: number;
  lookAroundRate: number;
  darkRatio: number;
  darkAvoidance: number;
  flashlightRatio: number;
  interactionRate: number;
  reportAccuracy: number;
  witnessRate: number;
}

export interface BehaviorProfile {
  readonly scores: Readonly<Record<BehaviorTendency, number>>;
  /** Tendencies whose score passed the dominance threshold, strongest first. */
  readonly dominant: readonly BehaviorTendency[];
}

export interface BehaviorSnapshot {
  readonly metrics: BehaviorMetrics;
  readonly normalized: NormalizedBehavior;
  readonly profile: BehaviorProfile;
}

/** Per-frame movement sample supplied by the engine (aggregated, not stored). */
export interface MovementSample {
  readonly dt: number;
  readonly speed: number;
  readonly sprinting: boolean;
  readonly yawDeltaDeg: number;
  readonly inDarkArea: boolean;
  readonly flashlightOn: boolean;
  readonly roomId: RoomId | null;
}

/**
 * A data-driven reaction of the building to a tendency.
 * Defined in content/behavior/behavior-responses.ts.
 */
export interface BehaviorResponseDefinition {
  readonly id: string;
  readonly tendency: BehaviorTendency;
  /** Score at which the response switches on. */
  readonly threshold: number;
  readonly description: string;
  /** Multiplies the selection weight of anomalies carrying these tags. */
  readonly tagWeightMultipliers?: Readonly<Record<string, number>>;
  /** Multiplies the decoy event rate. */
  readonly decoyRateMultiplier?: number;
  /** Multiplies the weight of decoys carrying these tags. */
  readonly decoyTagMultipliers?: Readonly<Record<string, number>>;
  /** Lines the building may display on screens/terminal (supports {tokens}). */
  readonly messages: readonly string[];
}
