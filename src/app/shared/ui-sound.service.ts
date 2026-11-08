import { Injectable, inject } from '@angular/core';
import { AudioManagerService } from '../core/game/systems/audio-manager.service';

/** Interface sounds (hover / select), throttled so fast keyboard navigation does not stack clicks. */
@Injectable({ providedIn: 'root' })
export class UiSoundService {
  private readonly audio = inject(AudioManagerService);
  private lastHover = 0;

  hover(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastHover < 45) return;
    this.lastHover = now;
    this.audio.play('ui-hover');
  }

  select(): void {
    this.audio.play('ui-select');
  }
}
