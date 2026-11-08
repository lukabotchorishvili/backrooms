import { Injectable } from '@angular/core';
import { ATTENTION_LEVEL_CONFIGS } from '../content/attention/attention-levels';
import {
  AnomalyDefinition,
  AnomalyEffect,
  AnomalyRuntimeState,
  AttentionLevel,
  AttentionLevelConfig,
  BehaviorProfile,
  BehaviorResponseDefinition,
  DecoyDefinition,
  DifficultyConfig,
  DirectorState,
  DoorState,
  RoomId,
  StageDefinition,
  attentionLevelIndex,
} from '../models';
import { SeededRandom } from './seeded-random';

/** Read-only view of the world the director needs. Implemented by GameSessionService. */
export interface DirectorWorld {
  readonly playerRoomId: RoomId | null;
  readonly attentionLevel: AttentionLevel;
  readonly confirmedCount: number;
  readonly flags: ReadonlySet<string>;
  readonly profile: BehaviorProfile;
  readonly doorStates: Readonly<Record<string, DoorState>>;
  roomVisits(roomId: RoomId): number;
  /** Seconds the prop has been continuously out of the player's view (Infinity if never seen). */
  propUnseenSeconds(propId: string): number;
  adjacentRooms(roomId: RoomId): readonly RoomId[];
}

export type DirectorAction =
  | { readonly type: 'activate'; readonly anomaly: AnomalyDefinition }
  | { readonly type: 'retire'; readonly anomaly: AnomalyDefinition; readonly reason: 'expired' | 'resolved' | 'timeout' }
  | { readonly type: 'decoy'; readonly decoy: DecoyDefinition };

export interface DirectorSetup {
  readonly stage: StageDefinition;
  readonly difficulty: DifficultyConfig;
  readonly anomalies: readonly AnomalyDefinition[];
  readonly decoys: readonly DecoyDefinition[];
  readonly responses: readonly BehaviorResponseDefinition[];
  readonly levels?: readonly AttentionLevelConfig[];
  readonly seed: number;
}

/** Seconds a selected anomaly may wait for its trigger before being returned to the pool. */
export const PENDING_TIMEOUT_SEC = 150;
/** Seconds after which an empty board forces a new selection. */
export const STARVATION_SEC = 12;
/** Minimum seconds a prop must be unseen before it may change (no visible pops). */
export const MIN_UNSEEN_FOR_CHANGE = 0.75;

const IN_PLAY: ReadonlySet<AnomalyRuntimeState['status']> = new Set(['pending', 'active', 'witnessed']);

/** All prop ids an anomaly touches (for conflict detection). */
export function effectPropIds(def: AnomalyDefinition): string[] {
  const ids = new Set<string>();
  if (def.targetPropId) ids.add(def.targetPropId);
  for (const e of def.effects) {
    if ('propId' in e && typeof e.propId === 'string') ids.add(e.propId);
    if (e.type === 'door-state') ids.add(`door-${e.doorId}`);
    if (e.type === 'room-revert') e.doorIds.forEach((d) => ids.add(`door-${d}`));
  }
  return [...ids];
}

function effectRoomScopes(def: AnomalyDefinition): string[] {
  const scopes: string[] = [];
  for (const e of def.effects as readonly AnomalyEffect[]) {
    if (e.type === 'light-color' || e.type === 'light-pattern') scopes.push(`lights:${e.roomId}:${(e.lightIds ?? ['*']).join(',')}`);
    if (e.type === 'ceiling-height') scopes.push(`ceiling:${e.roomId}`);
    if (e.type === 'room-silence') scopes.push(`silence:${e.roomId}`);
    if (e.type === 'security-feed') scopes.push(`feed:${e.cameraId}`);
  }
  return scopes;
}

/**
 * Decides which anomalies happen, where and when.
 * Deterministic for a given seed + event sequence. Data-driven: difficulty, stage pool,
 * behaviour responses and attention levels are all inputs - the algorithm never branches on ids.
 */
