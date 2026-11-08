import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { prefersReducedMotion } from './motion';

/**
 * Types a line of text out character by character. Screen readers get the full text at once.
 * Respects prefers-reduced-motion (text appears instantly). `done` fires once per text.
 */
@Component({
  selector: 'app-typewriter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span aria-hidden="true">{{ shown() }}</span>@if (typing()) {<span class="tw__caret" aria-hidden="true"></span>}<span class="sr-only">{{ text() }}</span>`,
  host: { class: 'tw' },
})
export class Typewriter {
  readonly text = input.required<string>();
  /** Characters per second. */
  readonly cps = input(36);
  /** Delay before the first character (ms). */
  readonly delay = input(0);
  /** Show the whole text immediately. */
  readonly instant = input(false);
  /** Show a blinking caret while typing. */
  readonly caret = input(true);
  readonly done = output<void>();

  private readonly count = signal(0);
  protected readonly shown = computed(() => this.text().slice(0, this.count()));
  protected readonly typing = computed(() => this.caret() && this.count() < this.text().length);

  private lastText: string | null = null;
  private emitted = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimers());
    effect(() => {
      const text = this.text();
      const instant = this.instant() || prefersReducedMotion();
      const cps = Math.max(1, this.cps());
      const delay = Math.max(0, this.delay());
      untracked(() => this.run(text, instant, cps, delay));
    });
  }

  /** Reveal the rest of the text now. */
  complete(): void {
    this.clearTimers();
    this.count.set(this.text().length);
    this.finish();
  }

  private run(text: string, instant: boolean, cps: number, delay: number): void {
    this.clearTimers();
    if (text !== this.lastText) {
      this.lastText = text;
      this.emitted = false;
      this.count.set(0);
    }
    if (instant || text.length === 0 || this.count() >= text.length) {
      this.count.set(text.length);
      // Emit outside the effect run so parents can update their own state freely.
      queueMicrotask(() => this.finish());
      return;
    }
    const resumeFrom = this.count();
    this.timeout = setTimeout(
      () => {
        const begin = performance.now() - (resumeFrom * 1000) / cps;
        this.interval = setInterval(
          () => {
            const n = Math.min(text.length, Math.floor(((performance.now() - begin) * cps) / 1000));
            if (n !== this.count()) this.count.set(n);
            if (n >= text.length) {
              this.clearTimers();
              this.finish();
            }
          },
          Math.max(16, Math.floor(1000 / cps)),
        );
      },
      resumeFrom > 0 ? 0 : delay,
    );
  }

  private finish(): void {
    if (this.emitted) return;
    this.emitted = true;
    this.done.emit();
  }

  private clearTimers(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    if (this.interval !== null) clearInterval(this.interval);
    this.timeout = null;
    this.interval = null;
  }
}
