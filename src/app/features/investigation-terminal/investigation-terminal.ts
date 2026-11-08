import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import {
  ANOMALY_CATEGORIES,
  ANOMALY_CATEGORY_LABELS,
  AnomalyCategory,
  ReportResult,
  RoomId,
} from '../../core/game/models';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { observationMatchesRoom } from '../../core/game/systems/investigation.service';
import { MODIFIER_KEYS } from '../../shared/motion';
import { Typewriter } from '../../shared/typewriter';
import { consumeKey, listenOnWindow } from '../../shared/window-listener';
import { GameUiState } from '../game/game-ui-state';

interface CandidateEntry {
  readonly id: string;
  readonly clock: string;
  readonly subject: string;
  readonly text: string;
}

const OUTCOME_TAGS: Readonly<Record<ReportResult['outcome'], string>> = {
  confirmed: 'ACCEPTED',
  rejected: 'REJECTED',
  mismatch: 'RETURNED',
  duplicate: 'NOT PROCESSED',
  invalid: 'NOT PROCESSED',
};

/**
 * Reception terminal: file irregularity reports (room -> notebook entry -> category) and request
 * elevator access. Keyboard-first; all key events are kept away from game input while open.
 */
@Component({
  selector: 'app-investigation-terminal',
  imports: [Typewriter],
  templateUrl: './investigation-terminal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'overlay overlay--terminal',
    '(keydown)': '$event.stopPropagation()',
    '(keyup)': '$event.stopPropagation()',
  },
})
export class InvestigationTerminal {
  protected readonly session = inject(GameSessionService);
  private readonly uiState = inject(GameUiState);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly resultEl = viewChild<ElementRef<HTMLElement>>('resultEl');
  private readonly accessEl = viewChild<ElementRef<HTMLElement>>('accessEl');

  protected readonly stage = this.session.stageSignal;
  protected readonly header = computed(() => this.stage()?.terminal.header ?? 'FLOOR INSPECTION SYSTEM');
  protected readonly bootLines = computed<readonly string[]>(() => this.stage()?.terminal.bootLines ?? []);
  protected readonly instructions = computed<readonly string[]>(() => this.stage()?.terminal.instructions ?? []);
  protected readonly employee = computed(() => this.stage()?.employeeNumber ?? '----');
  protected readonly floor = computed(() => this.stage()?.floorLabel ?? '');

  /* ---------------------------------------------------------------- boot sequence */
  /** Boot lines are typed only the first time the terminal opens in a run. */
  protected readonly firstOpen = !this.uiState.terminalBooted();
  protected readonly booting = signal(this.firstOpen);
  protected readonly bootIndex = signal(0);

  /* ---------------------------------------------------------------- report form */
  /** Visited rooms, captured on open (the player cannot move while the terminal is up). */
  protected readonly rooms: readonly { readonly id: RoomId; readonly name: string }[] = this.session.reportableRooms();
  protected readonly categories = ANOMALY_CATEGORIES.map((id) => ({ id, label: ANOMALY_CATEGORY_LABELS[id] }));

  protected readonly roomId = signal<RoomId | null>(null);
  protected readonly observationId = linkedSignal<RoomId | null, string | null>({
    source: this.roomId,
    computation: () => null,
  });
  protected readonly category = signal<AnomalyCategory | null>(null);

  protected readonly candidates = computed<readonly CandidateEntry[]>(() => {
    const room = this.roomId();
    if (!room) return [];
    return this.session.investigation
      .observations()
      .filter((o) => !o.reported && observationMatchesRoom(o, room))
      .sort((a, b) => b.time - a.time)
      .map((o) => ({ id: o.id, clock: o.clock, subject: o.subject, text: o.text }));
  });

  protected readonly canSubmit = computed(() => {
    const id = this.observationId();
    return this.roomId() !== null && this.category() !== null && id !== null && this.candidates().some((c) => c.id === id);
  });

  protected readonly result = signal<ReportResult | null>(null);
  protected readonly resultTag = computed(() => {
    const r = this.result();
    return r ? OUTCOME_TAGS[r.outcome] : '';
  });

