import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { prefersReducedMotion } from '../../shared/motion';

/**
 * "THE FLOOR / IS LYING" with a mirrored reflection on the floor line beneath it.
 * Very occasionally the reflection - and only the reflection - reads "IS LISTENING".
 */
@Component({
  selector: 'app-floor-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'logo', role: 'img', 'aria-label': 'The Floor Is Lying' },
  template: `
    <div class="logo__title" aria-hidden="true">
      <span class="logo__line">THE FLOOR</span>
      <span class="logo__line logo__line--lie">IS LYING</span>
    </div>
    <div class="logo__floor" aria-hidden="true"></div>
    <div class="logo__reflection" [class.is-listening]="listening()" aria-hidden="true">
      <span class="logo__line">THE FLOOR</span>
      <span class="logo__line logo__line--lie">{{ listening() ? 'IS LISTENING' : 'IS LYING' }}</span>
    </div>
  `,
})
export class FloorLogo {
  protected readonly listening = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const reduced = prefersReducedMotion();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const later = (fn: () => void, ms: number): void => {
        timer = setTimeout(fn, ms);
      };

      // A flicker is a short on/off sequence, like a failing tube catching the reflection.
      const flicker = (steps: readonly number[], index = 0): void => {
        if (index >= steps.length) {
          this.listening.set(false);
          schedule();
          return;
        }
        this.listening.set(index % 2 === 0);
        later(() => flicker(steps, index + 1), steps[index]);
      };

      const schedule = (): void => {
        const wait = reduced ? 30000 + Math.random() * 30000 : 9000 + Math.random() * 16000;
        later(() => {
          if (document.visibilityState === 'hidden' || Math.random() < 0.35) {
            schedule();
            return;
          }
          if (reduced) {
            flicker([1400]);
            return;
          }
          const roll = Math.random();
          if (roll < 0.15) flicker([520]);
          else if (roll < 0.55) flicker([70, 90, 150]);
          else flicker([90, 60, 60, 110, 240]);
        }, wait);
      };

      later(schedule, 4000);
      destroyRef.onDestroy(() => {
        if (timer !== null) clearTimeout(timer);
      });
    });
  }
}
