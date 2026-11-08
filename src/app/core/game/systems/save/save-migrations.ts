import { sanitizeMetrics } from '../behavior/behavior-profile';
import {
  BEHAVIOR_TENDENCIES,
  BehaviorTendency,
  CURRENT_SAVE_VERSION,
  GameProgress,
  PlayerStatistics,
  RunSnapshot,
  SaveData,
  sanitizeSettings,
} from '../../models';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);

export function defaultStatistics(): PlayerStatistics {
  return {
    runsStarted: 0,
    runsCompleted: 0,
    totalPlayTimeSec: 0,
    totalCorrectReports: 0,
    totalFalseReports: 0,
    endingCounts: {},
    fastestCompletionSec: null,
  };
}

export function defaultProgress(): GameProgress {
  return { activeRun: null, completedStages: [], unlockedEndings: [], tutorialSeen: false };
}

export function createDefaultSave(defaultDifficulty: string): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    savedAt: new Date(0).toISOString(),
    settings: sanitizeSettings(null),
    selectedDifficulty: defaultDifficulty,
    progress: defaultProgress(),
    statistics: defaultStatistics(),
    behavior: { lifetime: null, recentDominant: [] },
  };
}

/**
 * Migration table: key = version migrated FROM. Each step returns the next version's shape.
 *
 * v1 (pre-release prototype) stored:
 *   { version: 1, settings: { sensitivity, volume, quality, invertY },
 *     difficulty, endings: string[], stats: { runs, completed, playTime } }
 * v2 (current) splits volumes per category, adds behaviour history and resumable runs.
 */
export const SAVE_MIGRATIONS: Readonly<Record<number, (data: Json) => Json>> = {
  1: (v1) => {
    const s = isObject(v1['settings']) ? v1['settings'] : {};
    const stats = isObject(v1['stats']) ? v1['stats'] : {};
    const volume = num(s['volume'], 0.8);
    return {
      version: 2,
      savedAt: typeof v1['savedAt'] === 'string' ? v1['savedAt'] : new Date(0).toISOString(),
      settings: {
        mouseSensitivity: num(s['sensitivity'], 1),
        invertMouse: s['invertY'] === true,
        masterVolume: volume,
        ambientVolume: 0.8,
        effectsVolume: 0.9,
        musicVolume: 0.6,
        graphicsQuality: s['quality'],
      },
      selectedDifficulty: v1['difficulty'],
      progress: { activeRun: null, completedStages: [], unlockedEndings: strArray(v1['endings']), tutorialSeen: true },
      statistics: {
        ...defaultStatistics(),
        runsStarted: num(stats['runs']),
        runsCompleted: num(stats['completed']),
        totalPlayTimeSec: num(stats['playTime']),
      },
      behavior: { lifetime: null, recentDominant: [] },
    };
  },
};

export interface MigrationResult {
  readonly data: SaveData;
  readonly migratedFrom: number | null;
  readonly recovered: boolean;
  readonly issues: string[];
}

function sanitizeRun(run: unknown, knownStages: ReadonlySet<string>, knownDifficulties: ReadonlySet<string>): RunSnapshot | null {
  if (!isObject(run)) return null;
  if (typeof run['stageId'] !== 'string' || !knownStages.has(run['stageId'])) return null;
  if (typeof run['difficultyId'] !== 'string' || !knownDifficulties.has(run['difficultyId'])) return null;
  const player = run['player'];
  if (!isObject(player) || !Array.isArray(player['position']) || player['position'].length !== 3) return null;
  const inv = run['investigation'];
  if (!isObject(inv) || !Array.isArray(inv['observations']) || !Array.isArray(inv['confirmedAnomalyIds'])) return null;
  if (!isObject(run['director']) || !isObject(run['progression']) || !isObject(run['attention'])) return null;
  const snapshot = run as unknown as RunSnapshot;
  return { ...snapshot, behavior: sanitizeMetrics(snapshot.behavior) };
}

/**
 * Parses, migrates and repairs a raw save string. Never throws: corrupt data yields a fresh
 * save (settings are salvaged when possible) and `recovered = true`.
 */
