import {
  AbstractMesh,
  Camera,
  Color3,
  DynamicTexture,
  HemisphericLight,
  PointLight,
  Scene,
  SpotLight,
  Vector3,
} from '@babylonjs/core';
import { AttentionLevelConfig, LightDefinition, LightTone, Rgb, RoomDefinition, StageDefinition } from '../models';
import { canvasTexture, drawFlashlightCookie } from './materials/procedural-textures';
import { FixtureMesh, RoomMeshRegistry, WorldBuilder } from './world/world-builder';

/** Global calibration: content intensities are authored relative to this. */
const LIGHT_GAIN = 1.45;
const RANGE_GAIN = 1.15;

const TONES: Record<LightTone, Rgb> = {
  cool: [0.8, 0.9, 1.0],
  neutral: [1.0, 0.96, 0.88],
  warm: [1.0, 0.84, 0.64],
  sickly: [0.84, 1.0, 0.7],
  emergency: [1.0, 0.18, 0.12],
};

interface ManagedLight {
  readonly def: LightDefinition;
  readonly room: RoomDefinition;
  readonly light: PointLight;
  readonly fixture?: FixtureMesh;
  readonly baseColor: Color3;
  readonly baseIntensity: number;
  readonly baseY: number;
  overrideColor: Color3 | null;
  overrideScale: number;
  pattern: { bits: string; step: number; t: number } | null;
  off: boolean;
  stutter: number;
  noise: number;
  brightness: number;
  power: number;
}

/**
 * Owns all scene lights. Each room's point lights only affect that room's meshes (keeps the
 * per-material light count bounded). Handles fluorescent flicker, anomaly colour/pattern
 * overrides, attention tint, intro power-up and the player's flashlight.
 */
