import { AttentionLevel } from './attention.model';
import { Rgb, Vec3 } from './common.model';
import { BehaviorTendency } from './player-profile.model';
import { DoorState, RoomId } from './room.model';

export const ANOMALY_CATEGORIES = ['visual', 'spatial', 'temporal', 'audio', 'behavioral'] as const;
export type AnomalyCategory = (typeof ANOMALY_CATEGORIES)[number];

export const ANOMALY_CATEGORY_LABELS: Record<AnomalyCategory, string> = {
  visual: 'Visual irregularity',
  spatial: 'Spatial irregularity',
  temporal: 'Temporal irregularity',
  audio: 'Auditory irregularity',
  behavioral: 'Behavioural irregularity',
};

/** 1 = obvious, 5 = extremely subtle. */
export type AnomalyDifficulty = 1 | 2 | 3 | 4 | 5;

/* ------------------------------------------------------------------------------------------ */
/* Triggers: WHEN a selected (pending) anomaly is allowed to become active.                     */
/* ------------------------------------------------------------------------------------------ */

export type AnomalyTrigger =
  /** As soon as selected, provided the target room is not occupied (unless allowObserved). */
  | { readonly type: 'immediate'; readonly allowObserved?: boolean }
  /** After the player leaves the target room (memory-room change). */
  | { readonly type: 'room-exit'; readonly minVisits?: number }
  /** When the player is approaching the room again (adjacent room) after N visits. */
  | { readonly type: 'room-return'; readonly minVisits: number }
  /** When the target prop has been out of the player's view for N seconds. */
  | { readonly type: 'unobserved'; readonly minUnseenSec: number }
  /** After a game event occurred N times (e.g. 'report-confirmed'). */
  | { readonly type: 'event'; readonly event: string; readonly count?: number };

/* ------------------------------------------------------------------------------------------ */
/* Effects: WHAT changes in the world. Each type is implemented by a registered handler in     */
/* engine/anomalies/handlers. Add a new effect = extend this union + register a handler.      */
/* ------------------------------------------------------------------------------------------ */

export type AnomalyEffect =
  | {
      readonly type: 'transform-prop';
      readonly propId: string;
      readonly offset?: Vec3;
      readonly rotateDeg?: number;
      readonly scale?: number;
      /** Scale the change by difficulty subtlety (subtle = smaller change). */
      readonly subtletyScaled?: boolean;
    }
  | { readonly type: 'hide-prop'; readonly propId: string }
  | { readonly type: 'show-prop'; readonly propId: string }
  | { readonly type: 'swap-variant'; readonly propId: string; readonly variant: string }
  | {
      readonly type: 'set-text';
      readonly propId: string;
      /** Supports {tokens} resolved from the behaviour profile. */
      readonly text: string;
      readonly color?: Rgb;
    }
  | {
      readonly type: 'clock';
      readonly propId: string;
      readonly mode: 'backward' | 'frozen' | 'fast';
      /** HH:MM for frozen clocks. */
      readonly time?: string;
    }
  | {
      readonly type: 'light-color';
      readonly roomId: RoomId;
      readonly lightIds?: readonly string[];
      readonly color: Rgb;
      readonly intensityScale?: number;
    }
  | {
      readonly type: 'light-pattern';
      readonly roomId: RoomId;
      readonly lightIds?: readonly string[];
      /** '1' = on, '0' = off, one step per stepSec. Loops. */
      readonly pattern: string;
      readonly stepSec: number;
    }
  | { readonly type: 'door-state'; readonly doorId: string; readonly state: DoorState; readonly slam?: boolean }
  | { readonly type: 'room-revert'; readonly roomId: RoomId; readonly doorIds: readonly string[] }
  | { readonly type: 'ceiling-height'; readonly roomId: RoomId; readonly delta: number }
  | {
      readonly type: 'sound';
      readonly soundId: string;
      /** World position of the source. */
      readonly position: Vec3;
      /** Repeat interval while active (omit to play once on activation). */
      readonly intervalSec?: number;
      readonly volume?: number;
      /** Hearing radius used for perception (m). */
      readonly radius: number;
    }
  | { readonly type: 'footstep-echo'; readonly roomId: RoomId; readonly steps: number }
  | {
      readonly type: 'announcement';
      /** Spoken + subtitled text. Supports {tokens}. */
      readonly text: string;
      readonly position: Vec3;
      readonly intervalSec?: number;
    }
  | { readonly type: 'room-silence'; readonly roomId: RoomId }
  | {
      readonly type: 'security-feed';
      readonly cameraId: string;
      readonly mode: 'delayed' | 'show-prop' | 'mislabel';
      readonly delaySec?: number;
      readonly propId?: string;
      readonly label?: string;
    };

