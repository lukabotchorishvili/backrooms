import { describeTendencies, formatDuration, formatPercent } from './format';

describe('format helpers', () => {
  it('formats durations as mm:ss without wrapping into hours', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65.9)).toBe('01:05');
    expect(formatDuration(4325)).toBe('72:05');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });

  it('describes dominant tendencies as words', () => {
    expect(describeTendencies([])).toBe('Unremarkable');
    expect(describeTendencies(['curious', 'door-checker'])).toBe('Curious, Door-checker');
  });

  it('formats percentages', () => {
    expect(formatPercent(0.8)).toBe('80%');
  });
});
