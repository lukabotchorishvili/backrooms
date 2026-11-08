import { ATTENTION_LEVEL_CONFIGS, ESCALATION_DURATION_SEC, ESCALATION_RECOVERY_VALUE } from '../content/attention/attention-levels';
import { GameEvent } from '../models';
import { registry } from '../testing/fake-world';
import { AttentionSystemService, attentionLevelFor } from './attention-system.service';

function create(difficulty = 'employee'): AttentionSystemService {
  const s = new AttentionSystemService();
  s.configure(registry.difficulties.require(difficulty));
  s.reset();
  return s;
}

describe('AttentionSystemService', () => {
  it('maps values to levels', () => {
    expect(attentionLevelFor(0).level).toBe('low');
    expect(attentionLevelFor(24.9).level).toBe('low');
    expect(attentionLevelFor(25).level).toBe('medium');
    expect(attentionLevelFor(50).level).toBe('high');
    expect(attentionLevelFor(80).level).toBe('critical');
    expect(attentionLevelFor(100).level).toBe('critical');
    const mins = ATTENTION_LEVEL_CONFIGS.map((l) => l.min);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
  });

  it('emits level transitions in both directions', () => {
    const s = create();
    const up = s.raise(30, true);
    expect(up).toContainEqual({ type: 'attention-level', level: 'medium', previous: 'low' });
    const down = s.relieve(10);
    expect(down).toContainEqual({ type: 'attention-level', level: 'low', previous: 'medium' });
  });

  it('scales gains by difficulty (easy < normal < hard)', () => {
    const values = ['observer', 'employee', 'the-building-knows'].map((d) => {
      const s = create(d);
      s.raise(10);
      return s.value();
    });
    expect(values[0]).toBeLessThan(values[1]);
    expect(values[1]).toBeLessThan(values[2]);
  });

  it('decays while calm, rises while sprinting and in overtime', () => {
    const s = create();
    s.raise(20, true);
    for (let i = 0; i < 100; i++) s.update(1, { sprinting: false, overtime: false });
    expect(s.value()).toBeLessThan(20);
    const before = s.value();
    for (let i = 0; i < 30; i++) s.update(1, { sprinting: true, overtime: true });
    expect(s.value()).toBeGreaterThan(before);
  });

  it('CRITICAL starts an escalation that always recovers (no failure state)', () => {
    const s = create();
    const events: GameEvent[] = s.raise(90, true);
    expect(events.map((e) => e.type)).toContain('escalation-start');
    expect(s.isEscalating()).toBe(true);
    // Calming interactions are ignored while the building intervenes
    expect(s.relieve(50)).toEqual([]);
    const later: GameEvent[] = [];
    for (let i = 0; i < ESCALATION_DURATION_SEC + 2; i++) later.push(...s.update(1, { sprinting: false, overtime: false }));
    expect(later.map((e) => e.type)).toContain('escalation-end');
    expect(s.isEscalating()).toBe(false);
    expect(s.value()).toBeLessThanOrEqual(ESCALATION_RECOVERY_VALUE);
    expect(s.snapshot().escalations).toBe(1);
    expect(s.snapshot().peak).toBeGreaterThanOrEqual(90);
    // Grace period: cannot immediately escalate again
    const again = s.raise(60, true);
    expect(again.map((e) => e.type)).not.toContain('escalation-start');
    expect(s.value()).toBeLessThan(80);
  });

  it('restores clamped values from a save', () => {
    const s = create();
    s.restore({ value: 140, peak: 10, escalations: 2, escalationRemaining: 5 });
    expect(s.value()).toBe(100);
    expect(s.snapshot().peak).toBe(100);
    expect(s.isEscalating()).toBe(false);
  });
});
