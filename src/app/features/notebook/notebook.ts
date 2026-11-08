import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Observation, RoomId } from '../../core/game/models';
import { GameSessionService } from '../../core/game/systems/game-session.service';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { consumeKey, listenOnWindow } from '../../shared/window-listener';

interface NotebookEntry {
  readonly id: string;
  readonly clock: string;
  readonly subject: string;
  readonly text: string;
  readonly reported: boolean;
}

interface NotebookGroup {
  readonly roomId: RoomId;
  readonly roomName: string;
  readonly entries: readonly NotebookEntry[];
}

/**
 * The player's notebook: observations grouped by room, newest first, filed ones struck through.
 * An observation's `source` is deliberately never read here - the player must judge for themselves.
 */
@Component({
  selector: 'app-notebook',
  imports: [AutofocusDirective],
  templateUrl: './notebook.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'overlay overlay--notebook' },
})
export class Notebook {
  private readonly session = inject(GameSessionService);

  protected readonly employee = computed(() => this.session.stageSignal()?.employeeNumber ?? '----');
  protected readonly floor = computed(() => this.session.stageSignal()?.floorLabel ?? '');
  protected readonly clock = this.session.clock;

  protected readonly groups = computed<readonly NotebookGroup[]>(() => {
    const newestFirst = [...this.session.investigation.observations()].sort((a, b) => b.time - a.time);
    const byRoom = new Map<RoomId, NotebookEntry[]>();
    for (const o of newestFirst) {
      const list = byRoom.get(o.roomId) ?? [];
      list.push(toEntry(o));
      byRoom.set(o.roomId, list);
    }
    // Map preserves insertion order, so the room with the newest entry comes first.
    return [...byRoom.entries()].map(([roomId, entries]) => ({
      roomId,
      roomName: this.session.roomDisplayName(roomId),
      entries,
    }));
  });

  protected readonly total = computed(() => this.session.investigation.observations().length);
  protected readonly unreported = computed(() => this.session.investigation.unreportedCount());

  constructor() {
    listenOnWindow(
      'keydown',
      (event) => {
        if (event.key !== 'Tab' && event.key !== 'Escape') return;
        consumeKey(event);
        if (event.repeat) return;
        this.session.closeOverlay();
      },
      { capture: true },
    );
  }

  protected close(): void {
    this.session.closeOverlay();
  }
}

function toEntry(o: Observation): NotebookEntry {
  return { id: o.id, clock: o.clock, subject: o.subject, text: o.text, reported: o.reported };
}
