import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RekeyDirective } from '../../shared/rekey.directive';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { listenOnWindow } from '../../shared/window-listener';
import { AttentionMeter } from './attention-meter';

interface TutorialRow {
  readonly keys: string;
  readonly action: string;
}

/**
 * In-game HUD. Everything sits at the edges; the centre only gets a 4px dot.
 * Kept mounted across playing/paused/notebook/terminal (hidden with `concealed`) so pulses and
 * the objective animation don't replay every time an overlay closes.
 */
@Component({
  selector: 'app-hud',
  imports: [AttentionMeter, RekeyDirective],
  templateUrl: './hud.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'hud',
    '[class.is-concealed]': 'concealed()',
    '[class.is-security]': 'session.securityView() !== null',
    '[attr.aria-hidden]': 'concealed() ? "true" : null',
  },
})
export class Hud {
  protected readonly session = inject(GameSessionService);
  protected readonly attention = this.session.attention;

  /** Hide the HUD (overlay open) without destroying it. */
  readonly concealed = input(false);

  /** Re-keyed on every new note / witness hint so the pulse animation restarts. */
  protected readonly noteKey = signal(0);
  protected readonly witnessKey = signal(0);

  protected readonly witnessHints = computed(() => this.session.difficultySignal()?.clues.witnessHint ?? false);

  protected readonly tutorialRows = computed<readonly TutorialRow[]>(() =>
    (this.session.tutorial() ?? []).map((line) => {
      const [keys, ...rest] = line.split(/\s+[—–-]\s+/);
      return { keys: keys.trim(), action: rest.join(' — ').trim() };
    }),
  );

  constructor() {
    let lastNote = untracked(() => this.session.noteFlash());
    effect(() => {
      const n = this.session.noteFlash();
      if (n > lastNote) untracked(() => this.noteKey.update((k) => k + 1));
      lastNote = n;
    });

    let lastWitness = untracked(() => this.session.witnessHint());
    effect(() => {
      const n = this.session.witnessHint();
      if (n > lastWitness) untracked(() => this.witnessKey.update((k) => k + 1));
      lastWitness = n;
    });

    // The pointer is locked during play, so the tutorial is dismissed from the keyboard.
    listenOnWindow('keydown', (event) => {
      if (event.key === 'Enter' && !event.repeat && this.session.tutorial() && !this.concealed()) {
        event.preventDefault();
        this.session.dismissTutorial();
      }
    });
  }
}
