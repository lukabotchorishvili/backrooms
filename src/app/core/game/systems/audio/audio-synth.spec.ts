import { SYNTH_RECIPES } from '../../content/audio/sound-library';
import { SYNTH_SAMPLE_RATE, encodeWav, hasRecipe, listRecipes, synthesize } from './audio-synth';

describe('audio synthesizer', () => {
  it('implements every recipe referenced by the sound library', () => {
    const missing = SYNTH_RECIPES.filter((r) => !hasRecipe(r));
    expect(missing).toEqual([]);
    expect(listRecipes().length).toBeGreaterThanOrEqual(SYNTH_RECIPES.length);
  });

  it('produces finite samples in [-1, 1], deterministically', () => {
    for (const recipe of ['knock', 'phone-ring', 'step-carpet', 'elevator-ding', 'door-slam', 'pa-chime']) {
      const a = synthesize(recipe, SYNTH_SAMPLE_RATE);
      const b = synthesize(recipe, SYNTH_SAMPLE_RATE);
      expect(a.length).toBeGreaterThan(0);
      let peak = 0;
      let finite = true;
      let identical = a.length === b.length;
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i])) finite = false;
        if (a[i] !== b[i]) identical = false;
        peak = Math.max(peak, Math.abs(a[i]));
      }
      expect(finite, recipe).toBe(true);
      expect(identical, recipe).toBe(true);
      expect(peak).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.01);
    }
  });

  it('throws for unknown recipes', () => {
    expect(() => synthesize('does-not-exist')).toThrow(/Unknown synth recipe/);
  });

  it('encodes 16-bit mono WAV', () => {
    const buffer = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 24000);
    const bytes = new Uint8Array(buffer);
    const text = (from: number) => String.fromCharCode(...bytes.slice(from, from + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(buffer.byteLength).toBe(44 + 2 * 4);
    expect(new DataView(buffer).getUint32(24, true)).toBe(24000);
  });
});
