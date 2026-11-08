import { PropStateSnapshot } from '../models';
import { MemoryRoomService, diffSnapshots } from './memory-room.service';

const snap = (patch: Partial<PropStateSnapshot> = {}): PropStateSnapshot => ({ position: [1, 0, 2], rotationY: 90, visible: true, ...patch });

describe('MemoryRoomService', () => {
  it('captures a baseline only on the first visit', () => {
    const m = new MemoryRoomService();
    let captures = 0;
    const capture = () => {
      captures++;
      return { chair: snap() };
    };
    expect(m.enter('office', 0, capture).firstVisit).toBe(true);
    m.exit('office', 10);
    expect(m.enter('office', 40, capture).firstVisit).toBe(false);
    expect(captures).toBe(1);
    expect(m.visits('office')).toBe(2);
    m.exit('office', 50);
    expect(m.awaySeconds('office', 80)).toBe(30);
  });

  it('detects subtle changes against the baseline', () => {
    const m = new MemoryRoomService();
    m.enter('office', 0, () => ({ chair: snap(), plant: snap({ position: [3, 0, 3] }), sign: snap({ text: 'ARCHIVE' }) }));
    const diffs = m.compare('office', {
      chair: snap({ rotationY: 255 }),
      plant: snap({ position: [3, 0, 3] }),
      sign: snap({ text: 'BREAK ROOM' }),
      extra: snap(),
    });
    const byId = Object.fromEntries(diffs.map((d) => [d.propId, d.changes]));
    expect(byId['chair']).toEqual(['rotation']);
    expect(byId['plant']).toBeUndefined();
    expect(byId['sign']).toEqual(['text']);
    expect(byId['extra']).toEqual(['visibility']);
  });

  it('ignores floating point noise', () => {
    expect(diffSnapshots(snap(), snap({ position: [1.01, 0, 2.01], rotationY: 90.5 }))).toEqual([]);
    expect(diffSnapshots(snap({ rotationY: 359 }), snap({ rotationY: 1 }))).toEqual([]);
  });

  it('round-trips through export/restore', () => {
    const m = new MemoryRoomService();
    m.enter('a', 0, () => ({ x: snap() }));
    const r = new MemoryRoomService();
    r.restore(m.export());
    expect(r.visits('a')).toBe(1);
    expect(r.baseline('a')).toEqual({ x: snap() });
  });
});