export function migrateSave(
  raw: string | null,
  options: { defaultDifficulty: string; knownStages: ReadonlySet<string>; knownDifficulties: ReadonlySet<string> },
): MigrationResult {
  const issues: string[] = [];
  const fresh = createDefaultSave(options.defaultDifficulty);
  if (raw === null || raw === '') return { data: fresh, migratedFrom: null, recovered: false, issues };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: fresh, migratedFrom: null, recovered: true, issues: ['save is not valid JSON'] };
  }
  if (!isObject(parsed)) return { data: fresh, migratedFrom: null, recovered: true, issues: ['save is not an object'] };

  let data: Json = parsed;
  let version = num(data['version'], 1);
  const originalVersion = version;
  if (version > CURRENT_SAVE_VERSION) {
    issues.push(`save version ${version} is newer than supported ${CURRENT_SAVE_VERSION}`);
    const salvaged = createDefaultSave(options.defaultDifficulty);
    salvaged.settings = sanitizeSettings(isObject(data['settings']) ? (data['settings'] as never) : null);
    return { data: salvaged, migratedFrom: null, recovered: true, issues };
  }
  while (version < CURRENT_SAVE_VERSION) {
    const step = SAVE_MIGRATIONS[version];
    if (!step) {
      issues.push(`no migration from version ${version}`);
      return { data: fresh, migratedFrom: originalVersion, recovered: true, issues };
    }
    data = step(data);
    version = num(data['version'], version + 1);
  }

  // Repair the (now current-version) structure field by field.
  const progressRaw = isObject(data['progress']) ? data['progress'] : {};
  const statsRaw = isObject(data['statistics']) ? data['statistics'] : {};
  const behaviorRaw = isObject(data['behavior']) ? data['behavior'] : {};
  const difficulty =
    typeof data['selectedDifficulty'] === 'string' && options.knownDifficulties.has(data['selectedDifficulty'])
      ? data['selectedDifficulty']
      : options.defaultDifficulty;
  if (difficulty !== data['selectedDifficulty']) issues.push('unknown difficulty replaced with default');

  const activeRun = sanitizeRun(progressRaw['activeRun'], options.knownStages, options.knownDifficulties);
  if (progressRaw['activeRun'] && !activeRun) issues.push('in-progress run was invalid and has been discarded');

  const endingCounts: Record<string, number> = {};
  if (isObject(statsRaw['endingCounts'])) {
    for (const [k, v] of Object.entries(statsRaw['endingCounts'])) endingCounts[k] = num(v);
  }
  const recentDominant: BehaviorTendency[][] = Array.isArray(behaviorRaw['recentDominant'])
    ? (behaviorRaw['recentDominant'] as unknown[])
        .map((entry) => strArray(entry).filter((t): t is BehaviorTendency => (BEHAVIOR_TENDENCIES as readonly string[]).includes(t)))
        .slice(0, 10)
    : [];

  const result: SaveData = {
    version: CURRENT_SAVE_VERSION,
    savedAt: typeof data['savedAt'] === 'string' ? data['savedAt'] : fresh.savedAt,
    settings: sanitizeSettings(isObject(data['settings']) ? (data['settings'] as never) : null),
    selectedDifficulty: difficulty,
    progress: {
      activeRun,
      completedStages: strArray(progressRaw['completedStages']),
      unlockedEndings: strArray(progressRaw['unlockedEndings']),
      tutorialSeen: progressRaw['tutorialSeen'] === true,
    },
    statistics: {
      runsStarted: num(statsRaw['runsStarted']),
      runsCompleted: num(statsRaw['runsCompleted']),
      totalPlayTimeSec: num(statsRaw['totalPlayTimeSec']),
      totalCorrectReports: num(statsRaw['totalCorrectReports']),
      totalFalseReports: num(statsRaw['totalFalseReports']),
      endingCounts,
      fastestCompletionSec: typeof statsRaw['fastestCompletionSec'] === 'number' ? statsRaw['fastestCompletionSec'] : null,
    },
    behavior: {
      lifetime: behaviorRaw['lifetime'] ? sanitizeMetrics(behaviorRaw['lifetime'] as never) : null,
      recentDominant,
    },
  };
  return {
    data: result,
    migratedFrom: originalVersion < CURRENT_SAVE_VERSION ? originalVersion : null,
    recovered: issues.length > 0,
    issues,
  };
}
