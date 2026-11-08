import { ChangeDetectionStrategy, Component, inject, input, linkedSignal, output } from '@angular/core';
import { CONTENT } from '../../core/game/content/content-registry';
import { DifficultyConfig } from '../../core/game/models';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { MenuNavDirective } from '../../shared/menu-nav.directive';
import { UiSoundService } from '../../shared/ui-sound.service';

export type DifficultyPickerMode = 'new' | 'default';

/**
 * Lists the difficulties (name, tier, description).
 * - mode "new": choose one, then BEGIN SHIFT emits `confirmed`.
 * - mode "default": every pick emits `picked` immediately (the host persists it); DONE closes.
 */
@Component({
  selector: 'app-difficulty-picker',
  imports: [MenuNavDirective, AutofocusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel panel--difficulty' },
  template: `
    <header class="panel__head">
      <span class="panel__code" aria-hidden="true">{{ mode() === 'new' ? 'FAC-NEW' : 'FAC-DIF' }}</span>
      <h2 class="panel__title" id="difficulty-title">{{ mode() === 'new' ? 'NEW SHIFT' : 'DIFFICULTY' }}</h2>
      <p class="panel__lede">
        {{ mode() === 'new' ? 'Choose how much the building is allowed to lie.' : 'Default for new shifts.' }}
      </p>
    </header>

    <div class="difficulty-list" appMenuNav role="group" aria-labelledby="difficulty-title">
      @for (d of difficulties; track d.id) {
        <div data-nav-row>
          <button
            type="button"
            class="difficulty"
            [attr.aria-pressed]="selected() === d.id"
            [appAutofocus]="d.id === initial()"
            (click)="pick(d)"
          >
            <span class="difficulty__mark" aria-hidden="true"></span>
            <span class="difficulty__name">{{ d.name }}</span>
            <span class="difficulty__tier">{{ d.tier }}</span>
            <span class="difficulty__desc">{{ d.description }}</span>
          </button>
        </div>
      }

      @if (mode() === 'new' && savedShift(); as saved) {
        <p class="notice notice--warning" role="note">
          Starting a new shift replaces your saved shift ({{ saved }}).
        </p>
      }

      <div class="panel__actions btn-row" data-nav-row>
        <button type="button" class="btn btn--primary" (click)="confirm()">
          {{ mode() === 'new' ? 'BEGIN SHIFT' : 'DONE' }}
        </button>
        <button type="button" class="btn btn--quiet" (click)="cancel()">BACK</button>
      </div>
    </div>
  `,
})
export class DifficultyPicker {
  private readonly ui = inject(UiSoundService);

  readonly mode = input.required<DifficultyPickerMode>();
  readonly initial = input.required<string>();
  /** Summary of the saved shift that a new game would replace (null = none). */
  readonly savedShift = input<string | null>(null);

  readonly picked = output<string>();
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected readonly difficulties: readonly DifficultyConfig[] = CONTENT.sortedDifficulties();
  protected readonly selected = linkedSignal(() => this.initial());

  protected pick(d: DifficultyConfig): void {
    this.ui.select();
    this.selected.set(d.id);
    this.picked.emit(d.id);
  }

  protected confirm(): void {
    this.ui.select();
    this.confirmed.emit(this.selected());
  }

  protected cancel(): void {
    this.ui.select();
    this.cancelled.emit();
  }
}
