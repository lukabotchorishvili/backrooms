import { AbstractMesh, Camera, Ray, Scene, Vector3 } from '@babylonjs/core';
import { PropPlacement, PropStateSnapshot, RoomDefinition, RoomId, Vec3 } from '../../models';
import { CollisionWorld } from '../collision-manager';
import { BuiltProp } from './prop-kit';

export type ClockMode = 'normal' | 'backward' | 'frozen' | 'fast';

export interface PropInstance {
  readonly id: string;
  readonly placement: PropPlacement;
  readonly room: RoomDefinition;
  readonly built: BuiltProp;
  readonly basePosition: Vector3;
  readonly baseRotationY: number;
  visible: boolean;
  variant: string;
  consumed: boolean;
  readonly colliderIds: string[];
  clockMode: ClockMode;
  clockFrozenMinutes: number;
  clockSpin: number;
  fakeDoorUnlocked: boolean;
  fakeDoorOpen: boolean;
  fakeDoorAnim: number;
}

/** Something whose "seen / unseen" time the director cares about. */
interface WatchTarget {
  readonly id: string;
  readonly meshes: () => AbstractMesh[];
  unseen: number;
  everSeen: boolean;
}

const MAX_SIGHT = 32;

/**
 * Runtime registry of every placed prop: transforms, visibility, colliders, memory snapshots,
 * and the "has the player seen this recently" timers used by the anomaly director.
 */
export class PropRegistry {
  private readonly props = new Map<string, PropInstance>();
  private readonly watch = new Map<string, WatchTarget>();
  private watchOrder: string[] = [];
  private watchCursor = 0;
  private readonly tmpRay = new Ray(Vector3.Zero(), Vector3.Forward(), 1);

  constructor(
    private readonly scene: Scene,
    private readonly collisions: CollisionWorld,
  ) {}

  add(placement: PropPlacement, room: RoomDefinition, built: BuiltProp): PropInstance {
    const instance: PropInstance = {
      id: placement.id,
      placement,
      room,
      built,
      basePosition: built.root.position.clone(),
      baseRotationY: built.root.rotation.y,
      visible: !placement.hidden,
      variant: placement.variant ?? '',
      consumed: false,
      colliderIds: built.colliders.map((_, i) => `${placement.id}#${i}`),
      clockMode: 'normal',
      clockFrozenMinutes: 0,
      clockSpin: 0,
      fakeDoorUnlocked: placement.variant === 'closet-unlocked',
      fakeDoorOpen: false,
      fakeDoorAnim: 0,
    };
    const solid = placement.solid ?? !placement.cameraOnly;
    built.colliders.forEach((_, i) =>
      this.collisions.add({ id: instance.colliderIds[i], cx: 0, cz: 0, hx: 0, hz: 0, rot: 0, enabled: solid && instance.visible }),
    );
    this.props.set(placement.id, instance);
    this.syncColliders(instance);
    return instance;
  }

  get(id: string): PropInstance | undefined {
    return this.props.get(id);
  }

  all(): IterableIterator<PropInstance> {
    return this.props.values();
  }

  inRoom(roomId: RoomId): PropInstance[] {
    return [...this.props.values()].filter((p) => p.room.id === roomId);
  }

  /** Recomputes world-space colliders from the prop's current transform. */
  syncColliders(p: PropInstance): void {
    const root = p.built.root;
    const rot = root.rotation.y;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const solid = (p.placement.solid ?? !p.placement.cameraOnly) && p.visible && !p.consumed;
    p.built.colliders.forEach((c, i) => {
      const fakeDoorOpen = p.built.fakeDoor && p.built.fakeDoor.colliderIndex === i && p.fakeDoorOpen;
      this.collisions.update(p.colliderIds[i], {
        cx: root.position.x + c.x * cos + c.z * sin,
        cz: root.position.z - c.x * sin + c.z * cos,
        hx: c.hx,
        hz: c.hz,
        rot: rot + (c.rot ?? 0),
        enabled: solid && !fakeDoorOpen,
      });
    });
  }

  setTransform(id: string, offset: Vec3 | undefined, rotateDeg: number | undefined, scale: number | undefined): void {
    const p = this.props.get(id);
    if (!p) return;
    const root = p.built.root;
    root.position.copyFrom(p.basePosition);
    if (offset) root.position.addInPlace(new Vector3(offset[0], offset[1], offset[2]));
    root.rotation.y = p.baseRotationY + ((rotateDeg ?? 0) * Math.PI) / 180;
    root.scaling.setAll((p.placement.scale ?? 1) * (scale ?? 1));
    this.syncColliders(p);
  }

  resetTransform(id: string): void {
    this.setTransform(id, undefined, undefined, undefined);
  }

  setVisible(id: string, visible: boolean): void {
    const p = this.props.get(id);
    if (!p) return;
    p.visible = visible;
    p.built.root.setEnabled(visible && !p.consumed);
    this.syncColliders(p);
  }

