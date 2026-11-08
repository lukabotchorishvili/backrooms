import { createEmptyMetrics } from './behavior/behavior-profile';
import { resolveTokens, shiftClock } from './text-tokens';

describe('text tokens', () => {
  const metrics = { ...createEmptyMetrics(), doorInteractions: 12, inspections: 30, roomVisits: { archive: 2, 'break-room': 5 }, firstRoomEntryClock: { reception: '09:14' } };
  const ctx = {
    employee: '4471',
    metrics,
    clock: '10:42',
    previousRoomId: 'archive',
    roomName: (id: string) => ({ archive: 'Archive', 'break-room': 'Break room' })[id] ?? id,
    behaviorMessage: () => 'YOU HAVE OPENED {doorCount} DOORS.',
  };

  it('resolves behaviour-derived tokens', () => {
    expect(resolveTokens('Employee {employee}, {doorCount} doors, {inspections} objects.', ctx)).toBe('Employee 4471, 12 doors, 30 objects.');
    expect(resolveTokens('{mostVisitedRoom} x{mostVisitedCount}', ctx)).toBe('BREAK ROOM x5');
    expect(resolveTokens('{firstVisit:reception} / {firstVisit:security}', ctx)).toBe('09:14 / 09:00');
    expect(resolveTokens('{lastRoom} at {time}', ctx)).toBe('ARCHIVE at 10:42');
  });

  it('resolves nested behaviour messages and leaves unknown tokens', () => {
    expect(resolveTokens('{behaviorMessage}', ctx)).toBe('YOU HAVE OPENED 12 DOORS.');
    expect(resolveTokens('{nonsense}', ctx)).toBe('{nonsense}');
  });

  it('computes the shift clock and overtime', () => {
    expect(shiftClock(0, 25).label).toBe('09:00');
    expect(shiftClock(25 * 30, 25).label).toBe('13:00');
    expect(shiftClock(25 * 60, 25).overtime).toBe(true);
    expect(shiftClock(25 * 60 - 1, 25).overtime).toBe(false);
  });
});
