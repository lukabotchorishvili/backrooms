import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { prefersReducedMotion } from '../../shared/motion';
import { CorridorRenderer } from './corridor-renderer';

/** Backdrop is rendered below CSS resolution on purpose: softer, cheaper, more filmic. */
const RENDER_SCALE = 0.55;
const FRAME_MS = 1000 / 30;

/**
 * Animated corridor behind the main menu. The loop runs only in the browser, is capped at
 * ~30 fps, pauses while the tab is hidden and is torn down with the component.
 */
@Component({
  selector: 'app-corridor-backdrop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas class="corridor__canvas"></canvas>`,
  host: { class: 'corridor', 'aria-hidden': 'true' },
})
export class CorridorBackdrop {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      const animated = !prefersReducedMotion();
      const renderer = new CorridorRenderer(ctx, animated);

      let raf = 0;
      let start = -1;
      let last = 0;
      let lastT = 0;
      let running = false;

      const resize = (): void => {
        const width = Math.max(1, Math.round(canvas.clientWidth * RENDER_SCALE));
        const height = Math.max(1, Math.round(canvas.clientHeight * RENDER_SCALE));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        renderer.resize(width, height);
        // Resizing clears the canvas: redraw immediately instead of waiting for the next tick.
        renderer.render(lastT, 0);
      };

      const frame = (now: number): void => {
        if (!running) return;
        raf = requestAnimationFrame(frame);
        if (start < 0) {
          start = now;
          last = now - FRAME_MS;
        }
        const elapsed = now - last;
        if (elapsed < FRAME_MS - 1) return;
        last = now;
        lastT = (now - start) / 1000;
        renderer.render(lastT, Math.min(0.1, elapsed / 1000));
      };

      const play = (): void => {
        if (running || !animated) return;
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      };
      const stop = (): void => {
        running = false;
        cancelAnimationFrame(raf);
      };
      const onVisibility = (): void => (document.visibilityState === 'hidden' ? stop() : play());

      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      observer?.observe(canvas);
      if (!observer) window.addEventListener('resize', resize);
      document.addEventListener('visibilitychange', onVisibility);

      resize();
      play();

      destroyRef.onDestroy(() => {
        stop();
        observer?.disconnect();
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVisibility);
      });
    });
  }
}
