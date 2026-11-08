import { Rgb } from './common.model';

export const ATTENTION_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

export function attentionLevelIndex(level: AttentionLevel): number {
  return ATTENTION_LEVELS.indexOf(level);
}

/**
 * How the world behaves at a given BUILDING ATTENTION level.
 * Defined in content/attention/attention-levels.ts, consumed by the engine's AtmosphereController
 * and by the AnomalyDirector (interval multiplier).
 */
export interface AttentionLevelConfig {
  readonly level: AttentionLevel;
  /** Inclusive lower bound on the 0..100 attention value. */
  readonly min: number;
  readonly label: string;
  /** Chance per second that a random visible light stutters. */
  readonly flickerChancePerSec: number;
  /** Multiplier on all light intensities. */
  readonly lightIntensity: number;
  /** Tint blended into fluorescent light colour. */
  readonly lightTint: Rgb;
  readonly tintStrength: number;
  readonly fogDensity: number;
  /** Volume of the low "attention" drone layer (0..1). */
  readonly droneVolume: number;
  /** Ambient horror sound events per minute (distant knocks, footsteps...). */
  readonly ambientEventsPerMin: number;
  /** Multiplies the director's evaluation interval (lower = more frequent anomalies). */
  readonly anomalyIntervalMultiplier: number;
  /** Extra weight for spatial anomalies at this level. */
  readonly spatialWeight: number;
  /** Security feeds show interference. */
  readonly feedInterference: number;
  /** Post-process: extra chromatic aberration / grain / vignette. */
  readonly postFxIntensity: number;
}

export interface AttentionState {
  value: number;
  peak: number;
  escalations: number;
  /** Seconds remaining in the CRITICAL escalation sequence (0 = not escalating). */
  escalationRemaining: number;
}
