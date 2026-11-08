import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { GamePhase } from '../../core/game/models';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { MenuNavDirective } from '../../shared/menu-nav.directive';
import { EndingScreen } from '../endings/ending-screen';
import { Hud } from '../hud/hud';
import { InvestigationTerminal } from '../investigation-terminal/investigation-terminal';
import { Notebook } from '../notebook/notebook';
import { GameUiState } from './game-ui-state';
import { IntroOverlay } from './intro-overlay';
import { LoadingScreen } from './loading-screen';
import { PauseMenu } from './pause-menu';
import { PerfReadout } from './perf-readout';

/** Phases during which the HUD stays mounted (hidden behind overlays where needed). */
const HUD_PHASES: ReadonlySet<GamePhase> = new Set(['playing', 'security', 'paused', 'notebook', 'terminal']);
const LIVE_PHASES: ReadonlySet<GamePhase> = new Set(['playing', 'security']);

/**
 * /play - the full-viewport WebGL canvas plus every overlay, switched on the session phase.
 * The engine is attached once the canvas exists (browser only) and detached on destroy.
 */
@Component({
  selector: 'app-game-page',
  imports: [
    Hud,
    LoadingScreen,
    IntroOverlay,
    PauseMenu,
    Notebook,
    InvestigationTerminal,
    EndingScreen,
    PerfReadout,
    AutofocusDirective,
    MenuNavDirective,
  ],
  providers: [GameUiState],
  templateUrl: './game-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'game',
    '[class.is-locked]': 'session.pointerLocked()',
    '[attr.data-phase]': 'session.phase()',
  },
})
export class GamePage implements OnDestroy {
  protected readonly session = inject(GameSessionService);
  private readonly uiState = inject(GameUiState);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly phase = this.session.phase;
  protected readonly hudMounted = computed(() => HUD_PHASES.has(this.phase()));
  protected readonly hudConcealed = computed(() => !LIVE_PHASES.has(this.phase()));
  protected readonly showRelockVeil = computed(() => LIVE_PHASES.has(this.phase()) && !this.session.pointerLocked());
  protected readonly loadingFloor = computed(() => this.session.stageSignal()?.floorLabel ?? '');
  protected readonly wakeDetails = computed(() => {
    const parts = [this.session.stageSignal()?.floorLabel, this.session.difficultySignal()?.name];
    if (this.session.isResumed()) parts.push(`SAVED AT ${this.session.clock()}`);
    else parts.push('SHIFT 09:00–17:00');
    return parts.filter((p): p is string => !!p).join(' · ');
  });

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvas()?.nativeElement;
      if (canvas) void this.session.attach(canvas);
    });

    effect(() => {
      const phase = this.phase();
      untracked(() => {
        // Every boot starts a new run (new game, continue, restart, retry).
        if (phase === 'loading') this.uiState.resetRun();
        // Overlays are gone: give keyboard focus back to the game surface.
        if (phase === 'playing' || phase === 'intro') this.focusCanvas();
      });
    });
  }

  ngOnDestroy(): void {
    this.session.detach();
  }

  /** "Click to wake up" - must stay inside the click handler (pointer lock + audio unlock). */
  protected wake(): void {
    this.focusCanvas();
    void this.session.beginFromOverlay();
  }

  /** Click-to-continue after pointer lock was lost. */
  protected relock(): void {
    this.focusCanvas();
    this.session.relock();
  }

  protected retry(): void {
    void this.session.retry();
  }

  protected toMenu(): void {
    this.session.quitToMenu();
  }

  private focusCanvas(): void {
    const canvas = this.canvas()?.nativeElement;
    if (canvas && document.activeElement !== canvas) canvas.focus({ preventScroll: true });
  }
}
