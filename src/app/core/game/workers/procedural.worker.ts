/*
 * Off-main-thread procedural generation: surface textures (colour + normal maps) and synthesised
 * audio. Pure computation only - results are transferred back without copying.
 */
import { SURFACE_RECIPES, renderSurfacePixels } from '../engine/materials/surface-pixels';
import { SYNTH_SAMPLE_RATE, synthesize } from '../systems/audio/audio-synth';
import type { ProceduralJob, ProceduralResult } from './procedural-pool';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ProceduralJob>) => void) | null;
  postMessage(message: ProceduralResult, options?: { transfer?: Transferable[] }): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const job = e.data;
  try {
    if (job.kind === 'surface') {
      const pixels = renderSurfacePixels(SURFACE_RECIPES[job.id].build(job.size), true);
      const transfer: Transferable[] = [pixels.color.buffer];
      if (pixels.normal) transfer.push(pixels.normal.buffer);
      scope.postMessage({ jobId: job.jobId, kind: 'surface', size: pixels.size, color: pixels.color, normal: pixels.normal }, { transfer });
    } else {
      const pcm = synthesize(job.recipe, SYNTH_SAMPLE_RATE);
      scope.postMessage({ jobId: job.jobId, kind: 'synth', pcm }, { transfer: [pcm.buffer] });
    }
  } catch (err) {
    scope.postMessage({ jobId: job.jobId, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
