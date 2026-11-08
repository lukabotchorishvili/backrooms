import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ATTENTION_LEVEL_CONFIGS } from '../../core/game/content/attention/attention-levels';
import { AttentionLevel } from '../../core/game/models';

const SEGMENTS = 20;
const SEGMENT_SIZE = 100 / SEGMENTS;

/** BUILDING ATTENTION: thin segmented bar 0..100, coloured by level, uneasy while escalating. */
@Component({
  selector: 'app-attention-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'attn',
    role: 'meter',
    'aria-label': 'Building attention',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'rounded()',
    '[attr.aria-valuetext]': 'label()',
    '[attr.data-level]': 'level()',
    '[class.is-escalating]': 'escalating()',
  },
  template: `
    <div class="attn__head">
      <span class="attn__title">BUILDING ATTENTION</span>
      <span class="attn__label">{{ label() }}</span>
    </div>
    <div class="attn__bar" aria-hidden="true">
      @for (i of segments; track i) {
        <span class="attn__seg" [class.is-on]="i < filled()" [class.is-threshold]="thresholds.has(i)"></span>
      }
    </div>
  `,
})
export class AttentionMeter {
  readonly value = input.required<number>();
  readonly level = input.required<AttentionLevel>();
  readonly label = input.required<string>();
  readonly escalating = input(false);

  protected readonly segments = Array.from({ length: SEGMENTS }, (_, i) => i);
  /** Segments that start a new level (25 / 50 / 80) get a tick. */
  protected readonly thresholds: ReadonlySet<number> = new Set(
    ATTENTION_LEVEL_CONFIGS.filter((l) => l.min > 0).map((l) => Math.round(l.min / SEGMENT_SIZE)),
  );
  protected readonly rounded = computed(() => Math.round(Math.max(0, Math.min(100, this.value()))));
  protected readonly filled = computed(() => {
    const v = this.rounded();
    return v <= 0 ? 0 : Math.max(1, Math.round(v / SEGMENT_SIZE));
  });
}