  consume(id: string): void {
    const p = this.props.get(id);
    if (!p) return;
    p.consumed = true;
    const key = p.built.parts.get('key');
    if (key) {
      key.setEnabled(false);
      p.built.parts.get('key-tag')?.setEnabled(false);
      if (p.placement.interaction) p.consumed = true;
      return;
    }
    p.built.root.setEnabled(false);
    this.syncColliders(p);
  }

  setVariant(id: string, variant: string): void {
    const p = this.props.get(id);
    if (!p) return;
    p.variant = variant;
    p.built.setVariant?.(variant);
    if (p.built.fakeDoor) {
      p.fakeDoorUnlocked = variant.endsWith('unlocked');
      if (!p.fakeDoorUnlocked) p.fakeDoorOpen = false;
      this.syncColliders(p);
    }
  }

  setText(id: string, text: string, color?: readonly [number, number, number]): void {
    const p = this.props.get(id);
    if (!p?.built.text) return;
    p.built.text.draw(text, color ? [color[0], color[1], color[2]] : undefined);
  }

  resetText(id: string): void {
    const p = this.props.get(id);
    if (!p?.built.text) return;
    p.built.text.draw(p.built.defaultText ?? '');
  }

  textOf(id: string): string | undefined {
    return this.props.get(id)?.built.text?.text;
  }

  /** Serialisable snapshot of a room's tracked props (memory-room baseline). */
  capture(roomId: RoomId): Record<string, PropStateSnapshot> {
    const out: Record<string, PropStateSnapshot> = {};
    for (const p of this.props.values()) {
      if (p.room.id !== roomId) continue;
      const tracked = p.placement.tracked ?? !!p.placement.interaction;
      if (!tracked) continue;
      const pos = p.built.root.position;
      out[p.id] = {
        position: [round(pos.x), round(pos.y), round(pos.z)],
        rotationY: round((p.built.root.rotation.y * 180) / Math.PI),
        visible: p.visible && !p.consumed,
        variant: p.variant || undefined,
        text: p.built.text?.text,
      };
    }
    return out;
  }

  /* ----------------------------------------------------------------- visibility tracking */

  addWatch(id: string, meshes: () => AbstractMesh[]): void {
    if (this.watch.has(id)) return;
    this.watch.set(id, { id, meshes, unseen: 999, everSeen: false });
    this.watchOrder = [...this.watch.keys()];
  }

  watchProp(id: string): void {
    const p = this.props.get(id);
    if (p) this.addWatch(id, () => p.built.meshes);
  }

  unseenSeconds(id: string): number {
    const w = this.watch.get(id);
    return w ? w.unseen : Infinity;
  }

  /**
   * Advances unseen timers and re-tests a slice of targets per call (round-robin), so the cost
   * is bounded regardless of how many props are watched.
   */
  updateVisibility(dt: number, camera: Camera, budget = 6): void {
    for (const w of this.watch.values()) w.unseen += dt;
    if (this.watchOrder.length === 0) return;
    const origin = camera.globalPosition;
    for (let n = 0; n < Math.min(budget, this.watchOrder.length); n++) {
      this.watchCursor = (this.watchCursor + 1) % this.watchOrder.length;
      const target = this.watch.get(this.watchOrder[this.watchCursor]);
      if (target && this.isSeen(target, camera, origin)) {
        target.unseen = 0;
        target.everSeen = true;
      }
    }
  }

  private isSeen(target: WatchTarget, camera: Camera, origin: Vector3): boolean {
    for (const mesh of target.meshes()) {
      if (!mesh.isEnabled() || !mesh.isVisible) continue;
      const center = mesh.getBoundingInfo().boundingSphere.centerWorld;
      const dist = Vector3.Distance(origin, center);
      if (dist > MAX_SIGHT) continue;
      if (!camera.isInFrustum(mesh)) continue;
      if (dist < 1.2) return true;
      const dir = center.subtract(origin).normalize();
      this.tmpRay.origin.copyFrom(origin);
      this.tmpRay.direction.copyFrom(dir);
      this.tmpRay.length = dist - 0.25;
      const hit = this.scene.pickWithRay(
        this.tmpRay,
        (m) => m.isEnabled() && m.isVisible && !!m.metadata?.occluder && !target.meshes().includes(m),
        true,
      );
      if (!hit?.hit) return true;
    }
    return false;
  }

  update(dt: number, time: number): void {
    for (const p of this.props.values()) {
      if (p.built.update && p.visible) p.built.update(dt, time);
    }
  }

  dispose(): void {
    for (const p of this.props.values()) {
      p.built.disposeExtra?.();
      p.built.root.dispose(false, false);
    }
    this.props.clear();
    this.watch.clear();
    this.watchOrder = [];
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
