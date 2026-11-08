import { AnomalyDefinition, DifficultyConfig, Observation } from '../models';
import { registry } from '../testing/fake-world';
import { InvestigationService, categoryAccepted, scoreReport } from './investigation.service';

const anomalies = new Map<string, AnomalyDefinition>(registry.anomalies.all().map((a) => [a.id, a]));
const diff = (id: string): DifficultyConfig => registry.difficulties.require(id);

function obs(partial: Partial<Observation>): Observation {
  return {
    id: 'obs-1',
    time: 10,
    clock: '09:30',
    roomId: 'conference',
    subject: 'Wall clock',
    text: 'The second hand sweeps counter-clockwise.',
    source: { kind: 'anomaly', anomalyId: 'cnf-clock-backward' },
    reported: false,
    ...partial,
  };
}

describe('report scoring', () => {
  const ctx = (difficulty = 'employee', confirmed: string[] = []) => ({
    anomalies,
    difficulty: diff(difficulty),
    confirmedAnomalyIds: new Set(confirmed),
  });

  it('confirms a genuine anomaly in the right room and category', () => {
    const r = scoreReport({ observationId: 'obs-1', roomId: 'conference', category: 'temporal' }, obs({}), ctx());
    expect(r.outcome).toBe('confirmed');
    expect(r.attentionDelta).toBeLessThan(0);
  });

  it('rejects mundane observations and decoys with an attention penalty', () => {
    const prop = scoreReport({ observationId: 'obs-1', roomId: 'conference', category: 'visual' }, obs({ source: { kind: 'prop', propId: 'cnf-table' } }), ctx());
    const decoy = scoreReport({ observationId: 'obs-1', roomId: 'open-plan', category: 'audio' }, obs({ roomId: 'open-plan', source: { kind: 'decoy', decoyId: 'dec-printer' } }), ctx());
    for (const r of [prop, decoy]) {
      expect(r.outcome).toBe('rejected');
      expect(r.attentionDelta).toBe(diff('employee').attention.falseReportPenalty);
    }
  });

  it('applies category tolerance per difficulty', () => {
    const clock = anomalies.get('cnf-clock-backward')!; // temporal, accepts visual
    expect(categoryAccepted(clock, 'audio', 'any')).toBe(true);
    expect(categoryAccepted(clock, 'visual', 'accepted')).toBe(true);
    expect(categoryAccepted(clock, 'audio', 'accepted')).toBe(false);
    expect(categoryAccepted(clock, 'visual', 'primary')).toBe(false);
    expect(categoryAccepted(clock, 'temporal', 'primary')).toBe(true);

    const report = { observationId: 'obs-1', roomId: 'conference', category: 'audio' as const };
    expect(scoreReport(report, obs({}), ctx('observer')).outcome).toBe('confirmed');
    const normal = scoreReport(report, obs({}), ctx('employee'));
    expect(normal.outcome).toBe('mismatch');
    expect(normal.attentionDelta).toBe(diff('employee').attention.categoryMismatchPenalty);
  });

  it('accepts alternate rooms and refuses duplicates', () => {
    const feed = obs({ roomId: 'security', alternateRoomIds: ['break-room'], source: { kind: 'anomaly', anomalyId: 'sec-camera-figure' } });
    expect(scoreReport({ observationId: 'obs-1', roomId: 'break-room', category: 'visual' }, feed, ctx()).outcome).toBe('confirmed');
    expect(scoreReport({ observationId: 'obs-1', roomId: 'break-room', category: 'visual' }, feed, ctx('employee', ['sec-camera-figure'])).outcome).toBe('duplicate');
    expect(scoreReport({ observationId: 'obs-1', roomId: 'conference', category: 'visual' }, { ...feed, reported: true }, ctx()).outcome).toBe('duplicate');
  });

  it('missing observations are invalid (no penalty)', () => {
    const r = scoreReport({ observationId: 'nope', roomId: 'conference', category: 'visual' }, undefined, ctx());
    expect(r.outcome).toBe('invalid');
    expect(r.attentionDelta).toBe(0);
  });
});

describe('InvestigationService', () => {
  it('deduplicates notebook entries sensibly', () => {
    const s = new InvestigationService();
    s.reset();
    const base = { time: 1, clock: '09:00', roomId: 'conference', subject: 'Clock' };
    expect(s.addObservation({ ...base, text: 'a', source: { kind: 'anomaly', anomalyId: 'x' } }).isNew).toBe(true);
    expect(s.addObservation({ ...base, text: 'a', source: { kind: 'anomaly', anomalyId: 'x' } }).isNew).toBe(false);
    expect(s.addObservation({ ...base, text: 'plant by window', source: { kind: 'prop', propId: 'p' } }).isNew).toBe(true);
    expect(s.addObservation({ ...base, text: 'plant by window', source: { kind: 'prop', propId: 'p' } }).isNew).toBe(false);
    // the prop changed -> a new, comparable entry
    expect(s.addObservation({ ...base, text: 'plant by desk', source: { kind: 'prop', propId: 'p' } }).isNew).toBe(true);
    expect(s.observations().length).toBe(3);
  });

  it('does not repeat a mundane decoy note until the earlier one was filed', () => {
    const s = new InvestigationService();
    s.reset();
    const decoy = { clock: '09:00', roomId: 'storage', subject: 'Dripping', text: 'drip', source: { kind: 'decoy' as const, decoyId: 'dec-storage-drip' } };
    expect(s.addObservation({ ...decoy, time: 10 }).isNew).toBe(true);
    expect(s.addObservation({ ...decoy, time: 500 }).isNew).toBe(false);
    const first = s.observations()[0];
    const ctx = { anomalies, difficulty: diff('employee'), confirmedAnomalyIds: new Set<string>() };
    s.submitReport({ observationId: first.id, roomId: 'storage', category: 'audio' }, ctx, 600);
    expect(s.addObservation({ ...decoy, time: 700 }).isNew).toBe(true);
  });

  it('tracks progress, false reports and marks entries as filed', () => {
    const s = new InvestigationService();
    s.reset();
    const a = s.addObservation({ time: 1, clock: '09:00', roomId: 'conference', subject: 'Clock', text: 't', source: { kind: 'anomaly', anomalyId: 'cnf-clock-backward' } }).observation;
    const p = s.addObservation({ time: 2, clock: '09:01', roomId: 'conference', subject: 'Table', text: 'u', source: { kind: 'prop', propId: 'cnf-table' } }).observation;
    const ctx = { anomalies, difficulty: diff('employee'), confirmedAnomalyIds: new Set<string>() };
    expect(s.submitReport({ observationId: p.id, roomId: 'conference', category: 'visual' }, ctx, 3).outcome).toBe('rejected');
    expect(s.submitReport({ observationId: a.id, roomId: 'conference', category: 'temporal' }, ctx, 4).outcome).toBe('confirmed');
    expect(s.confirmedCount()).toBe(1);
    expect(s.falseReportCount()).toBe(1);
    expect(s.observations().every((o) => o.reported)).toBe(true);
    const exported = s.export();
    const restored = new InvestigationService();
    restored.restore(exported);
    expect(restored.confirmedCount()).toBe(1);
    expect(restored.reports().length).toBe(2);
  });
});
