import { EndingResolutionContext } from '../models';
import { registry, stage } from '../testing/fake-world';
import { ProgressionService, evaluateEndingCondition, resolveEnding } from './progression.service';

const endings = registry.endingsForStage(stage);
const ctx = (patch: Partial<EndingResolutionContext> = {}): EndingResolutionContext => ({
  investigationComplete: true,
  attention: 10,
  peakAttention: 20,
  escalations: 0,
  flags: new Set<string>(),
  ...patch,
});

describe('endings', () => {
  it('A - normal exit with low attention', () => {
    expect(resolveEnding(endings, 'elevator-standard', ctx())?.id).toBe('normal-exit');
  });

  it('B - the building remembers with high attention or after an escalation', () => {
    expect(resolveEnding(endings, 'elevator-standard', ctx({ attention: 70 }))?.id).toBe('building-remembers');
    expect(resolveEnding(endings, 'elevator-standard', ctx({ escalations: 1 }))?.id).toBe('building-remembers');
  });

  it('C - the wrong exit needs the hidden clue sequence and the service trigger', () => {
    const flags = new Set(['memo-found', 'service-key']);
    expect(resolveEnding(endings, 'elevator-service', ctx({ flags }))?.id).toBe('wrong-exit');
    expect(resolveEnding(endings, 'elevator-service', ctx({ flags: new Set(['service-key']) }))).toBeNull();
    expect(resolveEnding(endings, 'elevator-standard', ctx({ flags }))?.id).toBe('normal-exit');
  });

  it('no ending before the investigation is complete', () => {
    expect(resolveEnding(endings, 'elevator-standard', ctx({ investigationComplete: false }))).toBeNull();
  });

  it('every standard-trigger configuration resolves to some ending (always completable)', () => {
    for (const attention of [0, 30, 54, 55, 79, 100]) {
      for (const escalations of [0, 1, 3]) {
        expect(resolveEnding(endings, 'elevator-standard', ctx({ attention, escalations, peakAttention: attention }))).not.toBeNull();
      }
    }
  });

  it('evaluates composite conditions', () => {
    expect(evaluateEndingCondition({ type: 'any', conditions: [{ type: 'flag', flag: 'x' }, { type: 'attention-below', value: 50 }] }, ctx())).toBe(true);
    expect(evaluateEndingCondition({ type: 'peak-attention-at-least', value: 30 }, ctx())).toBe(false);
  });
});

describe('ProgressionService', () => {
  it('walks the objective flow and never skips steps', () => {
    const p = new ProgressionService();
    p.reset();
    expect(p.objective()).toBe('find-terminal');
    expect(p.grantAccess()).toBe(false);
    expect(p.terminalOpened()).toBe(true);
    expect(p.objective()).toBe('investigate');
    expect(p.confirmedChanged(4, 5)).toBe(false);
    expect(p.confirmedChanged(5, 5)).toBe(true);
    expect(p.objective()).toBe('request-access');
    expect(p.grantAccess()).toBe(true);
    expect(p.accessGranted()).toBe(true);
    expect(p.objective()).toBe('take-elevator');
    const saved = p.export();
    const q = new ProgressionService();
    q.restore(saved);
    expect(q.objective()).toBe('take-elevator');
    expect(q.hasFlag('investigation-complete')).toBe(true);
  });
});
