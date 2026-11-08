import { Vector3 } from '@babylonjs/core';
import { AnomalyEffect, AnomalyEffectType, DoorState, Vec3 } from '../../models';
import type { EffectOwner, EngineAudio, EngineHost } from '../engine-api';
import type { LightingManager } from '../lighting-manager';
import type { PlayerController } from '../camera-controller';
import type { DoorSystem } from '../world/door-system';
import type { PropRegistry } from '../world/prop-registry';

/** Engine services available to effect handlers. */
export interface EffectContext {
  readonly props: PropRegistry;
  readonly doors: DoorSystem;
  readonly lighting: LightingManager;
  readonly audio: EngineAudio;
  readonly host: EngineHost;
  readonly player: PlayerController;
  /** 0 = blatant, 1 = subtle (difficulty). */
  readonly subtlety: number;
  readonly audioClueVolume: number;
  readonly hearingMultiplier: number;
  playerRoomId(): string | null;
  setRoomSilenced(roomId: string, silenced: boolean): void;
  setFeedEffect(cameraId: string, effect: Extract<AnomalyEffect, { type: 'security-feed' }> | null, owner: EffectOwner | null): void;
  /** Plays a world sound and reports hearing perception when within radius. */
  emitSound(soundId: string, position: Vec3, volume: number, radius: number, owner: EffectOwner): void;
  announce(text: string, position: Vec3, owner: EffectOwner): void;
}

/** Mutable per-activation state for handlers with timers. */
export interface EffectState {
  timer: number;
  data: Record<string, unknown>;
}

export interface AnomalyEffectHandler<T extends AnomalyEffect = AnomalyEffect> {
  readonly type: T['type'];
  apply(ctx: EffectContext, effect: T, owner: EffectOwner, instant: boolean, state: EffectState): void;
  revert(ctx: EffectContext, effect: T, owner: EffectOwner, state: EffectState): void;
  update?(ctx: EffectContext, effect: T, owner: EffectOwner, dt: number, state: EffectState): void;
}

type HandlerFor<K extends AnomalyEffectType> = AnomalyEffectHandler<Extract<AnomalyEffect, { type: K }>>;

/**
 * Registry (strategy pattern). Add a new effect type by extending the AnomalyEffect union and
 * calling `registerEffectHandler(...)` - the director and content never change.
 */
const REGISTRY = new Map<string, AnomalyEffectHandler>();

export function registerEffectHandler<K extends AnomalyEffectType>(handler: HandlerFor<K>): void {
  if (REGISTRY.has(handler.type)) throw new Error(`Effect handler "${handler.type}" registered twice`);
  REGISTRY.set(handler.type, handler as unknown as AnomalyEffectHandler);
}

export function effectHandler(type: string): AnomalyEffectHandler | undefined {
  return REGISTRY.get(type);
}

export function registeredEffectTypes(): string[] {
  return [...REGISTRY.keys()];
}

/* ------------------------------------------------------------------------------ handlers */

const scaleBySubtlety = (ctx: EffectContext) => 1.25 - ctx.subtlety * 0.55;

registerEffectHandler<'transform-prop'>({
  type: 'transform-prop',
  apply: (ctx, e) => {
    const k = e.subtletyScaled ? scaleBySubtlety(ctx) : 1;
    const offset: Vec3 | undefined = e.offset ? [e.offset[0] * k, e.offset[1] * k, e.offset[2] * k] : undefined;
    ctx.props.setTransform(e.propId, offset, e.rotateDeg !== undefined ? e.rotateDeg * k : undefined, e.scale);
  },
  revert: (ctx, e) => ctx.props.resetTransform(e.propId),
});

registerEffectHandler<'hide-prop'>({
  type: 'hide-prop',
  apply: (ctx, e) => ctx.props.setVisible(e.propId, false),
  revert: (ctx, e) => ctx.props.setVisible(e.propId, true),
});

registerEffectHandler<'show-prop'>({
  type: 'show-prop',
  apply: (ctx, e) => ctx.props.setVisible(e.propId, true),
  revert: (ctx, e) => ctx.props.setVisible(e.propId, false),
});

registerEffectHandler<'swap-variant'>({
  type: 'swap-variant',
  apply: (ctx, e) => ctx.props.setVariant(e.propId, e.variant),
  revert: (ctx, e) => ctx.props.setVariant(e.propId, ctx.props.get(e.propId)?.placement.variant ?? ''),
});

registerEffectHandler<'set-text'>({
  type: 'set-text',
  apply: (ctx, e) => ctx.props.setText(e.propId, e.text, e.color),
  revert: (ctx, e) => ctx.props.resetText(e.propId),
});

