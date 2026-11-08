import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { MODIFIER_KEYS } from '../../shared/motion';
import { Typewriter } from '../../shared/typewriter';
import { listenOnWindow } from '../../shared/window-listener';

/**
 * Wake-up console. Lines arrive over time from the session; any key or click skips.
 * Clicks are caught on window (capture) because the pointer is locked to the canvas.
 */
@Component({
  selector: 'app-intro-overlay',
  imports: [Typewriter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'overlay overlay--intro' },
  template: `
    <div class="intro__console" aria-live="polite">
      @for (line of session.introLines(); track $index) {
        <p class="intro__line">
          <span class="intro__prompt" aria-hidden="true">&gt;</span>
          <app-typewriter [text]="line" [cps]="30" />
        </p>
      }
    </div>
    <p class="intro__skip">Press any key to skip</p>
  `,
})
export class IntroOverlay {
  protected readonly session = inject(GameSessionService);

  constructor() {
    listenOnWindow(
      'keydown',
      (event) => {
        if (event.repeat || MODIFIER_KEYS.has(event.key)) return;
        // Escape is reserved by the browser for leaving pointer lock.
        if (event.key !== 'Escape') event.preventDefault();
        this.session.skipIntro();
      },
      { capture: true },
    );
    listenOnWindow('mousedown', () => this.session.skipIntro(), { capture: true });
  }
}
