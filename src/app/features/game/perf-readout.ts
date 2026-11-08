import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameSessionService } from '../../core/game/systems/game-session.service';

/** Tiny dev readout, visible while "Performance readout" is enabled and the engine reports stats. */
@Component({
  selector: 'app-perf-readout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'perf', 'aria-hidden': 'true' },
  template: `
    @if (line(); as text) {
      <span>{{ text }}</span>
    }
  `,
})
export class PerfReadout {
  private readonly session = inject(GameSessionService);

  protected readonly line = computed(() => {
    const s = this.session.stats();
    if (!s) return null;
    return [
      `FPS ${Math.round(s.fps)}`,
      `${s.frameMs.toFixed(1)} MS`,
      `DRAW ${s.drawCalls}`,
      `MESH ${s.activeMeshes}/${s.totalMeshes}`,
      `LIGHT ${s.lights}`,
    ].join('  ·  ');
  });
}
