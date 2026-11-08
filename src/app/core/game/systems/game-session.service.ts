import { Injectable, computed, effect, inject, isDevMode, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ATTENTION_LEVEL_CONFIGS } from '../content/attention/attention-levels';
import { CONTENT } from '../content/content-registry';
import { formatIssues, validateStage } from '../content/content-validator';
import type {
  EngineHost,
  EngineStats,
  FrameSample,
  GameEngineApi,
  InteractionRequest,
  LoadProgress,
  PerceptionEvent,
  SecurityViewState,
} from '../engine/engine-api';
import {
  AnomalyDefinition,
  AnomalyEffect,
  AnomalyReport,
  BehaviorTendency,
  DecoyDefinition,
  DifficultyConfig,
  EndingDefinition,
  GameEvent,
  GamePhase,
  GameSettings,
  InteractionKind,
  InteractionPrompt,
  ObservationSource,
  ReportResult,
  RoomId,
  RunSnapshot,
  StageDefinition,
} from '../models';
import { AnomalyDirectorService, DirectorAction, DirectorWorld } from './anomaly-director.service';
import { AttentionSystemService } from './attention-system.service';
import { AudioManagerService } from './audio-manager.service';
import { BehaviorTrackingService } from './behavior-tracking.service';
import { InvestigationService } from './investigation.service';
import { MemoryRoomService } from './memory-room.service';
import { ProgressionService, resolveEnding } from './progression.service';
import { SaveManagerService } from './save-manager.service';
import { SeededRandom } from './seeded-random';
import { SettingsService } from './settings.service';
import { TokenContext, resolveTokens, shiftClock } from './text-tokens';
import { ProceduralPool } from '../workers/procedural-pool';

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'neutral' | 'warning' | 'objective' | 'success';
}

export interface InspectionCard {
  readonly title: string;
  readonly text: string;
  readonly kind: 'note' | 'system' | 'pickup';
}

export interface EndingResult {
  readonly ending: EndingDefinition;
  readonly playTimeSec: number;
  readonly confirmed: number;
  readonly falseReports: number;
  readonly peakAttention: number;
  readonly dominant: readonly BehaviorTendency[];
  readonly newlyUnlocked: boolean;
  readonly unlockedCount: number;
  readonly totalEndings: number;
}

type StartRequest = { mode: 'new'; difficultyId: string; seed: number } | { mode: 'continue' };

interface RunContext {
  stage: StageDefinition;
  difficulty: DifficultyConfig;
  anomalies: Map<string, AnomalyDefinition>;
  endings: EndingDefinition[];
  seed: number;
  restored: RunSnapshot | null;
  roomId: RoomId | null;
  previousRoomId: RoomId | null;
  roomEnteredAt: number;
  presence: Map<string, number>;
  cooldowns: Map<string, number>;
  doorToggles: Map<string, number[]>;
  flashToggles: number[];
  elevatorPresses: number;
  inspectCounts: Map<string, number>;
  resolved: Map<string, { def: AnomalyDefinition; observation: string }>;
  directorAccumulator: number;
  hudAccumulator: number;
  autosaveAccumulator: number;
  sprinting: boolean;
  elevatorCalled: boolean;
  finished: boolean;
  adjacency: Map<RoomId, RoomId[]>;
}

const DIRECTOR_TICK_SEC = 0.25;
const AUTOSAVE_SEC = 30;

/**
 * The game shell's orchestrator. Owns the run lifecycle, routes engine events to the game
 * systems, exposes UI state as signals and implements the EngineHost contract.
 *
 * Stage lifecycle: load config -> validate -> build environment (engine) -> register anomalies
 * (director) -> init stage behaviour (tracking/memory/attention) -> gameplay -> completion ->
 * ending -> dispose.
 */
@Injectable({ providedIn: 'root' })
export class GameSessionService implements EngineHost {
  private readonly router = inject(Router);
  readonly saves = inject(SaveManagerService);
  private readonly settingsService = inject(SettingsService);
  readonly audio = inject(AudioManagerService);
  readonly behavior = inject(BehaviorTrackingService);
  readonly attention = inject(AttentionSystemService);
  readonly director = inject(AnomalyDirectorService);
  readonly investigation = inject(InvestigationService);
  readonly memory = inject(MemoryRoomService);
  readonly progression = inject(ProgressionService);
  readonly content = CONTENT;

  /* ------------------------------------------------------------------ UI state (signals) */
  readonly phase = signal<GamePhase>('idle');
  readonly loading = signal<LoadProgress>({ progress: 0, message: '' });
  readonly error = signal<string | null>(null);
  readonly prompt = signal<InteractionPrompt | null>(null);
  readonly inspection = signal<InspectionCard | null>(null);
  readonly toasts = signal<Toast[]>([]);
  readonly subtitle = signal<string | null>(null);
  readonly clock = signal('09:00');
  readonly overtime = signal(false);
  readonly flashlightOn = signal(false);
  readonly noteFlash = signal(0);
  readonly witnessHint = signal(0);
  readonly introLines = signal<string[]>([]);
  readonly tutorial = signal<readonly string[] | null>(null);
  readonly securityView = signal<SecurityViewState | null>(null);
  readonly endingResult = signal<EndingResult | null>(null);
  readonly stats = signal<EngineStats | null>(null);
  readonly roomName = signal('');
  readonly stageSignal = signal<StageDefinition | null>(null);
  readonly difficultySignal = signal<DifficultyConfig | null>(null);
  readonly isResumed = signal(false);
  readonly pointerLocked = signal(false);

