import {
  AbstractMesh,
  InstancedMesh,
  Mesh,
  Ray,
  SceneInstrumentation,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core';
import {
  AnomalyDefinition,
  AnomalyEffect,
  AttentionLevelConfig,
  DecoyDefinition,
  DoorState,
  EndingDefinition,
  GameSettings,
  PropStateSnapshot,
  RoomDefinition,
  RoomId,
  RunSnapshot,
  StageDefinition,
  Vec3,
  rectContains,
} from '../models';
import { EffectContext, EffectState, effectHandler } from './anomalies/effect-handlers';
import { EYE_HEIGHT, PlayerController } from './camera-controller';
import { CollisionWorld } from './collision-manager';
import type {
  EffectOwner,
  EngineAudio,
  EngineHost,
  EngineInitOptions,
  EngineStats,
  GameEngineApi,
} from './engine-api';
import { DESTINATIONS, DestinationScene } from './endings/destinations';
import { InputManager } from './input-manager';
import { LightingManager } from './lighting-manager';
import { MaterialLibrary } from './materials/material-library';
import { RenderManager } from './render-manager';
import { RoomCuller } from './room-culler';
import { SecurityCameraSystem } from './security-camera-system';
import { DoorSystem } from './world/door-system';
import { Elevator } from './world/elevator';
import { ObjectFactory } from './world/object-factory';
import { DEFAULT_LAYER } from './world/prop-kit';
import { PropInstance, PropRegistry } from './world/prop-registry';
import { RoomMeshRegistry, WorldBuilder } from './world/world-builder';

export { registeredEffectTypes } from './anomalies/effect-handlers';

export function createGameEngine(): GameEngineApi {
  return new GameEngine();
}

type Target = { kind: 'prop'; prop: PropInstance; distance: number } | { kind: 'door'; id: string; distance: number };

interface ActiveEffects {
  readonly owner: EffectOwner;
  readonly effects: readonly AnomalyEffect[];
  readonly states: EffectState[];
  expiresAt: number | null;
  readonly revertOnExpire: boolean;
}

interface EndingRun {
  readonly ending: EndingDefinition;
  phase: 'waiting' | 'closing' | 'ride' | 'arrive' | 'reveal' | 'fade' | 'done';
  t: number;
  destination: DestinationScene | null;
}

const INTERACT_RANGE = 2.4;
const GAZE_RANGE = 9;
const GAZE_DWELL = 1.0;
const DEFAULT_VERBS: Record<string, string> = {
  inspect: 'Inspect',
  terminal: 'Use',
  'security-console': 'Watch',
  'elevator-call': 'Press',
  'elevator-panel': 'Use',
  pickup: 'Take',
  relief: 'Use',
  hazard: 'Use',
};
const AMBIENT_EVENTS = ['distant-footsteps', 'distant-door', 'knock'];
const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

class GameEngine implements GameEngineApi {
  private render!: RenderManager;
  private input!: InputManager;
  private player!: PlayerController;
  private collisions!: CollisionWorld;
  private lib!: MaterialLibrary;
  private roomMeshes!: RoomMeshRegistry;
  private world!: WorldBuilder;
  private factory!: ObjectFactory;
  private props!: PropRegistry;
  private doors!: DoorSystem;
  private elevator!: Elevator;
  private lighting!: LightingManager;
  private security!: SecurityCameraSystem;
  private host!: EngineHost;
  private audio!: EngineAudio;
  private stage!: StageDefinition;
  private instrumentation: SceneInstrumentation | null = null;
  private shadows: ShadowGenerator | null = null;
  private effectCtx!: EffectContext;
  private culler: RoomCuller | null = null;

  private simPaused = true;
  private disposed = false;
  private time = 0;
  private roomId: RoomId | null = null;
  private roomEnteredAt = 0;
  private readonly active = new Map<string, ActiveEffects>();
  private decoyCounter = 0;
  private readonly silenced = new Set<string>();
  private target: Target | null = null;
  private gaze: { id: string | null; t: number; last: Map<string, number> } = { id: null, t: 0, last: new Map() };
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), GAZE_RANGE);
  private ambientTimer = 20;
  private attention: AttentionLevelConfig | null = null;
  private escalating = false;
  private shadowAccum = 0;
  private cameraOnlyMeshes: AbstractMesh[] = [];

  private intro: { t: number; resolve: () => void; skip: () => boolean } | null = null;
  private secView: { index: number; t: number; from: { p: Vector3; r: Vector3 }; exiting: boolean } | null = null;
  private elevatorState: { arrivingT: number; floor: number; insideT: number; entered: boolean } | null = null;
  private endingRun: EndingRun | null = null;

  /* ============================================================================ init */

  async init(options: EngineInitOptions): Promise<void> {
    const { canvas, host, restore, onProgress } = options;
    this.host = host;
    this.audio = options.audio;
    this.stage = host.stage;
    const settings = host.settings();
    const t0 = performance.now();
    const mark = (label: string) => devMode() && console.debug(`[engine] ${label}: ${Math.round(performance.now() - t0)} ms`);

    onProgress({ progress: 0.02, message: 'Switching on the building' });
    this.render = new RenderManager(canvas);
    const scene = this.render.scene;
    this.collisions = new CollisionWorld();
    this.input = new InputManager(canvas);
    this.player = new PlayerController(scene, this.collisions, this.input);
    this.render.attachCamera(this.player.camera);
    this.lib = new MaterialLibrary(scene, settings.graphicsQuality);
    this.roomMeshes = new RoomMeshRegistry();

    // Surfaces are generated pixel by pixel - in parallel workers when available.
    const surfaces = [...new Set(this.stage.rooms.flatMap((r) => [r.surfaces.floor, r.surfaces.walls, r.surfaces.ceiling]))];
    let done = 0;
    onProgress({ progress: 0.05, message: 'Laying carpet, painting walls' });
    await Promise.all(
      surfaces.map(async (id) => {
        if (!options.workers) await yieldFrame();
        await this.lib.prepareSurface(id, options.workers);
        onProgress({ progress: 0.05 + (++done / surfaces.length) * 0.35, message: 'Laying carpet, painting walls' });
      }),
    );
    if (this.disposed) return;

    mark('surfaces generated');
    onProgress({ progress: 0.42, message: 'Raising walls' });
    this.world = new WorldBuilder(scene, this.lib, this.stage, this.collisions, this.roomMeshes);
    this.world.buildAll();
    await yieldFrame();

    this.factory = new ObjectFactory(scene, this.lib, this.stage, {
      registerRoomMesh: (roomId, mesh) => this.roomMeshes.add(roomId, mesh),
    });
    this.props = new PropRegistry(scene, this.collisions);
    const total = this.stage.rooms.reduce((n, r) => n + r.props.length, 0);
    let built = 0;
    for (const room of this.stage.rooms) {
      for (const placement of room.props) {
        const prop = this.factory.build(placement, room);
        this.props.add(placement, room, prop);
        if (placement.cameraOnly) this.cameraOnlyMeshes.push(...prop.meshes);
        built++;
        if (built % 12 === 0) {
          onProgress({ progress: 0.45 + (built / total) * 0.3, message: 'Furnishing the floor' });
          await yieldFrame();
          if (this.disposed) return;
        }
      }
    }

    mark('props built');
    onProgress({ progress: 0.78, message: 'Hanging doors' });
    this.doors = new DoorSystem(scene, this.lib, this.stage, this.collisions, this.roomMeshes, this.props, this.factory);
    this.doors.buildAll();
    this.elevator = new Elevator(scene, this.lib, this.stage, this.collisions, this.roomMeshes);
    this.props.setText(this.stage.elevator.indicatorPropId, '--');

    onProgress({ progress: 0.82, message: 'Wiring the lights' });
    this.lighting = new LightingManager(scene, this.stage, this.world, this.roomMeshes, this.player.camera);
    this.lighting.build();
    this.security = new SecurityCameraSystem(
      scene,
      this.lib,
      this.stage,
      this.roomMeshes,
      this.props.get('sec-desk'),
      settings.graphicsQuality,
      () => this.clockLabel(),
      () => this.cameraOnlyMeshes,
    );
    this.security.onPerceive = (owner) => this.host.perceive({ owner, mode: 'feed' });
    this.watchAnomalyTargets();
    this.culler = new RoomCuller(this.stage, this.roomMeshes, this.doors);
    this.freezeStaticGeometry();
    this.createEffectContext();
    this.wireInput();

    // Spawn / restore
    if (restore) this.restore(restore);
    else {
      const s = this.stage.spawn;
      this.player.teleport(s.position[0], s.position[2], s.yawDeg, s.pitchDeg);
    }
    this.updateRoom(true);
    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;

    mark('systems wired');
    onProgress({ progress: 0.9, message: 'Warming up the fluorescent tubes' });
    scene.onBeforeRenderObservable.add(() => this.frame());
    await scene.whenReadyAsync();
    mark('shaders ready');
    onProgress({ progress: 1, message: 'Ready' });
  }

  /** Static architecture never moves: skip per-frame world matrix work. */
  private freezeStaticGeometry(): void {
    for (const mesh of this.render.scene.meshes) {
      const meta = mesh.metadata as { kind?: string; id?: string } | null;
      if (meta?.kind !== 'structure' || meta.id === 'elevator-door') continue;
      let node = mesh.parent;
      let movable = false;
      while (node) {
        if (node.name.startsWith('ceiling-node')) movable = true;
        node = node.parent;
      }
      if (movable) continue;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
    }
  }

  private watchAnomalyTargets(): void {
    const ids = new Set<string>();
    for (const room of this.stage.rooms) for (const p of room.props) if (p.interaction) ids.add(p.id);
    for (const id of ids) this.props.watchProp(id);
  }

  private restore(r: RunSnapshot): void {
    this.player.teleport(r.player.position[0], r.player.position[2], r.player.yawDeg, r.player.pitchDeg);
    for (const [id, state] of Object.entries(r.doors)) this.doors.setState(id, state, { instant: true });
    if (r.player.flashlight) this.lighting.setFlashlight(true);
    const flags = new Set(r.progression.flags);
    for (const room of this.stage.rooms) {
      for (const p of room.props) {
        if (p.interaction?.kind === 'pickup' && p.interaction.consumed && p.interaction.flag && flags.has(p.interaction.flag)) {
          this.props.consume(p.id);
        }
      }
    }
  }

  private createEffectContext(): void {
    const engine = this;
    const diff = this.host.difficulty;
    this.effectCtx = {
      props: this.props,
      doors: this.doors,
      lighting: this.lighting,
      audio: this.audio,
      host: this.host,
      player: this.player,
      subtlety: diff.anomalies.subtlety,
      audioClueVolume: diff.clues.audioClueVolume,
      hearingMultiplier: diff.clues.hearingRadius,
      playerRoomId: () => engine.roomId,
      setRoomSilenced: (roomId, silenced) => {
        if (silenced) engine.silenced.add(roomId);
        else engine.silenced.delete(roomId);
        engine.refreshAmbience();
      },
      setFeedEffect: (cameraId, effect, owner) => engine.security.setFeedEffect(cameraId, effect, owner),
      emitSound: (soundId, position, volume, radius, owner) => engine.emitSound(soundId, position, volume, radius, owner),
      announce: (text, position, owner) => engine.announce(text, position, owner),
    };
  }

  private wireInput(): void {
    this.input.onLockChange = (locked, intentional) => {
      this.host.pointerLockChanged(locked);
      if (!locked && !intentional && !this.simPaused && !this.endingRun) this.host.requestPause();
    };
    this.input.onKey = (code) => this.onKey(code);
    this.player.onStep = (e) => {
      const room = this.stage.rooms.find((r) => r.id === this.roomId);
      const hard = room?.ambience.floorSound === 'hard';
      this.audio.play(hard ? 'step-hard' : 'step-carpet', { volume: e.sprinting ? 1.25 : 0.85 });
    };
    this.player.onSprintChange = (active) => this.host.emit({ type: 'sprint', active });
  }

  /* ============================================================================ API */

  startRendering(): void {
    const engine = this.render.engine;
    engine.runRenderLoop(() => {
      if (!this.disposed) this.render.scene.render();
    });
  }

  playIntro(skip: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const spawnRoom = this.roomId ?? '';
      this.lighting.setRoomPower(spawnRoom, 0);
      this.render.setFade(1);
      this.player.setEyeOffset(-0.55);
      this.player.setPitch(28);
      this.intro = { t: 0, resolve, skip };
    });
  }

  private updateIntro(dt: number): void {
    const intro = this.intro;
    if (!intro) return;
    intro.t += dt;
    const t = intro.t;
    const room = this.roomId ?? '';
    if (t > 0.8 && t - dt <= 0.8) {
      this.audio.play('light-on');
      this.refreshAmbience();
    }
    if (t > 0.8 && t < 2.6) this.lighting.setRoomPower(room, Math.random() < 0.25 + (t - 0.8) * 0.4 ? 1 : 0.05);
    if (t >= 2.6) this.lighting.setRoomPower(room, 1);
    this.render.setFade(t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 1.6));
    const rise = Math.max(0, Math.min(1, (t - 2.8) / 2.6));
    const e = rise * rise * (3 - 2 * rise);
    this.player.setEyeOffset(-0.55 * (1 - e));
    this.player.setPitch(28 - 22 * e);
    this.player.update(0, this.host.settings());
    if (t > 6.2 || intro.skip()) this.finishIntro();
  }

  private finishIntro(): void {
    const intro = this.intro;
    if (!intro) return;
    this.intro = null;
    this.lighting.setRoomPower(this.roomId ?? '', 1);
    this.render.setFade(0);
    this.player.setEyeOffset(0);
    this.player.setPitch(6);
    this.refreshAmbience();
    intro.resolve();
  }

  setSimulationPaused(paused: boolean): void {
    this.simPaused = paused;
    if (paused) return;
    if (this.pendingInitialEnter) {
      this.host.emit({ type: 'room-enter', roomId: this.pendingInitialEnter, previousRoomId: null });
      this.pendingInitialEnter = null;
    }
    this.refreshAmbience();
  }

  requestPointerLock(): void {
    this.input.requestLock();
  }

  releasePointerLock(): void {
    this.input.releaseLock();
  }

  isPointerLocked(): boolean {
    return this.input.isLocked;
  }

  applySettings(settings: GameSettings): void {
    this.render.applySettings(settings);
    this.player.applySettings(settings);
    this.configureShadows(settings);
  }

  private configureShadows(settings: GameSettings): void {
    const want = settings.graphicsQuality === 'high';
    if (want && !this.shadows) {
      const gen = new ShadowGenerator(1024, this.lighting.flashlight);
      if (this.render.webGL2) {
        gen.usePercentageCloserFiltering = true;
        gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      } else {
        gen.usePoissonSampling = true;
      }
      gen.bias = 0.0008;
      gen.normalBias = 0.02;
      gen.transparencyShadow = false;
      this.shadows = gen;
    } else if (!want && this.shadows) {
      this.shadows.dispose();
      this.shadows = null;
    }
  }

  private updateShadowCasters(): void {
    if (!this.shadows) return;
    const map0 = this.shadows.getShadowMap();
    if (!this.lighting.isFlashlightOn()) {
      if (map0) map0.renderList = [];
      return;
    }
    const p = this.player.position;
    const list: AbstractMesh[] = [];
    for (const prop of this.props.all()) {
      if (!prop.visible || prop.placement.cameraOnly) continue;
      const pos = prop.built.root.position;
      if (Math.abs(pos.x - p.x) > 9 || Math.abs(pos.z - p.z) > 9) continue;
      for (const m of prop.built.meshes) if (m instanceof Mesh || m instanceof InstancedMesh) list.push(m);
    }
    const map = this.shadows.getShadowMap();
    if (map) map.renderList = list;
  }

  applyAnomaly(def: AnomalyDefinition, instant: boolean): void {
    const key = `anomaly:${def.id}`;
    if (this.active.has(key)) return;
    const owner: EffectOwner = { kind: 'anomaly', id: def.id };
    const states = def.effects.map(() => ({ timer: 0, data: {} as Record<string, unknown> }));
    def.effects.forEach((e, i) => effectHandler(e.type)?.apply(this.effectCtx, e, owner, instant, states[i]));
    this.active.set(key, { owner, effects: def.effects, states, expiresAt: null, revertOnExpire: false });
    for (const e of def.effects) {
      if (e.type === 'show-prop') {
        const prop = this.props.get(e.propId);
        if (prop?.placement.cameraOnly) this.security.setOwnerForRoom(prop.room.id, owner);
      }
    }
  }

  revertAnomaly(def: AnomalyDefinition): void {
    const key = `anomaly:${def.id}`;
    const entry = this.active.get(key);
    if (!entry) return;
    entry.effects.forEach((e, i) => effectHandler(e.type)?.revert(this.effectCtx, e, entry.owner, entry.states[i]));
    this.active.delete(key);
    for (const e of def.effects) {
      if (e.type === 'show-prop') {
        const prop = this.props.get(e.propId);
        if (prop?.placement.cameraOnly) this.security.setOwnerForRoom(prop.room.id, null);
      }
    }
  }

  playDecoy(def: DecoyDefinition): void {
    const key = `decoy:${def.id}:${++this.decoyCounter}`;
    const owner: EffectOwner = { kind: 'decoy', id: def.id };
    const states = def.effects.map(() => ({ timer: 0, data: {} as Record<string, unknown> }));
    def.effects.forEach((e, i) => effectHandler(e.type)?.apply(this.effectCtx, e, owner, false, states[i]));
    this.active.set(key, { owner, effects: def.effects, states, expiresAt: this.time + (def.durationSec ?? 8), revertOnExpire: !!def.durationSec });
  }

  setAttention(config: AttentionLevelConfig, escalating: boolean): void {
    const startedEscalation = escalating && !this.escalating;
    this.attention = config;
    this.escalating = escalating;
    this.lighting.setAttention(config, escalating);
    this.render.setAttention(config, escalating);
    this.security.setInterference(escalating ? 1 : config.feedInterference);
    const drone = escalating ? 1 : config.droneVolume;
    if (drone > 0) this.audio.startLoop('drone', 'attention-drone', { volume: drone, fadeMs: 3000 });
    else this.audio.stopLoop('drone', 3000);
    if (escalating) this.audio.startLoop('heartbeat', 'heartbeat', { volume: 1, fadeMs: 2000 });
    else this.audio.stopLoop('heartbeat', 2000);
    if (startedEscalation) this.escalationBurst();
  }

  /** CRITICAL: a burst of hostility - lights die around the player, nearby doors slam. */
  private escalationBurst(): void {
    this.audio.play('low-boom');
    const neighbours = this.neighbours();
    for (const r of [this.roomId ?? '', ...neighbours]) this.lighting.stutterRoom(r, 2.5);
    const p = this.player.position;
    let delay = 600;
    for (const door of this.doors.all()) {
      if (door.state !== 'open') continue;
      const d = Math.hypot(door.position[0] - p.x, door.position[2] - p.z);
      if (d < 2.2 || d > 16) continue;
      setTimeout(() => {
        if (this.disposed) return;
        this.doors.setState(door.def.id, 'closed', { slam: true });
        this.audio.play('door-slam', { position: door.position });
      }, delay);
      delay += 450 + Math.random() * 500;
    }
  }

  falseReportResponse(): void {
    this.lighting.stutterRoom(this.roomId ?? '', 0.9);
    this.audio.play('thud', { volume: 0.8 });
    setTimeout(() => {
      if (!this.disposed) this.audio.play('distant-door', { position: this.randomNearby(12, 18) });
    }, 2200);
  }

  reliefResponse(): void {
    // The building exhales: lights steady for a moment.
    for (const r of [this.roomId ?? '']) this.lighting.setRoomPower(r, 1);
  }

  propUnseenSeconds(propId: string): number {
    return this.props.unseenSeconds(propId);
  }

  captureRoomState(roomId: RoomId): Record<string, PropStateSnapshot> {
    return this.props.capture(roomId);
  }

  doorStates(): Record<string, DoorState> {
    return this.doors.states();
  }

  consumeProp(propId: string): void {
    this.props.consume(propId);
  }

  playerTransform(): { position: Vec3; yawDeg: number; pitchDeg: number; flashlight: boolean } {
    const p = this.player.position;
    return { position: [p.x, 0, p.z], yawDeg: this.player.yawDeg, pitchDeg: this.player.pitchDeg, flashlight: this.lighting.isFlashlightOn() };
  }

  setElevatorAvailable(available: boolean): void {
    if (!available) return;
    if (this.elevator.phase === 'locked') {
      this.elevator.setPhase('idle');
      this.props.setText(this.stage.elevator.indicatorPropId, '1');
    }
  }

  callElevator(ending: EndingDefinition): void {
    if (this.elevatorState) return;
    this.elevator.setInterior(ending.sequence.interior);
    this.elevator.setPhase('arriving');
    this.elevatorState = { arrivingT: 0, floor: 1, insideT: 0, entered: false };
    const button = this.props.get(this.stage.elevator.callPanelPropId)?.built.parts.get('button-up');
    if (button instanceof Mesh) button.material = this.lib.get('emissive-amber');
    this.audio.startLoop('elevator-motor', 'elevator-motor', { volume: 0.7, fadeMs: 800, position: this.carPosition() });
  }

  beginEnding(ending: EndingDefinition): void {
    if (this.endingRun) return;
    this.endingRun = { ending, phase: 'waiting', t: 0, destination: null };
    const g = this.props.get(this.stage.elevator.carPanelPropId)?.built.parts.get('button-g');
    if (g instanceof Mesh) g.material = this.lib.get('emissive-amber');
  }

  exitSecurityView(): void {
    if (!this.secView) return;
    this.secView = null;
    this.security.viewing = false;
    this.player.lookEnabled = true;
    this.player.movementEnabled = true;
    this.player.update(0, this.host.settings());
    this.host.securityViewChanged(null);
  }

  stats(): EngineStats {
    const scene = this.render.scene;
    return {
      fps: Math.round(this.render.engine.getFps()),
      drawCalls: this.instrumentation?.drawCallsCounter.current ?? 0,
      activeMeshes: scene.getActiveMeshes().length,
      totalMeshes: scene.meshes.length,
      lights: scene.lights.length,
      frameMs: Math.round((this.instrumentation?.frameTimeCounter.lastSecAverage ?? 0) * 10) / 10,
    };
  }

  debug(): Record<string, unknown> {
    return {
      lock: (on = true) => {
        this.input.simulateLock(on);
        this.host.pointerLockChanged(on);
      },
      teleport: (x: number, z: number, yaw = this.player.yawDeg, pitch = 0) => this.player.teleport(x, z, yaw, pitch),
      look: (yaw: number, pitch = 0) => {
        const p = this.player.position;
        this.player.teleport(p.x, p.z, yaw, pitch);
      },
      press: (code: string) => this.input.simulatePress(code),
      /** Renders n frames synchronously (background tabs throttle requestAnimationFrame). */
      step: (n = 10) => {
        for (let i = 0; i < n; i++) this.render.scene.render();
      },
      hold: (code: string, ms: number) => this.input.simulateHold(code, ms),
      mouse: (dx: number, dy: number) => this.input.simulateMouse(dx, dy),
      state: () => {
        const p = this.player.position;
        return {
          room: this.roomId,
          x: +p.x.toFixed(2),
          z: +p.z.toFixed(2),
          yaw: Math.round(this.player.yawDeg),
          target: this.target ? (this.target.kind === 'prop' ? this.target.prop.id : 'door:' + this.target.id) : null,
          distance: this.target ? +this.target.distance.toFixed(2) : null,
          active: [...this.active.keys()],
          elevator: this.elevator.phase,
          visibleRooms: this.culler?.current ?? [],
        };
      },
      stats: () => this.stats(),
      scene: this.render.scene,
      props: this.props,
      doors: this.doors,
      lighting: this.lighting,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.render?.engine.stopRenderLoop();
      this.input?.dispose();
      this.endingRun?.destination?.dispose();
      this.audio?.stopLoop('elevator-motor', 0);
      this.instrumentation?.dispose();
      this.shadows?.dispose();
      this.culler?.dispose();
      this.security?.dispose();
      this.lighting?.dispose();
      this.elevator?.dispose();
      this.doors?.dispose();
      this.props?.dispose();
      this.factory?.dispose();
      this.lib?.dispose();
      this.render?.dispose();
    } catch (err) {
      console.warn('[engine] dispose error', err);
    }
  }

  /* ============================================================================ frame */

  private frame(): void {
    if (this.disposed) return;
    const dt = Math.min(this.render.engine.getDeltaTime() / 1000, 0.1);
    this.time += dt;
    const settings = this.host.settings();
    const playing = !this.simPaused && !this.intro;
    this.input.enabled = playing && this.input.isLocked;

    if (this.intro) this.updateIntro(dt);

    if (playing) {
      if (this.secView) this.updateSecurityView(dt);
      else this.player.update(dt, settings);
      this.updateRoom(false);
      this.handleKeysInWorld();
      this.updateInteraction(dt);
    }
    this.doors.update(dt);
    this.elevator.update(dt);
    this.updateElevator(dt);
    this.updateEnding(dt);
    this.props.update(dt, this.time);
    this.updateClocks();
    this.updateFakeDoors(dt);
    if (playing) {
      this.updateEffects(dt);
      this.props.updateVisibility(dt, this.player.camera);
      this.updateAmbientEvents(dt);
    }
    this.culler?.update(this.roomId);
    this.lighting.update(dt, this.roomId, this.neighbours());
    if (this.escalating && this.lighting.isFlashlightOn()) this.lighting.setFlashlightIntensity(Math.random() < 0.08 ? 0.15 : 1);

    const nearSecurity = this.roomId === 'security' || !!this.secView;
    this.security.setActive(nearSecurity);
    const p = this.player.position;
    this.security.recordPlayer(dt, p.x, p.z, (this.player.yawDeg * Math.PI) / 180);
    this.security.update(dt);

    const f = this.player.forward();
    this.audio.setListener([p.x, p.y, p.z], [f.x, f.y, f.z]);

    this.shadowAccum += dt;
    if (this.shadowAccum > 0.5) {
      this.shadowAccum = 0;
      this.updateShadowCasters();
    }

    if (playing && !this.endingRun) {
      const room = this.stage.rooms.find((r) => r.id === this.roomId);
      const dark = !!room && (room.ambience.darkness >= 0.5 || this.lighting.roomBrightness(room.id) < 0.35);
      this.host.simulate({
        dt,
        roomId: this.roomId,
        position: [p.x, 0, p.z],
        speed: this.player.speed,
        sprinting: this.player.sprinting,
        yawDeltaDeg: this.player.yawDeltaDeg,
        inDarkArea: dark,
        flashlightOn: this.lighting.isFlashlightOn(),
      });
    }
    this.input.endFrame();
  }

  private onKey(code: string): void {
    if (this.simPaused || this.intro || this.endingRun) return;
    if (code === 'Tab' && !this.secView) this.host.toggleNotebook();
  }

  private handleKeysInWorld(): void {
    if (this.endingRun) return;
    if (this.secView) {
      if (this.input.wasPressed('KeyA') || this.input.wasPressed('ArrowLeft')) this.focusFeed(this.secView.index - 1);
      if (this.input.wasPressed('KeyD') || this.input.wasPressed('ArrowRight')) this.focusFeed(this.secView.index + 1);
      if (this.input.wasPressed('KeyE') || this.input.wasPressed('KeyQ') || this.input.wasPressed('Backspace')) this.exitSecurityView();
      return;
    }
    if (this.input.wasPressed('KeyF')) {
      const on = !this.lighting.isFlashlightOn();
      this.lighting.setFlashlight(on);
      this.audio.play('flashlight-click');
      this.host.emit({ type: 'flashlight', on });
    }
    if (this.input.wasPressed('KeyE') && this.target && this.target.distance <= INTERACT_RANGE) this.activate(this.target);
  }

  /* ============================================================================ rooms */

  private roomAt(x: number, z: number): RoomDefinition | undefined {
    const inside = (r: RoomDefinition, m: number) => rectContains(r.bounds, x, z, m) || (r.extraBounds ?? []).some((b) => rectContains(b, x, z, m));
    const current = this.stage.rooms.find((r) => r.id === this.roomId);
    if (current && inside(current, 0.05)) return current;
    return this.stage.rooms.find((r) => inside(r, -0.15)) ?? current;
  }

  private updateRoom(initial: boolean): void {
    const p = this.player.position;
    const room = this.roomAt(p.x, p.z);
    if (!room || room.id === this.roomId) return;
    const previous = this.roomId;
    if (previous && !initial) this.host.emit({ type: 'room-exit', roomId: previous, durationSec: this.time - this.roomEnteredAt });
    this.roomId = room.id;
    this.roomEnteredAt = this.time;
    if (initial) this.pendingInitialEnter = room.id;
    else this.host.emit({ type: 'room-enter', roomId: room.id, previousRoomId: previous });
    this.refreshAmbience();
  }

  private pendingInitialEnter: string | null = null;

  private neighbours(): string[] {
    if (!this.roomId) return [];
    const out: string[] = [];
    for (const d of this.stage.doors) {
      if (d.rooms[0] === this.roomId) out.push(d.rooms[1]);
      else if (d.rooms[1] === this.roomId) out.push(d.rooms[0]);
    }
    return out;
  }

  /* ============================================================================ interaction */

  private updateInteraction(dt: number): void {
    if (this.secView || this.endingRun) {
      this.setTarget(null);
      return;
    }
    const cam = this.player.camera;
    this.ray.origin.copyFrom(cam.globalPosition);
    this.ray.direction.copyFrom(this.player.forward());
    this.ray.length = GAZE_RANGE;
    const hit = this.render.scene.pickWithRay(this.ray, (m) => m.isPickable && m.isEnabled() && m.isVisible && (m.layerMask & DEFAULT_LAYER) !== 0 && !!m.metadata);
    let target: Target | null = null;
    if (hit?.hit && hit.pickedMesh) {
      const meta = hit.pickedMesh.metadata as { kind?: string; id?: string };
      if (meta.kind === 'prop' && meta.id) {
        const prop = this.props.get(meta.id);
        if (prop && prop.placement.interaction && prop.visible && !prop.consumed) target = { kind: 'prop', prop, distance: hit.distance };
      } else if (meta.kind === 'door' && meta.id) {
        target = { kind: 'door', id: meta.id, distance: hit.distance };
      }
    }
    this.setTarget(target);

    // Gaze dwell -> object-gaze events (looking at specific objects)
    const gazeId = target ? (target.kind === 'prop' ? target.prop.id : `door-${target.id}`) : null;
    if (gazeId !== this.gaze.id) {
      this.gaze.id = gazeId;
      this.gaze.t = 0;
    } else if (gazeId) {
      this.gaze.t += dt;
      const last = this.gaze.last.get(gazeId) ?? -999;
      if (this.gaze.t >= GAZE_DWELL && this.time - last > 8) {
        this.gaze.last.set(gazeId, this.time);
        this.host.emit({ type: 'object-gaze', propId: gazeId, roomId: this.roomId });
      }
    }
  }

  private setTarget(target: Target | null): void {
    this.target = target;
    if (!target || target.distance > INTERACT_RANGE) {
      this.host.setPrompt(null);
      return;
    }
    if (target.kind === 'door') {
      const door = this.doors.get(target.id);
      if (!door) return;
      const verb = door.state === 'open' ? 'Close' : door.state === 'locked' ? 'Try' : 'Open';
      this.host.setPrompt({ key: 'E', verb, target: door.def.sign ? `${titleCase(door.def.sign)} door` : 'Door' });
      return;
    }
    const def = target.prop.placement.interaction!;
    let verb = def.verb ?? DEFAULT_VERBS[def.kind] ?? 'Use';
    const fake = target.prop.built.fakeDoor;
    if (fake) verb = target.prop.fakeDoorOpen ? 'Inspect' : this.fakeDoorUnlocked(target.prop) ? 'Open' : 'Try';
    verb = this.host.promptVerb?.(target.prop.id, def.kind) ?? verb;
    this.host.setPrompt({ key: 'E', verb, target: def.name });
  }

  private fakeDoorUnlocked(prop: PropInstance): boolean {
    return prop.variant === 'sealed' || prop.variant.endsWith('unlocked');
  }

  private activate(target: Target): void {
    if (target.kind === 'door') {
      const door = this.doors.get(target.id);
      if (!door) return;
      const result = this.doors.toggle(target.id);
      const glass = door.def.style === 'glass' || door.def.style === 'double-glass';
      if (result === 'locked-attempt') {
        this.audio.play('door-locked', { position: door.position });
        this.host.notify(door.def.lockedNote ?? 'Locked.');
      } else {
        this.audio.play(glass ? 'glass-door' : result === 'open' ? 'door-open' : 'door-close', { position: door.position });
      }
      this.host.emit({ type: 'door-interact', doorId: target.id, result });
      return;
    }
    const prop = target.prop;
    const def = prop.placement.interaction!;
    if (def.kind === 'security-console') {
      this.enterSecurityView();
      this.host.emit({ type: 'interaction', propId: prop.id, kind: def.kind });
      return;
    }
    if (prop.built.fakeDoor) {
      const p = prop.built.root.position;
      if (this.fakeDoorUnlocked(prop) && !prop.fakeDoorOpen) {
        prop.fakeDoorOpen = true;
        this.props.syncColliders(prop);
        this.audio.play('door-open', { position: [p.x, 1.2, p.z] });
      } else if (!this.fakeDoorUnlocked(prop)) {
        this.audio.play('door-locked', { position: [p.x, 1.2, p.z] });
      }
    }
    this.host.interact({ propId: prop.id, definition: def, roomId: prop.room.id });
  }

  private updateFakeDoors(dt: number): void {
    for (const prop of this.props.all()) {
      const fake = prop.built.fakeDoor;
      if (!fake) continue;
      const target = prop.fakeDoorOpen ? 1 : 0;
      if (prop.fakeDoorAnim === target) continue;
      prop.fakeDoorAnim = target > prop.fakeDoorAnim ? Math.min(1, prop.fakeDoorAnim + dt * 1.6) : Math.max(0, prop.fakeDoorAnim - dt * 1.6);
      const e = prop.fakeDoorAnim * prop.fakeDoorAnim * (3 - 2 * prop.fakeDoorAnim);
      fake.leaf.rotation.y = fake.openAngle * e;
    }
  }

  private updateClocks(): void {
    const minutes = this.host.shiftMinutes();
    const real = this.time;
    for (const prop of this.props.all()) {
      const clock = prop.built.clock;
      if (!clock || !prop.visible) continue;
      let h: number;
      let m: number;
      let s: number;
      switch (prop.clockMode) {
        case 'backward':
          h = -(minutes / 60) % 12;
          m = -(minutes % 60);
          s = -(real % 60);
          break;
        case 'frozen':
          h = (prop.clockFrozenMinutes / 60) % 12;
          m = prop.clockFrozenMinutes % 60;
          s = 0;
          break;
        case 'fast':
          prop.clockSpin += 0.016 * 40;
          h = (prop.clockSpin / 60) % 12;
          m = prop.clockSpin % 60;
          s = (prop.clockSpin * 10) % 60;
          break;
        default:
          h = (minutes / 60) % 12;
          m = minutes % 60;
          s = real % 60;
      }
      clock.hour.rotation.z = -(h / 12) * Math.PI * 2;
      clock.minute.rotation.z = -(m / 60) * Math.PI * 2;
      clock.second.rotation.z = -(Math.floor(s) / 60) * Math.PI * 2;
    }
  }

  /* ============================================================================ effects */

  private updateEffects(dt: number): void {
    for (const [key, entry] of this.active) {
      entry.effects.forEach((e, i) => effectHandler(e.type)?.update?.(this.effectCtx, e, entry.owner, dt, entry.states[i]));
      if (entry.expiresAt !== null && this.time >= entry.expiresAt) {
        if (entry.revertOnExpire) entry.effects.forEach((e, i) => effectHandler(e.type)?.revert(this.effectCtx, e, entry.owner, entry.states[i]));
        this.active.delete(key);
      }
    }
  }

  private emitSound(soundId: string, position: Vec3, volume: number, radius: number, owner: EffectOwner): void {
    this.audio.play(soundId, { position, volume });
    if (owner.kind === 'ambient') return;
    const p = this.player.position;
    const d = Math.hypot(position[0] - p.x, position[2] - p.z);
    if (d <= radius) this.host.perceive({ owner, mode: 'hearing' });
  }

  private announce(text: string, position: Vec3, owner: EffectOwner): void {
    this.audio.play('pa-chime');
    setTimeout(() => {
      if (this.disposed) return;
      const duration = this.audio.speak(text);
      this.host.showSubtitle(text, duration + 0.5);
      if (owner.kind !== 'ambient') this.host.perceive({ owner, mode: 'hearing' });
    }, 1500);
    void position;
  }

  /* ============================================================================ atmosphere */

  private refreshAmbience(): void {
    const room = this.stage.rooms.find((r) => r.id === this.roomId);
    if (!room) return;
    const silenced = this.silenced.has(room.id);
    const wanted = new Set(room.ambience.soundscape);
    for (const id of ['amb-hum', 'amb-fluorescent', 'amb-vent', 'amb-office', 'amb-room-tone', 'amb-fridge', 'amb-electronics']) {
      const key = `amb:${id}`;
      if (wanted.has(id)) this.audio.startLoop(key, id, { volume: silenced ? 0 : 1, fadeMs: silenced ? 250 : 1600 });
      else if (this.audio.hasLoop(key)) this.audio.stopLoop(key, 1600);
    }
    this.audio.setLoopVolume('music', silenced ? 0 : 1, silenced ? 300 : 2000);
    this.audio.setLoopVolume('drone', silenced ? 0 : this.escalating ? 1 : this.attention?.droneVolume ?? 0, 600);
  }

  private updateAmbientEvents(dt: number): void {
    const rate = this.escalating ? 6 : this.attention?.ambientEventsPerMin ?? 0.4;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = (60 / Math.max(rate, 0.05)) * (0.5 + Math.random());
    if (this.roomId && this.silenced.has(this.roomId)) return;
    const pool = this.attention && (this.attention.level === 'high' || this.attention.level === 'critical') ? [...AMBIENT_EVENTS, 'whisper'] : AMBIENT_EVENTS;
    const sound = pool[Math.floor(Math.random() * pool.length)];
    this.audio.play(sound, { position: this.randomNearby(sound === 'whisper' ? 3 : 9, sound === 'whisper' ? 5 : 17), volume: 0.8 });
  }

  private randomNearby(min: number, max: number): Vec3 {
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const r = min + Math.random() * (max - min);
    return [p.x + Math.cos(a) * r, 1.2, p.z + Math.sin(a) * r];
  }

  private clockLabel(): string {
    const m = this.host.shiftMinutes();
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  }

  /* ============================================================================ security view */

  private enterSecurityView(): void {
    if (this.secView || this.security.count === 0) return;
    const cam = this.player.camera;
    this.secView = { index: 0, t: 0, from: { p: cam.position.clone(), r: cam.rotation.clone() }, exiting: false };
    this.player.lookEnabled = false;
    this.player.movementEnabled = false;
    this.security.viewing = true;
    this.focusFeed(0);
    this.audio.play('static-burst', { volume: 0.6 });
  }

  private focusFeed(index: number): void {
    if (!this.secView) return;
    const count = this.security.count;
    const i = ((index % count) + count) % count;
    const cam = this.player.camera;
    this.secView.index = i;
    this.secView.t = 0;
    this.secView.from = { p: cam.position.clone(), r: cam.rotation.clone() };
    this.security.focus(i);
    this.audio.play('ui-hover', { volume: 0.8 });
    this.host.securityViewChanged({ index: i, count, label: this.security.feedLabel(i) });
  }

  private updateSecurityView(dt: number): void {
    const view = this.secView;
    if (!view) return;
    const screen = this.security.screenOf(view.index);
    if (!screen) return;
    view.t = Math.min(1, view.t + dt * 1.6);
    const e = view.t * view.t * (3 - 2 * view.t);
    const center = screen.getAbsolutePosition();
    const normal = Vector3.TransformNormal(new Vector3(0, 0, -1), screen.getWorldMatrix()).normalize();
    const targetPos = center.add(normal.scale(0.62));
    const dir = center.subtract(targetPos).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = -Math.asin(dir.y);
    const cam = this.player.camera;
    cam.position = Vector3.Lerp(view.from.p, targetPos, e);
    const fromYaw = view.from.r.y;
    let dy = yaw - fromYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    cam.rotation.set(view.from.r.x + (pitch - view.from.r.x) * e, fromYaw + dy * e, 0);
  }

  /* ============================================================================ elevator & endings */

  private carPosition(): Vec3 {
    const c = this.elevator.carCenter;
    return [c.x, 1.5, c.z];
  }

  private updateElevator(dt: number): void {
    const st = this.elevatorState;
    if (!st) return;
    const label = this.stage.elevator.floorLabel;
    const target = Number(label) || 14;
    if (this.elevator.phase === 'arriving') {
      st.arrivingT += dt;
      const floor = Math.min(target, 1 + Math.floor(st.arrivingT / 0.42));
      if (floor !== st.floor) {
        st.floor = floor;
        this.props.setText(this.stage.elevator.indicatorPropId, String(floor));
      }
      if (floor >= target && st.arrivingT > (target - 1) * 0.42 + 0.6) {
        this.audio.stopLoop('elevator-motor', 600);
        const door = this.elevator.doorPosition();
        this.audio.play('elevator-ding', { position: [door.x, door.y, door.z] });
        this.audio.play('elevator-doors', { position: this.carPosition() });
        this.elevator.setPhase('opening');
      }
    } else if (this.elevator.phase === 'opening' && this.elevator.doorsFullyOpen()) {
      this.elevator.setPhase('open');
    } else if (this.elevator.phase === 'open' && !this.endingRun) {
      const p = this.player.position;
      if (this.elevator.contains(p.x, p.z)) {
        st.insideT += dt;
        if (st.insideT > 1.2 && !st.entered) {
          st.entered = true;
          this.host.elevatorEntered();
        }
      } else {
        st.insideT = 0;
        st.entered = false;
      }
    }
  }

  private updateEnding(dt: number): void {
    const run = this.endingRun;
    if (!run) return;
    const seq = run.ending.sequence;
    run.t += dt;
    const shakeOn = this.host.settings().cameraShake;
    switch (run.phase) {
      case 'waiting': {
        // Let the player step fully inside before the doors close.
        const p = this.player.position;
        if (run.t >= seq.closeDelaySec && this.elevator.contains(p.x, p.z)) {
          this.player.movementEnabled = false;
          this.elevator.setPhase('closing');
          this.audio.play('elevator-doors', { position: this.carPosition() });
          run.phase = 'closing';
          run.t = 0;
        }
        break;
      }
      case 'closing':
        if (this.elevator.doorsFullyClosed() || run.t > 4) {
          this.elevator.setPhase('closed-inside');
          this.audio.startLoop('ride', seq.rideSound, { volume: 0.8, fadeMs: 800 });
          run.phase = 'ride';
          run.t = 0;
        }
        break;
      case 'ride': {
        const steps = seq.indicatorSequence;
        const idx = Math.min(steps.length - 1, Math.floor((run.t / seq.rideSec) * steps.length));
        this.props.setText(this.stage.elevator.indicatorPropId, steps[idx]);
        if (shakeOn) this.player.shake(seq.shake * (0.6 + 0.4 * Math.sin(run.t * 3)));
        if (seq.lightsFlicker) this.elevator.carLight.intensity = Math.random() < 0.08 ? 0.05 : 0.8;
        if (run.t >= seq.rideSec) {
          this.player.shake(0);
          this.elevator.carLight.intensity = 0.8;
          this.audio.stopLoop('ride', 900);
          if (seq.arrivalSound) this.audio.play(seq.arrivalSound);
          if (seq.destination !== 'none') this.buildDestination(run);
          run.phase = run.destination ? 'arrive' : 'fade';
          run.t = 0;
        }
        break;
      }
      case 'arrive':
        run.destination?.setDoors(Math.min(1, run.t / 2.2));
        if (run.t > 2.2) {
          this.player.movementEnabled = true;
          run.phase = 'reveal';
          run.t = 0;
        }
        break;
      case 'reveal':
        if (run.t >= seq.revealSec) {
          this.player.movementEnabled = false;
          run.phase = 'fade';
          run.t = 0;
        }
        break;
      case 'fade':
        this.render.setFade(run.t / seq.fadeSec);
        if (run.t >= seq.fadeSec) {
          run.phase = 'done';
          this.render.setFade(1);
          this.host.endingSequenceFinished(run.ending);
        }
        break;
      case 'done':
        break;
    }
  }

  private buildDestination(run: EndingRun): void {
    const id = run.ending.sequence.destination;
    if (id === 'none') return;
    const builder = DESTINATIONS[id];
    const car = this.stage.elevator.car;
    const dest = builder({
      scene: this.render.scene,
      lib: this.lib,
      collisions: this.collisions,
      carCenter: new Vector3((car.x0 + car.x1) / 2, 0, (car.z0 + car.z1) / 2),
      carSize: { x: car.x1 - car.x0, z: car.z1 - car.z0 },
      doorWidth: this.stage.elevator.width,
    });
    this.lighting.includeInFill(dest.meshes);
    if (this.shadows) dest.meshes.forEach((m) => (m.receiveShadows = true));
    run.destination = dest;
    const p = this.player.position;
    const c = this.elevator.carCenter;
    this.player.teleport(dest.carOrigin.x + (p.x - c.x), dest.carOrigin.z + (p.z - c.z), this.player.yawDeg, this.player.pitchDeg);
    this.player.boundsClamp = dest.clamp;
    this.render.scene.fogDensity = 0.05;
    this.audio.stopLoop('drone', 400);
    this.audio.startLoop('ending-tone', 'amb-room-tone', { volume: 0.9, fadeMs: 3000 });
    void EYE_HEIGHT;
  }
}

declare const ngDevMode: unknown;
/** Angular defines ngDevMode in development builds only. */
function devMode(): boolean {
  return typeof ngDevMode !== 'undefined' && !!ngDevMode;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
