export type AudioCategory = 'ambient' | 'effects' | 'music';

/**
 * A sound event. Sources are either a URL (drop files in public/assets/audio) or a
 * procedural recipe id understood by systems/audio/audio-synth.ts.
 */
export interface SoundDefinition {
  readonly id: string;
  readonly category: AudioCategory;
  readonly source: { readonly kind: 'synth'; readonly recipe: string } | { readonly kind: 'url'; readonly urls: readonly string[] };
  readonly volume: number;
  readonly loop?: boolean;
  /** Positional (3D) sound. */
  readonly spatial?: boolean;
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly rolloff?: number;
  /** Random playback-rate variation (+/-). */
  readonly rateJitter?: number;
}