export class LightingManager {
  private readonly lights = new Map<string, ManagedLight>();
  private readonly byRoom = new Map<string, ManagedLight[]>();
  readonly flashlight: SpotLight;
  private readonly fillNormal: HemisphericLight;
  private readonly fillDark: HemisphericLight;
  private readonly cookie: DynamicTexture;
  private attention: AttentionLevelConfig | null = null;
  private flashlightOn = false;
  private flashlightScale = 1;
  private readonly flashlightCamera: Camera;
  /** Hand-held offset in camera space (right, down, forward) and beam direction. */
  private readonly flashOffset = new Vector3(0.16, -0.14, 0.05);
  private readonly flashAim = new Vector3(-0.02, 0, 1);
  private escalating = false;
  private masterPower = 1;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly stage: StageDefinition,
    private readonly world: WorldBuilder,
    private readonly roomMeshes: RoomMeshRegistry,
    camera: Camera,
  ) {
    this.fillNormal = new HemisphericLight('fill', new Vector3(0.2, 1, 0.1), scene);
    this.fillNormal.intensity = 0.26;
    this.fillNormal.diffuse = new Color3(0.62, 0.64, 0.66);
    // Ground colour lights downward faces: stands in for light bouncing off floors onto ceilings.
    this.fillNormal.groundColor = new Color3(0.42, 0.4, 0.37);
    this.fillNormal.specular = Color3.Black();
    this.fillDark = new HemisphericLight('fill-dark', new Vector3(0.2, 1, 0.1), scene);
    this.fillDark.intensity = 0.045;
    this.fillDark.diffuse = new Color3(0.5, 0.55, 0.6);
    this.fillDark.groundColor = new Color3(0.12, 0.12, 0.12);
    this.fillDark.specular = Color3.Black();

    // NOT parented to the camera: Babylon only recomputes a spot light's projection-texture
    // matrix when the light's own position/direction setters run. A parented light keeps a
    // frozen cookie projection, so the beam only lit one fixed region. syncFlashlight() moves it
    // in world space every frame instead.
    this.flashlight = new SpotLight('flashlight', camera.position.clone(), new Vector3(0, 0, 1), 0.82, 1.6, scene);
    this.flashlightCamera = camera;
    this.flashlight.diffuse = new Color3(1, 0.95, 0.84);
    this.flashlight.specular = new Color3(0.5, 0.48, 0.42);
    // Always enabled: toggling a light's enabled state changes every material's shader defines
    // (recompile = a black frame). On/off is done through intensity instead.
    this.flashlight.intensity = 0;
    this.flashlight.range = 24;
    this.cookie = canvasTexture(scene, 'flashlight-cookie', 256, 256, drawFlashlightCookie);
    this.flashlight.projectionTexture = this.cookie;
  }

  build(): void {
    const dark: AbstractMesh[] = [];
    const normal: AbstractMesh[] = [];
    for (const room of this.stage.rooms) {
      const geometry = this.world.room(room.id);
      const targets = this.roomMeshes.lightTargets(room.id);
      (room.ambience.darkness >= 0.5 ? dark : normal).push(...targets);
      const list: ManagedLight[] = [];
      for (const def of room.lights) {
        const tone = TONES[def.tone];
        const light = new PointLight(`light-${def.id}`, new Vector3(def.position[0], def.position[1] - 0.2, def.position[2]), this.scene);
        light.diffuse = new Color3(tone[0], tone[1], tone[2]);
        light.specular = new Color3(tone[0] * 0.25, tone[1] * 0.25, tone[2] * 0.25);
        light.range = def.range * RANGE_GAIN;
        light.intensity = def.intensity * LIGHT_GAIN;
        light.includedOnlyMeshes = targets;
        if (geometry) light.parent = geometry.ceilingNode;
        const managed: ManagedLight = {
          def,
          room,
          light,
          fixture: geometry?.fixtures.get(def.id),
          baseColor: light.diffuse.clone(),
          baseIntensity: def.intensity * LIGHT_GAIN,
          baseY: def.position[1] - 0.2,
          overrideColor: null,
          overrideScale: 1,
          pattern: null,
          off: !!def.off,
          stutter: 0,
          noise: Math.random() * 100,
          brightness: 1,
          power: 1,
        };
        this.lights.set(def.id, managed);
        list.push(managed);
      }
      this.byRoom.set(room.id, list);
    }
    this.fillNormal.includedOnlyMeshes = normal;
    this.fillDark.includedOnlyMeshes = dark;
  }

  /** Adds meshes created after build() (e.g. ending scenes) to the global fill light. */
  includeInFill(meshes: AbstractMesh[]): void {
    this.fillNormal.includedOnlyMeshes = [...this.fillNormal.includedOnlyMeshes, ...meshes];
  }

  private select(roomId: string, ids?: readonly string[]): ManagedLight[] {
    const list = this.byRoom.get(roomId) ?? [];
    return ids && ids.length ? list.filter((l) => ids.includes(l.def.id)) : list;
  }

  setColor(roomId: string, ids: readonly string[] | undefined, color: Rgb | null, scale = 1): void {
    for (const l of this.select(roomId, ids)) {
      l.overrideColor = color ? new Color3(color[0], color[1], color[2]) : null;
      l.overrideScale = color ? scale : 1;
    }
  }

  setPattern(roomId: string, ids: readonly string[] | undefined, pattern: string | null, stepSec = 0.2): void {
    for (const l of this.select(roomId, ids)) l.pattern = pattern ? { bits: pattern, step: stepSec, t: 0 } : null;
  }

  stutterRoom(roomId: string, duration: number): void {
    for (const l of this.select(roomId)) l.stutter = Math.max(l.stutter, duration * (0.6 + Math.random() * 0.6));
  }

  stutterRandom(roomIds: readonly string[], duration: number): void {
    const candidates = roomIds.flatMap((r) => this.select(r));
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (pick) pick.stutter = Math.max(pick.stutter, duration);
  }

  /** Room power for the intro (0 = off, 1 = on). */
  setRoomPower(roomId: string, power: number): void {
    for (const l of this.select(roomId)) l.power = power;
  }

  setMasterPower(power: number): void {
    this.masterPower = power;
  }

  setCeilingOffset(roomId: string, delta: number): void {
    const geometry = this.world.room(roomId);
    if (geometry) geometry.ceilingNode.position.y = delta;
  }

  setAttention(config: AttentionLevelConfig, escalating: boolean): void {
    this.attention = config;
    this.escalating = escalating;
  }

  /** Relative light level of a room right now (0 = dark, 1 = as designed). */
  roomBrightness(roomId: string): number {
    const list = this.byRoom.get(roomId) ?? [];
    if (list.length === 0) return 0;
    return list.reduce((s, l) => s + l.brightness, 0) / list.length;
  }

  isFlashlightOn(): boolean {
    return this.flashlightOn;
  }

  setFlashlight(on: boolean): void {
    this.flashlightOn = on;
    this.flashlight.intensity = on ? 2.6 * this.flashlightScale : 0;
  }

  setFlashlightIntensity(scale: number): void {
    this.flashlightScale = scale;
    if (this.flashlightOn) this.flashlight.intensity = 2.6 * scale;
  }

  /**
   * Puts the flashlight in the player's hand in world space. Assigning through the position /
   * direction setters marks the projection (cookie) and shadow matrices dirty, so they follow
   * the view every frame.
   */
  syncFlashlight(): void {
    const world = this.flashlightCamera.getWorldMatrix();
    this.flashlight.position = Vector3.TransformCoordinates(this.flashOffset, world);
    this.flashlight.direction = Vector3.TransformNormal(this.flashAim, world).normalize();
  }

  update(dt: number, playerRoomId: string | null, neighbourRooms: readonly string[]): void {
    this.time += dt;
    this.syncFlashlight();
    const att = this.attention;
    const levelIntensity = att?.lightIntensity ?? 1;
    const tint = att?.lightTint ?? [1, 1, 1];
    const tintStrength = this.escalating ? 0.85 : att?.tintStrength ?? 0;
    const flickerChance = (att?.flickerChancePerSec ?? 0) * (this.escalating ? 3 : 1);
    if (flickerChance > 0 && playerRoomId && Math.random() < flickerChance * dt) {
      this.stutterRandom([playerRoomId, ...neighbourRooms], 0.25 + Math.random() * 0.8);
    }

    for (const l of this.lights.values()) {
      let factor = l.off ? 0 : 1;
      if (l.pattern) {
        l.pattern.t += dt;
        const idx = Math.floor(l.pattern.t / l.pattern.step) % l.pattern.bits.length;
        factor *= l.pattern.bits[idx] === '1' ? 1 : 0.04;
      }
      const constFlicker = l.def.flicker ?? 0;
      if (constFlicker > 0) {
        l.noise += dt * (8 + constFlicker * 30);
        const n = Math.sin(l.noise) * Math.sin(l.noise * 2.7 + 1.3) * Math.sin(l.noise * 0.37);
        if (n > 1 - constFlicker * 0.9) factor *= 0.15;
        factor *= 1 - constFlicker * 0.06 * (0.5 + 0.5 * Math.sin(l.noise * 13));
      }
      if (l.stutter > 0) {
        l.stutter -= dt;
        factor *= Math.random() < 0.55 ? 0.05 : 0.9;
      }
      factor *= l.power * this.masterPower;
      l.brightness = factor;
      const intensity = l.baseIntensity * factor * levelIntensity * l.overrideScale;
      l.light.intensity = intensity;
      const base = l.overrideColor ?? l.baseColor;
      const s = l.overrideColor ? 0 : tintStrength;
      const r = base.r + (tint[0] * base.r - base.r) * s;
      const g = base.g + (tint[1] * base.g - base.g) * s;
      const b = base.b + (tint[2] * base.b - base.b) * s;
      l.light.diffuse.set(r, g, b);
      if (l.fixture) {
        const e = Math.min(1.2, factor * levelIntensity * l.overrideScale);
        l.fixture.material.emissiveColor.set(r * e * 0.95, g * e * 0.95, b * e * 0.95);
      }
    }
    this.fillNormal.intensity = 0.26 * levelIntensity * this.masterPower;
    this.fillDark.intensity = 0.045 * this.masterPower;
  }

  dispose(): void {
    for (const l of this.lights.values()) l.light.dispose();
    this.lights.clear();
    this.byRoom.clear();
    this.flashlight.dispose();
    this.cookie.dispose();
    this.fillNormal.dispose();
    this.fillDark.dispose();
  }
}