@Injectable({ providedIn: 'root' })
export class AnomalyDirectorService {
  private setup: DirectorSetup | null = null;
  private defs = new Map<string, AnomalyDefinition>();
  private rng = new SeededRandom(1);
  private state: DirectorState = this.emptyState(1);
  private initialized = false;
  private lastResolvedAt = new Map<string, number>();

  private emptyState(seed: number): DirectorState {
    return { seed, rngState: seed, elapsed: 0, sinceLastSelection: 0, sinceLastDecoy: 0, anomalies: {}, history: [], eventCounts: {} };
  }

  start(setup: DirectorSetup): void {
    this.setup = setup;
    this.defs = new Map(setup.anomalies.map((a) => [a.id, a]));
    this.rng = new SeededRandom(setup.seed);
    this.state = this.emptyState(setup.seed);
    for (const a of setup.anomalies) this.state.anomalies[a.id] = { id: a.id, status: 'idle', timesActivated: 0 };
    this.lastResolvedAt.clear();
    this.initialized = false;
  }

  restore(setup: DirectorSetup, saved: DirectorState): void {
    this.start(setup);
    this.state = {
      ...this.emptyState(saved.seed),
      ...saved,
      anomalies: { ...this.state.anomalies },
      history: [...(saved.history ?? [])],
      eventCounts: { ...(saved.eventCounts ?? {}) },
    };
    for (const [id, s] of Object.entries(saved.anomalies ?? {})) {
      if (!this.defs.has(id)) continue;
      // Pending selections are dropped on load; they will be reselected.
      const status = s.status === 'pending' ? 'idle' : s.status;
      this.state.anomalies[id] = { ...s, status };
      if (s.retiredAt !== undefined) this.lastResolvedAt.set(id, s.retiredAt);
    }
    this.rng.setState(saved.rngState);
    this.initialized = true;
  }

  getState(): DirectorState {
    this.state.rngState = this.rng.getState();
    return JSON.parse(JSON.stringify(this.state)) as DirectorState;
  }

  get elapsed(): number {
    return this.state.elapsed;
  }

  status(id: string): AnomalyRuntimeState['status'] {
    return this.state.anomalies[id]?.status ?? 'idle';
  }

  /** Anomalies whose effects are currently applied in the world. */
  appliedAnomalies(): AnomalyDefinition[] {
    return Object.values(this.state.anomalies)
      .filter((s) => s.status === 'active' || s.status === 'witnessed' || s.status === 'reported')
      .map((s) => this.defs.get(s.id)!)
      .filter(Boolean);
  }

  /** Active (applied, not yet reported) anomalies - clues can be perceived. */
  perceivableAnomalies(): AnomalyDefinition[] {
    return Object.values(this.state.anomalies)
      .filter((s) => s.status === 'active' || s.status === 'witnessed')
      .map((s) => this.defs.get(s.id)!)
      .filter(Boolean);
  }

  inPlayCount(): number {
    return Object.values(this.state.anomalies).filter((s) => IN_PLAY.has(s.status)).length;
  }

  recordEvent(type: string): void {
    this.state.eventCounts[type] = (this.state.eventCounts[type] ?? 0) + 1;
  }

  markWitnessed(id: string): boolean {
    const s = this.state.anomalies[id];
    if (!s || s.status !== 'active') return false;
    s.status = 'witnessed';
    s.witnessedAt = this.state.elapsed;
    return true;
  }

  markReported(id: string): void {
    const s = this.state.anomalies[id];
    if (!s) return;
    s.status = 'reported';
    s.reportedAt = this.state.elapsed;
  }

  /* ------------------------------------------------------------------------------------- */

