import { registeredEffectTypes } from '../engine/anomalies/effect-handlers';
import { ANOMALY_CATEGORIES, AnomalyDefinition, DifficultyConfig, StageDefinition } from '../models';
import { createDefaultContentRegistry } from './content-registry';
import { reachableRooms, validateDifficulty, validateRegistry, validateStage } from './content-validator';

const registry = createDefaultContentRegistry();
const stage = registry.stages.require('floor-14');
const errors = <T extends { level: string }>(issues: T[]) => issues.filter((i) => i.level === 'error');

function mutate(patch: (s: StageDefinition) => StageDefinition): StageDefinition {
  return patch(JSON.parse(JSON.stringify(stage)) as StageDefinition);
}

describe('content validation', () => {
  it('all built-in content is valid and every effect type has an engine handler', () => {
    const issues = validateRegistry(registry, { knownEffectTypes: registeredEffectTypes() });
    expect(errors(issues), JSON.stringify(errors(issues), null, 2)).toEqual([]);
  });

  it('floor 14 meets the MVP content requirements', () => {
    expect(stage.rooms.length).toBe(10);
    expect(stage.anomalyIds.length).toBeGreaterThanOrEqual(25);
    const pool = registry.anomaliesForStage(stage);
    for (const c of ANOMALY_CATEGORIES) expect(pool.filter((a) => a.category === c).length, c).toBeGreaterThanOrEqual(5);
    expect(registry.endingsForStage(stage).length).toBeGreaterThanOrEqual(3);
    // every anomaly has a discoverable clue
    for (const a of pool) expect(a.clue.observation.length, a.id).toBeGreaterThan(10);
  });

  it('every room is reachable from reception', () => {
    expect(reachableRooms(stage, stage.hubRoomId).size).toBe(stage.rooms.length);
  });

  it('reports duplicate ids, doors off walls and unreachable rooms', () => {
    const broken = mutate((s) => ({
      ...s,
      rooms: s.rooms.map((r, i) => (i === 0 ? { ...r, props: [...r.props, { ...r.props[0] }] } : r)),
      doors: s.doors
        .filter((d) => d.id !== 'd-cor-security')
        .map((d) => (d.id === 'd-open-conf' ? { ...d, center: 40 } : d)),
    }));
    const messages = errors(validateStage(broken, registry)).map((i) => i.message);
    expect(messages).toContain('duplicate prop id');
    expect(messages.some((m) => m.includes('does not lie on a wall'))).toBe(true);
    expect(messages.some((m) => m.includes('"security" is unreachable'))).toBe(true);
  });

  it('reports broken anomaly definitions', () => {
    const bad: AnomalyDefinition = {
      ...registry.anomalies.require('cnf-clock-backward'),
      id: 'broken',
      roomId: 'nowhere',
      effects: [{ type: 'set-text', propId: 'ghost-prop', text: 'x' }],
      clue: { mode: 'inspect', subject: 'x', observation: '' },
    };
    const reg = createDefaultContentRegistry();
    reg.anomalies.register(bad);
    const s = mutate((st) => ({ ...st, anomalyIds: [...st.anomalyIds, 'broken'] }));
    const messages = errors(validateStage(s, reg)).filter((i) => i.path.startsWith('anomaly:broken')).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'unknown room "nowhere"',
        'unknown prop "ghost-prop"',
        'clue observation text is required (fairness rule)',
        'clue mode "inspect" requires targetPropId',
      ]),
    );
  });

  it('rejects fallbacks that need a baseline and unknown effect handlers', () => {
    const s = mutate((st) => ({ ...st, fallbackAnomalyIds: ['rec-painting-figure'] }));
    expect(errors(validateStage(s, registry)).some((i) => i.message.includes('must be immediate'))).toBe(true);
    const unknown = errors(validateStage(stage, registry, { knownEffectTypes: ['sound'] }));
    expect(unknown.some((i) => i.message.includes('no engine handler registered'))).toBe(true);
  });

  it('refuses duplicate registrations', () => {
    const reg = createDefaultContentRegistry();
    expect(() => reg.anomalies.register(registry.anomalies.require('cnf-phone-ring'))).toThrow(/Duplicate anomaly id/);
  });
});

describe('difficulty configuration', () => {
  const [easy, normal, hard] = registry.sortedDifficulties();

  it('ships three valid presets', () => {
    expect([easy.id, normal.id, hard.id]).toEqual(['observer', 'employee', 'the-building-knows']);
    for (const d of [easy, normal, hard]) expect(validateDifficulty(d)).toEqual([]);
  });

  it('is ordered from forgiving to hostile', () => {
    const inc = (f: (d: DifficultyConfig) => number) => expect(f(easy) <= f(normal) && f(normal) <= f(hard)).toBe(true);
    const dec = (f: (d: DifficultyConfig) => number) => expect(f(easy) >= f(normal) && f(normal) >= f(hard)).toBe(true);
    inc((d) => d.anomalies.subtlety);
    inc((d) => d.anomalies.maxSimultaneous);
    inc((d) => d.anomalies.adaptationStrength);
    inc((d) => d.attention.gainMultiplier);
    inc((d) => d.attention.falseReportPenalty);
    inc((d) => d.decoys.perMinute);
    dec((d) => d.clues.audioClueVolume);
    dec((d) => d.attention.correctReportRelief);
    dec((d) => d.shiftDurationMin);
    expect(easy.reporting.categoryTolerance).toBe('any');
    expect(hard.reporting.categoryTolerance).toBe('primary');
    expect(easy.clues.witnessHint).toBe(true);
  });

  it('detects invalid configs', () => {
    const broken: DifficultyConfig = { ...normal, anomalies: { ...normal.anomalies, allowedRatings: [], maxSimultaneous: 0 } };
    const messages = validateDifficulty(broken).map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(['maxSimultaneous must be >= 1', 'allowedRatings is empty']));
  });
});
