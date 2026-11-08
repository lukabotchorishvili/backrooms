import { Injectable, computed, signal } from '@angular/core';
import {
  ESCALATION_DURATION_SEC,
  ESCALATION_RECOVERY_VALUE,
  ATTENTION_LEVEL_CONFIGS,
} from '../content/attention/attention-levels';
import {
  AttentionLevel,
  AttentionLevelConfig,
  AttentionState,
  DifficultyConfig,
  GameEvent,
  attentionLevelIndex,
} from '../models';

/** Seconds after an escalation during which attention cannot reach CRITICAL again. */
export const POST_ESCALATION_GRACE_SEC = 75;

export function attentionLevelFor(
  value: number,
  levels: readonly AttentionLevelConfig[] = ATTENTION_LEVEL_CONFIGS,
): AttentionLevelConfig {
  let result = levels[0];
  for (const config of levels) if (value >= config.min) result = config;
  return result;
}

export interface AttentionTickContext {
  readonly sprinting: boolean;
  readonly overtime: boolean;
}

/**
 * BUILDING ATTENTION: a 0..100 narrative pressure meter (not health).
 * There is no failure state - CRITICAL triggers an escalation sequence that always recovers.
 */
@Injectable({ providedIn: 'root' })
export class AttentionSystemService {
  private readonly valueSignal = signal(0);
  readonly value = this.valueSignal.asReadonly();
  readonly levelConfig = computed(() => attentionLevelFor(this.valueSignal(), this.levels));
  readonly level = computed<AttentionLevel>(() => this.levelConfig().level);
  private readonly escalatingSignal = signal(false);
  readonly escalating = this.escalatingSignal.asReadonly();

  private levels: readonly AttentionLevelConfig[] = ATTENTION_LEVEL_CONFIGS;
  private difficulty: DifficultyConfig | null = null;
  private state: AttentionState = { value: 0, peak: 0, escalations: 0, escalationRemaining: 0 };
  private grace = 0;
  private lastLevel: AttentionLevel = 'low';

  configure(difficulty: DifficultyConfig, levels: readonly AttentionLevelConfig[] = ATTENTION_LEVEL_CONFIGS): void {
    this.difficulty = difficulty;
    this.levels = levels;
  }

  reset(): void {
    this.state = { value: 0, peak: 0, escalations: 0, escalationRemaining: 0 };
    this.grace = 0;
    this.lastLevel = 'low';
    this.sync();
  }

  restore(state: AttentionState): void {
    const v = Number.isFinite(state.value) ? Math.min(100, Math.max(0, state.value)) : 0;
    this.state = {
      value: v,
      peak: Math.max(v, state.peak || 0),
      escalations: state.escalations || 0,
      escalationRemaining: 0,
    };
    this.grace = 0;
    this.lastLevel = attentionLevelFor(v, this.levels).level;
    this.sync();
  }

  snapshot(): AttentionState {
    return { ...this.state };
  }

  isEscalating(): boolean {
    return this.state.escalationRemaining > 0;
  }

  /**
   * Raise attention. Positive amounts are scaled by the difficulty's gain multiplier unless
   * `raw` is set (penalties already defined per difficulty pass raw = true).
   */
  raise(amount: number, raw = false): GameEvent[] {
    if (amount <= 0) return [];
    const scaled = raw ? amount : amount * (this.difficulty?.attention.gainMultiplier ?? 1);
    return this.setValue(this.state.value + scaled);
  }

  /** Lower attention (correct reports, calming interactions). Ignored during escalation. */
  relieve(amount: number): GameEvent[] {
    if (amount <= 0 || this.isEscalating()) return [];
    return this.setValue(this.state.value - amount);
  }

  update(dt: number, ctx: AttentionTickContext): GameEvent[] {
    const events: GameEvent[] = [];
    const diff = this.difficulty;
    if (!diff) return events;
    if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);

    if (this.state.escalationRemaining > 0) {
      this.state.escalationRemaining = Math.max(0, this.state.escalationRemaining - dt);
      if (this.state.escalationRemaining === 0) {
        this.grace = POST_ESCALATION_GRACE_SEC;
        events.push(...this.setValue(ESCALATION_RECOVERY_VALUE, true));
        events.push({ type: 'escalation-end' });
        this.escalatingSignal.set(false);
      }
      return events;
    }

    let delta = 0;
    if (ctx.sprinting) delta += diff.attention.sprintGainPerSec * dt;
    if (ctx.overtime) delta += diff.attention.overtimeGainPerSec * dt;
    const levelIdx = attentionLevelIndex(this.levelConfig().level);
    if (!ctx.sprinting && levelIdx < attentionLevelIndex('high')) delta -= diff.attention.decayPerSec * dt;
    if (delta !== 0) events.push(...this.setValue(this.state.value + delta));
    return events;
  }

  private setValue(next: number, force = false): GameEvent[] {
    const events: GameEvent[] = [];
    let value = Math.min(100, Math.max(0, next));
    const criticalMin = this.levels.find((l) => l.level === 'critical')?.min ?? 80;
    if (!force && this.grace > 0) value = Math.min(value, criticalMin - 1);
    if (this.isEscalating()) value = Math.max(value, criticalMin);
    this.state.value = value;
    this.state.peak = Math.max(this.state.peak, value);

    const level = attentionLevelFor(value, this.levels).level;
    if (level !== this.lastLevel) {
      events.push({ type: 'attention-level', level, previous: this.lastLevel });
      this.lastLevel = level;
    }
    if (!force && level === 'critical' && !this.isEscalating()) {
      this.state.escalationRemaining = ESCALATION_DURATION_SEC;
      this.state.escalations++;
      this.escalatingSignal.set(true);
      events.push({ type: 'escalation-start' });
    }
    this.sync();
    return events;
  }

  private sync(): void {
    this.valueSignal.set(Math.round(this.state.value * 10) / 10);
    this.escalatingSignal.set(this.state.escalationRemaining > 0);
  }
}
