import { AttentionLevelConfig } from '../../models';

/** Ordered LOW -> CRITICAL. `min` is the inclusive lower bound on the 0..100 value. */
export const ATTENTION_LEVEL_CONFIGS: readonly AttentionLevelConfig[] = [
  {
    level: 'low',
    min: 0,
    label: 'NOMINAL',
    flickerChancePerSec: 0.01,
    lightIntensity: 1,
    lightTint: [1, 1, 1],
    tintStrength: 0,
    fogDensity: 0.028,
    droneVolume: 0,
    ambientEventsPerMin: 0.4,
    anomalyIntervalMultiplier: 1,
    spatialWeight: 1,
    feedInterference: 0.05,
    postFxIntensity: 0,
  },
  {
    level: 'medium',
    min: 25,
    label: 'ATTENTIVE',
    flickerChancePerSec: 0.035,
    lightIntensity: 0.92,
    lightTint: [1, 0.93, 0.78],
    tintStrength: 0.25,
    fogDensity: 0.034,
    droneVolume: 0.25,
    ambientEventsPerMin: 1,
    anomalyIntervalMultiplier: 0.85,
    spatialWeight: 1.2,
    feedInterference: 0.15,
    postFxIntensity: 0.25,
  },
  {
    level: 'high',
    min: 50,
    label: 'WATCHING',
    flickerChancePerSec: 0.08,
    lightIntensity: 0.8,
    lightTint: [1, 0.78, 0.66],
    tintStrength: 0.45,
    fogDensity: 0.042,
    droneVolume: 0.55,
    ambientEventsPerMin: 2,
    anomalyIntervalMultiplier: 0.7,
    spatialWeight: 1.6,
    feedInterference: 0.4,
    postFxIntensity: 0.55,
  },
  {
    level: 'critical',
    min: 80,
    label: 'INTERVENING',
    flickerChancePerSec: 0.3,
    lightIntensity: 0.6,
    lightTint: [1, 0.35, 0.3],
    tintStrength: 0.7,
    fogDensity: 0.055,
    droneVolume: 0.9,
    ambientEventsPerMin: 4,
    anomalyIntervalMultiplier: 0.6,
    spatialWeight: 2,
    feedInterference: 0.8,
    postFxIntensity: 1,
  },
];

/** Attention value the CRITICAL escalation sequence recovers to. */
export const ESCALATION_RECOVERY_VALUE = 62;
/** Duration of the CRITICAL escalation sequence (seconds). */
export const ESCALATION_DURATION_SEC = 40;
