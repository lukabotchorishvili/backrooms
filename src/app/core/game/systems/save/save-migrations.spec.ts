import { TestBed } from '@angular/core/testing';
import { CURRENT_SAVE_VERSION, DEFAULT_SETTINGS } from '../../models';
import { createEmptyMetrics } from '../behavior/behavior-profile';
import { SAVE_KEY, SaveManagerService } from '../save-manager.service';
import { createDefaultSave, migrateSave } from './save-migrations';
import { LocalStorageAdapter, MemoryStorageAdapter, createStorageAdapter } from './storage-adapter';

const options = {
  defaultDifficulty: 'employee',
  knownStages: new Set(['floor-14']),
  knownDifficulties: new Set(['observer', 'employee', 'the-building-knows']),
};

describe('save migrations', () => {
  it('returns defaults for an empty store', () => {
    const r = migrateSave(null, options);
    expect(r.recovered).toBe(false);
    expect(r.data.version).toBe(CURRENT_SAVE_VERSION);
    expect(r.data.settings).toEqual({ ...DEFAULT_SETTINGS });
    expect(r.data.progress.activeRun).toBeNull();
  });

  it('migrates a v1 save to the current version', () => {
    const v1 = {
      version: 1,
      settings: { sensitivity: 1.7, volume: 0.4, quality: 'high', invertY: true },
      difficulty: 'the-building-knows',
      endings: ['normal-exit'],
      stats: { runs: 4, completed: 2, playTime: 3600 },
    };
    const r = migrateSave(JSON.stringify(v1), options);
    expect(r.migratedFrom).toBe(1);
    expect(r.data.version).toBe(2);
    expect(r.data.settings.mouseSensitivity).toBe(1.7);
    expect(r.data.settings.masterVolume).toBe(0.4);
    expect(r.data.settings.invertMouse).toBe(true);
    expect(r.data.settings.graphicsQuality).toBe('high');
    expect(r.data.selectedDifficulty).toBe('the-building-knows');
    expect(r.data.progress.unlockedEndings).toEqual(['normal-exit']);
    expect(r.data.statistics.runsStarted).toBe(4);
    expect(r.data.behavior.recentDominant).toEqual([]);
  });

  it('recovers from corrupt JSON and wrong shapes', () => {
    expect(migrateSave('{not json', options).recovered).toBe(true);
    expect(migrateSave('[1,2,3]', options).recovered).toBe(true);
    const r = migrateSave(JSON.stringify({ version: 2, settings: { masterVolume: 99, graphicsQuality: 'ultra' }, selectedDifficulty: 'impossible', progress: { activeRun: { stageId: 'nope' } } }), options);
    expect(r.recovered).toBe(true);
    expect(r.data.settings.masterVolume).toBe(1);
    expect(r.data.settings.graphicsQuality).toBe('medium');
    expect(r.data.selectedDifficulty).toBe('employee');
    expect(r.data.progress.activeRun).toBeNull();
  });

  it('salvages settings from a save written by a newer version', () => {
    const r = migrateSave(JSON.stringify({ version: 99, settings: { mouseSensitivity: 2 } }), options);
    expect(r.recovered).toBe(true);
    expect(r.data.settings.mouseSensitivity).toBe(2);
    expect(r.data.version).toBe(CURRENT_SAVE_VERSION);
  });

  it('round-trips a current save unchanged', () => {
    const save = createDefaultSave('observer');
    save.progress.unlockedEndings = ['wrong-exit'];
    save.statistics.endingCounts = { 'wrong-exit': 1 };
    const r = migrateSave(JSON.stringify(save), options);
    expect(r.recovered).toBe(false);
    expect(r.migratedFrom).toBeNull();
    expect(r.data.progress.unlockedEndings).toEqual(['wrong-exit']);
    expect(r.data.statistics.endingCounts).toEqual({ 'wrong-exit': 1 });
  });
});

describe('storage adapters', () => {
  it('falls back to memory when localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => ({ setItem: () => { throw new Error('quota'); }, removeItem: () => undefined, getItem: () => null }),
    });
    try {
      expect(createStorageAdapter().kind).toBe('memory');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('memory adapter stores values', () => {
    const m = new MemoryStorageAdapter();
    m.set('k', 'v');
    expect(m.get('k')).toBe('v');
    m.remove('k');
    expect(m.get('k')).toBeNull();
  });
});

describe('SaveManagerService', () => {
  let storage: MemoryStorageAdapter;
  const factory = SaveManagerService.storageFactory;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    SaveManagerService.storageFactory = () => storage;
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    SaveManagerService.storageFactory = factory;
  });

  it('persists settings and difficulty', () => {
    const s = TestBed.inject(SaveManagerService);
    s.setSettings({ ...DEFAULT_SETTINGS, mouseSensitivity: 2.2 });
    s.setDifficulty('observer');
    s.setDifficulty('not-a-difficulty');
    const stored = JSON.parse(storage.get(SAVE_KEY)!);
    expect(stored.settings.mouseSensitivity).toBe(2.2);
    expect(stored.selectedDifficulty).toBe('observer');
  });

  it('records completed runs, unlocks endings and clears Continue', () => {
    const s = TestBed.inject(SaveManagerService);
    s.startNewRun();
    s.completeRun({ stageId: 'floor-14', endingId: 'normal-exit', playTimeSec: 900, correct: 5, falseReports: 1, metrics: createEmptyMetrics(), dominant: ['curious'] });
    const d = s.data();
    expect(d.progress.unlockedEndings).toEqual(['normal-exit']);
    expect(d.progress.completedStages).toEqual(['floor-14']);
    expect(d.statistics.runsCompleted).toBe(1);
    expect(d.statistics.fastestCompletionSec).toBe(900);
    expect(d.behavior.recentDominant[0]).toEqual(['curious']);
    expect(s.hasContinue()).toBe(false);
  });

  it('resetAllProgress keeps settings', () => {
    const s = TestBed.inject(SaveManagerService);
    s.setSettings({ ...DEFAULT_SETTINGS, invertMouse: true });
    s.completeRun({ stageId: 'floor-14', endingId: 'wrong-exit', playTimeSec: 1, correct: 5, falseReports: 0, metrics: createEmptyMetrics(), dominant: [] });
    s.resetAllProgress();
    expect(s.data().settings.invertMouse).toBe(true);
    expect(s.data().progress.unlockedEndings).toEqual([]);
  });

  it('works on top of real localStorage when available', () => {
    if (typeof localStorage === 'undefined') return;
    const adapter = new LocalStorageAdapter(localStorage);
    adapter.set('tfil-test', '1');
    expect(adapter.get('tfil-test')).toBe('1');
    adapter.remove('tfil-test');
  });
});

