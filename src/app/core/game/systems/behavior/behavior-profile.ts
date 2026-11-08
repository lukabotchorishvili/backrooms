import {
  BEHAVIOR_TENDENCIES,
  BehaviorMetrics,
  BehaviorProfile,
  BehaviorTendency,
  NormalizedBehavior,
  clamp01,
  saturate,
} from '../../models';

export interface NormalizationContext {
  /** Number of inspectable objects on the stage (for coverage). */
  readonly totalInteractables: number;
}

/** Score at which a tendency counts as "dominant". */
export const DOMINANCE_THRESHOLD = 0.55;
/** Seconds of play before the profile is fully trusted. */
export const PROFILE_CONFIDENCE_SEC = 90;

export function createEmptyMetrics(): BehaviorMetrics {
  return {
    totalTime: 0,
    moveTime: 0,
    sprintTime: 0,
    slowMoveTime: 0,
    stillTime: 0,
    darkTime: 0,
    flashlightTime: 0,
    lookAroundDegrees: 0,
    doorInteractions: 0,
    lockedDoorAttempts: 0,
    roomEntries: 0,
    roomRevisits: 0,
    backtracks: 0,
    inspections: 0,
    uniqueInspections: 0,
    gazes: 0,
    interactions: 0,
    flashlightToggles: 0,
    sprintStarts: 0,
    correctReports: 0,
    falseReports: 0,
    anomaliesWitnessed: 0,
    roomTime: {},
    roomVisits: {},
    objectGazes: {},
    inspectedProps: [],
    firstRoomEntryClock: {},
  };
}

/** Repairs metrics loaded from storage (missing fields get defaults). */
export function sanitizeMetrics(input: Partial<BehaviorMetrics> | null | undefined): BehaviorMetrics {
  const base = createEmptyMetrics();
  if (!input || typeof input !== 'object') return base;
  const out = { ...base } as BehaviorMetrics;
  for (const key of Object.keys(base) as (keyof BehaviorMetrics)[]) {
    const value = input[key];
    const def = base[key];
    if (typeof def === 'number') {
      (out as unknown as Record<string, unknown>)[key] = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    } else if (Array.isArray(def)) {
      (out as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
    } else {
      (out as unknown as Record<string, unknown>)[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    }
  }
  return out;
}

/** Adds run metrics into lifetime metrics. */
export function mergeMetrics(a: BehaviorMetrics, b: BehaviorMetrics): BehaviorMetrics {
  const out = createEmptyMetrics();
  for (const key of Object.keys(out) as (keyof BehaviorMetrics)[]) {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      (out as unknown as Record<string, number>)[key] = av + bv;
    }
  }
  const sumRecords = (x: Record<string, number>, y: Record<string, number>) => {
    const r: Record<string, number> = { ...x };
    for (const [k, v] of Object.entries(y)) r[k] = (r[k] ?? 0) + v;
    return r;
  };
  out.roomTime = sumRecords(a.roomTime, b.roomTime);
  out.roomVisits = sumRecords(a.roomVisits, b.roomVisits);
  out.objectGazes = sumRecords(a.objectGazes, b.objectGazes);
  out.inspectedProps = [...new Set([...a.inspectedProps, ...b.inspectedProps])];
  out.firstRoomEntryClock = { ...b.firstRoomEntryClock };
  return out;
}

export function normalizeMetrics(m: BehaviorMetrics, ctx: NormalizationContext): NormalizedBehavior {
  const minutes = Math.max(m.totalTime / 60, 0.5);
  const uniqueRooms = Math.max(1, Object.keys(m.roomVisits).length);
  const moveTime = Math.max(m.moveTime, 1);
  const total = Math.max(m.totalTime, 1);
  const darkRatio = m.darkTime / total;
  // Avoidance is only meaningful once the player has had time to meet dark rooms.
  const avoidanceConfidence = clamp01((m.totalTime - 120) / 240);
  const reports = m.correctReports + m.falseReports;
  return {
    doorFrequency: saturate((m.doorInteractions + m.lockedDoorAttempts * 1.5) / minutes, 1.6),
    inspectionRate: saturate(m.inspections / minutes, 2),
    objectCoverage: clamp01(m.uniqueInspections / Math.max(1, ctx.totalInteractables)),
    revisitRatio: saturate(m.roomRevisits / uniqueRooms, 2),
    backtrackRate: saturate(m.backtracks / minutes, 0.6),
    sprintRatio: clamp01(m.sprintTime / moveTime),
    slowMoveRatio: clamp01(m.slowMoveTime / moveTime),
    stillRatio: clamp01(m.stillTime / total),
    lookAroundRate: saturate(m.lookAroundDegrees / 360 / minutes, 3),
    darkRatio: clamp01(darkRatio),
    darkAvoidance: (1 - clamp01(darkRatio / 0.12)) * avoidanceConfidence,
    flashlightRatio: clamp01(m.flashlightTime / total),
    interactionRate: saturate(m.interactions / minutes, 3),
    reportAccuracy: (m.correctReports + 1) / (reports + 2),
    witnessRate: saturate(m.anomaliesWitnessed / minutes, 0.4),
  };
}

/** Weighted tendency formulas. Exposed for documentation and tests. */
export function tendencyScores(n: NormalizedBehavior, m: BehaviorMetrics): Record<BehaviorTendency, number> {
  const reports = m.correctReports + m.falseReports;
  const accuracyEvidence = reports >= 2 ? n.reportAccuracy : 0.5 * n.reportAccuracy;
  return {
    curious: 0.45 * n.inspectionRate + 0.35 * n.objectCoverage + 0.2 * n.interactionRate,
    cautious: 0.3 * n.slowMoveRatio * (1 - n.sprintRatio) + 0.45 * n.lookAroundRate + 0.25 * clamp01(n.stillRatio * 2.5),
    rusher: 0.62 * n.sprintRatio + 0.38 * (1 - n.inspectionRate),
    repetitive: 0.65 * n.revisitRatio + 0.35 * n.backtrackRate,
    avoidant: 0.8 * n.darkAvoidance + 0.2 * n.darkAvoidance * (1 - clamp01(n.flashlightRatio * 4)),
    observant: 0.55 * accuracyEvidence + 0.45 * n.witnessRate,
    'door-checker': 0.78 * n.doorFrequency + 0.22 * saturate(m.lockedDoorAttempts, 3),
  };
}

export function computeProfile(
  n: NormalizedBehavior,
  m: BehaviorMetrics,
  threshold = DOMINANCE_THRESHOLD,
): BehaviorProfile {
  const confidence = clamp01(m.totalTime / PROFILE_CONFIDENCE_SEC);
  const raw = tendencyScores(n, m);
  const scores = {} as Record<BehaviorTendency, number>;
  for (const t of BEHAVIOR_TENDENCIES) scores[t] = clamp01(raw[t] * confidence);
  const dominant = BEHAVIOR_TENDENCIES.filter((t) => scores[t] >= threshold).sort((a, b) => scores[b] - scores[a]);
  return { scores, dominant };
}

export function mostVisitedRoom(m: BehaviorMetrics): { roomId: string; count: number } | null {
  let best: { roomId: string; count: number } | null = null;
  for (const [roomId, count] of Object.entries(m.roomVisits)) {
    if (!best || count > best.count) best = { roomId, count };
  }
  return best;
}
