import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { RekeyDirective } from '../../shared/rekey.directive';

const FLAVOUR = [
  'Counting the doors…',
  'Measuring the corridor. Twice.',
  'Replacing fluorescent tubes…',
  'Aligning the ceiling tiles…',
  'Checking that the clocks agree…',
  'Reminding the floor where it is…',
  'Filing yesterday’s irregularities…',
  'Making sure the exits are where you left them…',
  'Warming the elevator motor…',
  'Teaching the carpet to stay still…',
];

@Component({
  imports: [RekeyDirective],
  selector: 'app-loading-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'overlay overlay--loading fx-grain' },
  template: `
    <div class="loading">
      <p class="loading__floor">{{ floorLabel() || 'FLOOR —' }}</p>
      <div
        class="loading__bar"
        role="progressbar"
        aria-label="Loading"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="percent()"
        [attr.aria-valuetext]="message() || 'Loading'"
      >
        <span class="loading__fill" [style.transform]="'scaleX(' + clamped() + ')'"></span>
      </div>
      <div class="loading__meta">
        <span class="loading__message">{{ message() || 'Preparing' }}</span>
        <span class="loading__percent">{{ percentLabel() }}</span>
      </div>
      <ng-container *appRekey="flavour(); let line">
        <p class="loading__flavour">{{ line }}</p>
      </ng-container>
    </div>
  `,
})
export class LoadingScreen {
  readonly progress = input(0);
  readonly message = input('');
  readonly floorLabel = input('');

  protected readonly clamped = computed(() => Math.max(0, Math.min(1, this.progress())));
  protected readonly percent = computed(() => Math.round(this.clamped() * 100));
  protected readonly percentLabel = computed(() => `${String(this.percent()).padStart(3, '0')}%`);

  private readonly index = signal(Math.floor(Math.random() * FLAVOUR.length));
  protected readonly flavour = computed(() => FLAVOUR[this.index() % FLAVOUR.length]);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const id = setInterval(() => this.index.update((i) => i + 1), 2800);
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }
}
