import { RunSnapshot } from './game-state.model';
import { BehaviorMetrics, BehaviorTendency } from './player-profile.model';
import { GameSettings } from './settings.model';

/** Bump when the persisted shape changes and add a migration in save-migrations.ts. */
export const CURRENT_SAVE_VERSION = 2;

export interface GameProgress {
  /** The in-progress run used by "Continue" (null = nothing to continue). */
  activeRun: RunSnapshot | null;
  completedStages: string[];
  unlockedEndings: string[];
  tutorialSeen: boolean;
}

export interface PlayerStatistics {
  runsStarted: number;
  runsCompleted: number;
  totalPlayTimeSec: number;
  totalCorrectReports: number;
  totalFalseReports: number;
  endingCounts: Record<string, number>;
  fastestCompletionSec: number | null;
}

/** Long-term behaviour history (across runs). */
export interface BehaviorHistory {
  lifetime: BehaviorMetrics | null;
  /** Dominant tendencies of the last finished/abandoned runs (newest first, max 10). */
  recentDominant: BehaviorTendency[][];
}

export interface SaveData {
  version: number;
  savedAt: string;
  settings: GameSettings;
  selectedDifficulty: string;
  progress: GameProgress;
  statistics: PlayerStatistics;
  behavior: BehaviorHistory;
}
