import { BehaviorMetrics, BEHAVIOR_TENDENCIES } from '../../models';
import { BehaviorTrackingService } from '../behavior-tracking.service';
import {
  computeProfile,
  createEmptyMetrics,
  mergeMetrics,
  mostVisitedRoom,
  normalizeMetrics,
  sanitizeMetrics,
} from './behavior-profile';

const ctx = { totalInteractables: 60 };

function metrics(patch: Partial<BehaviorMetrics>): BehaviorMetrics {
  return { ...createEmptyMetrics(), totalTime: 600, moveTime: 400, slowMoveTime: 400, stillTime: 200, ...patch };
}

function profileOf(patch: Partial<BehaviorMetrics>) {
  const m = metrics(patch);
  return computeProfile(normalizeMetrics(m, ctx), m);
}

describe('behaviour profile', () => {
  it('normalises every metric into 0..1', () => {
    const m = metrics({ doorInteractions: 500, inspections: 900, uniqueInspections: 200, roomRevisits: 99, backtracks: 80, sprintTime: 999, darkTime: 9999, flashlightTime: 9999, lookAroundDegrees: 1e7 });
    const n = normalizeMetrics(m, ctx);
    for (const [key, value] of Object.entries(n)) {
      expect(value, key).toBeGreaterThanOrEqual(0);
      expect(value, key).toBeLessThanOrEqual(1);
    }
  });

  it('a quiet first minute has low confidence (no tendency dominates)', () => {
    const m = { ...createEmptyMetrics(), totalTime: 20, moveTime: 20, slowMoveTime: 20, doorInteractions: 6 };
    const p = computeProfile(normalizeMetrics(m, ctx), m);
    expect(p.dominant).toEqual([]);
  });

  it('detects a CURIOUS player', () => {
    const p = profileOf({ inspections: 60, uniqueInspections: 45, interactions: 70 });
    expect(p.dominant).toContain('curious');
    expect(p.scores.rusher).toBeLessThan(0.55);
  });

  it('detects a RUSHER', () => {
    const p = profileOf({ sprintTime: 330, slowMoveTime: 70, inspections: 1 });
    expect(p.dominant).toContain('rusher');
    expect(p.dominant).not.toContain('curious');
  });

  it('detects a DOOR-CHECKER', () => {
    const p = profileOf({ doorInteractions: 40, lockedDoorAttempts: 6 });
    expect(p.dominant).toContain('door-checker');
  });

  it('detects REPETITIVE movement', () => {
    const p = profileOf({ roomVisits: { a: 9, b: 8, c: 2 }, roomRevisits: 16, backtracks: 9 });
    expect(p.dominant).toContain('repetitive');
  });

  it('detects AVOIDANT players only after enough time to meet dark rooms', () => {
    const early = { ...metrics({ darkTime: 0 }), totalTime: 100 };
    expect(computeProfile(normalizeMetrics(early, ctx), early).scores.avoidant).toBeLessThan(0.1);
    const late = profileOf({ darkTime: 0, totalTime: 900 });
    expect(late.dominant).toContain('avoidant');
    const explorer = profileOf({ darkTime: 200, flashlightTime: 200 });
    expect(explorer.dominant).not.toContain('avoidant');
  });

  it('detects OBSERVANT players from accurate reports', () => {
    const p = profileOf({ correctReports: 5, falseReports: 0, anomaliesWitnessed: 6 });
    expect(p.dominant).toContain('observant');
    const guesser = profileOf({ correctReports: 1, falseReports: 6, anomaliesWitnessed: 1 });
    expect(guesser.dominant).not.toContain('observant');
  });

  it('tendencies are not mutually exclusive', () => {
    const p = profileOf({ inspections: 70, uniqueInspections: 50, interactions: 80, doorInteractions: 45, lockedDoorAttempts: 4 });
    expect(p.dominant).toEqual(expect.arrayContaining(['curious', 'door-checker']));
    for (const t of BEHAVIOR_TENDENCIES) expect(p.scores[t]).toBeGreaterThanOrEqual(0);
  });

  it('merges and sanitises metrics', () => {
    const a = metrics({ inspections: 2, roomVisits: { x: 1 }, inspectedProps: ['p1'] });
    const b = metrics({ inspections: 3, roomVisits: { x: 2, y: 1 }, inspectedProps: ['p1', 'p2'] });
    const merged = mergeMetrics(a, b);
    expect(merged.inspections).toBe(5);
    expect(merged.roomVisits).toEqual({ x: 3, y: 1 });
    expect(merged.inspectedProps).toEqual(['p1', 'p2']);
    const repaired = sanitizeMetrics({ inspections: -4, totalTime: Number.NaN } as never);
    expect(repaired.inspections).toBe(0);
    expect(repaired.totalTime).toBe(0);
    expect(repaired.roomVisits).toEqual({});
  });

  it('mostVisitedRoom picks the highest count', () => {
    expect(mostVisitedRoom(metrics({ roomVisits: { a: 2, b: 5 } }))).toEqual({ roomId: 'b', count: 5 });
    expect(mostVisitedRoom(createEmptyMetrics())).toBeNull();
  });
});

describe('BehaviorTrackingService', () => {
  it('records meaningful events, revisits and backtracking', () => {
    const s = new BehaviorTrackingService();
    s.reset(ctx);
    s.record({ type: 'room-enter', roomId: 'a', previousRoomId: null }, 0, '09:00');
    s.record({ type: 'room-exit', roomId: 'a', durationSec: 5 }, 5, '09:01');
    s.record({ type: 'room-enter', roomId: 'b', previousRoomId: 'a' }, 5, '09:01');
    s.record({ type: 'room-exit', roomId: 'b', durationSec: 3 }, 8, '09:02');
    s.record({ type: 'room-enter', roomId: 'a', previousRoomId: 'b' }, 8, '09:02');
    s.record({ type: 'door-interact', doorId: 'd', result: 'open' }, 9, '09:02');
    s.record({ type: 'door-interact', doorId: 'd', result: 'locked-attempt' }, 9, '09:02');
    s.record({ type: 'object-inspect', propId: 'p', roomId: 'a' }, 10, '09:02');
    s.record({ type: 'object-inspect', propId: 'p', roomId: 'a' }, 11, '09:02');
    const m = s.getMetrics();
    expect(m.roomEntries).toBe(3);
    expect(m.roomRevisits).toBe(1);
    expect(m.backtracks).toBe(1);
    expect(m.doorInteractions).toBe(1);
    expect(m.lockedDoorAttempts).toBe(1);
    expect(m.inspections).toBe(2);
    expect(m.uniqueInspections).toBe(1);
    expect(m.firstRoomEntryClock).toEqual({ a: '09:00', b: '09:01' });
  });

  it('aggregates movement samples without storing them', () => {
    const s = new BehaviorTrackingService();
    s.reset(ctx);
    for (let i = 0; i < 100; i++) {
      s.sample({ dt: 0.1, speed: i < 50 ? 4 : 0, sprinting: i < 50, yawDeltaDeg: 2, inDarkArea: i % 2 === 0, flashlightOn: false, roomId: 'a' });
    }
    const m = s.getMetrics();
    expect(m.totalTime).toBeCloseTo(10);
    expect(m.sprintTime).toBeCloseTo(5);
    expect(m.stillTime).toBeCloseTo(5);
    expect(m.darkTime).toBeCloseTo(5);
    expect(m.roomTime['a']).toBeCloseTo(10);
    expect(Object.keys(m)).not.toContain('samples');
  });
});
