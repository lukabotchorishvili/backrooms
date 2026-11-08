import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { attentionLevelFor } from '../../core/game/systems/attention-system.service';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { describeTendencies, formatDuration } from '../../shared/format';
import { MenuNavDirective } from '../../shared/menu-nav.directive';
import { MODIFIER_KEYS, prefersReducedMotion } from '../../shared/motion';
import { Typewriter } from '../../shared/typewriter';
import { UiSoundService } from '../../shared/ui-sound.service';
import { consumeKey, listenOnWindow } from '../../shared/window-listener';

type EndingStep = 'lines' | 'caption' | 'summary';

/**
 * Final black screen: epilogue lines typed slowly one after another, the caption, then the
 * ending record and run statistics. Any key / click skips straight to the summary.
 */
@Component({
  selector: 'app-ending-screen',
  imports: [Typewriter, MenuNavDirective, AutofocusDirective],
  templateUrl: './ending-screen.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'overlay overlay--ending fx-grain', '(click)': 'skip()' },
})
export class EndingScreen {
  private readonly session = inject(GameSessionService);
  private readonly ui = inject(UiSoundService);

  protected readonly result = this.session.endingResult;
  protected readonly lines = computed<readonly string[]>(() => this.result()?.ending.epilogue.lines ?? []);
  protected readonly step = signal<EndingStep>('lines');
  protected readonly lineIndex = signal(0);
  protected readonly revealAll = signal(false);

  protected readonly stats = computed(() => {
    const r = this.result();
    if (!r) return null;
    return {
      time: formatDuration(r.playTimeSec),
      confirmed: r.confirmed,
      falseReports: r.falseReports,
      peak: r.peakAttention,
      peakLabel: attentionLevelFor(r.peakAttention).label,
      tendencies: describeTendencies(r.dominant),
    };
  });

  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimers());

    if (prefersReducedMotion() || this.lines().length === 0) {
      this.revealAll.set(true);
      this.lineIndex.set(Math.max(0, this.lines().length - 1));
      this.step.set('summary');
    }

    listenOnWindow(
      'keydown',
      (event) => {
        if (this.step() === 'summary' || event.repeat || MODIFIER_KEYS.has(event.key)) return;
        consumeKey(event);
        this.skip();
      },
      { capture: true },
    );
  }

  protected lineDone(index: number): void {
    if (this.step() !== 'lines' || this.revealAll()) return;
    if (index + 1 < this.lines().length) {
      this.later(() => this.lineIndex.set(index + 1), 1100);
    } else {
      this.later(() => {
        this.step.set('caption');
        this.later(() => this.step.set('summary'), 2800);
      }, 1500);
    }
  }

  protected skip(): void {
    if (this.step() === 'summary') return;
    this.clearTimers();
    this.revealAll.set(true);
    this.lineIndex.set(Math.max(0, this.lines().length - 1));
    this.step.set('summary');
  }

  protected newShift(): void {
    this.ui.select();
    void this.session.restart();
  }

  protected mainMenu(): void {
    this.ui.select();
    this.session.quitToMenu();
  }

  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }
}