  update(dt: number, world: DirectorWorld): DirectorAction[] {
    const setup = this.setup;
    if (!setup) return [];
    const actions: DirectorAction[] = [];
    const s = this.state;
    s.elapsed += dt;
    s.sinceLastSelection += dt;
    s.sinceLastDecoy += dt;

    if (!this.initialized) {
      this.initialized = true;
      for (let i = 0; i < setup.difficulty.anomalies.initialSelections; i++) this.selectNext(world);
    }

    for (const rs of Object.values(s.anomalies)) {
      const def = this.defs.get(rs.id);
      if (!def) continue;
      if (rs.status === 'pending') {
        if (this.triggerSatisfied(def, world)) {
          rs.status = 'active';
          rs.activatedAt = s.elapsed;
          rs.timesActivated++;
          s.history.push(def.id);
          if (s.history.length > 12) s.history.shift();
          actions.push({ type: 'activate', anomaly: def });
        } else if (s.elapsed - (rs.selectedAt ?? 0) > PENDING_TIMEOUT_SEC) {
          rs.status = 'idle';
          this.lastResolvedAt.set(def.id, s.elapsed - def.cooldownSec * 0.66);
        }
      } else if (rs.status === 'active') {
        const age = s.elapsed - (rs.activatedAt ?? 0);
        if (age > setup.difficulty.anomalies.unwitnessedLifetimeSec && this.isUnobserved(def, world, 3)) {
          rs.status = 'idle';
          rs.retiredAt = s.elapsed;
          this.lastResolvedAt.set(def.id, s.elapsed);
          actions.push({ type: 'retire', anomaly: def, reason: 'expired' });
        }
      } else if (rs.status === 'reported') {
        if (this.isUnobserved(def, world, 2)) {
          rs.status = 'retired';
          rs.retiredAt = s.elapsed;
          actions.push({ type: 'retire', anomaly: def, reason: 'resolved' });
        }
      }
    }

    const level = this.levelConfig(world.attentionLevel);
    const interval = setup.difficulty.anomalies.evaluationIntervalSec * level.anomalyIntervalMultiplier;
    const nothingToFind = this.countStatus('pending') + this.countStatus('active') + this.countStatus('witnessed') === 0;
    if (s.sinceLastSelection >= interval || (nothingToFind && s.sinceLastSelection >= STARVATION_SEC)) {
      if (this.openSlots(world) > 0) this.selectNext(world);
      s.sinceLastSelection = 0;
    }

    const decoy = this.maybeDecoy(world, level);
    if (decoy) actions.push({ type: 'decoy', decoy });
    return actions;
  }

  /** Remaining room for new selections. */
  openSlots(world: DirectorWorld): number {
    const setup = this.setup;
    if (!setup) return 0;
    const pendingOrFresh = this.countStatus('pending') + this.countStatus('active');
    const witnessed = this.countStatus('witnessed');
    const remaining = Math.max(0, setup.stage.requiredReports - world.confirmedCount);
    if (witnessed >= remaining + 2) return 0;
    return setup.difficulty.anomalies.maxSimultaneous - pendingOrFresh;
  }

  /** Selects one anomaly (weighted, seeded) and marks it pending. Returns it, or null. */
  selectNext(world: DirectorWorld): AnomalyDefinition | null {
    const setup = this.setup;
    if (!setup) return null;
    let chosen = this.rng.weighted(this.eligible(world, false), (d) => this.weightOf(d, world));
    if (!chosen) {
      // Fallback: always-eligible anomalies, ignoring rating and adaptive constraints.
      const fallback = setup.stage.fallbackAnomalyIds
        .map((id) => this.defs.get(id))
        .filter((d): d is AnomalyDefinition => !!d && this.isEligible(d, world, true));
      chosen = this.rng.weighted(fallback, (d) => d.weight ?? 1);
    }
    if (!chosen) return null;
    const rs = this.state.anomalies[chosen.id];
    rs.status = 'pending';
    rs.selectedAt = this.state.elapsed;
    return chosen;
  }

  eligible(world: DirectorWorld, relaxed: boolean): AnomalyDefinition[] {
    return [...this.defs.values()].filter((d) => this.isEligible(d, world, relaxed));
  }

