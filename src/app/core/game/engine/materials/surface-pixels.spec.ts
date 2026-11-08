import { SURFACE_MATERIAL_IDS } from '../../models';
import { ProceduralPool } from '../../workers/procedural-pool';
import { SURFACE_RECIPES, renderSurfacePixels } from './surface-pixels';

describe('procedural surfaces (worker-safe recipes)', () => {
  it('has a recipe for every surface material id', () => {
    for (const id of SURFACE_MATERIAL_IDS) expect(SURFACE_RECIPES[id], id).toBeDefined();
  });

  it('renders colour + normal maps of the requested size, deterministically', () => {
    for (const id of SURFACE_MATERIAL_IDS) {
      const a = renderSurfacePixels(SURFACE_RECIPES[id].build(32), true);
      const b = renderSurfacePixels(SURFACE_RECIPES[id].build(32), true);
      expect(a.color.length, id).toBe(a.size * a.size * 4);
      expect(a.normal?.length, id).toBe(a.size * a.size * 4);
      expect(Array.from(a.color.slice(0, 64))).toEqual(Array.from(b.color.slice(0, 64)));
      // opaque output
      expect(a.color[3]).toBe(255);
    }
  });

  it('the worker pool reports unavailability instead of throwing (main-thread fallback)', () => {
    const hadWorker = 'Worker' in globalThis;
    if (!hadWorker) expect(ProceduralPool.create()).toBeNull();
    else expect(() => ProceduralPool.create()?.dispose()).not.toThrow();
  });
});
