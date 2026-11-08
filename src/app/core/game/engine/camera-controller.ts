import { FreeCamera, Scene, Vector3 } from '@babylonjs/core';
import { GameSettings } from '../models';
import { CollisionWorld } from './collision-manager';
import { InputManager } from './input-manager';

export const EYE_HEIGHT = 1.65;
export const PLAYER_RADIUS = 0.3;
const WALK_SPEED = 2.35;
const SPRINT_SPEED = 4.3;
const ACCEL = 10;
const DECEL = 12;
const LOOK_SCALE = 0.0021;
const STEP_WALK = 0.74;
const STEP_SPRINT = 0.95;

export interface StepEvent {
  readonly sprinting: boolean;
  readonly position: Vector3;
}

/**
 * First-person controller: smooth acceleration/deceleration, sprint, mouse look with
 * sensitivity/invert, capsule (circle) collision against the CollisionWorld, head bob and
 * footstep cadence. Owns the player camera.
 */
export class PlayerController {
  readonly camera: FreeCamera;
  private x = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 0;
  private vx = 0;
  private vz = 0;
  private bob = 0;
  private stepDistance = 0;
  private eyeOffset = 0;
  private shakeAmount = 0;
  private shakeTime = 0;
  speed = 0;
  sprinting = false;
  movementEnabled = true;
  lookEnabled = true;
  yawDeltaDeg = 0;
  onStep: (e: StepEvent) => void = () => undefined;
  onSprintChange: (active: boolean) => void = () => undefined;
  /** Optional bounds clamp (used by ending scenes). */
  boundsClamp: ((x: number, z: number) => [number, number]) | null = null;

  constructor(
    scene: Scene,
    private readonly collisions: CollisionWorld,
    private readonly input: InputManager,
  ) {
    this.camera = new FreeCamera('player-camera', new Vector3(0, EYE_HEIGHT, 0), scene);
    this.camera.inputs.clear();
    // Babylon only re-derives the up vector when rotation.z changes, and bakes in the yaw/pitch
    // of that moment. Head-bob roll changes every frame while walking but sits at exactly 0
    // when standing, freezing a stale (tilted) up vector while the mouse keeps turning the view.
    // Recompute it from the full rotation every frame instead.
    this.camera.updateUpVectorFromRotation = true;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 140;
    this.camera.fov = (75 * Math.PI) / 180;
    this.camera.fovMode = FreeCamera.FOVMODE_VERTICAL_FIXED;
    scene.activeCamera = this.camera;
  }

  applySettings(settings: GameSettings): void {
    // Settings FOV is horizontal-ish; convert to a comfortable vertical FOV.
    const aspect = 16 / 9;
    const h = (settings.fieldOfView * Math.PI) / 180;
    this.camera.fov = 2 * Math.atan(Math.tan(h / 2) / aspect);
  }

  teleport(x: number, z: number, yawDeg: number, pitchDeg = 0): void {
    this.x = x;
    this.z = z;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.vx = 0;
    this.vz = 0;
    this.syncCamera(0, false);
  }

  setEyeOffset(offset: number): void {
    this.eyeOffset = offset;
  }

  setPitch(deg: number): void {
    this.pitch = (deg * Math.PI) / 180;
  }

  shake(amount: number): void {
    this.shakeAmount = amount;
  }

  get position(): Vector3 {
    return new Vector3(this.x, EYE_HEIGHT, this.z);
  }

  get yawDeg(): number {
    return (this.yaw * 180) / Math.PI;
  }

  get pitchDeg(): number {
    return (this.pitch * 180) / Math.PI;
  }

  forward(): Vector3 {
    return new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt: number, settings: GameSettings): void {
    const prevYaw = this.yaw;
    if (this.lookEnabled) {
      const { dx, dy } = this.input.takeMouse();
      const sens = LOOK_SCALE * settings.mouseSensitivity;
      this.yaw += dx * sens;
      this.pitch += dy * sens * (settings.invertMouse ? -1 : 1);
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    } else {
      this.input.takeMouse();
    }
    this.yawDeltaDeg = ((this.yaw - prevYaw) * 180) / Math.PI;

    let mx = 0;
    let mz = 0;
    if (this.movementEnabled) {
      if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) mz += 1;
      if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) mz -= 1;
      if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) mx -= 1;
      if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    const wantsSprint = this.movementEnabled && (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) && mz > 0;
    const sprinting = wantsSprint && len > 0;
    if (sprinting !== this.sprinting) {
      this.sprinting = sprinting;
      this.onSprintChange(sprinting);
    }
    const target = len > 0 ? (sprinting ? SPRINT_SPEED : WALK_SPEED) : 0;
    let tx = 0;
    let tz = 0;
    if (len > 0) {
      mx /= len;
      mz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      tx = (mz * sin + mx * cos) * target;
      tz = (mz * cos - mx * sin) * target;
    }
    const k = 1 - Math.exp(-(target > 0 ? ACCEL : DECEL) * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    if (Math.abs(this.vx) < 0.001) this.vx = 0;
    if (Math.abs(this.vz) < 0.001) this.vz = 0;

    const ox = this.x;
    const oz = this.z;
    [this.x, this.z] = this.collisions.move(this.x, this.z, this.vx * dt, this.vz * dt, PLAYER_RADIUS);
    if (this.boundsClamp) [this.x, this.z] = this.boundsClamp(this.x, this.z);
    const moved = Math.hypot(this.x - ox, this.z - oz);
    this.speed = dt > 0 ? moved / dt : 0;
    // Lose velocity into walls so sliding feels solid.
    if (dt > 0 && moved < Math.hypot(this.vx, this.vz) * dt * 0.5) {
      this.vx *= 0.6;
      this.vz *= 0.6;
    }

    this.stepDistance += moved;
    const stride = this.sprinting ? STEP_SPRINT : STEP_WALK;
    if (this.stepDistance >= stride && this.speed > 0.4) {
      this.stepDistance = 0;
      this.onStep({ sprinting: this.sprinting, position: this.position });
    }
    this.bob += moved * (Math.PI * 2) / (stride * 2);
    this.syncCamera(dt, settings.cameraShake);
  }

  private syncCamera(dt: number, shakeEnabled: boolean): void {
    const intensity = Math.min(this.speed / WALK_SPEED, 1.6);
    let y = EYE_HEIGHT + this.eyeOffset;
    let roll = 0;
    let ox = 0;
    let oz = 0;
    if (shakeEnabled) {
      y += Math.abs(Math.sin(this.bob)) * 0.045 * intensity - 0.02 * intensity;
      roll = Math.sin(this.bob) * 0.006 * intensity;
      if (this.shakeAmount > 0) {
        this.shakeTime += dt;
        const s = this.shakeAmount;
        ox = (Math.sin(this.shakeTime * 37) + Math.sin(this.shakeTime * 13.7)) * 0.008 * s;
        oz = Math.cos(this.shakeTime * 29) * 0.008 * s;
        y += Math.sin(this.shakeTime * 41) * 0.01 * s;
        roll += Math.sin(this.shakeTime * 23) * 0.004 * s;
      }
    }
    this.camera.position.set(this.x + ox, y, this.z + oz);
    this.camera.rotation.set(this.pitch, this.yaw, roll);
  }
}
