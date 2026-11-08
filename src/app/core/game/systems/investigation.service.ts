import { Injectable, computed, signal } from '@angular/core';
import {
  ANOMALY_CATEGORY_LABELS,
  AnomalyCategory,
  AnomalyDefinition,
  AnomalyReport,
  DifficultyConfig,
  Observation,
  ObservationSource,
  ReportRecord,
  ReportResult,
  RoomId,
} from '../models';

export interface ScoreContext {
  readonly anomalies: ReadonlyMap<string, AnomalyDefinition>;
  readonly difficulty: DifficultyConfig;
  readonly confirmedAnomalyIds: ReadonlySet<string>;
}

/** Is `category` acceptable for the anomaly under the difficulty's tolerance? */
export function categoryAccepted(
  def: AnomalyDefinition,
  category: AnomalyCategory,
  tolerance: DifficultyConfig['reporting']['categoryTolerance'],
): boolean {
  if (tolerance === 'any') return true;
  if (category === def.category) return true;
  if (tolerance === 'accepted') return (def.acceptedCategories ?? []).includes(category);
  return false;
}

export function observationMatchesRoom(obs: Observation, roomId: RoomId): boolean {
  return obs.roomId === roomId || (obs.alternateRoomIds ?? []).includes(roomId);
}

/**
 * Pure report scoring. Does not mutate anything; the service applies the result.
 */
export function scoreReport(report: AnomalyReport, obs: Observation | undefined, ctx: ScoreContext): ReportResult {
  const d = ctx.difficulty;
  if (!obs) {
    return { outcome: 'invalid', headline: 'NO SUCH ENTRY', detail: 'Select an observation from your notebook.', attentionDelta: 0 };
  }
  if (obs.reported) {
    return { outcome: 'duplicate', headline: 'ALREADY FILED', detail: 'This observation has already been processed.', attentionDelta: 0 };
  }
  const source = obs.source;
  const isAnomaly = source.kind === 'anomaly';
  const def = isAnomaly ? ctx.anomalies.get(source.anomalyId) : undefined;

  if (!observationMatchesRoom(obs, report.roomId) || !def) {
    return {
      outcome: 'rejected',
      headline: 'NO IRREGULARITY FOUND',
      detail: 'Facilities found nothing out of the ordinary. This report has been noted.',
      attentionDelta: d.attention.falseReportPenalty,
    };
  }
  if (ctx.confirmedAnomalyIds.has(def.id)) {
    return {
      outcome: 'duplicate',
      anomalyId: def.id,
      headline: 'ALREADY FILED',
      detail: 'This irregularity was already confirmed.',
      attentionDelta: 0,
    };
  }
  if (!categoryAccepted(def, report.category, d.reporting.categoryTolerance)) {
    return {
      outcome: 'mismatch',
      anomalyId: def.id,
      headline: 'CLASSIFICATION REJECTED',
      detail: 'Something was observed, but it was filed under the wrong category.',
      attentionDelta: d.attention.categoryMismatchPenalty,
    };
  }
  return {
    outcome: 'confirmed',
    anomalyId: def.id,
    headline: 'IRREGULARITY CONFIRMED',
    detail: `Filed under ${ANOMALY_CATEGORY_LABELS[def.category].toUpperCase()}. Facilities will correct it.`,
    attentionDelta: -d.attention.correctReportRelief,
  };
}

/** Notebook (observations) + report history + investigation progress. */
@Injectable({ providedIn: 'root' })
export class InvestigationService {
  private readonly observationsSignal = signal<Observation[]>([]);
  readonly observations = this.observationsSignal.asReadonly();
  private readonly confirmedSignal = signal<string[]>([]);
  readonly confirmedAnomalyIds = this.confirmedSignal.asReadonly();
  private readonly reportsSignal = signal<ReportRecord[]>([]);
  readonly reports = this.reportsSignal.asReadonly();

  readonly confirmedCount = computed(() => this.confirmedSignal().length);
  readonly falseReportCount = computed(
    () => this.reportsSignal().filter((r) => r.outcome === 'rejected' || r.outcome === 'mismatch').length,
  );
  readonly unreportedCount = computed(() => this.observationsSignal().filter((o) => !o.reported).length);

  private counter = 0;

  reset(): void {
    this.observationsSignal.set([]);
    this.confirmedSignal.set([]);
    this.reportsSignal.set([]);
    this.counter = 0;
  }

  restore(data: { observations: Observation[]; confirmedAnomalyIds: string[]; reports: ReportRecord[] }): void {
    this.observationsSignal.set(data.observations.map((o) => ({ ...o })));
    this.confirmedSignal.set([...data.confirmedAnomalyIds]);
    this.reportsSignal.set([...data.reports]);
    this.counter = data.observations.length;
  }

  export(): { observations: Observation[]; confirmedAnomalyIds: string[]; reports: ReportRecord[] } {
    return {
      observations: this.observationsSignal().map((o) => ({ ...o })),
      confirmedAnomalyIds: [...this.confirmedSignal()],
      reports: [...this.reportsSignal()],
    };
  }

  isConfirmed(anomalyId: string): boolean {
    return this.confirmedSignal().includes(anomalyId);
  }

  /**
   * Log an observation. Duplicates are suppressed:
   * - the same unreported anomaly is only logged once;
   * - a prop is only re-logged when its description changed;
   * - the same decoy is not re-logged while an unreported note of it exists.
   */
  addObservation(input: Omit<Observation, 'id' | 'reported'>): { observation: Observation; isNew: boolean } {
    const list = this.observationsSignal();
    const existing = this.findDuplicate(list, input.source, input.text, input.time);
    if (existing) return { observation: existing, isNew: false };
    const observation: Observation = { ...input, id: `obs-${++this.counter}`, reported: false };
    this.observationsSignal.set([...list, observation]);
    return { observation, isNew: true };
  }

  private findDuplicate(list: Observation[], source: ObservationSource, text: string, time: number): Observation | undefined {
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const s = o.source;
      if (source.kind === 'anomaly' && s.kind === 'anomaly' && s.anomalyId === source.anomalyId) {
        return o.reported ? undefined : o;
      }
      if (source.kind === 'prop' && s.kind === 'prop' && s.propId === source.propId) {
        return o.text === text ? o : undefined;
      }
      if (source.kind === 'decoy' && s.kind === 'decoy' && s.decoyId === source.decoyId) {
        // The same mundane event is noted again only after the earlier note was filed.
        return !o.reported || time - o.time < 60 ? o : undefined;
      }
    }
    return undefined;
  }

  submitReport(report: AnomalyReport, ctx: ScoreContext, now: number): ReportResult {
    const obs = this.observationsSignal().find((o) => o.id === report.observationId);
    const result = scoreReport(report, obs, ctx);
    if (result.outcome === 'invalid') return result;
    if (result.outcome !== 'duplicate') {
      this.reportsSignal.update((r) => [
        ...r,
        { time: now, observationId: report.observationId, roomId: report.roomId, category: report.category, outcome: result.outcome },
      ]);
    }
    if (result.outcome === 'confirmed' || result.outcome === 'rejected') {
      this.observationsSignal.update((list) => list.map((o) => (o.id === report.observationId ? { ...o, reported: true } : o)));
    }
    if (result.outcome === 'confirmed' && result.anomalyId) {
      const id = result.anomalyId;
      this.confirmedSignal.update((c) => (c.includes(id) ? c : [...c, id]));
    }
    return result;
  }
}
