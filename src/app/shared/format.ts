import type { BehaviorTendency } from '../core/game/models';

/** 754 -> "12:34". Minutes are not wrapped into hours (a long shift reads "72:05"). */
export function formatDuration(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const TENDENCY_WORDS: Readonly<Record<BehaviorTendency, string>> = {
  curious: 'Curious',
  cautious: 'Cautious',
  rusher: 'Rusher',
  repetitive: 'Repetitive',
  avoidant: 'Avoidant',
  observant: 'Observant',
  'door-checker': 'Door-checker',
};

/** Dominant tendencies as a readable list ("Curious, Door-checker"), or "Unremarkable". */
export function describeTendencies(tendencies: readonly BehaviorTendency[]): string {
  if (!tendencies.length) return 'Unremarkable';
  return tendencies.map((t) => TENDENCY_WORDS[t] ?? t).join(', ');
}

/** 0.8 -> "80%". */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