  isEligible(def: AnomalyDefinition, world: DirectorWorld, relaxed: boolean): boolean {
    const setup = this.setup;
    if (!setup) return false;
    const rs = this.state.anomalies[def.id];
    if (!rs || rs.status !== 'idle') return false;
    if (rs.timesActivated > 0 && !def.repeatable) return false;
    const last = this.lastResolvedAt.get(def.id);
    if (last !== undefined && this.state.elapsed - last < def.cooldownSec) return false;

    const diff = setup.difficulty.anomalies;
    if (!relaxed) {
      if (!diff.allowedRatings.includes(def.difficulty) || diff.ratingWeights[def.difficulty] <= 0) return false;
      for (const req of def.requiredTendencies ?? []) {
        if ((world.profile.scores[req.tendency] ?? 0) < req.min) return false;
      }
    }

    const c = def.conditions;
    if (c) {
      if (c.minElapsedSec !== undefined && this.state.elapsed < c.minElapsedSec) return false;
      if (c.minConfirmed !== undefined && world.confirmedCount < c.minConfirmed) return false;
      if (c.requiresVisited && world.roomVisits(def.roomId) < 1) return false;
      if (c.minVisits !== undefined && world.roomVisits(def.roomId) < c.minVisits) return false;
      const lvl = attentionLevelIndex(world.attentionLevel);
      if (c.minAttention && lvl < attentionLevelIndex(c.minAttention)) return false;
      if (c.maxAttention && lvl > attentionLevelIndex(c.maxAttention)) return false;
      if (c.requiresFlags && !c.requiresFlags.every((f) => world.flags.has(f))) return false;
      if (c.requiresDoorState && world.doorStates[c.requiresDoorState.doorId] !== c.requiresDoorState.state) return false;
    }
    for (const dep of def.dependsOn ?? []) {
      if ((this.state.anomalies[dep]?.timesActivated ?? 0) === 0) return false;
    }
    return !this.conflictsWithInPlay(def, diff.maxPerRoom);
  }

  private conflictsWithInPlay(def: AnomalyDefinition, maxPerRoom: number): boolean {
    const props = new Set(effectPropIds(def));
    const scopes = new Set(effectRoomScopes(def));
    let sameRoom = 0;
    for (const rs of Object.values(this.state.anomalies)) {
      if (!IN_PLAY.has(rs.status) && rs.status !== 'reported') continue;
      const other = this.defs.get(rs.id);
      if (!other || other.id === def.id) continue;
      if (IN_PLAY.has(rs.status) && other.roomId === def.roomId) sameRoom++;
      if (def.exclusiveGroup && def.exclusiveGroup === other.exclusiveGroup) return true;
      if ((def.conflictsWith ?? []).includes(other.id) || (other.conflictsWith ?? []).includes(def.id)) return true;
      if (effectPropIds(other).some((p) => props.has(p))) return true;
      if (effectRoomScopes(other).some((sc) => scopes.has(sc))) return true;
    }
    return sameRoom >= maxPerRoom;
  }

  /** Selection weight: base x rating x adaptive tendencies x behaviour responses x anti-repetition. */
  weightOf(def: AnomalyDefinition, world: DirectorWorld): number {
    const setup = this.setup;
    if (!setup) return 0;
    const diff = setup.difficulty.anomalies;
    const strength = diff.adaptationStrength;
    let w = (def.weight ?? 1) * (diff.ratingWeights[def.difficulty] ?? 0);

    for (const [t, bonus] of Object.entries(def.tendencyWeights ?? {})) {
      const score = world.profile.scores[t as keyof BehaviorProfile['scores']] ?? 0;
      w *= 1 + strength * score * (bonus ?? 0);
    }
    for (const response of this.activeResponses(world.profile)) {
      for (const tag of def.tags ?? []) {
        const mult = response.tagWeightMultipliers?.[tag];
        if (mult !== undefined) w *= Math.max(0, 1 + (mult - 1) * strength);
      }
    }
    if (def.category === 'spatial') w *= this.levelConfig(world.attentionLevel).spatialWeight;

    const history = this.state.history;
    const lastId = history[history.length - 1];
    const last = lastId ? this.defs.get(lastId) : undefined;
    if (last && last.category === def.category) w *= 0.5;
    const recentRooms = history.slice(-2).map((id) => this.defs.get(id)?.roomId);
    if (recentRooms.includes(def.roomId)) w *= 0.55;
    if ((this.state.anomalies[def.id]?.timesActivated ?? 0) > 0) w *= 0.4;
    return w;
  }

