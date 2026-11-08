import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { ConfirmPrompt } from '../../shared/confirm-prompt';
import { MenuNavDirective } from '../../shared/menu-nav.directive';
import { UiSoundService } from '../../shared/ui-sound.service';
import { consumeKey, listenOnWindow } from '../../shared/window-listener';
import { SettingsPanel } from '../settings/settings-panel';

type PauseView = 'root' | 'settings' | 'confirm-restart' | 'confirm-menu';
type PauseItem = 'resume' | 'restart' | 'settings' | 'menu';

@Component({
  selector: 'app-pause-menu',
  imports: [MenuNavDirective, AutofocusDirective, ConfirmPrompt, SettingsPanel],
  templateUrl: './pause-menu.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'overlay overlay--pause fx-grain fx-vignette' },
})
export class PauseMenu {
  protected readonly session = inject(GameSessionService);
  private readonly ui = inject(UiSoundService);

  protected readonly view = signal<PauseView>('root');
  protected readonly focusTarget = signal<PauseItem>('resume');

  protected readonly status = computed(() => {
    const parts = [
      this.session.stageSignal()?.floorLabel,
      this.session.clock(),
      this.session.difficultySignal()?.name,
    ].filter((p): p is string => !!p);
    return parts.join(' · ');
  });

  constructor() {
    // Capture phase + stopImmediatePropagation: game input must never see this Escape, otherwise
    // it could pause again right after we resume.
    listenOnWindow(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        consumeKey(event);
        if (event.repeat) return;
        if (this.view() !== 'root') {
          this.ui.select();
          this.view.set('root');
          return;
        }
        // Pointer lock cannot be acquired from Escape; the click-to-continue veil covers that.
        this.session.resume();
      },
      { capture: true },
    );
  }

  protected resume(): void {
    this.ui.select();
    this.session.resume();
  }

  protected open(view: Exclude<PauseView, 'root'>, from: PauseItem): void {
    this.ui.select();
    this.focusTarget.set(from);
    this.view.set(view);
  }

  protected back(): void {
    this.view.set('root');
  }

  protected restart(): void {
    this.ui.select();
    void this.session.restart();
  }

  protected quit(): void {
    this.ui.select();
    this.session.quitToMenu();
  }
}