  /* ---------------------------------------------------------------- status */
  protected readonly objective = this.session.progression.objective;
  protected readonly accessGranted = this.session.progression.accessGranted;
  protected readonly accessDenied = signal(false);
  protected readonly attentionLabel = computed(() => this.session.attention.levelConfig().label);
  protected readonly systemNote = this.pickSystemNote();

  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    });

    listenOnWindow(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          consumeKey(event);
          if (!event.repeat) this.session.closeOverlay();
          return;
        }
        if (this.booting() && !MODIFIER_KEYS.has(event.key)) {
          consumeKey(event);
          this.finishBoot();
        }
      },
      { capture: true },
    );

    if (!this.firstOpen || this.bootLines().length === 0) {
      this.booting.set(false);
      this.uiState.terminalBooted.set(true);
      afterNextRender(() => this.focusFirstField());
    }
  }

  /* ---------------------------------------------------------------- boot */

  protected bootLineDone(index: number): void {
    if (!this.booting()) return;
    if (index + 1 < this.bootLines().length) {
      this.bootTimer = setTimeout(() => this.bootIndex.set(index + 1), 140);
    } else {
      this.bootTimer = setTimeout(() => this.finishBoot(), 450);
    }
  }

  protected finishBoot(): void {
    if (!this.booting()) return;
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    this.bootIndex.set(Math.max(0, this.bootLines().length - 1));
    this.booting.set(false);
    this.uiState.terminalBooted.set(true);
    afterNextRender(() => this.focusFirstField(), { injector: this.injector });
  }

  /* ---------------------------------------------------------------- form */

  protected selectRoom(id: RoomId): void {
    this.roomId.set(id);
  }

  protected selectObservation(id: string): void {
    this.observationId.set(id);
  }

  protected selectCategory(id: AnomalyCategory): void {
    this.category.set(id);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const roomId = this.roomId();
    const observationId = this.observationId();
    const category = this.category();
    if (!this.canSubmit() || roomId === null || observationId === null || category === null) return;
    const result = this.session.submitReport({ observationId, roomId, category });
    this.result.set(result);
    this.category.set(null);
    if (result.outcome === 'confirmed' || result.outcome === 'rejected') this.observationId.set(null);
    afterNextRender(() => this.resultEl()?.nativeElement.focus({ preventScroll: false }), { injector: this.injector });
  }

  /**
   * Enter on a choice selects it and advances: LOCATION -> DESCRIPTION -> CATEGORY -> submit.
   * (Browsers disagree on implicit submission from radio buttons, so it is handled explicitly.)
   */
  protected onFieldEnter(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return;
    event.preventDefault();
    if (!target.checked) target.click();
    const order = ['term-room', 'term-observation', 'term-category'];
    const index = order.indexOf(target.name);
    if (index === order.length - 1 && this.canSubmit()) {
      this.submit(event);
      return;
    }
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        for (const name of order.slice(index + 1)) {
          if (name === 'term-category' && this.category() !== null && this.canSubmit()) break;
          const next =
            root.querySelector<HTMLElement>(`input[name="${name}"]:checked:not(:disabled)`) ??
            root.querySelector<HTMLElement>(`input[name="${name}"]:not(:disabled)`);
          if (next) {
            next.focus();
            return;
          }
        }
        root.querySelector<HTMLElement>('.term-actions button:not(:disabled)')?.focus();
      },
      { injector: this.injector },
    );
  }

  protected requestAccess(): void {
    const granted = this.session.requestElevatorAccess();
    this.accessDenied.set(!granted);
    afterNextRender(() => this.accessEl()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    this.session.closeOverlay();
  }

  private focusFirstField(): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLElement>('input[name="term-room"]:checked') ??
      root.querySelector<HTMLElement>('input[name="term-room"]') ??
      root.querySelector<HTMLElement>('.term-actions button:not(:disabled)');
    target?.focus({ preventScroll: true });
  }

  /** One line the building wants to say, chosen from the active behaviour responses. */
  private pickSystemNote(): string | null {
    try {
      const responses = this.session.director.activeResponses(this.session.behavior.snapshot().profile);
      const message = responses.find((r) => r.messages.length > 0)?.messages[0];
      return message ? this.session.resolveText(message) : null;
    } catch {
      return null;
    }
  }
}