  activeResponses(profile: BehaviorProfile): BehaviorResponseDefinition[] {
    return (this.setup?.responses ?? []).filter((r) => (profile.scores[r.tendency] ?? 0) >= r.threshold);
  }

  triggerSatisfied(def: AnomalyDefinition, world: DirectorWorld): boolean {
    const t = def.trigger;
    const inRoom = world.playerRoomId === def.roomId;
    const targetUnseen = def.targetPropId ? world.propUnseenSeconds(def.targetPropId) >= MIN_UNSEEN_FOR_CHANGE : true;
    switch (t.type) {
      case 'immediate':
        return t.allowObserved ? true : !inRoom && targetUnseen;
      case 'room-exit':
        return !inRoom && targetUnseen && world.roomVisits(def.roomId) >= (t.minVisits ?? 1);
      case 'room-return':
        return (
          !inRoom &&
          targetUnseen &&
          world.roomVisits(def.roomId) >= t.minVisits &&
          world.playerRoomId !== null &&
          world.adjacentRooms(def.roomId).includes(world.playerRoomId)
        );
      case 'unobserved':
        return def.targetPropId ? world.propUnseenSeconds(def.targetPropId) >= t.minUnseenSec : !inRoom;
      case 'event':
        return (this.state.eventCounts[t.event] ?? 0) >= (t.count ?? 1);
    }
  }

  private isUnobserved(def: AnomalyDefinition, world: DirectorWorld, seconds: number): boolean {
    if (world.playerRoomId === def.roomId) return false;
    if (def.alternateRoomIds?.includes(world.playerRoomId ?? '')) return false;
    return def.targetPropId ? world.propUnseenSeconds(def.targetPropId) >= seconds : true;
  }

  private maybeDecoy(world: DirectorWorld, level: AttentionLevelConfig): DecoyDefinition | null {
    const setup = this.setup;
    if (!setup || setup.decoys.length === 0 || !world.playerRoomId) return null;
    let rate = setup.difficulty.decoys.perMinute;
    for (const r of this.activeResponses(world.profile)) rate *= r.decoyRateMultiplier ?? 1;
    rate *= 1 + attentionLevelIndex(level.level) * 0.15;
    if (rate <= 0) return null;
    const interval = 60 / rate;
    if (this.state.sinceLastDecoy < interval) return null;
    this.state.sinceLastDecoy = -this.rng.range(0, interval * 0.35);
    const near = new Set([world.playerRoomId, ...world.adjacentRooms(world.playerRoomId)]);
    const responses = this.activeResponses(world.profile);
    return (
      this.rng.weighted(
        setup.decoys.filter((d) => near.has(d.roomId)),
        (d) => {
          let w = d.weight ?? 1;
          for (const r of responses) for (const tag of d.tags ?? []) w *= r.decoyTagMultipliers?.[tag] ?? 1;
          return w;
        },
      ) ?? null
    );
  }

  private countStatus(status: AnomalyRuntimeState['status']): number {
    let n = 0;
    for (const s of Object.values(this.state.anomalies)) if (s.status === status) n++;
    return n;
  }

  private levelConfig(level: AttentionLevel): AttentionLevelConfig {
    const levels = this.setup?.levels ?? ATTENTION_LEVEL_CONFIGS;
    return levels.find((l) => l.level === level) ?? levels[0];
  }
}
