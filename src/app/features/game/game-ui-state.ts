import { Injectable, signal } from '@angular/core';

/**
 * UI-only state that must outlive individual overlays but not the game page
 * (provided by GamePage). Reset at the start of every run.
 */
@Injectable()
export class GameUiState {
  /** The terminal has played its boot sequence during this run. */
  readonly terminalBooted = signal(false);

  resetRun(): void {
    this.terminalBooted.set(false);
  }
}
