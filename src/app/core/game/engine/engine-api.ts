/*
 * The contract between the Angular game shell (GameSessionService) and the Babylon.js engine.
 * This file must stay free of Babylon and Angular imports so the shell can type the engine
 * without pulling it into the initial bundle (the engine is lazy-loaded with import()).
 */
import {
  AnomalyDefinition,
  AttentionLevelConfig,
  DecoyDefinition,
  DifficultyConfig,
  DoorState,
  EndingDefinition,
  GameEvent,
  GameSettings,
  InteractionDefinition,
  InteractionKind,
  InteractionPrompt,
  PropStateSnapshot,
  RoomId,
  RunSnapshot,
  StageDefinition,
  Vec3,
} from '../models';
import type { ProceduralWorkers } from '../workers/procedural-pool';

/** Aggregated per-frame player state handed to the simulation. */
export interface FrameSample {
  readonly dt: number;
  readonly roomId: RoomId | null;
  readonly position: Vec3;
  readonly speed: number;
  readonly sprinting: boolean;
  readonly yawDeltaDeg: number;
  readonly inDarkArea: boolean;
  readonly flashlightOn: boolean;
}

export interface InteractionRequest {
  readonly propId: string;
  readonly definition: InteractionDefinition;
  readonly roomId: RoomId | null;
}

/** Who produced a perceivable effect (sound, feed image...). */
export type EffectOwner =
  | { readonly kind: 'anomaly'; readonly id: string }
  | { readonly kind: 'decoy'; readonly id: string }
  | { readonly kind: 'ambient' };

export interface PerceptionEvent {
  readonly owner: EffectOwner;
  readonly mode: 'hearing' | 'feed';
}

export interface LoadProgress {
  readonly progress: number;
  readonly message: string;
}

export interface EngineStats {
  readonly fps: number;
  readonly drawCalls: number;
  readonly activeMeshes: number;
  readonly totalMeshes: number;
  readonly lights: number;
  readonly frameMs: number;
}

export interface SecurityViewState {
  readonly index: number;
  readonly count: number;
  readonly label: string;
}

/** Callbacks the engine uses to talk to the game shell. Implemented by GameSessionService. */
export interface EngineHost {
  readonly stage: StageDefinition;
  readonly difficulty: DifficultyConfig;
  settings(): GameSettings;
  /** Meaningful gameplay events (room changes, doors, flashlight...). */
  emit(event: GameEvent): void;
  /** One simulation step. Not called while paused. */
  simulate(sample: FrameSample): void;
  /** The player pressed E on an interactive prop (doors are handled by the engine itself). */
  interact(request: InteractionRequest): void;
  /** Perception of an effect produced by an anomaly/decoy. */
  perceive(event: PerceptionEvent): void;
  setPrompt(prompt: InteractionPrompt | null): void;
  /** Optional context-sensitive verb for a prompt (e.g. "Turn service key"); null = default. */
  promptVerb?(propId: string, kind: InteractionKind): string | null;
  /** Resolve {tokens} in in-world text (behaviour-derived messages, clocks...). */
  resolveText(text: string): string;
  /** Current shift clock (game time) in minutes since midnight. */
  shiftMinutes(): number;
  /** Pointer lock acquired/lost (UI shows a click-to-continue overlay when lost). */
  pointerLockChanged(locked: boolean): void;
  /** Escape / pointer-lock loss while playing. */
  requestPause(): void;
  toggleNotebook(): void;
  /** Security view opened/changed/closed by the engine. */
  securityViewChanged(state: SecurityViewState | null): void;
  /** Announcement subtitles. */
  showSubtitle(text: string, durationSec: number): void;
  /** Player stepped into the elevator car (ending sequences begin from here). */
  elevatorEntered(): void;
  /** Ending sequence finished playing in-world. */
  endingSequenceFinished(ending: EndingDefinition): void;
  /** Engine-side warning/notice for the HUD. */
  notify(text: string, tone?: 'neutral' | 'warning'): void;
}

/** Subset of AudioManagerService the engine uses for in-world sound. */
export interface EngineAudio {
  play(id: string, options?: { position?: Vec3; volume?: number; rate?: number }): number | null;
  startLoop(key: string, soundId: string, options?: { volume?: number; fadeMs?: number; position?: Vec3 }): void;
  setLoopVolume(key: string, volume: number, fadeMs?: number): void;
  stopLoop(key: string, fadeMs?: number): void;
  hasLoop(key: string): boolean;
  setListener(position: Vec3, forward: Vec3): void;
  speak(text: string, options?: { pitch?: number; rate?: number; volume?: number }): number;
}

export interface EngineInitOptions {
  readonly canvas: HTMLCanvasElement;
  /** Optional worker pool for procedural textures (null = generate on the main thread). */
  readonly workers: ProceduralWorkers | null;
  readonly host: EngineHost;
  readonly audio: EngineAudio;
  readonly restore: RunSnapshot | null;
  readonly onProgress: (p: LoadProgress) => void;
}

/** The engine surface used by the shell. Implemented by engine/game-engine.ts. */
export interface GameEngineApi {
  init(options: EngineInitOptions): Promise<void>;
  /** Starts rendering (scene visible behind the "click to begin" overlay). */
  startRendering(): void;
  /** Plays the wake-up intro (camera rise + light flicker). Resolves when finished or skipped. */
  playIntro(skip: () => boolean): Promise<void>;
  setSimulationPaused(paused: boolean): void;
  requestPointerLock(): void;
  releasePointerLock(): void;
  isPointerLocked(): boolean;
  applySettings(settings: GameSettings): void;

  applyAnomaly(def: AnomalyDefinition, instant: boolean): void;
  revertAnomaly(def: AnomalyDefinition): void;
  playDecoy(def: DecoyDefinition): void;
  setAttention(config: AttentionLevelConfig, escalating: boolean): void;
  /** Subtle environmental reaction to an incorrect report. */
  falseReportResponse(): void;
  /** Short reaction to a calming interaction. */
  reliefResponse(): void;

  propUnseenSeconds(propId: string): number;
  captureRoomState(roomId: RoomId): Record<string, PropStateSnapshot>;
  doorStates(): Record<string, DoorState>;
  consumeProp(propId: string): void;
  playerTransform(): { position: Vec3; yawDeg: number; pitchDeg: number; flashlight: boolean };

  /** Elevator becomes callable; interior dressing for the locked-in ending. */
  setElevatorAvailable(available: boolean): void;
  callElevator(ending: EndingDefinition): void;
  beginEnding(ending: EndingDefinition): void;

  exitSecurityView(): void;
  stats(): EngineStats;
  /** Development-only automation handle (exposed as window.__tfil in dev builds). */
  debug?(): Record<string, unknown>;
  dispose(): void;
}

export type GameEngineFactory = () => GameEngineApi;
