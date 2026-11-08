export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GameSettings {
  /** Multiplier, 0.2 .. 3. 1 = default. */
  mouseSensitivity: number;
  invertMouse: boolean;
  masterVolume: number;
  ambientVolume: number;
  effectsVolume: number;
  musicVolume: number;
  graphicsQuality: GraphicsQuality;
  fullscreen: boolean;
  cameraShake: boolean;
  postProcessing: boolean;
  /** Field of view in degrees. */
  fieldOfView: number;
  showPerformanceStats: boolean;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  mouseSensitivity: 1,
  invertMouse: false,
  masterVolume: 0.8,
  ambientVolume: 0.8,
  effectsVolume: 0.9,
  musicVolume: 0.6,
  graphicsQuality: 'medium',
  fullscreen: false,
  cameraShake: true,
  postProcessing: true,
  fieldOfView: 75,
  showPerformanceStats: false,
});

/** Clamp/repair untrusted settings (e.g. from an old or hand-edited save). */
export function sanitizeSettings(input: Partial<GameSettings> | null | undefined): GameSettings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) } as GameSettings;
  const num = (v: unknown, def: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
  return {
    mouseSensitivity: num(s.mouseSensitivity, DEFAULT_SETTINGS.mouseSensitivity, 0.2, 3),
    invertMouse: bool(s.invertMouse, DEFAULT_SETTINGS.invertMouse),
    masterVolume: num(s.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
    ambientVolume: num(s.ambientVolume, DEFAULT_SETTINGS.ambientVolume, 0, 1),
    effectsVolume: num(s.effectsVolume, DEFAULT_SETTINGS.effectsVolume, 0, 1),
    musicVolume: num(s.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
    graphicsQuality: (['low', 'medium', 'high'] as const).includes(s.graphicsQuality)
      ? s.graphicsQuality
      : DEFAULT_SETTINGS.graphicsQuality,
    fullscreen: bool(s.fullscreen, DEFAULT_SETTINGS.fullscreen),
    cameraShake: bool(s.cameraShake, DEFAULT_SETTINGS.cameraShake),
    postProcessing: bool(s.postProcessing, DEFAULT_SETTINGS.postProcessing),
    fieldOfView: num(s.fieldOfView, DEFAULT_SETTINGS.fieldOfView, 60, 100),
    showPerformanceStats: bool(s.showPerformanceStats, DEFAULT_SETTINGS.showPerformanceStats),
  };
}
