import { Injectable, Signal, WritableSignal, computed, signal } from '@angular/core';
import { CONTENT } from '../content/content-registry';
import { mergeMetrics } from './behavior/behavior-profile';
import {
  BehaviorMetrics,
  BehaviorTendency,
  GameSettings,
  RunSnapshot,
  SaveData,
  sanitizeSettings,
} from '../models';
import { MigrationResult, createDefaultSave, migrateSave } from './save/save-migrations';
import { StorageAdapter, createStorageAdapter } from './save/storage-adapter';

export const SAVE_KEY = 'the-floor-is-lying.save';
export const SAVE_BACKUP_KEY = 'the-floor-is-lying.save.corrupt-backup';

/**
 * Versioned persistence of settings, progress, statistics and behaviour history.
 * Only serialisable data is stored - never engine objects.
 * Falls back to in-memory storage when localStorage is unavailable.
 */
@Injectable({ providedIn: 'root' })
export class SaveManagerService {
  private readonly storage: StorageAdapter;
  private readonly dataSignal: WritableSignal<SaveData>;
  readonly data: Signal<SaveData>;
  readonly hasContinue = computed(() => this.data().progress.activeRun !== null);
  readonly lastLoad: MigrationResult;

  constructor() {
    this.storage = SaveManagerService.storageFactory();
    this.lastLoad = this.read();
    this.dataSignal = signal<SaveData>(this.lastLoad.data);
    this.data = this.dataSignal.asReadonly();
    if (this.lastLoad.recovered) {
      console.warn('[save] Save data was repaired:', this.lastLoad.issues.join('; '));
      if (this.lastLoad.migratedFrom === null) this.backupRaw();
      this.persist();
    } else if (this.lastLoad.migratedFrom !== null) {
      this.persist();
    }
  }

  /** Overridable in tests. */
  static storageFactory: () => StorageAdapter = createStorageAdapter;

  get usingFallbackStorage(): boolean {
    return this.storage.kind === 'memory';
  }

  private read(): MigrationResult {
    let raw: string | null = null;
    try {
      raw = this.storage.get(SAVE_KEY);
    } catch {
      raw = null;
    }
    return migrateSave(raw, {
      defaultDifficulty: CONTENT.defaultDifficultyId,
      knownStages: new Set(CONTENT.stages.all().map((s) => s.id)),
      knownDifficulties: new Set(CONTENT.difficulties.all().map((d) => d.id)),
    });
  }

  private backupRaw(): void {
    try {
      const raw = this.storage.get(SAVE_KEY);
      if (raw) this.storage.set(SAVE_BACKUP_KEY, raw);
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    const data = { ...this.dataSignal(), savedAt: new Date().toISOString() };
    this.dataSignal.set(data);
    try {
      this.storage.set(SAVE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[save] Could not write save data', err);
    }
  }

  private update(mutator: (draft: SaveData) => SaveData): void {
    this.dataSignal.set(mutator(structuredClone(this.dataSignal())));
    this.persist();
  }

  setSettings(settings: GameSettings): void {
    this.update((d) => ({ ...d, settings: sanitizeSettings(settings) }));
  }

  setDifficulty(id: string): void {
    if (!CONTENT.difficulties.has(id)) return;
    this.update((d) => ({ ...d, selectedDifficulty: id }));
  }

  markTutorialSeen(): void {
    if (this.dataSignal().progress.tutorialSeen) return;
    this.update((d) => ({ ...d, progress: { ...d.progress, tutorialSeen: true } }));
  }

  saveRun(run: RunSnapshot): void {
    this.update((d) => ({ ...d, progress: { ...d.progress, activeRun: run } }));
  }

  /** New Game: discards the in-progress run. Settings, endings and statistics are kept. */
  startNewRun(): void {
    this.update((d) => ({
      ...d,
      progress: { ...d.progress, activeRun: null },
      statistics: { ...d.statistics, runsStarted: d.statistics.runsStarted + 1 },
    }));
  }

  clearRun(): void {
    this.update((d) => ({ ...d, progress: { ...d.progress, activeRun: null } }));
  }

  /** Records a finished run and unlocks its ending. */
  completeRun(params: {
    stageId: string;
    endingId: string;
    playTimeSec: number;
    correct: number;
    falseReports: number;
    metrics: BehaviorMetrics;
    dominant: readonly BehaviorTendency[];
  }): void {
    this.update((d) => {
      const stats = d.statistics;
      return {
        ...d,
        progress: {
          ...d.progress,
          activeRun: null,
          completedStages: d.progress.completedStages.includes(params.stageId)
            ? d.progress.completedStages
            : [...d.progress.completedStages, params.stageId],
          unlockedEndings: d.progress.unlockedEndings.includes(params.endingId)
            ? d.progress.unlockedEndings
            : [...d.progress.unlockedEndings, params.endingId],
        },
        statistics: {
          ...stats,
          runsCompleted: stats.runsCompleted + 1,
          totalPlayTimeSec: stats.totalPlayTimeSec + params.playTimeSec,
          totalCorrectReports: stats.totalCorrectReports + params.correct,
          totalFalseReports: stats.totalFalseReports + params.falseReports,
          endingCounts: { ...stats.endingCounts, [params.endingId]: (stats.endingCounts[params.endingId] ?? 0) + 1 },
          fastestCompletionSec:
            stats.fastestCompletionSec === null ? params.playTimeSec : Math.min(stats.fastestCompletionSec, params.playTimeSec),
        },
        behavior: {
          lifetime: d.behavior.lifetime ? mergeMetrics(d.behavior.lifetime, params.metrics) : params.metrics,
          recentDominant: [[...params.dominant], ...d.behavior.recentDominant].slice(0, 10),
        },
      };
    });
  }

  /** Wipes everything except settings. */
  resetAllProgress(): void {
    const settings = this.dataSignal().settings;
    const fresh = createDefaultSave(CONTENT.defaultDifficultyId);
    this.dataSignal.set({ ...fresh, settings });
    this.persist();
  }
}
