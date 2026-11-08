import { AnomalyDifficulty } from './anomaly.model';

export type DifficultyId = string;

/**
 * Every difficulty-dependent number in the game lives here.
 * Systems read a DifficultyConfig; nothing branches on a difficulty id.
 * Add a difficulty: create a new config object in content/difficulties and register it.
 */
export interface DifficultyConfig {
  readonly id: DifficultyId;
  /** Menu name, e.g. "OBSERVER". */
  readonly name: string;
  /** Short tag line, e.g. "EASY". */
  readonly tier: string;
  readonly description: string;
  /** Sort order in menus. */
  readonly order: number;

  readonly anomalies: {
    /** Max anomalies pending/active-but-unwitnessed at once. */
    readonly maxSimultaneous: number;
    /** Anomalies selected immediately when a run starts. */
    readonly initialSelections: number;
    /** Seconds between director evaluations at LOW attention. */
    readonly evaluationIntervalSec: number;
    /** Anomaly difficulty ratings that may appear. */
    readonly allowedRatings: readonly AnomalyDifficulty[];
    /** Selection weight per rating. */
    readonly ratingWeights: Readonly<Record<AnomalyDifficulty, number>>;
    /** 0 = blatant, 1 = very subtle. Scales transform offsets, colours, volumes. */
    readonly subtlety: number;
    /** How strongly behaviour tendencies bend selection (0 = not adaptive). */
    readonly adaptationStrength: number;
    /** Unwitnessed active anomalies may be withdrawn after this long (seconds). */
    readonly unwitnessedLifetimeSec: number;
    /** Max simultaneous active anomalies in one room. */
    readonly maxPerRoom: number;
  };

  readonly decoys: {
    /** Decoy events per minute at LOW attention. */
    readonly perMinute: number;
  };

  readonly clues: {
    /** Multiplier for audio clue volume. */
    readonly audioClueVolume: number;
    /** Hearing radius multiplier for audio clues. */
    readonly hearingRadius: number;
    /** HUD hints when a genuine anomaly enters the notebook. */
    readonly witnessHint: boolean;
    /** Seconds of dwell needed for sight/presence clues. */
    readonly dwellMultiplier: number;
  };

  readonly attention: {
    readonly gainMultiplier: number;
    readonly falseReportPenalty: number;
    readonly categoryMismatchPenalty: number;
    readonly correctReportRelief: number;
    /** Passive decay per second while below HIGH. */
    readonly decayPerSec: number;
    /** Attention gained per second while sprinting. */
    readonly sprintGainPerSec: number;
    /** Attention gained per second during overtime (after the shift ends). */
    readonly overtimeGainPerSec: number;
  };

  readonly reporting: {
    /**
     * any      - category is ignored.
     * accepted - primary or acceptedCategories.
     * primary  - only the primary category.
     */
    readonly categoryTolerance: 'any' | 'accepted' | 'primary';
  };

  /** Real minutes for the 09:00-17:00 shift clock. After that: overtime pressure. */
  readonly shiftDurationMin: number;
}
