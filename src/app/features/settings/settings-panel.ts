import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { DEFAULT_SETTINGS, GameSettings, GraphicsQuality } from '../../core/game/models';
import { SettingsService } from '../../core/game/systems/settings.service';
import { AutofocusDirective } from '../../shared/autofocus.directive';
import { formatPercent } from '../../shared/format';
import { MenuNavDirective } from '../../shared/menu-nav.directive';
import { UiSoundService } from '../../shared/ui-sound.service';
import { listenOnDocument } from '../../shared/window-listener';

type NumericKey = { [K in keyof GameSettings]: GameSettings[K] extends number ? K : never }[keyof GameSettings];
type BooleanKey = { [K in keyof GameSettings]: GameSettings[K] extends boolean ? K : never }[keyof GameSettings];

interface SliderDef {
  readonly key: NumericKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
}

interface ToggleDef {
  readonly key: Exclude<BooleanKey, 'fullscreen'>;
  readonly label: string;
  readonly hint?: string;
}

const VOLUME = { min: 0, max: 1, step: 0.05, format: formatPercent } as const;

/**
 * Shared settings panel (main menu + pause menu). Every change applies live through
 * SettingsService.update(). Escape handling is left to the host (menu / pause).
 */
@Component({
  selector: 'app-settings-panel',
  imports: [MenuNavDirective, AutofocusDirective],
  templateUrl: './settings-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'settings' },
})
export class SettingsPanel {
  private readonly settingsService = inject(SettingsService);
  private readonly ui = inject(UiSoundService);

  readonly closed = output<void>();

  protected readonly settings = this.settingsService.settings;

  protected readonly controls: readonly SliderDef[] = [
    { key: 'mouseSensitivity', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
    { key: 'fieldOfView', label: 'Field of view', min: 60, max: 100, step: 1, format: (v) => `${Math.round(v)}°` },
  ];
  protected readonly volumes: readonly SliderDef[] = [
    { key: 'masterVolume', label: 'Master volume', ...VOLUME },
    { key: 'ambientVolume', label: 'Ambience', ...VOLUME },
    { key: 'effectsVolume', label: 'Effects', ...VOLUME },
    { key: 'musicVolume', label: 'Music', ...VOLUME },
  ];
  protected readonly displayToggles: readonly ToggleDef[] = [
    { key: 'cameraShake', label: 'Camera shake' },
    { key: 'postProcessing', label: 'Post-processing', hint: 'Grain, vignette, aberration' },
    { key: 'showPerformanceStats', label: 'Performance readout' },
  ];
  protected readonly qualities: readonly { readonly id: GraphicsQuality; readonly label: string }[] = [
    { id: 'low', label: 'LOW' },
    { id: 'medium', label: 'MEDIUM' },
    { id: 'high', label: 'HIGH' },
  ];

  constructor() {
    // Keep the toggle honest when the player leaves fullscreen with Esc / F11.
    listenOnDocument('fullscreenchange', () => {
      const active = document.fullscreenElement !== null;
      if (active !== this.settings().fullscreen) this.settingsService.update({ fullscreen: active });
    });
  }

  protected sliderPercent(def: SliderDef): number {
    const value = this.settings()[def.key];
    return ((value - def.min) / (def.max - def.min)) * 100;
  }

  protected onSlider(key: NumericKey, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const value = target.valueAsNumber;
    if (!Number.isFinite(value)) return;
    const patch: Partial<GameSettings> = {};
    patch[key] = value;
    this.settingsService.update(patch);
  }

  protected toggle(key: Exclude<BooleanKey, 'fullscreen'>): void {
    this.ui.select();
    const patch: Partial<GameSettings> = {};
    patch[key] = !this.settings()[key];
    this.settingsService.update(patch);
  }

  protected toggleInvert(): void {
    this.ui.select();
    this.settingsService.update({ invertMouse: !this.settings().invertMouse });
  }

  /** Runs inside the click handler so the fullscreen request carries the user gesture. */
  protected toggleFullscreen(): void {
    this.ui.select();
    const next = !this.settings().fullscreen;
    void this.settingsService.applyFullscreen(next);
    this.settingsService.update({ fullscreen: next });
  }

  protected setQuality(quality: GraphicsQuality): void {
    if (this.settings().graphicsQuality === quality) return;
    this.ui.select();
    this.settingsService.update({ graphicsQuality: quality });
  }

  protected restoreDefaults(): void {
    this.ui.select();
    if (this.settings().fullscreen !== DEFAULT_SETTINGS.fullscreen) {
      void this.settingsService.applyFullscreen(DEFAULT_SETTINGS.fullscreen);
    }
    this.settingsService.reset();
  }

  protected close(): void {
    this.ui.select();
    this.closed.emit();
  }
}
