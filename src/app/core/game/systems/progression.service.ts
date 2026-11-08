import { Injectable, computed, signal } from '@angular/core';
import {
  EndingCondition,
  EndingDefinition,
  EndingResolutionContext,
  EndingTrigger,
  ObjectiveId,
  ProgressionState,
} from '../models';

export function evaluateEndingCondition(cond: EndingCondition, ctx: EndingResolutionContext): boolean {
  switch (cond.type) {
    case 'investigation-complete':
      return ctx.investigationComplete;
    case 'attention-at-least':
      return ctx.attention >= cond.value;
    case 'attention-below':
      return ctx.attention < cond.value;
    case 'peak-attention-at-least':
      return ctx.peakAttention >= cond.value;
    case 'escalations-at-least':
      return ctx.escalations >= cond.value;
    case 'flag':
      return ctx.flags.has(cond.flag);
    case 'any':
      return cond.conditions.some((c) => evaluateEndingCondition(c, ctx));
  }
}

/** Highest-priority ending for the trigger whose conditions all hold (or null). */
export function resolveEnding(
  endings: readonly EndingDefinition[],
  trigger: EndingTrigger,
  ctx: EndingResolutionContext,
): EndingDefinition | null {
  const candidates = endings
    .filter((e) => e.trigger === trigger)
    .sort((a, b) => b.priority - a.priority);
  return candidates.find((e) => e.conditions.every((c) => evaluateEndingCondition(c, ctx))) ?? null;
}

/**
 * Objectives, progression flags and the locked-in ending.
 * Flow: find-terminal -> investigate -> request-access -> take-elevator -> complete.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private readonly objectiveSignal = signal<ObjectiveId>('find-terminal');
  readonly objective = this.objectiveSignal.asReadonly();
  private readonly flagsSignal = signal<ReadonlySet<string>>(new Set());
  readonly flags = this.flagsSignal.asReadonly();
  private readonly pendingEndingSignal = signal<string | null>(null);
  readonly pendingEndingId = this.pendingEndingSignal.asReadonly();
  readonly accessGranted = computed(() => this.flagsSignal().has('access-granted'));

  reset(): void {
    this.objectiveSignal.set('find-terminal');
    this.flagsSignal.set(new Set());
    this.pendingEndingSignal.set(null);
  }

  restore(state: ProgressionState): void {
    this.objectiveSignal.set(state.objective);
    this.flagsSignal.set(new Set(state.flags));
    this.pendingEndingSignal.set(state.pendingEndingId);
  }

  export(): ProgressionState {
    return { objective: this.objectiveSignal(), flags: [...this.flagsSignal()], pendingEndingId: this.pendingEndingSignal() };
  }

  hasFlag(flag: string): boolean {
    return this.flagsSignal().has(flag);
  }

  /** Returns true if the flag was newly set. */
  setFlag(flag: string): boolean {
    if (this.flagsSignal().has(flag)) return false;
    this.flagsSignal.update((f) => new Set([...f, flag]));
    return true;
  }

  terminalOpened(): boolean {
    this.setFlag('terminal-used');
    if (this.objectiveSignal() === 'find-terminal') {
      this.objectiveSignal.set('investigate');
      return true;
    }
    return false;
  }

  /** Called after each confirmed report. Returns true when the investigation completes. */
  confirmedChanged(confirmed: number, required: number): boolean {
    if (confirmed >= required && (this.objectiveSignal() === 'investigate' || this.objectiveSignal() === 'find-terminal')) {
      this.objectiveSignal.set('request-access');
      this.setFlag('investigation-complete');
      return true;
    }
    return false;
  }

  canRequestAccess(): boolean {
    return this.objectiveSignal() === 'request-access';
  }

  grantAccess(): boolean {
    if (!this.canRequestAccess()) return false;
    this.setFlag('access-granted');
    this.objectiveSignal.set('take-elevator');
    return true;
  }

  lockEnding(id: string): void {
    this.pendingEndingSignal.set(id);
  }

  complete(): void {
    this.objectiveSignal.set('complete');
  }
}