  readonly confirmed = this.investigation.confirmedCount;
  readonly falseReports = this.investigation.falseReportCount;
  readonly notesCount = computed(() => this.investigation.observations().length);
  readonly required = computed(() => this.stageSignal()?.requiredReports ?? 5);
  readonly objectiveText = computed(() => {
    const stage = this.stageSignal();
    if (!stage) return '';
    return stage.objectives[this.progression.objective()]
      .replace('{confirmed}', String(this.confirmed()))
      .replace('{required}', String(stage.requiredReports));
  });

  private engine: GameEngineApi | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private run: RunContext | null = null;
  private startRequest: StartRequest | null = null;
  private introSkip = false;
  private toastId = 0;
  private inspectionTimer: ReturnType<typeof setTimeout> | null = null;
  private subtitleTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private bootToken = 0;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.autosave();
  };

  constructor() {
    effect(() => {
      const s = this.settingsService.settings();
      untracked(() => {
        this.audio.applySettings(s);
        this.engine?.applySettings(s);
        this.configureStats(s.showPerformanceStats);
      });
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.autosave());
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get stage(): StageDefinition {
    if (!this.run) throw new Error('No active run');
    return this.run.stage;
  }

  get difficulty(): DifficultyConfig {
    if (!this.run) throw new Error('No active run');
    return this.run.difficulty;
  }

  settings(): GameSettings {
    return this.settingsService.settings();
  }

  /* ================================================================== menu entry points */

  newGame(difficultyId: string): void {
    const difficulty = this.content.difficulties.get(difficultyId) ?? this.content.difficulties.require(this.content.defaultDifficultyId);
    this.saves.setDifficulty(difficulty.id);
    this.saves.startNewRun();
    this.startRequest = { mode: 'new', difficultyId: difficulty.id, seed: this.seedFromUrl() ?? SeededRandom.randomSeed() };
    void this.router.navigate(['/play']);
  }

  continueGame(): void {
    if (!this.saves.hasContinue()) return;
    this.startRequest = { mode: 'continue' };
    void this.router.navigate(['/play']);
  }

  private seedFromUrl(): number | null {
    if (typeof location === 'undefined') return null;
    const raw = new URLSearchParams(location.search).get('seed');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n >>> 0 : null;
  }

  /* ================================================================== lifecycle */

  /** Called by the game page once its canvas exists. */
  async attach(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    if (!this.startRequest) {
      this.startRequest = this.saves.hasContinue()
        ? { mode: 'continue' }
        : { mode: 'new', difficultyId: this.saves.data().selectedDifficulty, seed: this.seedFromUrl() ?? SeededRandom.randomSeed() };
      if (this.startRequest.mode === 'new') this.saves.startNewRun();
    }
    await this.boot();
  }

  /** Called when the game page is destroyed. */
  detach(): void {
    if (this.run && !this.run.finished && this.phase() !== 'error') this.autosave();
    this.teardown();
    this.canvas = null;
    this.phase.set('idle');
  }

  private async boot(): Promise<void> {
    const request = this.startRequest;
    const canvas = this.canvas;
    if (!request || !canvas) return;
    const token = ++this.bootToken;
    const t0 = performance.now();
    const mark = (label: string) => {
      if (isDevMode()) console.info(`[game] boot ${label}: ${Math.round(performance.now() - t0)} ms`);
    };
    this.teardown();
    this.error.set(null);
    this.endingResult.set(null);
    this.phase.set('loading');
    this.loading.set({ progress: 0.02, message: 'Reading floor plan' });

    try {
      // 1. Load stage configuration
      const restore = request.mode === 'continue' ? this.saves.data().progress.activeRun : null;
      const difficultyId = restore?.difficultyId ?? (request.mode === 'new' ? request.difficultyId : this.saves.data().selectedDifficulty);
      const difficulty = this.content.difficulties.require(difficultyId);
      const stage = this.content.stages.require(restore?.stageId ?? this.content.defaultStageId);
      const seed = restore?.seed ?? (request.mode === 'new' ? request.seed : SeededRandom.randomSeed());

      // 2. Lazy-load the engine and validate content (effect handlers known only engine-side)
      this.loading.set({ progress: 0.05, message: 'Loading engine' });
      const engineModule = await import('../engine/game-engine');
      if (token !== this.bootToken) return;
      mark('engine module loaded');
      const issues = validateStage(stage, this.content, { knownEffectTypes: engineModule.registeredEffectTypes() });
      const errors = issues.filter((i) => i.level === 'error');
      if (issues.length) console.warn(`[content] ${stage.id} validation:\n${formatIssues(issues)}`);
      if (errors.length) throw new Error(`Stage "${stage.id}" failed validation:\n${formatIssues(errors)}`);

      // 3. Initialise systems for this run
      this.run = this.createRunContext(stage, difficulty, seed, restore);
      this.stageSignal.set(stage);
      this.difficultySignal.set(difficulty);
      this.isResumed.set(!!restore);
      this.initSystems(this.run);

      // 4 + 5. Audio sources and the environment are generated concurrently: the pure procedural
      // work (textures, synthesis) runs in a worker pool while the main thread builds geometry.
      const workers = ProceduralPool.create();
      let audioProgress = 0;
      let worldProgress = 0;
      let worldMessage = 'Calibrating fluorescent ballasts';
      const report = () =>
        this.loading.set({ progress: 0.08 + (audioProgress * 0.25 + worldProgress * 0.75) * 0.92, message: worldMessage });
      const audioReady = this.audio
        .prepare(undefined, (p) => {
          audioProgress = p;
          report();
        }, workers)
        .then(() => mark('audio synthesised'));
      const engine = engineModule.createGameEngine();
      this.engine = engine;
      try {
        await engine.init({
          canvas,
          host: this,
          audio: this.audio,
          workers,
          restore,
          onProgress: (p) => {
            worldProgress = p.progress;
            worldMessage = p.message;
            report();
          },
        });
        await audioReady;
      } finally {
        workers?.dispose();
      }
      if (token !== this.bootToken) {
        engine.dispose();
        return;
      }
      engine.applySettings(this.settings());
      mark('engine initialised');

      // 6. Register anomalies / restore world state
      if (restore) {
        for (const def of this.director.appliedAnomalies()) engine.applyAnomaly(this.resolveAnomaly(def), true);
        if (this.progression.accessGranted()) engine.setElevatorAvailable(true);
      }
      engine.setAttention(this.attention.levelConfig(), this.attention.isEscalating());
      engine.startRendering();
      if (isDevMode() && typeof window !== 'undefined') {
        (window as unknown as { __tfil?: unknown }).__tfil = { session: this, ...(engine.debug?.() ?? {}) };
      }
      this.loading.set({ progress: 1, message: 'Ready' });
      this.phase.set('awaiting-start');
    } catch (err) {
      console.error('[game] failed to start', err);
      this.error.set(this.describeError(err));
      this.phase.set('error');
      this.teardown();
    }
  }

  private describeError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/webgl/i.test(msg) || /context/i.test(msg)) {
      return 'WebGL could not be initialised. Enable hardware acceleration in your browser settings, update your graphics driver, or try Chrome / Edge / Firefox.';
    }
    return msg;
  }

  private createRunContext(stage: StageDefinition, difficulty: DifficultyConfig, seed: number, restored: RunSnapshot | null): RunContext {
    const adjacency = new Map<RoomId, RoomId[]>();
    for (const door of stage.doors) {
      const [a, b] = door.rooms;
      adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
      adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
    }
    return {
      stage,
      difficulty,
      anomalies: new Map(this.content.anomaliesForStage(stage).map((a) => [a.id, a])),
      endings: this.content.endingsForStage(stage),
      seed,
      restored,
      roomId: null,
      previousRoomId: null,
      roomEnteredAt: 0,
      presence: new Map(),
      cooldowns: new Map(),
      doorToggles: new Map(),
      flashToggles: [],
      elevatorPresses: 0,
      inspectCounts: new Map(),
      resolved: new Map(),
      directorAccumulator: 0,
      hudAccumulator: 0,
      autosaveAccumulator: 0,
      sprinting: false,
      elevatorCalled: false,
      finished: false,
      adjacency,
    };
  }

  private initSystems(run: RunContext): void {
    const interactables = run.stage.rooms.reduce(
      (n, r) => n + r.props.filter((p) => p.interaction?.kind === 'inspect' && !p.hidden).length,
      0,
    );
    const setup = {
      stage: run.stage,
      difficulty: run.difficulty,
      anomalies: this.content.anomaliesForStage(run.stage),
      decoys: this.content.decoysForStage(run.stage),
      responses: this.content.responsesForStage(run.stage),
      levels: ATTENTION_LEVEL_CONFIGS,
      seed: run.seed,
    };
    this.attention.configure(run.difficulty);
    const r = run.restored;
    if (r) {
      this.behavior.restore(r.behavior, { totalInteractables: interactables });
      this.attention.restore(r.attention);
      this.investigation.restore(r.investigation);
      this.memory.restore(r.memory);
      this.progression.restore(r.progression);
      this.director.restore(setup, r.director);
      run.elevatorCalled = r.progression.pendingEndingId !== null;
    } else {
      this.behavior.reset({ totalInteractables: interactables });
      this.attention.reset();
      this.investigation.reset();
      this.memory.reset();
      this.progression.reset();
      this.director.start(setup);
    }
    this.updateClock();
  }

  private teardown(): void {
    this.engine?.dispose();
    this.engine = null;
    this.audio.stopAll();
    this.prompt.set(null);
    this.inspection.set(null);
    this.subtitle.set(null);
    this.securityView.set(null);
    this.introLines.set([]);
    this.tutorial.set(null);
    this.toasts.set([]);
  }

  /* ================================================================== start / intro */

  /** "Click to wake up" - must run inside a user gesture (pointer lock + audio unlock). */
  async beginFromOverlay(): Promise<void> {
    const engine = this.engine;
    const run = this.run;
    if (!engine || !run || this.phase() !== 'awaiting-start') return;
    engine.requestPointerLock();
    this.audio.startLoop('music', run.stage.music.ambient, { volume: 1, fadeMs: 4000 });

    if (run.restored) {
      this.phase.set('playing');
      engine.setSimulationPaused(false);
      this.notify(`SHIFT RESUMED — ${this.clock()}`, 'objective');
      this.notify(this.objectiveText(), 'objective');
      return;
    }

    this.phase.set('intro');
    this.introSkip = false;
    this.introLines.set([]);
    const lines = run.stage.intro.lines;
    const timers = lines.map((line, i) =>
      setTimeout(() => {
        if (this.phase() === 'intro') this.introLines.update((l) => [...l, line]);
      }, 1700 + i * 1100),
    );
    await engine.playIntro(() => this.introSkip);
    timers.forEach(clearTimeout);
    if (this.engine !== engine) return;
    this.introLines.set([]);
    this.phase.set('playing');
    engine.setSimulationPaused(false);
    if (!this.saves.data().progress.tutorialSeen) {
      this.tutorial.set(run.stage.intro.tutorial);
      setTimeout(() => this.tutorial.set(null), 14000);
      this.saves.markTutorialSeen();
    }
    this.notify(this.objectiveText(), 'objective');
  }

  skipIntro(): void {
    this.introSkip = true;
  }

  dismissTutorial(): void {
    this.tutorial.set(null);
  }

  /* ================================================================== pause / menus */

  pause(): void {
    const phase = this.phase();
    if (phase !== 'playing' && phase !== 'security') return;
    if (phase === 'security') this.engine?.exitSecurityView();
    this.phase.set('paused');
    this.engine?.setSimulationPaused(true);
    this.engine?.releasePointerLock();
    this.audio.setDuck(0.35);
    this.audio.cancelSpeech();
    this.autosave();
  }

  resume(): void {
    if (this.phase() !== 'paused') return;
    this.phase.set('playing');
    this.engine?.requestPointerLock();
    this.engine?.setSimulationPaused(false);
    this.audio.setDuck(1);
  }

  /** Restart the run without reloading the page (same difficulty, new seed). */
  async restart(): Promise<void> {
    const difficultyId = this.run?.difficulty.id ?? this.saves.data().selectedDifficulty;
    this.saves.startNewRun();
    this.startRequest = { mode: 'new', difficultyId, seed: this.seedFromUrl() ?? SeededRandom.randomSeed() };
    await this.boot();
  }

  /** Retry after a failed start without discarding the saved shift. */
  async retry(): Promise<void> {
    if (!this.startRequest) this.startRequest = this.saves.hasContinue() ? { mode: 'continue' } : { mode: 'new', difficultyId: this.saves.data().selectedDifficulty, seed: SeededRandom.randomSeed() };
    await this.boot();
  }

  quitToMenu(): void {
    if (this.run && !this.run.finished) this.autosave();
    this.teardown();
    this.run = null;
    this.phase.set('idle');
    void this.router.navigate(['/']);
  }

  toggleNotebook(): void {
    const phase = this.phase();
    if (phase === 'playing') {
      this.phase.set('notebook');
      this.engine?.setSimulationPaused(true);
      this.engine?.releasePointerLock();
      this.audio.play('notebook');
    } else if (phase === 'notebook') {
      this.closeOverlay();
    }
  }

  /** Closes notebook / terminal and returns to play (call from a user gesture). */
  closeOverlay(): void {
    const phase = this.phase();
    if (phase !== 'notebook' && phase !== 'terminal') return;
    this.phase.set('playing');
    this.engine?.requestPointerLock();
    this.engine?.setSimulationPaused(false);
    this.audio.setDuck(1);
  }

  requestPause(): void {
    this.pause();
  }

  /* ================================================================== terminal */

  openTerminal(): void {
    if (this.phase() !== 'playing' || !this.run) return;
    this.phase.set('terminal');
    this.engine?.setSimulationPaused(true);
    this.engine?.releasePointerLock();
    this.audio.setDuck(0.6);
    this.audio.play('keyboard');
    this.emit({ type: 'terminal-opened' });
    if (this.progression.terminalOpened()) this.notify(this.objectiveText(), 'objective');
  }

  /** Rooms the player may file reports for (visited rooms only). */
  reportableRooms(): { id: RoomId; name: string }[] {
    const run = this.run;
    if (!run) return [];
    const visited = new Set(this.memory.visitedRooms());
    return run.stage.rooms.filter((r) => visited.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
  }

  roomDisplayName(roomId: RoomId): string {
    return this.run?.stage.rooms.find((r) => r.id === roomId)?.name ?? roomId;
  }

  submitReport(report: AnomalyReport): ReportResult {
    const run = this.run;
    if (!run) return { outcome: 'invalid', headline: 'OFFLINE', detail: '', attentionDelta: 0 };
    const result = this.investigation.submitReport(
      report,
      {
        anomalies: run.anomalies,
        difficulty: run.difficulty,
        confirmedAnomalyIds: new Set(this.investigation.confirmedAnomalyIds()),
      },
      this.director.elapsed,
    );
    switch (result.outcome) {
      case 'confirmed':
        this.audio.play('report-ok');
        if (result.anomalyId) {
          this.director.markReported(result.anomalyId);
          this.emit({ type: 'report-confirmed', anomalyId: result.anomalyId });
        }
        this.handleAttentionEvents(this.attention.relieve(-result.attentionDelta));
        if (this.progression.confirmedChanged(this.confirmed(), run.stage.requiredReports)) {
          this.notify('INSPECTION COMPLETE', 'success');
        }
        break;
      case 'rejected':
      case 'mismatch':
        this.audio.play('report-bad');
        if (result.outcome === 'rejected') this.emit({ type: 'report-rejected' });
        this.handleAttentionEvents(this.attention.raise(result.attentionDelta, true));
        this.engine?.falseReportResponse();
        break;
      default:
        this.audio.play('terminal-beep');
    }
    this.autosave();
    return result;
  }

  requestElevatorAccess(): boolean {
    if (!this.progression.grantAccess()) return false;
    this.audio.play('report-ok');
    this.engine?.setElevatorAvailable(true);
    this.notify(this.objectiveText(), 'objective');
    this.autosave();
    return true;
  }

  /* ================================================================== EngineHost */

  emit(event: GameEvent): void {
    const run = this.run;
    if (!run) return;
    const now = this.director.elapsed;
    this.behavior.record(event, now, this.clock());
    this.director.recordEvent(event.type);

    switch (event.type) {
      case 'room-enter': {
        run.previousRoomId = run.roomId;
        run.roomId = event.roomId;
        run.roomEnteredAt = now;
        this.roomName.set(this.roomDisplayName(event.roomId));
        const { firstVisit } = this.memory.enter(event.roomId, now, () => this.engine?.captureRoomState(event.roomId) ?? {});
        if (!firstVisit && this.engine) {
          const diffs = this.memory.compare(event.roomId, this.engine.captureRoomState(event.roomId));
          if (diffs.length && isDevMode()) console.debug(`[memory] ${event.roomId} differs from baseline`, diffs);
        }
        break;
      }
      case 'room-exit':
        this.memory.exit(event.roomId, now);
        if (run.roomId === event.roomId) run.roomId = null;
        run.presence.clear();
        break;
      case 'door-interact':
        if (event.result !== 'locked-attempt') this.trackRepetition(run.doorToggles, event.doorId, 4, 8, 3);
        break;
      case 'flashlight': {
        this.flashlightOn.set(event.on);
        run.flashToggles = run.flashToggles.filter((t) => now - t < 6);
        run.flashToggles.push(now);
        if (run.flashToggles.length >= 7) {
          run.flashToggles = [];
          this.handleAttentionEvents(this.attention.raise(2));
        }
        break;
      }
      case 'sprint':
        run.sprinting = event.active;
        break;
      case 'object-gaze':
        this.checkSight(event.propId);
        break;
      default:
        break;
    }
  }

  private trackRepetition(map: Map<string, number[]>, key: string, count: number, windowSec: number, attention: number): void {
    const now = this.director.elapsed;
    const times = (map.get(key) ?? []).filter((t) => now - t < windowSec);
    times.push(now);
    if (times.length >= count) {
      map.set(key, []);
      this.handleAttentionEvents(this.attention.raise(attention));
      this.notify('The building noticed that.', 'warning');
    } else {
      map.set(key, times);
    }
  }

  simulate(sample: FrameSample): void {
    const run = this.run;
    if (!run || run.finished) return;
    const dt = Math.min(sample.dt, 0.1);
    this.behavior.sample({ ...sample, dt });
    this.handleAttentionEvents(this.attention.update(dt, { sprinting: run.sprinting && sample.speed > 0.5, overtime: this.overtime() }));

    run.directorAccumulator += dt;
    if (run.directorAccumulator >= DIRECTOR_TICK_SEC) {
      const step = run.directorAccumulator;
      run.directorAccumulator = 0;
      this.handleDirectorActions(this.director.update(step, this.directorWorld(run)));
      this.checkPresence(run, step);
    }

    run.hudAccumulator += dt;
    if (run.hudAccumulator >= 0.5) {
      run.hudAccumulator = 0;
      this.updateClock();
    }
    run.autosaveAccumulator += dt;
    if (run.autosaveAccumulator >= AUTOSAVE_SEC) {
      run.autosaveAccumulator = 0;
      this.autosave();
    }
  }

  private directorWorld(run: RunContext): DirectorWorld {
    const engine = this.engine;
    return {
      playerRoomId: run.roomId,
      attentionLevel: this.attention.level(),
      confirmedCount: this.confirmed(),
      flags: this.progression.flags(),
      profile: this.behavior.snapshot().profile,
      doorStates: engine?.doorStates() ?? {},
      roomVisits: (id) => this.memory.visits(id),
      propUnseenSeconds: (id) => engine?.propUnseenSeconds(id) ?? Infinity,
      adjacentRooms: (id) => run.adjacency.get(id) ?? [],
    };
  }

  private handleDirectorActions(actions: DirectorAction[]): void {
    const engine = this.engine;
    if (!engine) return;
    for (const action of actions) {
      if (action.type === 'activate') {
        engine.applyAnomaly(this.resolveAnomaly(action.anomaly, true), false);
        this.emit({ type: 'anomaly-activated', anomalyId: action.anomaly.id });
        if (isDevMode()) console.debug(`[director] activated ${action.anomaly.id} (${action.anomaly.roomId})`);
      } else if (action.type === 'retire') {
        engine.revertAnomaly(action.anomaly);
        this.run?.resolved.delete(action.anomaly.id);
        this.run?.presence.delete(action.anomaly.id);
        if (isDevMode()) console.debug(`[director] retired ${action.anomaly.id} (${action.reason})`);
      } else {
        engine.playDecoy(this.resolveDecoy(action.decoy));
      }
    }
  }

  private checkPresence(run: RunContext, dt: number): void {
    if (!run.roomId) return;
    for (const def of this.director.perceivableAnomalies()) {
      if (def.clue.mode !== 'presence' || def.roomId !== run.roomId) continue;
      const t = (run.presence.get(def.id) ?? 0) + dt;
      run.presence.set(def.id, t);
      if (t >= (def.clue.dwellSec ?? 3) * run.difficulty.clues.dwellMultiplier) this.witness(def, false);
    }
  }

  private checkSight(propId: string): void {
    for (const def of this.director.perceivableAnomalies()) {
      if (def.clue.mode === 'sight' && def.clue.targetPropId === propId) this.witness(def, false);
    }
  }

  perceive(event: PerceptionEvent): void {
    const run = this.run;
    if (!run) return;
    if (event.owner.kind === 'anomaly') {
      const ownerId = event.owner.id;
      const def = this.director.perceivableAnomalies().find((a) => a.id === ownerId);
      if (def && (def.clue.mode === event.mode || (event.mode === 'hearing' && def.clue.mode !== 'feed'))) this.witness(def, false);
    } else if (event.owner.kind === 'decoy') {
      const decoy = this.content.decoys.get(event.owner.id);
      if (decoy) {
        this.logObservation({ kind: 'decoy', decoyId: decoy.id }, decoy.roomId, undefined, decoy.subject, this.resolveText(decoy.observation));
      }
    }
  }

  interact(request: InteractionRequest): void {
    const run = this.run;
    if (!run || run.finished) return;
    const def = request.definition;
    this.emit({ type: 'interaction', propId: request.propId, kind: def.kind });
    switch (def.kind) {
      case 'inspect':
        this.inspect(request);
        break;
      case 'terminal':
        this.openTerminal();
        break;
      case 'elevator-call':
        this.pressElevatorCall();
        break;
      case 'elevator-panel':
        this.pressElevatorPanel();
        break;
      case 'pickup': {
        if (def.requiresFlag && !this.progression.hasFlag(def.requiresFlag)) {
          this.showCard(def.name, def.lockedNote ?? 'You leave it where it is.', 'note');
          return;
        }
        if (def.flag && this.progression.setFlag(def.flag)) this.emit({ type: 'flag-set', flag: def.flag });
        if (def.consumed) this.engine?.consumeProp(request.propId);
        this.audio.play('pickup');
        if (def.attentionDelta) this.handleAttentionEvents(this.attention.raise(def.attentionDelta));
        this.showCard(def.name, this.resolveText(def.note ?? ''), 'pickup');
        this.logObservation({ kind: 'prop', propId: request.propId }, request.roomId ?? run.roomId ?? run.stage.hubRoomId, undefined, def.name, this.resolveText(def.note ?? ''));
        this.autosave();
        break;
      }
      case 'relief':
      case 'hazard': {
        if (this.attention.isEscalating()) {
          this.showCard(def.name, 'It does not respond. Not now.', 'system');
          return;
        }
        const until = run.cooldowns.get(request.propId) ?? -1;
        const now = this.director.elapsed;
        if (now < until) {
          this.showCard(def.name, def.kind === 'relief' ? 'Not yet. It is still settling.' : 'Nothing happens.', 'system');
          return;
        }
        run.cooldowns.set(request.propId, now + (def.cooldownSec ?? 60));
        if (def.kind === 'relief') {
          this.audio.play('relief');
          this.handleAttentionEvents(this.attention.relieve(Math.abs(def.attentionDelta ?? 5)));
          this.engine?.reliefResponse();
        } else {
          this.audio.play('hazard');
          this.handleAttentionEvents(this.attention.raise(Math.abs(def.attentionDelta ?? 5)));
          if (def.flag && this.progression.setFlag(def.flag)) this.emit({ type: 'flag-set', flag: def.flag });
        }
        this.showCard(def.name, this.resolveText(def.note ?? ''), 'note');
        break;
      }
      default:
        break;
    }
  }

  private inspect(request: InteractionRequest): void {
    const run = this.run!;
    const propId = request.propId;
    this.emit({ type: 'object-inspect', propId, roomId: request.roomId });
    this.audio.play('inspect');
    const def = request.definition;
    const anomaly = this.director
      .perceivableAnomalies()
      .find((a) => a.clue.mode !== 'feed' && (a.clue.targetPropId === propId || a.targetPropId === propId));
    if (anomaly) {
      const count = (run.inspectCounts.get(anomaly.id) ?? 0) + 1;
      run.inspectCounts.set(anomaly.id, count);
      if (count > 4) this.handleAttentionEvents(this.attention.raise(1.5));
      this.witness(anomaly, true);
      return;
    }
    const text = this.resolveText(def.note ?? `${def.name}. Nothing unusual.`);
    this.showCard(def.name, text, 'note');
    this.logObservation({ kind: 'prop', propId }, request.roomId ?? run.roomId ?? run.stage.hubRoomId, undefined, def.name, text);
  }

  private witness(def: AnomalyDefinition, showCard: boolean): void {
    const run = this.run;
    if (!run) return;
    if (this.director.markWitnessed(def.id)) {
      this.emit({ type: 'anomaly-witnessed', anomalyId: def.id });
      if (run.difficulty.clues.witnessHint) this.witnessHint.update((n) => n + 1);
    }
    const text = run.resolved.get(def.id)?.observation ?? this.resolveText(def.clue.observation);
    if (showCard) this.showCard(def.clue.subject, text, 'note');
    this.logObservation({ kind: 'anomaly', anomalyId: def.id }, def.roomId, def.alternateRoomIds, def.clue.subject, text);
  }

  private logObservation(source: ObservationSource, roomId: RoomId, alt: readonly RoomId[] | undefined, subject: string, text: string): void {
    const { isNew } = this.investigation.addObservation({
      time: this.director.elapsed,
      clock: this.clock(),
      roomId,
      alternateRoomIds: alt,
      subject,
      text,
      source,
    });
    if (isNew) this.noteFlash.update((n) => n + 1);
  }

  private pressElevatorCall(): void {
    const run = this.run!;
    this.audio.play('elevator-button');
    if (!this.progression.accessGranted()) {
      run.elevatorPresses++;
      if (run.elevatorPresses > 2) this.handleAttentionEvents(this.attention.raise(2));
      this.showCard('Elevator call button', 'The button does not light up. ELEVATOR ACCESS: DENIED.', 'system');
      return;
    }
    if (run.elevatorCalled) {
      this.notify('The elevator is already here.');
      return;
    }
    const ending = this.resolveLockedEnding('elevator-standard');
    if (!ending) return;
    run.elevatorCalled = true;
    this.progression.lockEnding(ending.id);
    this.emit({ type: 'elevator-called' });
    this.engine?.callElevator(ending);
    this.autosave();
  }

  private pressElevatorPanel(): void {
    const run = this.run!;
    if (!run.elevatorCalled) {
      this.showCard('Floor panel', 'The panel is dark.', 'system');
      return;
    }
    const trigger = this.progression.hasFlag('service-key') ? 'elevator-service' : 'elevator-standard';
    const ending = this.resolveLockedEnding(trigger) ?? this.resolveLockedEnding('elevator-standard');
    if (ending) this.startEnding(ending);
  }

  elevatorEntered(): void {
    const run = this.run;
    if (!run || run.finished || !run.elevatorCalled) return;
    if (this.progression.hasFlag('service-key')) {
      this.notify('The panel has a keyhole marked S-3.');
      return;
    }
    const ending = this.resolveLockedEnding('elevator-standard');
    if (ending) this.startEnding(ending);
  }

  private resolveLockedEnding(trigger: 'elevator-standard' | 'elevator-service'): EndingDefinition | null {
    const run = this.run!;
    if (trigger === 'elevator-standard' && this.progression.pendingEndingId()) {
      const locked = run.endings.find((e) => e.id === this.progression.pendingEndingId());
      if (locked && locked.trigger === trigger) return locked;
    }
    const att = this.attention.snapshot();
    return resolveEnding(run.endings, trigger, {
      investigationComplete: this.progression.hasFlag('investigation-complete'),
      attention: att.value,
      peakAttention: att.peak,
      escalations: att.escalations,
      flags: this.progression.flags(),
    });
  }

  private startEnding(ending: EndingDefinition): void {
    const run = this.run!;
    if (run.finished) return;
    run.finished = true;
    this.progression.complete();
    this.prompt.set(null);
    this.audio.stopLoop('music', 2500);
    this.engine?.beginEnding(ending);
  }

  endingSequenceFinished(ending: EndingDefinition): void {
    const run = this.run;
    if (!run) return;
    const snapshot = this.behavior.snapshot();
    const before = this.saves.data().progress.unlockedEndings;
    const playTime = this.director.elapsed;
    this.saves.completeRun({
      stageId: run.stage.id,
      endingId: ending.id,
      playTimeSec: playTime,
      correct: this.confirmed(),
      falseReports: this.falseReports(),
      metrics: this.behavior.exportMetrics(),
      dominant: snapshot.profile.dominant,
    });
    const unlocked = this.saves.data().progress.unlockedEndings;
    this.endingResult.set({
      ending,
      playTimeSec: playTime,
      confirmed: this.confirmed(),
      falseReports: this.falseReports(),
      peakAttention: Math.round(this.attention.snapshot().peak),
      dominant: snapshot.profile.dominant,
      newlyUnlocked: !before.includes(ending.id),
      unlockedCount: unlocked.length,
      totalEndings: this.content.endings.all().length,
    });
    this.engine?.releasePointerLock();
    this.engine?.setSimulationPaused(true);
    this.audio.startLoop('music', 'music-ending', { volume: 1, fadeMs: 3000 });
    this.phase.set('ending');
  }

  pointerLockChanged(locked: boolean): void {
    this.pointerLocked.set(locked);
  }

  /** Re-acquire pointer lock after it was lost (click-to-continue overlay). */
  relock(): void {
    if (this.phase() === 'playing' || this.phase() === 'security') this.engine?.requestPointerLock();
  }

  private showCard(title: string, text: string, kind: InspectionCard['kind']): void {
    this.inspection.set({ title, text, kind });
    if (this.inspectionTimer) clearTimeout(this.inspectionTimer);
    this.inspectionTimer = setTimeout(() => this.inspection.set(null), Math.max(4500, text.length * 60));
  }

  promptVerb(_propId: string, kind: InteractionKind): string | null {
    if (kind === 'elevator-panel' && this.run?.elevatorCalled && this.progression.hasFlag('service-key')) return 'Turn service key';
    return null;
  }

  setPrompt(prompt: InteractionPrompt | null): void {
    const current = this.prompt();
    if (current === prompt) return;
    if (current && prompt && current.verb === prompt.verb && current.target === prompt.target && current.disabled === prompt.disabled) return;
    this.prompt.set(prompt);
  }

  securityViewChanged(state: SecurityViewState | null): void {
    this.securityView.set(state);
    if (state && this.phase() === 'playing') this.phase.set('security');
    else if (!state && this.phase() === 'security') this.phase.set('playing');
  }

  showSubtitle(text: string, durationSec: number): void {
    this.subtitle.set(text);
    if (this.subtitleTimer) clearTimeout(this.subtitleTimer);
    this.subtitleTimer = setTimeout(() => this.subtitle.set(null), durationSec * 1000);
  }

  notify(text: string, tone: Toast['tone'] = 'neutral'): void {
    if (!text) return;
    const id = ++this.toastId;
    this.toasts.update((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), tone === 'objective' ? 6500 : 4500);
  }

  shiftMinutes(): number {
    const run = this.run;
    if (!run) return 9 * 60;
    return shiftClock(this.director.elapsed, run.difficulty.shiftDurationMin).minutes;
  }

  resolveText(text: string): string {
    return resolveTokens(text, this.tokenContext());
  }

  private tokenContext(): TokenContext {
    const run = this.run;
    const stage = run?.stage;
    return {
      employee: stage?.employeeNumber ?? '0000',
      metrics: this.behavior.getMetrics(),
      clock: this.clock(),
      previousRoomId: run?.previousRoomId ?? null,
      roomName: (id) => this.roomDisplayName(id),
      behaviorMessage: () => {
        const responses = this.director.activeResponses(this.behavior.snapshot().profile);
        const messages = responses.flatMap((r) => r.messages);
        if (!messages.length) return 'WE ARE GLAD YOU ARE HERE, {employee}.';
        const index = Math.floor(this.director.elapsed) % messages.length;
        return messages[index];
      },
    };
  }

  private resolveAnomaly(def: AnomalyDefinition, fresh = false): AnomalyDefinition {
    const run = this.run;
    if (!run) return def;
    const cached = run.resolved.get(def.id);
    if (cached && !fresh) return cached.def;
    const effects = def.effects.map((e) => this.resolveEffect(e));
    const resolved: AnomalyDefinition = { ...def, effects };
    run.resolved.set(def.id, { def: resolved, observation: this.resolveText(def.clue.observation) });
    return resolved;
  }

  private resolveDecoy(def: DecoyDefinition): DecoyDefinition {
    return { ...def, effects: def.effects.map((e) => this.resolveEffect(e)) };
  }

  private resolveEffect(effect: AnomalyEffect): AnomalyEffect {
    switch (effect.type) {
      case 'set-text':
        return { ...effect, text: this.resolveText(effect.text) };
      case 'announcement':
        return { ...effect, text: this.resolveText(effect.text) };
      case 'clock':
        return effect.time ? { ...effect, time: this.resolveText(effect.time) } : effect;
      default:
        return effect;
    }
  }

  /* ================================================================== attention */

  private handleAttentionEvents(events: GameEvent[]): void {
    for (const event of events) {
      this.behavior.record(event, this.director.elapsed, this.clock());
      if (event.type === 'attention-level') {
        this.engine?.setAttention(this.attention.levelConfig(), this.attention.isEscalating());
        const rising = ATTENTION_LEVEL_CONFIGS.findIndex((l) => l.level === event.level) >
          ATTENTION_LEVEL_CONFIGS.findIndex((l) => l.level === event.previous);
        if (rising && event.level === 'medium') this.notify('The building is paying attention.', 'warning');
        if (rising && event.level === 'high') {
          this.notify('The building is watching you.', 'warning');
          if (this.run) this.audio.startLoop('music', this.run.stage.music.tension, { volume: 1, fadeMs: 5000 });
        }
        if (!rising && event.level === 'medium' && this.run) {
          this.audio.startLoop('music', this.run.stage.music.ambient, { volume: 1, fadeMs: 5000 });
        }
      } else if (event.type === 'escalation-start') {
        this.engine?.setAttention(this.attention.levelConfig(), true);
        this.notify('THE BUILDING IS INTERVENING', 'warning');
        const text = this.resolveText('Employee {employee}. Please return to your desk. Please return to your desk.');
        this.audio.play('pa-chime');
        setTimeout(() => this.showSubtitle(text, this.audio.speak(text, { pitch: 0.4, rate: 0.75 })), 1600);
      } else if (event.type === 'escalation-end') {
        this.engine?.setAttention(this.attention.levelConfig(), false);
        this.notify('The building settles. For now.');
      }
    }
  }

  /* ================================================================== persistence */

  private updateClock(): void {
    const run = this.run;
    if (!run) return;
    const c = shiftClock(this.director.elapsed, run.difficulty.shiftDurationMin);
    if (c.label !== this.clock()) this.clock.set(c.label);
    if (c.overtime && !this.overtime()) {
      this.overtime.set(true);
      this.notify('17:00. YOUR SHIFT HAS ENDED. YOU ARE STILL HERE.', 'warning');
    }
  }

  autosave(): void {
    const run = this.run;
    const engine = this.engine;
    if (!run || !engine || run.finished) return;
    const phase = this.phase();
    if (phase === 'loading' || phase === 'error' || phase === 'idle' || phase === 'awaiting-start' || phase === 'intro') return;
    const player = engine.playerTransform();
    const snapshot: RunSnapshot = {
      stageId: run.stage.id,
      difficultyId: run.difficulty.id,
      seed: run.seed,
      elapsed: this.director.elapsed,
      savedAtClock: this.clock(),
      player,
      attention: this.attention.snapshot(),
      investigation: this.investigation.export(),
      director: this.director.getState(),
      memory: this.memory.export(),
      progression: this.progression.export(),
      doors: engine.doorStates(),
      behavior: this.behavior.exportMetrics(),
    };
    this.saves.saveRun(snapshot);
  }

  /* ================================================================== dev stats */

  private configureStats(enabled: boolean): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (!enabled) {
      this.stats.set(null);
      return;
    }
    this.statsTimer = setInterval(() => this.stats.set(this.engine?.stats() ?? null), 500);
  }
}