registerEffectHandler<'clock'>({
  type: 'clock',
  apply: (ctx, e) => {
    const p = ctx.props.get(e.propId);
    if (!p) return;
    p.clockMode = e.mode;
    if (e.mode === 'frozen') {
      const [h, m] = (e.time ?? '09:00').split(':').map(Number);
      p.clockFrozenMinutes = (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
    }
  },
  revert: (ctx, e) => {
    const p = ctx.props.get(e.propId);
    if (p) p.clockMode = 'normal';
  },
});

registerEffectHandler<'light-color'>({
  type: 'light-color',
  apply: (ctx, e) => ctx.lighting.setColor(e.roomId, e.lightIds, e.color, e.intensityScale ?? 1),
  revert: (ctx, e) => ctx.lighting.setColor(e.roomId, e.lightIds, null),
});

registerEffectHandler<'light-pattern'>({
  type: 'light-pattern',
  apply: (ctx, e) => ctx.lighting.setPattern(e.roomId, e.lightIds, e.pattern, e.stepSec),
  revert: (ctx, e) => ctx.lighting.setPattern(e.roomId, e.lightIds, null),
});

registerEffectHandler<'door-state'>({
  type: 'door-state',
  apply: (ctx, e, _owner, instant, state) => {
    const door = ctx.doors.get(e.doorId);
    if (!door) return;
    state.data['previous'] = door.state;
    ctx.doors.setState(e.doorId, e.state, { instant, slam: e.slam });
    if (!instant && !e.slam) {
      const p = door.position;
      ctx.audio.play(e.state === 'open' ? 'door-open' : 'door-close', { position: p });
    }
  },
  revert: (ctx, e, _owner, state) => {
    const previous = state.data['previous'] as DoorState | undefined;
    const door = ctx.doors.get(e.doorId);
    if (!door || !previous) return;
    if (door.state === e.state) ctx.doors.setState(e.doorId, previous === 'open' ? 'closed' : previous, { instant: true });
  },
});

registerEffectHandler<'room-revert'>({
  type: 'room-revert',
  apply: (ctx, e, _owner, instant) => {
    for (const id of e.doorIds) {
      const door = ctx.doors.get(id);
      if (door && door.state !== door.def.initialState) ctx.doors.setState(id, door.def.initialState, { instant });
    }
  },
  revert: () => undefined,
});

registerEffectHandler<'ceiling-height'>({
  type: 'ceiling-height',
  apply: (ctx, e) => ctx.lighting.setCeilingOffset(e.roomId, e.delta),
  revert: (ctx, e) => ctx.lighting.setCeilingOffset(e.roomId, 0),
});

registerEffectHandler<'sound'>({
  type: 'sound',
  apply: (ctx, e, owner, instant, state) => {
    if (e.intervalSec) {
      state.timer = instant ? e.intervalSec * 0.5 : 3 + Math.random() * 4;
    } else if (!instant) {
      ctx.emitSound(e.soundId, e.position, (e.volume ?? 1) * ctx.audioClueVolume, e.radius * ctx.hearingMultiplier, owner);
    }
  },
  update: (ctx, e, owner, dt, state) => {
    if (!e.intervalSec) return;
    state.timer -= dt;
    if (state.timer <= 0) {
      state.timer = e.intervalSec * (0.8 + Math.random() * 0.4);
      ctx.emitSound(e.soundId, e.position, (e.volume ?? 1) * ctx.audioClueVolume, e.radius * ctx.hearingMultiplier, owner);
    }
  },
  revert: () => undefined,
});

registerEffectHandler<'footstep-echo'>({
  type: 'footstep-echo',
  apply: (_ctx, _e, _owner, _instant, state) => {
    state.data['moving'] = 0;
    state.data['cooldown'] = 4;
    state.data['pending'] = 0;
  },
  update: (ctx, e, owner, dt, state) => {
    const d = state.data as { moving: number; cooldown: number; pending: number; next?: number };
    d.cooldown = Math.max(0, d.cooldown - dt);
    if (d.pending > 0) {
      d.next = (d.next ?? 0) - dt;
      if (d.next <= 0) {
        const back = ctx.player.forward().scale(-2.6 - (e.steps - d.pending) * 0.4);
        const p = ctx.player.position.add(new Vector3(back.x, 0, back.z));
        ctx.emitSound('footstep-echo', [p.x, 0.2, p.z], 0.9 * ctx.audioClueVolume, 30, owner);
        d.pending--;
        d.next = 0.52;
      }
      return;
    }
    if (ctx.playerRoomId() !== e.roomId) {
      d.moving = 0;
      return;
    }
    if (ctx.player.speed > 0.8) d.moving += dt;
    else if (d.moving > 1.6 && d.cooldown === 0) {
      d.pending = e.steps;
      d.next = 0.28;
      d.cooldown = 18;
      d.moving = 0;
    } else if (ctx.player.speed < 0.2) d.moving = 0;
  },
  revert: () => undefined,
});

registerEffectHandler<'announcement'>({
  type: 'announcement',
  apply: (ctx, e, owner, instant, state) => {
    state.timer = e.intervalSec ?? 0;
    if (!instant) ctx.announce(e.text, e.position, owner);
    else state.timer = Math.min(state.timer, 20);
  },
  update: (ctx, e, owner, dt, state) => {
    if (!e.intervalSec) return;
    state.timer -= dt;
    if (state.timer <= 0) {
      state.timer = e.intervalSec;
      ctx.announce(e.text, e.position, owner);
    }
  },
  revert: () => undefined,
});

registerEffectHandler<'room-silence'>({
  type: 'room-silence',
  apply: (ctx, e) => ctx.setRoomSilenced(e.roomId, true),
  revert: (ctx, e) => ctx.setRoomSilenced(e.roomId, false),
});

registerEffectHandler<'security-feed'>({
  type: 'security-feed',
  apply: (ctx, e, owner) => ctx.setFeedEffect(e.cameraId, e, owner),
  revert: (ctx, e) => ctx.setFeedEffect(e.cameraId, null, null),
});
