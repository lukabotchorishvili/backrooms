import { Injectable, signal } from '@angular/core';
import { Howl, Howler } from 'howler';
import { SOUND_LIBRARY } from '../content/audio/sound-library';
import { AudioCategory, GameSettings, SoundDefinition, Vec3 } from '../models';
import type { ProceduralWorkers } from '../workers/procedural-pool';
import { SYNTH_SAMPLE_RATE, encodeWav, synthesize } from './audio/audio-synth';

export interface PlayOptions {
  readonly position?: Vec3;
  readonly volume?: number;
  readonly rate?: number;
}

interface LoopEntry {
  readonly soundId: string;
  readonly howl: Howl;
  readonly playId: number;
  volume: number;
}

/**
 * All game audio goes through here (Howler.js). Sources are synthesised procedurally on demand
 * (see audio-synth.ts) and cached as WAV blob URLs. Browser autoplay restrictions are handled by
 * Howler's auto-unlock: sounds requested before the first user gesture play once unlocked.
 *
 * Coordinates: Babylon is left-handed, Web Audio right-handed, so Z is mirrored for spatial audio.
 */
@Injectable({ providedIn: 'root' })
export class AudioManagerService {
  private readonly defs = new Map<string, SoundDefinition>(SOUND_LIBRARY.map((d) => [d.id, d]));
  private readonly howls = new Map<string, Howl>();
  private readonly recipeUrls = new Map<string, string>();
  private readonly loops = new Map<string, LoopEntry>();
  private volumes: Record<AudioCategory, number> = { ambient: 0.8, effects: 0.9, music: 0.6 };
  private master = 0.8;
  private duck = 1;
  private speechVolume = 0.8;
  readonly available = typeof window !== 'undefined' && typeof Blob !== 'undefined';
  readonly preparedCount = signal(0);

