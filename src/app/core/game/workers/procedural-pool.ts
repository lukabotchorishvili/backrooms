import type { SurfacePixels } from '../engine/materials/surface-pixels';
import { SurfaceMaterialId } from '../models';

export type ProceduralJob =
  | { readonly jobId: number; readonly kind: 'surface'; readonly id: SurfaceMaterialId; readonly size: number }
  | { readonly jobId: number; readonly kind: 'synth'; readonly recipe: string };

export type ProceduralResult =
  | { readonly jobId: number; readonly kind: 'surface'; readonly size: number; readonly color: Uint8Array; readonly normal?: Uint8Array }
  | { readonly jobId: number; readonly kind: 'synth'; readonly pcm: Float32Array }
  | { readonly jobId: number; readonly kind: 'error'; readonly message: string };

/** What the engine/audio manager need from the pool (lets them fall back to the main thread). */
export interface ProceduralWorkers {
  surface(id: SurfaceMaterialId, size: number): Promise<SurfacePixels>;
  synth(recipe: string): Promise<Float32Array>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  readonly job: ProceduralJob;
  readonly resolve: (r: ProceduralResult) => void;
  readonly reject: (e: Error) => void;
}

/**
 * A small pool of module workers that render procedural textures and synthesise audio in
 * parallel, keeping the main thread (and the loading screen) responsive. Callers fall back to
 * main-thread generation if workers are unavailable or a job fails.
 */
export class ProceduralPool implements ProceduralWorkers {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Pending[] = [];
  private readonly running = new Map<Worker, Pending>();
  private nextId = 1;
  private disposed = false;

  private constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./procedural.worker', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ProceduralResult>) => this.finish(worker, e.data);
      worker.onerror = (e) => {
        e.preventDefault();
        this.fail(worker, new Error(e.message || 'procedural worker failed'));
      };
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  /** Returns null when Web Workers are unavailable (SSR, tests, locked-down browsers). */
  static create(max = 6): ProceduralPool | null {
    if (typeof Worker === 'undefined' || typeof navigator === 'undefined') return null;
    try {
      const cores = navigator.hardwareConcurrency || 4;
      return new ProceduralPool(Math.max(2, Math.min(max, cores - 1)));
    } catch {
      return null;
    }
  }

  get size(): number {
    return this.workers.length;
  }

  async surface(id: SurfaceMaterialId, size: number): Promise<SurfacePixels> {
    const r = await this.run({ kind: 'surface', id, size });
    if (r.kind !== 'surface') throw new Error(r.kind === 'error' ? r.message : 'unexpected result');
    return { size: r.size, color: r.color, normal: r.normal };
  }

  async synth(recipe: string): Promise<Float32Array> {
    const r = await this.run({ kind: 'synth', recipe });
    if (r.kind !== 'synth') throw new Error(r.kind === 'error' ? r.message : 'unexpected result');
    return r.pcm;
  }

  private run(job: DistributiveOmit<ProceduralJob, 'jobId'>): Promise<ProceduralResult> {
    if (this.disposed) return Promise.reject(new Error('pool disposed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ job: { ...job, jobId: this.nextId++ } as ProceduralJob, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const pending = this.queue.shift()!;
      this.running.set(worker, pending);
      worker.postMessage(pending.job);
    }
  }

  private finish(worker: Worker, result: ProceduralResult): void {
    const pending = this.running.get(worker);
    this.running.delete(worker);
    this.idle.push(worker);
    if (pending) {
      if (result.kind === 'error') pending.reject(new Error(result.message));
      else pending.resolve(result);
    }
    this.pump();
  }

  private fail(worker: Worker, error: Error): void {
    const pending = this.running.get(worker);
    this.running.delete(worker);
    pending?.reject(error);
    // A worker that errors at the top level is unusable: drop it.
    worker.terminate();
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);
    if (this.workers.length === 0) {
      for (const p of this.queue.splice(0)) p.reject(error);
    } else {
      this.pump();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    for (const p of [...this.queue.splice(0), ...this.running.values()]) p.reject(new Error('pool disposed'));
    this.running.clear();
    this.workers.length = 0;
    this.idle.length = 0;
  }
}
