import { Injectable, computed, inject } from '@angular/core';
import { GameSettings, sanitizeSettings } from '../models';
import { SaveManagerService } from './save-manager.service';

/** Thin, typed facade over the persisted settings. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly save = inject(SaveManagerService);
  readonly settings = computed(() => this.save.data().settings);

  update(patch: Partial<GameSettings>): void {
    this.save.setSettings(sanitizeSettings({ ...this.settings(), ...patch }));
  }

  reset(): void {
    this.save.setSettings(sanitizeSettings(null));
  }

  /** Enter/leave browser fullscreen to match the setting. Must be called from a user gesture. */
  async applyFullscreen(enabled: boolean): Promise<void> {
    if (typeof document === 'undefined') return;
    try {
      if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!enabled && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Fullscreen can be refused (iframe, no gesture). The setting is still stored.
    }
  }
}
