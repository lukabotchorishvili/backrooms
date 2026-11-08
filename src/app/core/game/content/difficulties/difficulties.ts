import { DifficultyConfig } from '../../models';

export const DIFFICULTY_OBSERVER: DifficultyConfig = {
  id: 'observer',
  name: 'OBSERVER',
  tier: 'EASY',
  description:
    'Irregularities are obvious and the building is patient. Recommended for a first shift.',
  order: 0,
  anomalies: {
    maxSimultaneous: 2,
    initialSelections: 2,
    evaluationIntervalSec: 40,
    allowedRatings: [1, 2, 3],
    ratingWeights: { 1: 3, 2: 2, 3: 0.6, 4: 0, 5: 0 },
    subtlety: 0.1,
    adaptationStrength: 0.6,
    unwitnessedLifetimeSec: 420,
    maxPerRoom: 1,
  },
  decoys: { perMinute: 0.5 },
  clues: { audioClueVolume: 1.25, hearingRadius: 1.3, witnessHint: true, dwellMultiplier: 0.7 },
  attention: {
    gainMultiplier: 0.6,
    falseReportPenalty: 12,
    categoryMismatchPenalty: 0,
    correctReportRelief: 10,
    decayPerSec: 0.12,
    sprintGainPerSec: 0.05,
    overtimeGainPerSec: 0.08,
  },
  reporting: { categoryTolerance: 'any' },
  shiftDurationMin: 35,
};

export const DIFFICULTY_EMPLOYEE: DifficultyConfig = {
  id: 'employee',
  name: 'EMPLOYEE',
  tier: 'NORMAL',
  description: 'Balanced irregularities. The building adapts to how you work.',
  order: 1,
  anomalies: {
    maxSimultaneous: 3,
    initialSelections: 2,
    evaluationIntervalSec: 32,
    allowedRatings: [1, 2, 3, 4],
    ratingWeights: { 1: 1.4, 2: 2, 3: 1.6, 4: 0.6, 5: 0 },
    subtlety: 0.45,
    adaptationStrength: 1,
    unwitnessedLifetimeSec: 300,
    maxPerRoom: 2,
  },
  decoys: { perMinute: 0.9 },
  clues: { audioClueVolume: 1, hearingRadius: 1, witnessHint: false, dwellMultiplier: 1 },
  attention: {
    gainMultiplier: 1,
    falseReportPenalty: 16,
    categoryMismatchPenalty: 6,
    correctReportRelief: 8,
    decayPerSec: 0.06,
    sprintGainPerSec: 0.12,
    overtimeGainPerSec: 0.15,
  },
  reporting: { categoryTolerance: 'accepted' },
  shiftDurationMin: 25,
};

export const DIFFICULTY_BUILDING_KNOWS: DifficultyConfig = {
  id: 'the-building-knows',
  name: 'THE BUILDING KNOWS',
  tier: 'HARD',
  description:
    'Subtle, deceptive, highly adaptive. Every visit may differ. False reports are remembered.',
  order: 2,
  anomalies: {
    maxSimultaneous: 4,
    initialSelections: 2,
    evaluationIntervalSec: 26,
    allowedRatings: [2, 3, 4, 5],
    ratingWeights: { 1: 0, 2: 1, 3: 2, 4: 2, 5: 1.4 },
    subtlety: 0.85,
    adaptationStrength: 1.6,
    unwitnessedLifetimeSec: 220,
    maxPerRoom: 2,
  },
  decoys: { perMinute: 1.6 },
  clues: { audioClueVolume: 0.8, hearingRadius: 0.8, witnessHint: false, dwellMultiplier: 1.4 },
  attention: {
    gainMultiplier: 1.4,
    falseReportPenalty: 20,
    categoryMismatchPenalty: 10,
    correctReportRelief: 6,
    decayPerSec: 0.02,
    sprintGainPerSec: 0.2,
    overtimeGainPerSec: 0.25,
  },
  reporting: { categoryTolerance: 'primary' },
  shiftDurationMin: 18,
};

export const DIFFICULTIES: readonly DifficultyConfig[] = [
  DIFFICULTY_OBSERVER,
  DIFFICULTY_EMPLOYEE,
  DIFFICULTY_BUILDING_KNOWS,
];

export const DEFAULT_DIFFICULTY_ID = DIFFICULTY_EMPLOYEE.id;
