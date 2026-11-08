import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { CONTENT } from '../../core/game/content/content-registry';
import { AudioManagerService } from '../../core/game/systems/audio-manager.service';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { SaveManagerService } from '../../core/game/systems/save-manager.service';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { MenuNavDirective } from '../../shared/menu-nav.directive';
import { UiSoundService } from '../../shared/ui-sound.service';
import { SettingsPanel } from '../settings/settings-panel';
import { CorridorBackdrop } from './corridor-backdrop';
import { DifficultyPicker } from './difficulty-picker';
import { FloorLogo } from './floor-logo';

type MenuView = 'root' | 'new-game' | 'difficulty' | 'settings' | 'credits';
type RootItem = 'continue' | 'new-game' | 'difficulty' | 'settings' | 'credits';

/** Author credit shown on the credits panel. */
const CREDIT_AUTHOR = 'Luka';

@Component({
  selector: 'app-main-menu',
  imports: [CorridorBackdrop, FloorLogo, DifficultyPicker, SettingsPanel, MenuNavDirective, AutofocusDirective],
  templateUrl: './main-menu.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mm',
    '[class.mm--sub]': "view() !== 'root'",
    '(document:keydown.escape)': 'onEscape($event)',
  },
})
export class MainMenu {
  private readonly session = inject(GameSessionService);
  private readonly audio = inject(AudioManagerService);
  private readonly ui = inject(UiSoundService);
  protected readonly saves = inject(SaveManagerService);

  protected readonly author = CREDIT_AUTHOR;
  protected readonly stage = CONTENT.stages.require(CONTENT.defaultStageId);
  protected readonly fallbackStorage = this.saves.usingFallbackStorage;

  protected readonly view = signal<MenuView>('root');
  /** Item focused when the root list (re)appears. */
  protected readonly focusTarget = signal<RootItem>(this.saves.hasContinue() ? 'continue' : 'new-game');

  protected readonly selectedDifficulty = computed(
    () =>
      CONTENT.difficulties.get(this.saves.data().selectedDifficulty) ??
      CONTENT.difficulties.require(CONTENT.defaultDifficultyId),
  );

  /** "FLOOR 14 · 10:42 · EMPLOYEE" for the saved shift, or null. */
  protected readonly continueLine = computed(() => {
    const run = this.saves.data().progress.activeRun;
    if (!run) return null;
    const floor = CONTENT.stages.get(run.stageId)?.floorLabel ?? run.stageId.toUpperCase();
    const difficulty = CONTENT.difficulties.get(run.difficultyId)?.name ?? run.difficultyId.toUpperCase();
    return `${floor} · ${run.savedAtClock} · ${difficulty}`;
  });

  protected readonly endings = computed(() => {
    const unlocked = new Set(this.saves.data().progress.unlockedEndings);
    return CONTENT.endings
      .all()
      .map((e) => ({ code: e.code, title: unlocked.has(e.id) ? e.title : '???', unlocked: unlocked.has(e.id) }))
      .sort((a, b) => a.code.localeCompare(b.code));
  });
  protected readonly endingsUnlocked = computed(() => this.endings().filter((e) => e.unlocked).length);

  constructor() {
    let destroyed = false;
    afterNextRender(() => {
      void this.audio.prepare(['music-menu', 'ui-hover', 'ui-select']).then(() => {
        // Howler unlocks audio on the first user gesture; until then the loop is queued silently.
        if (!destroyed) this.audio.startLoop('menu-music', 'music-menu', { fadeMs: 3000 });
      });
    });
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      this.audio.stopLoop('menu-music', 700);
    });
  }

  protected open(view: Exclude<MenuView, 'root'>, from: RootItem): void {
    this.ui.select();
    this.focusTarget.set(from);
    this.view.set(view);
  }

  protected back(): void {
    this.view.set('root');
  }

  protected continueShift(): void {
    if (!this.saves.hasContinue()) return;
    this.ui.select();
    this.session.continueGame();
  }

  protected startNewShift(difficultyId: string): void {
    this.session.newGame(difficultyId);
  }

  protected setDefaultDifficulty(difficultyId: string): void {
    this.saves.setDifficulty(difficultyId);
  }

  protected closeCredits(): void {
    this.ui.select();
    this.back();
  }

  protected onEscape(event: Event): void {
    if (this.view() === 'root') return;
    event.preventDefault();
    this.ui.select();
    this.back();
  }
}