  /**
   * Synthesises sources ahead of time. With a worker pool every recipe renders in parallel off
   * the main thread; otherwise they are synthesised in small batches so the UI stays responsive.
   */
  async prepare(
    ids: readonly string[] = [...this.defs.keys()],
    onProgress?: (p: number) => void,
    workers: ProceduralWorkers | null = null,
  ): Promise<void> {
    if (!this.available) return;
    if (workers) {
      const recipes = [
        ...new Set(
          ids
            .map((id) => this.defs.get(id)?.source)
            .filter((s): s is { kind: 'synth'; recipe: string } => s?.kind === 'synth')
            .map((s) => s.recipe)
            .filter((r) => !this.recipeUrls.has(r)),
        ),
      ];
      let done = 0;
      await Promise.all(
        recipes.map(async (recipe) => {
          try {
            this.storeRecipe(recipe, await workers.synth(recipe));
          } catch {
            /* falls back to main-thread synthesis in sourceUrl() */
          }
          onProgress?.((++done / Math.max(1, recipes.length)) * 0.95);
        }),
      );
    }
    let done = 0;
    for (const id of ids) {
      this.ensureHowl(id);
      done++;
      onProgress?.(workers ? 0.95 + (done / ids.length) * 0.05 : done / ids.length);
      if (!workers && done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  private storeRecipe(recipe: string, pcm: Float32Array): string {
    const url = URL.createObjectURL(new Blob([encodeWav(pcm, SYNTH_SAMPLE_RATE)], { type: 'audio/wav' }));
    this.recipeUrls.set(recipe, url);
    return url;
  }

  private sourceUrl(def: SoundDefinition): string[] | null {
    if (def.source.kind === 'url') return [...def.source.urls];
    const recipe = def.source.recipe;
    let url = this.recipeUrls.get(recipe);
    if (!url) {
      try {
        url = this.storeRecipe(recipe, synthesize(recipe, SYNTH_SAMPLE_RATE));
      } catch (err) {
        console.warn(`[audio] could not synthesise "${recipe}"`, err);
        return null;
      }
    }
    return [url];
  }

  private ensureHowl(id: string): Howl | null {
    if (!this.available) return null;
    const existing = this.howls.get(id);
    if (existing) return existing;
    const def = this.defs.get(id);
    if (!def) {
      console.warn(`[audio] unknown sound "${id}"`);
      return null;
    }
    const src = this.sourceUrl(def);
    if (!src) return null;
    const howl = new Howl({
      src,
      format: def.source.kind === 'synth' ? ['wav'] : undefined,
      loop: !!def.loop,
      volume: def.volume,
      preload: true,
    });
    this.howls.set(id, howl);
    this.preparedCount.update((n) => n + 1);
    return howl;
  }

  private gainFor(def: SoundDefinition, volume = 1): number {
    return Math.max(0, Math.min(1, def.volume * volume * this.volumes[def.category] * this.duck));
  }

  applySettings(settings: GameSettings): void {
    this.master = settings.masterVolume;
    this.volumes = { ambient: settings.ambientVolume, effects: settings.effectsVolume, music: settings.musicVolume };
    this.speechVolume = settings.masterVolume * settings.effectsVolume;
    if (this.available) Howler.volume(this.master);
    this.refreshLoopVolumes(0);
  }

  /** Lowers everything (pause menu, terminal). 1 = normal. */
  setDuck(factor: number, fadeMs = 300): void {
    this.duck = Math.max(0, Math.min(1, factor));
    this.refreshLoopVolumes(fadeMs);
  }

  private refreshLoopVolumes(fadeMs: number): void {
    for (const loop of this.loops.values()) {
      const def = this.defs.get(loop.soundId);
      if (!def) continue;
      const target = this.gainFor(def, loop.volume);
      if (fadeMs > 0) loop.howl.fade(loop.howl.volume(loop.playId) as number, target, fadeMs, loop.playId);
      else loop.howl.volume(target, loop.playId);
    }
  }

  play(id: string, options: PlayOptions = {}): number | null {
    const def = this.defs.get(id);
    const howl = this.ensureHowl(id);
    if (!def || !howl) return null;
    const playId = howl.play();
    howl.volume(this.gainFor(def, options.volume ?? 1), playId);
    const jitter = def.rateJitter ?? 0;
    const rate = (options.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    if (rate !== 1) howl.rate(rate, playId);
    if (def.spatial && options.position) this.placeSpatial(howl, def, playId, options.position);
    return playId;
  }

  private placeSpatial(howl: Howl, def: SoundDefinition, playId: number, p: Vec3): void {
    howl.pannerAttr(
      {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: def.refDistance ?? 2,
        rolloffFactor: def.rolloff ?? 1,
        maxDistance: def.maxDistance ?? 60,
      },
      playId,
    );
    howl.pos(p[0], p[1], -p[2], playId);
  }

  /** Starts (or keeps) a named looping layer. */
  startLoop(key: string, soundId: string, options: { volume?: number; fadeMs?: number; position?: Vec3 } = {}): void {
    const existing = this.loops.get(key);
    if (existing && existing.soundId === soundId) {
      this.setLoopVolume(key, options.volume ?? existing.volume, options.fadeMs ?? 600);
      return;
    }
    if (existing) this.stopLoop(key, options.fadeMs ?? 600);
    const def = this.defs.get(soundId);
    const howl = this.ensureHowl(soundId);
    if (!def || !howl) return;
    const playId = howl.play();
    howl.loop(true, playId);
    const volume = options.volume ?? 1;
    const fade = options.fadeMs ?? 600;
    howl.volume(0, playId);
    howl.fade(0, this.gainFor(def, volume), fade, playId);
    if (def.spatial && options.position) this.placeSpatial(howl, def, playId, options.position);
    this.loops.set(key, { soundId, howl, playId, volume });
  }

  setLoopVolume(key: string, volume: number, fadeMs = 600): void {
    const loop = this.loops.get(key);
    if (!loop) return;
    const def = this.defs.get(loop.soundId);
    if (!def) return;
    loop.volume = volume;
    const target = this.gainFor(def, volume);
    loop.howl.fade(loop.howl.volume(loop.playId) as number, target, Math.max(1, fadeMs), loop.playId);
  }

  hasLoop(key: string): boolean {
    return this.loops.has(key);
  }

  stopLoop(key: string, fadeMs = 600): void {
    const loop = this.loops.get(key);
    if (!loop) return;
    this.loops.delete(key);
    const { howl, playId } = loop;
    if (fadeMs <= 0) {
      howl.stop(playId);
      return;
    }
    howl.fade(howl.volume(playId) as number, 0, fadeMs, playId);
    setTimeout(() => howl.stop(playId), fadeMs + 30);
  }

  stopAllLoops(fadeMs = 600): void {
    for (const key of [...this.loops.keys()]) this.stopLoop(key, fadeMs);
  }

  /** Listener transform (call every frame from the engine). */
  setListener(position: Vec3, forward: Vec3): void {
    if (!this.available) return;
    Howler.pos(position[0], position[1], -position[2]);
    Howler.orientation(forward[0], forward[1], -forward[2], 0, 1, 0);
  }

  /** Synthetic PA voice (Web Speech API, optional). Returns the estimated duration in seconds. */
  speak(text: string, options: { pitch?: number; rate?: number; volume?: number } = {}): number {
    const words = text.split(/\s+/).length;
    const duration = Math.max(2.5, words / 2.3 + 0.8);
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return duration;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find((v) => /en[-_]/i.test(v.lang) && /(david|mark|guy|george|male)/i.test(v.name)) ??
        voices.find((v) => /en[-_]/i.test(v.lang));
      if (voice) utterance.voice = voice;
      utterance.pitch = options.pitch ?? 0.55;
      utterance.rate = options.rate ?? 0.82;
      utterance.volume = Math.max(0, Math.min(1, (options.volume ?? 0.85) * this.speechVolume * this.duck));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      /* speech is optional */
    }
    return duration;
  }

  cancelSpeech(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /** Stops every sound (keeps synthesised sources cached for the next run). */
  stopAll(): void {
    this.loops.clear();
    for (const howl of this.howls.values()) howl.stop();
    this.cancelSpeech();
    this.duck = 1;
  }

  /** Releases all audio resources. */
  dispose(): void {
    this.stopAll();
    for (const howl of this.howls.values()) howl.unload();
    this.howls.clear();
    for (const url of this.recipeUrls.values()) URL.revokeObjectURL(url);
    this.recipeUrls.clear();
  }
}
