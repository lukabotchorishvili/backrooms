/**
 * Endings are data. The ProgressionService resolves which ending applies; the engine's
 * EndingDirector plays the configured sequence (interior dressing, ride, destination scene).
 */

export type EndingTrigger = 'elevator-standard' | 'elevator-service';

export type EndingCondition =
  | { readonly type: 'investigation-complete' }
  | { readonly type: 'attention-at-least'; readonly value: number }
  | { readonly type: 'attention-below'; readonly value: number }
  | { readonly type: 'peak-attention-at-least'; readonly value: number }
  | { readonly type: 'escalations-at-least'; readonly value: number }
  | { readonly type: 'flag'; readonly flag: string }
  | { readonly type: 'any'; readonly conditions: readonly EndingCondition[] };

/** Interior dressings for the elevator car - implemented in engine/endings/car-interiors.ts. */
export type ElevatorInteriorId = 'standard' | 'reception-replica';
/** Destination scenes revealed when the doors re-open - engine/endings/destinations.ts. */
export type EndingDestinationId = 'none' | 'infinite-floor';

export interface EndingSequenceConfig {
  readonly interior: ElevatorInteriorId;
  readonly destination: EndingDestinationId;
  /** Seconds the doors stay open after the player steps in before closing. */
  readonly closeDelaySec: number;
  /** Seconds of ride (motor hum, shake) before the fade / reveal. */
  readonly rideSec: number;
  /** Floor indicator sequence shown during the ride. */
  readonly indicatorSequence: readonly string[];
  readonly shake: number;
  readonly lightsFlicker: boolean;
  /** Seconds the player may look around the destination before the fade (0 = no reveal). */
  readonly revealSec: number;
  readonly fadeSec: number;
  readonly rideSound: string;
  readonly arrivalSound?: string;
}

export interface EndingDefinition {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly trigger: EndingTrigger;
  /** Higher priority endings are checked first. */
  readonly priority: number;
  readonly conditions: readonly EndingCondition[];
  readonly sequence: EndingSequenceConfig;
  readonly epilogue: {
    /** Lines typed out on the final black screen. */
    readonly lines: readonly string[];
    readonly caption: string;
  };
}

export interface EndingResolutionContext {
  readonly investigationComplete: boolean;
  readonly attention: number;
  readonly peakAttention: number;
  readonly escalations: number;
  readonly flags: ReadonlySet<string>;
}
