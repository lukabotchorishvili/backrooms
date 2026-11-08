import {
  AbstractMesh,
  Color3,
  DynamicTexture,
  FreeCamera,
  Frustum,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { AnomalyEffect, GraphicsQuality, SecurityCameraDefinition, StageDefinition, rectContains } from '../models';
import type { EffectOwner } from './engine-api';
import { MaterialLibrary } from './materials/material-library';
import { CAMERA_ONLY_LAYER, DEFAULT_LAYER } from './world/prop-kit';
import { PropInstance } from './world/prop-registry';
import { RoomMeshRegistry } from './world/world-builder';

type FeedEffect = Extract<AnomalyEffect, { type: 'security-feed' }>;

interface Feed {
  readonly def: SecurityCameraDefinition;
  readonly camera: FreeCamera;
  readonly rtt: RenderTargetTexture;
  readonly screen: Mesh;
  readonly overlay: DynamicTexture;
  readonly overlayMesh: Mesh;
  effect: FeedEffect | null;
  owner: EffectOwner | null;
  /** Clock label override (delayed feeds show an older time). */
  displayClock: string | null;
  frozen: number;
  /** Whether the anomaly content is actually visible in this feed right now. */
  anomalyVisible: boolean;
}

interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

const HISTORY_SEC = 180;

/**
 * Security room: each camera renders into a RenderTargetTexture shown on a monitor.
 * Cost control: feeds only render while the player is in/near the security room, at low
 * resolution, round-robin (refreshRate), with room-scoped render lists.
 * Cameras also see the CAMERA_ONLY layer (figures that are not there in person) and a proxy
 * of the player - optionally delayed / replayed from history.
 */
export class SecurityCameraSystem {
  private readonly feeds: Feed[] = [];
  private readonly proxy: TransformNode;
  private readonly proxyMeshes: AbstractMesh[] = [];
  private readonly history: Sample[] = [];
  private active = false;
  private time = 0;
  private sampleAccum = 0;
  private overlayAccum = 0;
  private interference = 0;
  private focusIndex = 0;
  private frame = 0;
  private rr = 0;
  viewing = false;
  private dwell = 0;
  onPerceive: (owner: EffectOwner) => void = () => undefined;

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
    private readonly stage: StageDefinition,
    private readonly roomMeshes: RoomMeshRegistry,
    desk: PropInstance | undefined,
    quality: GraphicsQuality,
    private readonly clock: () => string,
    private readonly extraVisible: () => AbstractMesh[],
  ) {
    this.proxy = this.buildProxy();
    const res = quality === 'low' ? [256, 192] : [384, 288];
    stage.securityCameras.forEach((def, i) => {
      const screenPart = desk?.built.parts.get(`screen-${i}`);
      if (!(screenPart instanceof Mesh)) return;
      const camera = new FreeCamera(`seccam-${def.id}`, new Vector3(...def.position), scene);
      camera.setTarget(new Vector3(...def.target));
      camera.fov = ((def.fov ?? 70) * Math.PI) / 180;
      camera.minZ = 0.1;
      camera.maxZ = 40;
      camera.layerMask = DEFAULT_LAYER | CAMERA_ONLY_LAYER;
      camera.inputs.clear();
      const rtt = new RenderTargetTexture(`feed-${def.id}`, { width: res[0], height: res[1] }, scene, false, true);
      rtt.activeCamera = camera;
      rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      rtt.clearColor = scene.clearColor.clone();
      rtt.onBeforeRenderObservable.add(() => this.placeProxyFor(feed));
      const mat = new StandardMaterial(`feed-mat-${def.id}`, scene);
      mat.disableLighting = true;
      mat.emissiveTexture = rtt;
      // Render targets skip the tone mapping of the main post-process pipeline: compensate here.
      mat.emissiveColor = new Color3(0.46, 0.54, 0.5);
      mat.diffuseColor = Color3.Black();
      screenPart.material = mat;

      const overlay = new DynamicTexture(`feed-overlay-${def.id}`, { width: 256, height: 192 }, scene, false);
      overlay.hasAlpha = true;
      const om = new StandardMaterial(`feed-overlay-mat-${def.id}`, scene);
      om.disableLighting = true;
      om.emissiveTexture = overlay;
      om.opacityTexture = overlay;
      om.diffuseColor = Color3.Black();
      const overlayMesh = MeshBuilder.CreatePlane(`feed-overlay-${def.id}`, { width: 0.54, height: 0.38 }, scene);
      overlayMesh.material = om;
      overlayMesh.parent = screenPart.parent;
      overlayMesh.position.copyFrom(screenPart.position);
      overlayMesh.position.z -= 0.002;
      overlayMesh.isPickable = false;
      const feed: Feed = { def, camera, rtt, screen: screenPart, overlay, overlayMesh, effect: null, owner: null, displayClock: null, frozen: 0, anomalyVisible: false };
      this.feeds.push(feed);
      this.refreshRenderList(feed);
      this.drawOverlay(feed);
    });
  }

  get count(): number {
    return this.feeds.length;
  }

  feedLabel(i: number): string {
    return this.feeds[i]?.def.label ?? '';
  }

  screenOf(i: number): Mesh | undefined {
    return this.feeds[i]?.screen;
  }

  private buildProxy(): TransformNode {
    const root = new TransformNode('player-proxy', this.scene);
    const mat = this.lib.get('fabric-chair');
    const skin = this.lib.get('plastic-beige');
    const body = MeshBuilder.CreateCylinder('proxy-body', { diameterTop: 0.36, diameterBottom: 0.3, height: 0.75, tessellation: 10 }, this.scene);
    body.position.y = 1.15;
    body.material = mat;
    const legs = MeshBuilder.CreateBox('proxy-legs', { width: 0.3, height: 0.8, depth: 0.2 }, this.scene);
    legs.position.y = 0.4;
    legs.material = this.lib.get('plastic-dark');
    const head = MeshBuilder.CreateSphere('proxy-head', { diameter: 0.24, segments: 8 }, this.scene);
    head.position.y = 1.66;
    head.material = skin;
    for (const m of [body, legs, head]) {
      m.parent = root;
      m.layerMask = CAMERA_ONLY_LAYER;
      m.isPickable = false;
      this.proxyMeshes.push(m);
    }
    root.setEnabled(false);
    return root;
  }

  /** Cameras never move, so each feed's render list is pre-culled to its frustum once. */
  private refreshRenderList(feed: Feed): void {
    const rooms = [feed.def.roomId, ...(feed.def.alsoSees ?? [])];
    feed.camera.computeWorldMatrix();
    const planes = Frustum.GetPlanes(feed.camera.getTransformationMatrix());
    const list = rooms
      .flatMap((r) => this.roomMeshes.renderables(r))
      .filter((m) => {
        m.computeWorldMatrix(true);
        return m.isInFrustum(planes);
      });
    feed.rtt.renderList = [...new Set([...list, ...this.proxyMeshes, ...this.extraVisible()])];
  }

  /** Feeds render only while the player is in or next to the security room. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    const targets = this.scene.customRenderTargets;
    for (const f of this.feeds) {
      const idx = targets.indexOf(f.rtt);
      if (active && idx < 0) targets.push(f.rtt);
      if (!active && idx >= 0) targets.splice(idx, 1);
    }
  }

  setInterference(level: number): void {
    this.interference = level;
  }

  setFeedEffect(cameraId: string, effect: FeedEffect | null, owner: EffectOwner | null): void {
    const feed = this.feeds.find((f) => f.def.id === cameraId);
    if (!feed) return;
    feed.effect = effect;
    feed.owner = owner;
    feed.displayClock = null;
  }

  /** Also used for camera-only anomaly props in a feed's room. */
  setOwnerForRoom(roomId: string, owner: EffectOwner | null): void {
    for (const f of this.feeds) {
      if (f.def.roomId === roomId && (!f.effect || f.effect.mode === 'show-prop')) f.owner = owner;
    }
  }

  focus(index: number): void {
    this.focusIndex = ((index % this.feeds.length) + this.feeds.length) % this.feeds.length;
    this.dwell = 0;
    this.feeds[this.focusIndex]?.rtt.resetRefreshCounter();
  }

  get focused(): number {
    return this.focusIndex;
  }

  recordPlayer(dt: number, x: number, z: number, yaw: number): void {
    this.time += dt;
    this.sampleAccum += dt;
    if (this.sampleAccum < 0.1) return;
    this.sampleAccum = 0;
    this.history.push({ t: this.time, x, z, yaw });
    while (this.history.length && this.time - this.history[0].t > HISTORY_SEC) this.history.shift();
  }

  private inRoom(roomId: string, x: number, z: number): boolean {
    const room = this.stage.rooms.find((r) => r.id === roomId);
    if (!room) return false;
    return rectContains(room.bounds, x, z) || (room.extraBounds ?? []).some((r) => rectContains(r, x, z));
  }

  private sampleAt(t: number): Sample | null {
    if (!this.history.length) return null;
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].t <= t) return this.history[i];
    return this.history[0];
  }

  /** Delayed sample; if the player was not in the camera's room then, loop their last visit. */
  private delayedSample(feed: Feed, delay: number): Sample | null {
    const direct = this.sampleAt(this.time - delay);
    if (direct && this.inRoom(feed.def.roomId, direct.x, direct.z)) return direct;
    let end = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const s = this.history[i];
      if (this.inRoom(feed.def.roomId, s.x, s.z)) {
        end = i;
        break;
      }
    }
    if (end < 0) return null;
    let start = end;
    while (start > 0 && this.inRoom(feed.def.roomId, this.history[start - 1].x, this.history[start - 1].z)) start--;
    const segment = this.history.slice(start, end + 1);
    if (segment.length < 8) return segment[segment.length - 1];
    const duration = segment[segment.length - 1].t - segment[0].t;
    const phase = this.time % Math.max(duration, 0.1);
    const t = segment[0].t + phase;
    return segment.find((s) => s.t >= t) ?? segment[segment.length - 1];
  }

  private placeProxyFor(feed: Feed): void {
    const latest = this.history[this.history.length - 1];
    let sample: Sample | null = latest ?? null;
    feed.displayClock = null;
    if (feed.effect?.mode === 'delayed') {
      sample = this.delayedSample(feed, feed.effect.delaySec ?? 20);
      feed.anomalyVisible = !!sample && sample !== latest;
      if (sample) feed.displayClock = this.clockMinus(this.time - sample.t);
    }
    if (sample && this.inRoom(feed.def.roomId, sample.x, sample.z)) {
      this.proxy.setEnabled(true);
      this.proxy.position.set(sample.x, 0, sample.z);
      this.proxy.rotation.y = sample.yaw;
    } else {
      this.proxy.setEnabled(false);
    }
  }

  private clockMinus(seconds: number): string {
    const [h, m] = this.clock().split(':').map(Number);
    const total = Math.max(0, h * 60 + m - Math.round(seconds / 6));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  private drawOverlay(feed: Feed): void {
    const ctx = feed.overlay.getContext() as unknown as CanvasRenderingContext2D;
    const w = 256;
    const h = 192;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const noise = this.interference + (feed.frozen > 0 ? 0.6 : 0);
    if (noise > 0.05) {
      for (let i = 0; i < noise * 40; i++) {
        ctx.fillStyle = `rgba(220,230,220,${Math.random() * 0.35 * noise})`;
        ctx.fillRect(0, Math.random() * h, w, 1 + Math.random() * 3);
      }
    }
    ctx.fillStyle = 'rgba(230,240,230,0.9)';
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.fillText(feed.effect?.mode === 'mislabel' && feed.effect.label ? feed.effect.label : feed.def.label, 8, 18);
    const clock = feed.displayClock ?? this.clock();
    const secs = String(Math.floor(this.time) % 60).padStart(2, '0');
    ctx.fillText(`${clock}:${secs}`, w - 78, h - 10);
    ctx.fillStyle = Math.floor(this.time * 2) % 2 ? 'rgba(255,40,30,0.95)' : 'rgba(255,40,30,0.2)';
    ctx.beginPath();
    ctx.arc(w - 14, 14, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(230,240,230,0.9)';
    ctx.fillText('REC', w - 50, 18);
    feed.overlay.update(true);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.overlayAccum += dt;
    for (const f of this.feeds) {
      if (f.frozen > 0) f.frozen -= dt;
      else if (this.interference > 0.3 && Math.random() < this.interference * 0.02 * dt * 60) {
        f.frozen = 0.4 + Math.random() * 0.6;
      }
      if (f.effect?.mode === 'show-prop') f.anomalyVisible = true;
    }
    this.scheduleRender();
    if (this.overlayAccum > 0.5) {
      this.overlayAccum = 0;
      for (const f of this.feeds) this.drawOverlay(f);
    }
    if (this.viewing) {
      const f = this.feeds[this.focusIndex];
      if (f) {
        this.dwell += dt;
        const visible = f.effect ? f.anomalyVisible : this.extraVisible().some((m) => m.isEnabled() && this.feedSees(f, m));
        if (f.owner && visible && this.dwell > 1.5) this.onPerceive(f.owner);
      }
    }
  }

  /**
   * Exactly one feed renders per frame (round-robin); while watching, the focused feed takes
   * every other frame. Frozen feeds (interference) keep their last image.
   */
  private scheduleRender(): void {
    if (!this.feeds.length) return;
    this.frame++;
    let feed: Feed;
    if (this.viewing && this.frame % 2 === 0) feed = this.feeds[this.focusIndex];
    else {
      this.rr = (this.rr + 1) % this.feeds.length;
      feed = this.feeds[this.rr];
    }
    if (feed.frozen <= 0) feed.rtt.resetRefreshCounter();
  }

  private feedSees(feed: Feed, mesh: AbstractMesh): boolean {
    const p = mesh.getAbsolutePosition();
    return this.inRoom(feed.def.roomId, p.x, p.z);
  }

  dispose(): void {
    this.setActive(false);
    for (const f of this.feeds) {
      f.rtt.dispose();
      f.overlay.dispose();
      f.camera.dispose();
      f.overlayMesh.dispose();
    }
    this.feeds.length = 0;
    this.proxy.dispose();
  }
}