export type AnomalyEffectType = AnomalyEffect['type'];

/* ------------------------------------------------------------------------------------------ */
/* Clues: HOW the player can perceive and record the anomaly. Every anomaly must have one.     */
/* ------------------------------------------------------------------------------------------ */

export type ClueMode =
  /** Pressing E on targetPropId while active logs the observation. */
  | 'inspect'
  /** Looking at targetPropId for dwellSec within range logs it. */
  | 'sight'
  /** Being inside the room for dwellSec while active logs it. */
  | 'presence'
  /** Hearing the effect's sound within its radius logs it. */
  | 'hearing'
  /** Watching the given security camera feed logs it. */
  | 'feed';

export interface AnomalyClue {
  readonly mode: ClueMode;
  readonly targetPropId?: string;
  readonly cameraId?: string;
  readonly dwellSec?: number;
  /** Short subject for the notebook, e.g. "Wall clock". */
  readonly subject: string;
  /** Observation text logged in the notebook. Phrased as a fact, never as "this is an anomaly". */
  readonly observation: string;
}

export interface AnomalyActivationConditions {
  readonly minElapsedSec?: number;
  readonly minConfirmed?: number;
  /** The target room must have been visited (a baseline exists). */
  readonly requiresVisited?: boolean;
  readonly minVisits?: number;
  readonly minAttention?: AttentionLevel;
  readonly maxAttention?: AttentionLevel;
  readonly requiresFlags?: readonly string[];
  readonly requiresDoorState?: { readonly doorId: string; readonly state: DoorState };
}

export interface AnomalyDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: AnomalyCategory;
  /** Other categories a report may use and still be accepted (NORMAL difficulty). */
  readonly acceptedCategories?: readonly AnomalyCategory[];
  readonly difficulty: AnomalyDifficulty;
  readonly roomId: RoomId;
  /** Rooms a report may also name (e.g. a camera-feed anomaly seen from the security room). */
  readonly alternateRoomIds?: readonly RoomId[];
  /** Primary prop affected - two anomalies never target the same prop simultaneously. */
  readonly targetPropId?: string;
  readonly trigger: AnomalyTrigger;
  readonly conditions?: AnomalyActivationConditions;
  readonly effects: readonly AnomalyEffect[];
  readonly clue: AnomalyClue;
  /** Seconds before it may be selected again after being resolved. */
  readonly cooldownSec: number;
  readonly repeatable: boolean;
  /** Base selection weight (default 1). */
  readonly weight?: number;
  /** Adaptive bonus per tendency: weight *= 1 + strength * score * bonus. */
  readonly tendencyWeights?: Readonly<Partial<Record<BehaviorTendency, number>>>;
  /** Only eligible when the profile shows these tendencies. */
  readonly requiredTendencies?: readonly { readonly tendency: BehaviorTendency; readonly min: number }[];
  /** Anomaly ids that must have been activated before this one is eligible. */
  readonly dependsOn?: readonly string[];
  readonly conflictsWith?: readonly string[];
  /** Anomalies sharing a group are never in play together. */
  readonly exclusiveGroup?: string;
  /** Free tags used by behaviour responses: door, dark, revisit, slow-down, unobserved... */
  readonly tags?: readonly string[];
}

/**
 * A decoy is a normal-but-suspicious building event (pipes, HVAC, a monitor sleeping).
 * It logs an observation like an anomaly does, but reporting it is a false report.
 */
export interface DecoyDefinition {
  readonly id: string;
  readonly roomId: RoomId;
  readonly subject: string;
  readonly observation: string;
  readonly effects: readonly AnomalyEffect[];
  /** For visual decoys: seconds until the effect is reverted. */
  readonly durationSec?: number;
  readonly weight?: number;
  readonly tags?: readonly string[];
}

/* Runtime ---------------------------------------------------------------------------------- */

export type AnomalyStatus = 'idle' | 'pending' | 'active' | 'witnessed' | 'reported' | 'retired';

export interface AnomalyRuntimeState {
  id: string;
  status: AnomalyStatus;
  selectedAt?: number;
  activatedAt?: number;
  witnessedAt?: number;
  reportedAt?: number;
  retiredAt?: number;
  timesActivated: number;
}
