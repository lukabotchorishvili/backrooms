import { SoundDefinition } from '../../models';

/**
 * Every sound in the game. All sources are procedural recipes (systems/audio/audio-synth.ts)
 * so the game ships with zero audio files. To use a recorded asset instead, replace a source
 * with { kind: 'url', urls: ['assets/audio/foo.ogg'] } and drop the file in public/assets/audio.
 */
const synth = (recipe: string) => ({ kind: 'synth', recipe }) as const;

export const SOUND_LIBRARY: readonly SoundDefinition[] = [
  // ---------------------------------------------------------------- ambient loops
  { id: 'amb-hum', category: 'ambient', source: synth('amb-hum'), volume: 0.32, loop: true },
  { id: 'amb-fluorescent', category: 'ambient', source: synth('amb-fluorescent'), volume: 0.2, loop: true },
  { id: 'amb-vent', category: 'ambient', source: synth('amb-vent'), volume: 0.28, loop: true },
  { id: 'amb-office', category: 'ambient', source: synth('amb-office'), volume: 0.25, loop: true },
  { id: 'amb-room-tone', category: 'ambient', source: synth('amb-room-tone'), volume: 0.35, loop: true },
  { id: 'amb-fridge', category: 'ambient', source: synth('amb-fridge'), volume: 0.26, loop: true },
  { id: 'amb-electronics', category: 'ambient', source: synth('amb-electronics'), volume: 0.2, loop: true },
  { id: 'attention-drone', category: 'ambient', source: synth('attention-drone'), volume: 0.5, loop: true },
  { id: 'elevator-motor', category: 'effects', source: synth('elevator-motor'), volume: 0.6, loop: true },
  { id: 'room-tone', category: 'ambient', source: synth('amb-room-tone'), volume: 0.5, loop: true },

  // ---------------------------------------------------------------- music
  { id: 'music-menu', category: 'music', source: synth('music-menu'), volume: 0.55, loop: true },
  { id: 'music-ambient', category: 'music', source: synth('music-ambient'), volume: 0.35, loop: true },
  { id: 'music-tension', category: 'music', source: synth('music-tension'), volume: 0.45, loop: true },
  { id: 'music-ending', category: 'music', source: synth('music-ending'), volume: 0.5, loop: true },

  // ---------------------------------------------------------------- player
  { id: 'step-carpet', category: 'effects', source: synth('step-carpet'), volume: 0.32, rateJitter: 0.12 },
  { id: 'step-hard', category: 'effects', source: synth('step-hard'), volume: 0.36, rateJitter: 0.12 },
  { id: 'flashlight-click', category: 'effects', source: synth('flashlight-click'), volume: 0.5 },
  { id: 'inspect', category: 'effects', source: synth('inspect'), volume: 0.35 },
  { id: 'notebook', category: 'effects', source: synth('notebook'), volume: 0.4 },

  // ---------------------------------------------------------------- interaction
  { id: 'door-open', category: 'effects', source: synth('door-open'), volume: 0.6, spatial: true, refDistance: 2, rolloff: 1.2, rateJitter: 0.06 },
  { id: 'door-close', category: 'effects', source: synth('door-close'), volume: 0.6, spatial: true, refDistance: 2, rolloff: 1.2, rateJitter: 0.06 },
  { id: 'door-locked', category: 'effects', source: synth('door-locked'), volume: 0.55, spatial: true, refDistance: 2 },
  { id: 'door-slam', category: 'effects', source: synth('door-slam'), volume: 1, spatial: true, refDistance: 4, rolloff: 0.8 },
  { id: 'glass-door', category: 'effects', source: synth('glass-door'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'keyboard', category: 'effects', source: synth('keyboard'), volume: 0.45 },
  { id: 'terminal-beep', category: 'effects', source: synth('terminal-beep'), volume: 0.35 },
  { id: 'report-ok', category: 'effects', source: synth('report-ok'), volume: 0.5 },
  { id: 'report-bad', category: 'effects', source: synth('report-bad'), volume: 0.55 },
  { id: 'elevator-button', category: 'effects', source: synth('elevator-button'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'elevator-ding', category: 'effects', source: synth('elevator-ding'), volume: 0.7, spatial: true, refDistance: 4 },
  { id: 'elevator-arrival', category: 'effects', source: synth('elevator-arrival'), volume: 0.8, spatial: true, refDistance: 3, rolloff: 0.9 },
  { id: 'elevator-doors', category: 'effects', source: synth('elevator-doors'), volume: 0.6, spatial: true, refDistance: 3 },
  { id: 'pickup', category: 'effects', source: synth('pickup'), volume: 0.5 },
  { id: 'relief', category: 'effects', source: synth('relief'), volume: 0.5 },
  { id: 'hazard', category: 'effects', source: synth('hazard'), volume: 0.6 },
  { id: 'ui-hover', category: 'effects', source: synth('ui-hover'), volume: 0.18 },
  { id: 'ui-select', category: 'effects', source: synth('ui-select'), volume: 0.35 },

  // ---------------------------------------------------------------- horror / anomaly
  { id: 'phone-ring', category: 'effects', source: synth('phone-ring'), volume: 0.75, spatial: true, refDistance: 3, rolloff: 0.9 },
  { id: 'knock', category: 'effects', source: synth('knock'), volume: 0.95, spatial: true, refDistance: 3, rolloff: 0.9 },
  { id: 'footstep-echo', category: 'effects', source: synth('step-hard'), volume: 0.45, spatial: true, refDistance: 2, rateJitter: 0.05 },
  { id: 'distant-footsteps', category: 'effects', source: synth('distant-footsteps'), volume: 0.5, spatial: true, refDistance: 5, rolloff: 0.7 },
  { id: 'distant-door', category: 'effects', source: synth('door-slam'), volume: 0.45, spatial: true, refDistance: 6, rolloff: 0.6 },
  { id: 'static-burst', category: 'effects', source: synth('static-burst'), volume: 0.35 },
  { id: 'fluorescent-zap', category: 'effects', source: synth('fluorescent-zap'), volume: 0.55, spatial: true, refDistance: 3 },
  { id: 'light-on', category: 'effects', source: synth('light-on'), volume: 0.7 },
  { id: 'pa-chime', category: 'effects', source: synth('pa-chime'), volume: 0.6 },
  { id: 'heartbeat', category: 'effects', source: synth('heartbeat'), volume: 0.6, loop: true },
  { id: 'stinger', category: 'effects', source: synth('stinger'), volume: 0.55 },
  { id: 'thud', category: 'effects', source: synth('thud'), volume: 0.7 },
  { id: 'low-boom', category: 'effects', source: synth('low-boom'), volume: 0.8 },
  { id: 'whisper', category: 'effects', source: synth('whisper'), volume: 0.35, spatial: true, refDistance: 2 },

  // ---------------------------------------------------------------- decoys
  { id: 'vent-rattle', category: 'effects', source: synth('vent-rattle'), volume: 0.55, spatial: true, refDistance: 3 },
  { id: 'pipes', category: 'effects', source: synth('pipes'), volume: 0.6, spatial: true, refDistance: 3 },
  { id: 'monitor-click', category: 'effects', source: synth('monitor-click'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'printer', category: 'effects', source: synth('printer'), volume: 0.5, spatial: true, refDistance: 3 },
  { id: 'cooler-gurgle', category: 'effects', source: synth('cooler-gurgle'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'paper-settle', category: 'effects', source: synth('paper-settle'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'drip', category: 'effects', source: synth('drip'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'radiator-tick', category: 'effects', source: synth('radiator-tick'), volume: 0.5, spatial: true, refDistance: 2 },
  { id: 'elevator-machinery', category: 'effects', source: synth('elevator-machinery'), volume: 0.5, spatial: true, refDistance: 4 },
];

/** Recipe ids referenced above - the synthesizer must implement every one. */
export const SYNTH_RECIPES: readonly string[] = [
  ...new Set(
    SOUND_LIBRARY.filter((s) => s.source.kind === 'synth').map((s) =>
      s.source.kind === 'synth' ? s.source.recipe : '',
    ),
  ),
];
