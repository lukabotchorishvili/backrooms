/**
 * Procedural sound synthesizer.
 *
 * The game ships with zero audio files: every `synth` source in the sound library names one of
 * the recipes registered at the bottom of this file. A recipe renders mono PCM (Float32 in
 * [-1, 1]) at load time; the audio system wraps it with encodeWav() into a Blob URL for Howler.
 *
 * Rules this module follows:
 * - Deterministic. Every recipe owns a seeded PRNG (never Math.random), so a recipe renders
 *   identical samples on every call and every run.
 * - Seamless loops. Loop buffers are treated as circular time: periodic oscillators have their
 *   rates snapped to whole cycles per loop, events that run past the end wrap to the head, and
 *   IIR filters / reverb run "circularly" (a warm-up pass, then the real pass) so the filter
 *   state at the head equals the state at the tail. Non-periodic layers are rendered long and
 *   folded with crossfadeLoop() (the tail crossfaded into the head).
 * - Pure TypeScript. No DOM or Web Audio, so it runs in Node under Vitest.
 */

export const SYNTH_SAMPLE_RATE = 24000;

const TAU = Math.PI * 2;

// =================================================================================================
// Deterministic PRNG
// =================================================================================================

/** mulberry32 - tiny, fast and fully deterministic. */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [-1, 1). */
  bi(): number {
    return this.next() * 2 - 1;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** value * (1 +/- amount) */
  vary(value: number, amount: number): number {
    return value * (1 + amount * this.bi());
  }
}

// =================================================================================================
// Small math helpers
// =================================================================================================

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;
const smoothstep = (x: number): number => {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};
const samplesFor = (sr: number, seconds: number): number => Math.max(1, Math.round(seconds * sr));
const buffer = (sr: number, seconds: number): Float32Array => new Float32Array(samplesFor(sr, seconds));

/** Snaps a rate so it completes a whole number of cycles (>= 1) over an n-sample loop. */
const snapToLoop = (hz: number, n: number, sr: number): number =>
  (Math.max(1, Math.round((hz * n) / sr)) * sr) / n;

function startIndex(n: number, sr: number, t: number, wrap: boolean): number {
  const s = Math.round(t * sr);
  return wrap ? ((s % n) + n) % n : s;
}

// =================================================================================================
// Wavetables & oscillators
// =================================================================================================

const TABLE_SIZE = 4096;

/** [harmonic number, amplitude, phase in cycles] */
type Harmonic = readonly [harmonic: number, amp: number, phase?: number];

/**
 * Single-cycle additive wavetable, peak-normalized unless `normalized` is false (then partial
 * amplitudes are kept as given, which lets several static partials of a loop share one voice).
 * Harmonics above ~0.45 * sr (at f0) are dropped. Two guard samples follow the cycle so
 * interpolated reads never need a bounds check.
 */
function makeTable(harmonics: readonly Harmonic[], f0 = 0, sr = 0, normalized = true): Float32Array {
  const table = new Float32Array(TABLE_SIZE + 2);
  for (const [k, amp, phase = 0] of harmonics) {
    if (f0 > 0 && k * f0 >= sr * 0.45) continue;
    for (let i = 0; i < TABLE_SIZE; i++) {
      table[i] += amp * Math.sin(TAU * ((k * i) / TABLE_SIZE + phase));
    }
  }
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i++) peak = Math.max(peak, Math.abs(table[i]));
  if (normalized && peak > 0) for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak;
  table[TABLE_SIZE] = table[0];
  table[TABLE_SIZE + 1] = table[1];
  return table;
}

/** Fractional part in [0, 1). Phases here stay far below 2^31, so `| 0` is exact (and much faster than Math.floor). */
function frac(x: number): number {
  const f = x - (x | 0);
  return f < 0 ? f + 1 : f;
}

/** Linear-interpolated wavetable read; phase in cycles. */
function readTable(table: Float32Array, phase: number): number {
  const x = frac(phase) * TABLE_SIZE;
  const i = x | 0;
  const a = table[i];
  return a + (table[i + 1] - a) * (x - i);
}

const SINE_TABLE = makeTable([[1, 1]]);

/** sin(2*pi*f*t)^(2k): a pulse train at 2f whose sharpness grows with k (no Math.pow per sample). */
function sinePulse(f: number, t: number, k: number): number {
  const s = readTable(SINE_TABLE, f * t);
  const s2 = s * s;
  let y = s2;
  for (let j = 1; j < k; j++) y *= s2;
  return y;
}

type Wave = 'sine' | 'saw' | 'square' | 'tri';

/** PolyBLEP residual for band-limited saw / square edges. */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Phase-accumulating oscillator (band-limited saw / square via PolyBLEP, naive triangle, sine). */
class Osc {
  private phase: number;
  private readonly wave: Wave;

  constructor(wave: Wave, phase = 0) {
    this.wave = wave;
    this.phase = frac(phase);
  }

  /** dt = frequency / sampleRate */
  next(dt: number): number {
    const p = this.phase;
    let y: number;
    if (this.wave === 'saw') y = 2 * p - 1 - polyBlep(p, dt);
    else if (this.wave === 'square') y = (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep(p < 0.5 ? p + 0.5 : p - 0.5, dt);
    else if (this.wave === 'tri') y = 1 - 4 * Math.abs(p - 0.5);
    else y = readTable(SINE_TABLE, p);
    const np = p + dt;
    this.phase = np >= 1 ? frac(np) : np;
    return y;
  }
}

// =================================================================================================
// Processors: filters, noise colouring, reverb
// =================================================================================================

/**
 * A buffer processor. Each implementation owns its sample loop (monomorphic and JIT friendly).
 * With `circular`, a warm-up pass primes the processor state with the buffer itself, so the
 * output is seamless when the buffer loops.
 */
interface Proc {
  run(buf: Float32Array, circular: boolean): void;
}

/**
 * Circular processing only needs to warm a processor up on the buffer's tail for a few of its
 * time constants (the loop's end is what precedes its start). Every filter used here settles
 * far below -90 dB within half a second.
 */
const FILTER_WARMUP_SECONDS = 0.5;

/** First index of the warm-up window (the last `samples` samples of an n-sample loop). */
const warmupStart = (n: number, samples: number): number => Math.max(0, n - Math.ceil(samples));

function applyProc(buf: Float32Array, proc: Proc, circular = false): Float32Array {
  proc.run(buf, circular);
  return buf;
}

type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peak';
/** [type, frequency, Q, gain dB (peak only)] */
type FilterSpec = readonly [type: FilterType, freq: number, q?: number, gainDb?: number];

/** RBJ cookbook biquad, transposed direct form II. */
class Biquad implements Proc {
  private readonly sr: number;
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(sr: number, type: FilterType, freq: number, q = Math.SQRT1_2, gainDb = 0) {
    this.sr = sr;
    this.set(type, freq, q, gainDb);
  }

  set(type: FilterType, freq: number, q = Math.SQRT1_2, gainDb = 0): void {
    const f = clamp(freq, 5, this.sr * 0.45);
    const w = (TAU * f) / this.sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.max(q, 0.05));
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    if (type === 'lowpass') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** Single sample (used by time-varying sweeps). */
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  run(buf: Float32Array, circular: boolean): void {
    const b0 = this.b0;
    const b1 = this.b1;
    const b2 = this.b2;
    const a1 = this.a1;
    const a2 = this.a2;
    const n = buf.length;
    let z1 = this.z1;
    let z2 = this.z2;
    if (circular) {
      for (let i = warmupStart(n, this.sr * FILTER_WARMUP_SECONDS); i < n; i++) {
        const x = buf[i];
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

function filter(buf: Float32Array, sr: number, specs: readonly FilterSpec[], circular = false): Float32Array {
  for (const [type, freq, q, gainDb] of specs) applyProc(buf, new Biquad(sr, type, freq, q, gainDb), circular);
  return buf;
}

/** Time-varying biquad: cutoff/centre comes from freqAt(sampleIndex), updated every 32 samples. */
function sweep(
  buf: Float32Array,
  sr: number,
  type: FilterType,
  q: number,
  freqAt: (i: number) => number,
  circular = false,
): Float32Array {
  const bq = new Biquad(sr, type, freqAt(0), q);
  const n = buf.length;
  if (circular) {
    const from = warmupStart(n, sr * FILTER_WARMUP_SECONDS);
    for (let i = from; i < n; i++) {
      if (i === from || (i & 31) === 0) bq.set(type, freqAt(i), q);
      bq.process(buf[i]);
    }
  }
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) bq.set(type, freqAt(i), q);
    buf[i] = bq.process(buf[i]);
  }
  return buf;
}

/** Paul Kellet's pink-noise filter (white in, pink out). Slowest pole: ~880 samples. */
const pinkFilter: Proc = {
  run(buf: Float32Array, circular: boolean): void {
    const n = buf.length;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let pass = circular ? 0 : 1; pass < 2; pass++) {
      for (let i = pass === 0 ? warmupStart(n, 20000) : 0; i < n; i++) {
        const w = buf[i];
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        if (pass === 1) buf[i] = out * 0.11;
      }
    }
  },
};

/** Leaky integrator (white in, brown out). Pole: ~50 samples. */
const brownFilter: Proc = {
  run(buf: Float32Array, circular: boolean): void {
    const n = buf.length;
    let z = 0;
    for (let pass = circular ? 0 : 1; pass < 2; pass++) {
      for (let i = pass === 0 ? warmupStart(n, 2000) : 0; i < n; i++) {
        z = (z + 0.02 * buf[i]) / 1.02;
        if (pass === 1) buf[i] = z * 3.5;
      }
    }
  },
};

type NoiseColor = 'white' | 'pink' | 'brown';

function noise(n: number, rng: Rng, color: NoiseColor = 'white', circular = false): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.bi();
  if (color === 'pink') pinkFilter.run(out, circular);
  else if (color === 'brown') brownFilter.run(out, circular);
  return out;
}

interface ReverbOpts {
  /** Decay time to -60 dB (seconds). */
  readonly rt60: number;
  readonly wet: number;
  readonly dry?: number;
  /** Scales the comb delay lengths (room size). */
  readonly size?: number;
  /** High-frequency damping inside the feedback loops, 0..0.95. */
  readonly damp?: number;
  readonly predelay?: number;
}

/** Freeverb tunings (samples at 44.1 kHz). */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491] as const;
const ALLPASS_TUNING = [556, 441, 341, 225] as const;

/**
 * Cheap mono Schroeder reverb: six parallel damped combs into four series allpasses (Freeverb
 * topology). The combs run fused in one unrolled loop: each comb's damping filter is a serial
 * dependency chain, so interleaving six independent chains lets the CPU overlap them. For loops,
 * the combs are first warmed up on the buffer's tail for 1.5 x RT60 (residual < -90 dB) by
 * starting the loop counter at a negative index that wraps to the tail.
 */
function reverb(buf: Float32Array, sr: number, o: ReverbOpts, circular = false): Float32Array {
  const n = buf.length;
  const scale = sr / 44100;
  const size = o.size ?? 1;
  const rt60 = Math.max(o.rt60, 0.05);
  const damp = clamp(o.damp ?? 0.35, 0, 0.95);
  const undamp = 1 - damp;

  // pre-delay (wraps around for loops)
  const pre = Math.round((o.predelay ?? 0) * sr);
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - pre;
    input[i] = j >= 0 ? buf[j] : circular ? buf[((j % n) + n) % n] : 0;
  }

  const combLen = (k: number): number => Math.max(8, Math.round(COMB_TUNING[k] * scale * size));
  const combFb = (len: number): number => Math.pow(10, (-3 * len) / (sr * rt60));
  const l0 = combLen(0);
  const l1 = combLen(1);
  const l2 = combLen(2);
  const l3 = combLen(3);
  const l4 = combLen(4);
  const l5 = combLen(5);
  const f0 = combFb(l0);
  const f1 = combFb(l1);
  const f2 = combFb(l2);
  const f3 = combFb(l3);
  const f4 = combFb(l4);
  const f5 = combFb(l5);
  const c0 = new Float32Array(l0);
  const c1 = new Float32Array(l1);
  const c2 = new Float32Array(l2);
  const c3 = new Float32Array(l3);
  const c4 = new Float32Array(l4);
  const c5 = new Float32Array(l5);
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let p4 = 0;
  let p5 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let s5 = 0;
  const wet = new Float32Array(n);
  const combStart = circular ? warmupStart(n, sr * rt60 * 1.5) - n : 0;
  for (let k = combStart; k < n; k++) {
    const i = k < 0 ? k + n : k;
    const x = input[i];
    const y0 = c0[p0];
    s0 = y0 * undamp + s0 * damp;
    c0[p0] = x + s0 * f0;
    if (++p0 === l0) p0 = 0;
    const y1 = c1[p1];
    s1 = y1 * undamp + s1 * damp;
    c1[p1] = x + s1 * f1;
    if (++p1 === l1) p1 = 0;
    const y2 = c2[p2];
    s2 = y2 * undamp + s2 * damp;
    c2[p2] = x + s2 * f2;
    if (++p2 === l2) p2 = 0;
    const y3 = c3[p3];
    s3 = y3 * undamp + s3 * damp;
    c3[p3] = x + s3 * f3;
    if (++p3 === l3) p3 = 0;
    const y4 = c4[p4];
    s4 = y4 * undamp + s4 * damp;
    c4[p4] = x + s4 * f4;
    if (++p4 === l4) p4 = 0;
    const y5 = c5[p5];
    s5 = y5 * undamp + s5 * damp;
    c5[p5] = x + s5 * f5;
    if (++p5 === l5) p5 = 0;
    if (k >= 0) wet[i] = y0 + y1 + y2 + y3 + y4 + y5;
  }

  // series allpasses, fused; warm-up over the (already final) comb output tail
  const apLen = (k: number): number => Math.max(4, Math.round(ALLPASS_TUNING[k] * scale));
  const m0 = apLen(0);
  const m1 = apLen(1);
  const m2 = apLen(2);
  const m3 = apLen(3);
  const a0 = new Float32Array(m0);
  const a1 = new Float32Array(m1);
  const a2 = new Float32Array(m2);
  const a3 = new Float32Array(m3);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  let q3 = 0;
  const apStart = circular ? warmupStart(n, sr * 0.25) - n : 0;
  for (let k = apStart; k < n; k++) {
    const i = k < 0 ? k + n : k;
    let v = wet[i];
    let b = a0[q0];
    a0[q0] = v + b * 0.5;
    v = b - v;
    if (++q0 === m0) q0 = 0;
    b = a1[q1];
    a1[q1] = v + b * 0.5;
    v = b - v;
    if (++q1 === m1) q1 = 0;
    b = a2[q2];
    a2[q2] = v + b * 0.5;
    v = b - v;
    if (++q2 === m2) q2 = 0;
    b = a3[q3];
    a3[q3] = v + b * 0.5;
    v = b - v;
    if (++q3 === m3) q3 = 0;
    if (k >= 0) wet[i] = v;
  }

  const wetGain = o.wet / COMB_TUNING.length;
  const dry = o.dry ?? 1;
  for (let i = 0; i < n; i++) buf[i] = buf[i] * dry + wet[i] * wetGain;
  return buf;
}

// =================================================================================================
// Buffer utilities: levels, envelopes, shaping, loops
// =================================================================================================

function mixInto(dst: Float32Array, src: Float32Array, offset = 0, gain = 1, wrap = false): Float32Array {
  const n = dst.length;
  for (let j = 0; j < src.length; j++) {
    let i = offset + j;
    if (i >= n) {
      if (!wrap) break;
      i %= n;
    }
    if (i >= 0) dst[i] += src[j] * gain;
  }
  return dst;
}

function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

function normalize(buf: Float32Array, peak: number): Float32Array {
  const p = peakOf(buf);
  if (p > 1e-12) {
    const g = peak / p;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

function setRms(buf: Float32Array, target: number): Float32Array {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / Math.max(1, buf.length));
  if (rms > 1e-12) {
    const g = target / rms;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

/** Multiplies the buffer by gain(sampleIndex). */
function shape(buf: Float32Array, gain: (i: number) => number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] *= gain(i);
  return buf;
}

/** tanh saturation; the buffer is pre-normalized so `drive` is level independent. */
function softClip(buf: Float32Array, drive: number): Float32Array {
  normalize(buf, 1);
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(drive * buf[i]) * k;
  return buf;
}

function fadeEdges(buf: Float32Array, sr: number, fadeIn: number, fadeOut: number): void {
  const n = buf.length;
  const a = Math.min(n, Math.round(fadeIn * sr));
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  const b = Math.min(n, Math.round(fadeOut * sr));
  for (let i = 0; i < b; i++) buf[n - 1 - i] *= i / b;
}

/**
 * Seamless-loop helper: `buf` holds loopLength + fadeLength samples of continuous material; the
 * overhanging tail is equal-power crossfaded into the head so the end flows into the start.
 */
function crossfadeLoop(buf: Float32Array, loopLength: number, fadeLength: number): Float32Array {
  const fade = Math.max(0, Math.min(fadeLength, buf.length - loopLength, loopLength));
  const out = buf.slice(0, loopLength);
  for (let i = 0; i < fade; i++) {
    const x = ((i + 0.5) / fade) * (Math.PI / 2);
    out[i] = buf[i] * Math.sin(x) + buf[loopLength + i] * Math.cos(x);
  }
  return out;
}

/** Smooth random curve in [-1, 1] (smoothstep-interpolated knots). `periodic` makes it loop. */
function smoothRandom(n: number, sr: number, rate: number, rng: Rng, periodic: boolean): Float32Array {
  const out = new Float32Array(n);
  const segments = Math.max(1, Math.round((n / sr) * rate));
  const knots = new Float64Array(segments + 1);
  for (let k = 0; k <= segments; k++) knots[k] = rng.bi();
  if (periodic) knots[segments] = knots[0];
  const span = n / segments;
  for (let i = 0; i < n; i++) {
    const x = i / span;
    const k = Math.min(x | 0, segments - 1);
    const f = x - k;
    out[i] = knots[k] + (knots[k + 1] - knots[k]) * (f * f * (3 - 2 * f));
  }
  return out;
}

interface FinishOpts {
  readonly peak: number;
  readonly loop?: boolean;
  /** DC / rumble high-pass cutoff (Hz). */
  readonly hp?: number;
  /** Soft-clip drive. */
  readonly clip?: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
}

/** Final mastering: DC removal, optional saturation, edge fades (one-shots), peak normalization. */
function finish(buf: Float32Array, sr: number, o: FinishOpts): Float32Array {
  const loop = o.loop ?? false;
  filter(buf, sr, [['highpass', o.hp ?? 20, 0.7]], loop);
  if (o.clip !== undefined) softClip(buf, o.clip);
  if (!loop) fadeEdges(buf, sr, o.fadeIn ?? 0.001, o.fadeOut ?? 0.02);
  normalize(buf, o.peak);
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    buf[i] = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
  }
  return buf;
}

// =================================================================================================
// Event generators (one-shot partials, notes, bursts) - all support wrap-around for loops
// =================================================================================================

/** [frequency, amplitude, decay time constant (s)] */
type Mode = readonly [freq: number, amp: number, tau: number];

/**
 * Exponentially damped sinusoid (one resonant mode), rendered with a rotation oscillator.
 * Rendering stops after `cut` time constants (7 = -60 dB) with a short fade.
 */
function addMode(
  out: Float32Array,
  sr: number,
  t0: number,
  f: number,
  amp: number,
  tau: number,
  attack = 0,
  wrap = false,
  cut = 7,
): void {
  if (f <= 0 || f >= sr * 0.48 || amp === 0 || tau <= 0) return;
  const n = out.length;
  const start = startIndex(n, sr, t0, wrap);
  let len = Math.ceil(tau * cut * sr);
  len = wrap ? Math.min(len, n) : Math.min(len, n - start);
  const w = (TAU * f) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const k = Math.exp(-1 / (tau * sr));
  const aN = attack * sr;
  const tailN = Math.min(64, len);
  let s = 0;
  let c = 1;
  let e = amp;
  for (let j = 0; j < len; j++) {
    let idx = start + j;
    if (idx >= n) idx -= n;
    let g = j < aN ? (e * j) / aN : e;
    if (j > len - tailN) g *= (len - j) / tailN;
    if (idx >= 0) out[idx] += g * s;
    const s2 = s * cw + c * sw;
    c = c * cw - s * sw;
    s = s2;
    e *= k;
  }
}

interface ModeOpts {
  readonly attack?: number;
  readonly pitch?: number;
  readonly wrap?: boolean;
}

function addModes(out: Float32Array, sr: number, t: number, modes: readonly Mode[], gain = 1, o: ModeOpts = {}): void {
  const pitch = o.pitch ?? 1;
  for (const [f, a, tau] of modes) addMode(out, sr, t, f * pitch, a * gain, tau, o.attack ?? 0, o.wrap ?? false);
}

interface BurstOpts {
  readonly t: number;
  readonly amp: number;
  /** Exponential decay time constant (s). */
  readonly decay: number;
  readonly attack?: number;
  readonly hold?: number;
  readonly color?: NoiseColor;
  readonly filters?: readonly FilterSpec[];
  readonly wrap?: boolean;
}

/** Enveloped (attack / hold / exponential decay), optionally filtered noise burst. */
function addBurst(out: Float32Array, sr: number, rng: Rng, o: BurstOpts): void {
  const attack = o.attack ?? 0.0003;
  const hold = o.hold ?? 0;
  const len = samplesFor(sr, attack + hold + o.decay * 7 + 0.003);
  const src = noise(len, rng, o.color ?? 'white');
  const aN = attack * sr;
  const hN = (attack + hold) * sr;
  const k = Math.exp(-1 / (o.decay * sr));
  let e = 1;
  for (let j = 0; j < len; j++) {
    let g: number;
    if (j < aN) g = j / aN;
    else if (j < hN) g = 1;
    else {
      g = e;
      e *= k;
    }
    src[j] *= g;
  }
  if (o.filters) filter(src, sr, o.filters);
  const tailN = Math.min(48, len);
  for (let j = 0; j < tailN; j++) src[len - 1 - j] *= j / tailN;
  const wrap = o.wrap ?? false;
  mixInto(out, src, startIndex(out.length, sr, o.t, wrap), o.amp, wrap);
}

interface NoteOpts {
  readonly t: number;
  /** Time until release starts (s). */
  readonly dur: number;
  readonly f: number;
  readonly amp: number;
  /** Glide target frequency (exponential glide over `glide`, default `dur`). */
  readonly f1?: number;
  readonly glide?: number;
  readonly wave?: Wave;
  readonly table?: Float32Array;
  readonly attack?: number;
  readonly release?: number;
  /** Optional exponential decay time constant applied over the whole note. */
  readonly decay?: number;
  readonly vibRate?: number;
  /** Fractional vibrato depth (0.01 = 1 %). */
  readonly vibDepth?: number;
  readonly phase?: number;
  readonly wrap?: boolean;
}

/** Sustained oscillator note with linear attack / release. */
function addNote(out: Float32Array, sr: number, o: NoteOpts): void {
  const n = out.length;
  const wrap = o.wrap ?? false;
  const attack = Math.max(o.attack ?? 0.004, 1 / sr);
  const release = Math.max(o.release ?? 0.02, 1 / sr);
  const len = samplesFor(sr, o.dur + release);
  const start = startIndex(n, sr, o.t, wrap);
  const wave = o.wave ?? 'sine';
  // sine / custom tables take an inlined table-read path; saw / square / tri use the BLEP oscillator
  const table = o.table ?? (wave === 'sine' ? SINE_TABLE : undefined);
  const osc = new Osc(wave, o.phase ?? 0);
  let phase = frac(o.phase ?? 0);
  const glide = o.glide ?? o.dur;
  const ratio = o.f1 === undefined ? 1 : o.f1 / o.f;
  const decayK = o.decay === undefined ? 1 : Math.exp(-1 / (o.decay * sr));
  const vibDepth = o.vibDepth ?? 0;
  const vibRate = o.vibRate ?? 5;
  // pitch (glide + vibrato) is evaluated every 16 samples; amplitude every sample
  const stepAt = (t: number): number => {
    let f = ratio === 1 ? o.f : o.f * Math.pow(ratio, Math.min(t / glide, 1));
    if (vibDepth !== 0) f *= 1 + vibDepth * readTable(SINE_TABLE, vibRate * t);
    return f / sr;
  };
  let dt = stepAt(0);
  let decayEnv = 1;
  // envelope in samples, with reciprocals (no per-sample division)
  const aN = attack * sr;
  const invA = 1 / aN;
  const durN = o.dur * sr;
  const invR = 1 / (release * sr);
  const amp = o.amp;
  for (let j = 0; j < len; j++) {
    let idx = start + j;
    if (idx >= n) {
      if (!wrap) break;
      idx %= n;
    }
    if ((j & 15) === 0 && j > 0) dt = stepAt(j / sr);
    let env = j < aN ? j * invA : 1;
    if (j > durN) {
      const r = 1 - (j - durN) * invR;
      env *= r > 0 ? r : 0;
    }
    env *= decayEnv;
    decayEnv *= decayK;
    let y: number;
    if (table) {
      const x = phase * TABLE_SIZE;
      const k = x | 0;
      const a = table[k];
      y = a + (table[k + 1] - a) * (x - k);
      phase += dt;
      if (phase >= 1) phase -= 1;
    } else {
      y = osc.next(dt);
    }
    if (idx >= 0) out[idx] += amp * env * y;
  }
}

/** Sine whose pitch slides exponentially from f0 towards f1 (bubbles, drips). */
function addChirp(out: Float32Array, sr: number, t0: number, f0: number, f1: number, glideTau: number, decayTau: number, amp: number): void {
  const n = out.length;
  const start = Math.round(t0 * sr);
  const len = Math.min(samplesFor(sr, decayTau * 7), n - start);
  const k = Math.exp(-1 / (decayTau * sr));
  const aN = 0.0015 * sr;
  let phase = 0;
  let e = amp;
  for (let j = 0; j < len; j++) {
    const t = j / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / glideTau);
    phase += f / sr;
    const g = j < aN ? (e * j) / aN : e;
    out[start + j] += g * Math.sin(TAU * phase);
    e *= k;
  }
}

interface LoopVoice {
  readonly f: number;
  readonly amp: number;
  readonly phase?: number;
  readonly table?: Float32Array;
  readonly vibRate?: number;
  /** Vibrato deviation in Hz. */
  readonly vibDepth?: number;
  readonly amRate?: number;
  readonly amDepth?: number;
  /** AM phase in cycles (0.25 = peak at t = 0). */
  readonly amPhase?: number;
}

const LOOP_BLOCK = 32;

/**
 * Adds a continuous voice that is exactly periodic over the buffer: carrier, vibrato and AM rates
 * are snapped to whole cycles per loop. Phase and gain are computed analytically at 32-sample
 * block edges (so there is no drift and the last block lands exactly on the first) and linearly
 * interpolated inside each block; vibrato and AM are slow enough for that to be inaudible.
 */
function addLoopVoice(out: Float32Array, sr: number, v: LoopVoice): void {
  const n = out.length;
  const f = snapToLoop(v.f, n, sr);
  const table = v.table ?? SINE_TABLE;
  const vibRate = v.vibRate ? snapToLoop(v.vibRate, n, sr) : 0;
  const vibK = vibRate > 0 ? (v.vibDepth ?? 0) / (TAU * vibRate) : 0;
  const amRate = v.amRate ? snapToLoop(v.amRate, n, sr) : 0;
  const amDepth = amRate > 0 ? (v.amDepth ?? 0) : 0;
  const amPhase = v.amPhase ?? 0;
  const ph0 = Math.abs(v.phase ?? 0);
  const amp = v.amp;
  // vibrato term is >= 0 and ph0 >= 0, so the phase is never negative (keeps table reads in range)
  const phaseAt = (t: number): number =>
    f * t + ph0 + (vibK !== 0 ? vibK * (1 - readTable(SINE_TABLE, vibRate * t + 0.25)) : 0);
  const gainAt = (t: number): number => amp * (amDepth !== 0 ? 1 + amDepth * readTable(SINE_TABLE, amRate * t + amPhase) : 1);
  let p0 = phaseAt(0);
  let g0 = gainAt(0);
  for (let b = 0; b < n; b += LOOP_BLOCK) {
    const e = Math.min(n, b + LOOP_BLOCK);
    const t1 = e / sr;
    const p1 = phaseAt(t1);
    const g1 = gainAt(t1);
    const len = e - b;
    const dp = (p1 - p0) / len; // < 1 cycle per sample for any audible voice
    const dg = (g1 - g0) / len;
    let p = frac(p0);
    let g = g0;
    for (let i = b; i < e; i++) {
      const x = p * TABLE_SIZE;
      const k = x | 0;
      const a = table[k];
      out[i] += g * (a + (table[k + 1] - a) * (x - k));
      p += dp;
      if (p >= 1) p -= 1;
      g += dg;
    }
    p0 = p1;
    g0 = g1;
  }
}

// =================================================================================================
// Foley building blocks
// =================================================================================================

function addThump(
  out: Float32Array,
  sr: number,
  rng: Rng,
  t: number,
  amp: number,
  f0: number,
  f1: number,
  tau: number,
  noiseAmt = 0.4,
  noiseLp = 300,
  wrap = false,
): void {
  addNote(out, sr, { t, dur: tau * 6, f: f0, f1, glide: tau * 2, amp, attack: 0.0015, release: 0.01, decay: tau, wrap });
  if (noiseAmt > 0) {
    addBurst(out, sr, rng, { t, amp: amp * noiseAmt, attack: 0.0008, decay: tau * 0.35, filters: [['lowpass', noiseLp, 0.8]], wrap });
  }
}

/** Sharp mechanical click: high-passed noise spike plus a few ringing modes. */
function addClick(
  out: Float32Array,
  sr: number,
  rng: Rng,
  t: number,
  amp: number,
  modes: readonly Mode[],
  hp = 1500,
  decay = 0.001,
  wrap = false,
): void {
  addBurst(out, sr, rng, { t, amp, attack: 0.0002, decay, filters: [['highpass', hp, 0.7]], wrap });
  addModes(out, sr, t, modes, amp, { wrap });
}

function addLatch(out: Float32Array, sr: number, rng: Rng, t: number, amp: number): void {
  const v = rng.vary(1, 0.04);
  addClick(out, sr, rng, t, amp, [[1250 * v, 0.2, 0.015], [2350 * v, 0.35, 0.012], [3900 * v, 0.25, 0.009], [5600 * v, 0.15, 0.006]], 1800, 0.0015);
  addBurst(out, sr, rng, { t, amp: amp * 0.3, decay: 0.006, filters: [['lowpass', 700, 0.7]] });
}

function addRelay(out: Float32Array, sr: number, rng: Rng, t: number, amp: number, wrap = false): void {
  addClick(out, sr, rng, t, amp, [[1300, 0.4, 0.006], [2900, 1, 0.004], [4700, 0.6, 0.003]], 1500, 0.0008, wrap);
}

function addHardStep(out: Float32Array, sr: number, rng: Rng, t: number, amp: number): void {
  const v = rng.vary(1, 0.05);
  addBurst(out, sr, rng, { t, amp: amp * 0.9, attack: 0.0003, decay: 0.0035, filters: [['highpass', 800, 0.7], ['peak', 2600 * v, 2.5, 8]] });
  addModes(out, sr, t, [[1450 * v, 0.18, 0.008], [2650 * v, 0.22, 0.006], [4100 * v, 0.1, 0.004]], amp);
  addThump(out, sr, rng, t, amp * 0.55, 125 * v, 80, 0.022, 0.6, 600);
  const toe = t + rng.range(0.05, 0.07);
  addBurst(out, sr, rng, { t: toe, amp: amp * 0.35, attack: 0.0003, decay: 0.003, filters: [['highpass', 1200, 0.7], ['peak', 3000 * v, 2, 6]] });
  addThump(out, sr, rng, toe, amp * 0.2, 140 * v, 95, 0.015, 0.5, 700);
}

function addWoodKnock(out: Float32Array, sr: number, rng: Rng, t: number, amp: number): void {
  const v = rng.vary(1, 0.04);
  const modes: Mode[] = [
    [118 * v, 0.9, 0.07],
    [196 * v, 0.7, 0.05],
    [315 * v, 0.5, 0.035],
    [520 * v, 0.35, 0.022],
    [870 * v, 0.2, 0.012],
    [1450 * v, 0.12, 0.006],
  ];
  addModes(out, sr, t, modes, amp);
  addBurst(out, sr, rng, { t, amp: amp * 0.6, attack: 0.0003, decay: 0.004, filters: [['lowpass', 2500, 0.7]] });
  addThump(out, sr, rng, t, amp * 0.5, 95, 70, 0.04, 0.2, 300);
}

interface CreakOpts {
  readonly t: number;
  readonly dur: number;
  readonly amp: number;
  /** Stick-slip rate at start, middle, end (Hz). */
  readonly rates: readonly [number, number, number];
  /** Body resonances: [frequency, Q]. */
  readonly body: readonly (readonly [number, number])[];
}

/** Stick-slip friction: an irregular impulse train exciting wooden body resonances. */
function addCreak(out: Float32Array, sr: number, rng: Rng, o: CreakOpts): void {
  const active = samplesFor(sr, o.dur);
  const len = active + samplesFor(sr, 0.04);
  const exc = new Float32Array(len);
  const [r0, r1, r2] = o.rates;
  let phase = 0;
  for (let i = 0; i < active; i++) {
    const x = i / active;
    const rate = x < 0.5 ? lerp(r0, r1, x * 2) : lerp(r1, r2, (x - 0.5) * 2);
    phase += (rate * (1 + 0.25 * rng.bi())) / sr;
    let e = 0.03 * rng.bi();
    if (phase >= 1) {
      phase -= 1;
      e += rng.range(0.5, 1);
    }
    exc[i] = e * smoothstep(x / 0.1) * smoothstep((1 - x) / 0.3);
  }
  const body = new Float32Array(len);
  for (const [f, q] of o.body) mixInto(body, filter(exc.slice(), sr, [['bandpass', f * rng.vary(1, 0.03), q]]));
  mixInto(out, normalize(body, 1), Math.round(o.t * sr), o.amp);
}

/** Paper crinkle: scattered micro-bursts of band-passed noise under a hump envelope. */
function addCrinkle(out: Float32Array, sr: number, rng: Rng, t0: number, dur: number, amp: number, rate: number): void {
  const count = Math.max(1, Math.round(dur * rate));
  for (let k = 0; k < count; k++) {
    const x = rng.next();
    addBurst(out, sr, rng, {
      t: t0 + x * dur,
      amp: amp * Math.sin(Math.PI * x) * rng.range(0.3, 1),
      attack: 0.0002,
      decay: rng.range(0.0006, 0.003),
      filters: [['bandpass', rng.range(2000, 6000), rng.range(0.8, 2)]],
    });
  }
}

/** Noise swish with a swept band-pass and a hump envelope (page turns, slides, brushes). */
function addSwish(out: Float32Array, sr: number, rng: Rng, t: number, dur: number, amp: number, fLo: number, fHi: number, q = 0.9): void {
  const len = samplesFor(sr, dur);
  const s = noise(len, rng, 'pink');
  sweep(s, sr, 'bandpass', q, (i) => fLo + (fHi - fLo) * Math.sin((Math.PI * i) / len));
  shape(s, (i) => {
    const h = Math.sin((Math.PI * i) / len);
    return h * Math.sqrt(h);
  });
  mixInto(out, normalize(s, 1), Math.round(t * sr), amp);
}

/** Struck-string tone with slight inharmonicity and a detuned second string. */
function addPiano(out: Float32Array, sr: number, t: number, f: number, amp: number, wrap = false): void {
  const B = 0.00035;
  const amps = [1, 0.42, 0.2, 0.1];
  for (let k = 1; k <= amps.length; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    // quieter partials can be cut earlier: they sink under the pad and reverb sooner
    addMode(out, sr, t, fk, amp * amps[k - 1], 1.7 / Math.pow(k, 0.85), 0.007, wrap, k === 1 ? 5.5 : 4.5);
  }
  addMode(out, sr, t, f * 1.0016, amp * 0.3, 1.4, 0.007, wrap, 4.5);
}

/** Tuned chime bar (elevator / PA): fundamental, beating twin, bar overtones and a mallet tick. */
function addChime(out: Float32Array, sr: number, rng: Rng, t: number, f: number, amp: number, tau = 0.65): void {
  addModes(
    out,
    sr,
    t,
    [[f, 1, tau], [f * 1.0021, 0.45, tau * 0.85], [f * 2, 0.05, tau * 0.35], [f * 3.98, 0.2, tau * 0.22], [f * 9.9, 0.035, 0.05]],
    amp,
    { attack: 0.0008 },
  );
  addBurst(out, sr, rng, { t, amp: amp * 0.08, decay: 0.0015, filters: [['bandpass', Math.min(f * 4, sr * 0.4), 1.5]] });
}

/** Magnetic-ballast buzz: 120 Hz harmonic series with a fixture resonance around 2.4 kHz. */
function fluorescentTable(sr: number, rng: Rng): Float32Array {
  const harmonics: Harmonic[] = [];
  for (let k = 1; k <= 48; k++) {
    const f = k * 120;
    const resonance = 1 + 1.6 * Math.exp(-((f - 2400) ** 2) / (2 * 800 ** 2));
    const odd = k % 2 === 1 ? 1 : 0.7;
    harmonics.push([k, (odd * resonance * rng.range(0.6, 1)) / Math.pow(k, 0.85), rng.next()]);
  }
  return makeTable(harmonics, 120, sr);
}

/** Harmonic-rich motor table (1/k^tilt rolloff, seeded phases). */
function motorTable(sr: number, rng: Rng, f0: number, count: number, tilt: number): Float32Array {
  const harmonics: Harmonic[] = [];
  for (let k = 1; k <= count; k++) harmonics.push([k, rng.range(0.6, 1) / Math.pow(k, tilt), rng.next()]);
  return makeTable(harmonics, f0, sr);
}

// =================================================================================================
// Recipes - ambience loops
// =================================================================================================

function ambHum(sr: number): Float32Array {
  const rng = new Rng(0x1001);
  const out = buffer(sr, 8);
  // static mains harmonics share one 60 Hz voice; the moving / beating partials get their own
  const mains = makeTable(
    [[1, 0.3], [3, 0.38, 0.2], [5, 0.1, 0.8], [6, 0.13, 0.4], [8, 0.05, 0.65], [10, 0.03, 0.15], [12, 0.025, 0.9]],
    60,
    sr,
    false,
  );
  const voices: readonly LoopVoice[] = [
    { f: 60, amp: 1, table: mains },
    { f: 120, amp: 1, amRate: 0.25, amDepth: 0.06 },
    { f: 120.25, amp: 0.25, phase: 0.3 },
    { f: 240, amp: 0.3, phase: 0.55, amRate: 0.125, amDepth: 0.2 },
    { f: 239.75, amp: 0.08, phase: 0.1 },
  ];
  for (const v of voices) addLoopVoice(out, sr, v);
  softClip(out, 1.8);
  filter(out, sr, [['lowpass', 1600, 0.7]], true);
  setRms(out, 0.3);
  const bed = filter(noise(out.length, rng, 'pink', true), sr, [['lowpass', 500, 0.7]], true);
  mixInto(out, setRms(bed, 0.012));
  return finish(out, sr, { peak: 0.6, loop: true, hp: 40 });
}

function ambFluorescent(sr: number): Float32Array {
  const rng = new Rng(0x1002);
  const L = 6;
  const out = buffer(sr, L);
  const n = out.length;
  addLoopVoice(out, sr, { f: 120, amp: 1, table: fluorescentTable(sr, rng), amRate: 0.5, amDepth: 0.05 });
  addLoopVoice(out, sr, { f: 60, amp: 0.2 });
  const flutter = smoothRandom(n, sr, 3, rng, true);
  shape(out, (i) => 1 + 0.06 * flutter[i]);
  setRms(out, 0.25);
  // discharge sizzle: noise gated by the mains peaks (120 pulses / s)
  const f60 = snapToLoop(60, n, sr);
  const sizzle = noise(n, rng, 'white');
  shape(sizzle, (i) => sinePulse(f60, i / sr, 3));
  filter(sizzle, sr, [['highpass', 3000, 0.7]], true);
  mixInto(out, setRms(sizzle, 0.012));
  // occasional tiny crackles (wrapped so they may straddle the seam)
  for (let c = 0; c < 4; c++) {
    let t = rng.range(0, L);
    const count = 2 + Math.floor(rng.next() * 4);
    for (let k = 0; k < count; k++) {
      addBurst(out, sr, rng, { t, amp: rng.range(0.04, 0.12), decay: rng.range(0.0004, 0.0015), filters: [['highpass', 2500, 0.7]], wrap: true });
      t += rng.range(0.003, 0.02);
    }
  }
  return finish(out, sr, { peak: 0.55, loop: true, hp: 60 });
}

function ambVent(sr: number): Float32Array {
  const rng = new Rng(0x1003);
  const L = 8;
  const F = 1.5;
  // Non-periodic gusting: rendered long, then folded with crossfadeLoop().
  const total = buffer(sr, L + F);
  const m = total.length;
  const gust = smoothRandom(m, sr, 0.5, rng, false);
  const air = noise(m, rng, 'pink');
  sweep(air, sr, 'bandpass', 0.55, (i) => 620 * (1 + 0.3 * gust[i]));
  shape(air, (i) => 0.8 + 0.2 * gust[i]);
  filter(air, sr, [['lowpass', 2400, 0.7]]);
  mixInto(total, setRms(air, 0.2));
  const rumble = filter(noise(m, rng, 'brown'), sr, [['lowpass', 140, 0.7]]);
  mixInto(total, setRms(rumble, 0.12));
  const duct = filter(noise(m, rng, 'white'), sr, [['bandpass', 340, 14]]);
  mixInto(total, setRms(duct, 0.025));
  const out = crossfadeLoop(total, samplesFor(sr, L), samplesFor(sr, F));
  return finish(out, sr, { peak: 0.6, loop: true, hp: 30 });
}

function ambOffice(sr: number): Float32Array {
  const rng = new Rng(0x1004);
  const out = buffer(sr, 8);
  const n = out.length;
  const hvac = filter(noise(n, rng, 'brown', true), sr, [['lowpass', 220, 0.7]], true);
  mixInto(out, setRms(hvac, 0.2));
  const air = filter(noise(n, rng, 'pink', true), sr, [['lowpass', 1100, 0.7], ['highpass', 150, 0.7]], true);
  const breathe = smoothRandom(n, sr, 0.4, rng, true);
  shape(air, (i) => 0.75 + 0.25 * breathe[i]);
  mixInto(out, setRms(air, 0.07));
  const hum = new Float32Array(n);
  addLoopVoice(hum, sr, { f: 120, amp: 1, amRate: 0.125, amDepth: 0.3 });
  addLoopVoice(hum, sr, { f: 240, amp: 0.4, phase: 0.3 });
  mixInto(out, setRms(hum, 0.008));
  return finish(out, sr, { peak: 0.45, loop: true, hp: 25 });
}

function ambRoomTone(sr: number): Float32Array {
  const rng = new Rng(0x1005);
  const out = buffer(sr, 8);
  const n = out.length;
  const rumble = filter(noise(n, rng, 'brown', true), sr, [['lowpass', 110, 0.7]], true);
  mixInto(out, setRms(rumble, 0.25));
  const tone = new Float32Array(n);
  addLoopVoice(tone, sr, { f: 41, amp: 1, amRate: 0.125, amDepth: 0.3 });
  addLoopVoice(tone, sr, { f: 41.25, amp: 0.5, phase: 0.4 });
  addLoopVoice(tone, sr, { f: 82, amp: 0.3, amRate: 0.25, amDepth: 0.4, amPhase: 0.5 });
  addLoopVoice(tone, sr, { f: 123, amp: 0.12, phase: 0.7 });
  mixInto(out, setRms(tone, 0.12));
  const air = filter(noise(n, rng, 'pink', true), sr, [['lowpass', 600, 0.7]], true);
  mixInto(out, setRms(air, 0.02));
  const f = snapToLoop(0.125, n, sr);
  shape(out, (i) => 1 + 0.15 * Math.sin((TAU * f * i) / sr));
  return finish(out, sr, { peak: 0.6, loop: true, hp: 20 });
}

function ambFridge(sr: number): Float32Array {
  const rng = new Rng(0x1006);
  const out = buffer(sr, 6);
  const n = out.length;
  const table = makeTable(
    [[1, 1], [2, 0.7, 0.25], [3, 0.35, 0.1], [4, 0.2, 0.6], [5, 0.1, 0.3], [6, 0.08, 0.8], [8, 0.04, 0.5], [10, 0.03, 0.2]],
    58,
    sr,
  );
  addLoopVoice(out, sr, { f: 58, amp: 1, table, vibRate: 0.5, vibDepth: 0.35, amRate: 1.5, amDepth: 0.12 });
  addLoopVoice(out, sr, { f: 116.5, amp: 0.35, amRate: 0.333, amDepth: 0.2 });
  setRms(out, 0.3);
  // cabinet rattle synchronous with the motor
  const f58 = snapToLoop(58, n, sr);
  const rattle = noise(n, rng, 'white');
  shape(rattle, (i) => sinePulse(f58 / 2, i / sr, 3));
  filter(rattle, sr, [['bandpass', 1100, 2]], true);
  mixInto(out, setRms(rattle, 0.02));
  const hiss = filter(noise(n, rng, 'pink', true), sr, [['bandpass', 3000, 0.7]], true);
  mixInto(out, setRms(hiss, 0.008));
  filter(out, sr, [['lowpass', 2500, 0.7]], true);
  return finish(out, sr, { peak: 0.6, loop: true, hp: 30 });
}

function ambElectronics(sr: number): Float32Array {
  const rng = new Rng(0x1007);
  const out = buffer(sr, 8);
  const n = out.length;
  const fan = filter(noise(n, rng, 'pink', true), sr, [['bandpass', 1500, 0.45], ['lowpass', 5000, 0.7]], true);
  const drift = smoothRandom(n, sr, 0.5, rng, true);
  shape(fan, (i) => 1 + 0.08 * drift[i]);
  mixInto(out, setRms(fan, 0.12));
  // fan blade-pass tone (with harmonics) drifting against a second, slightly faster fan
  const blades = new Float32Array(n);
  const bladeTable = makeTable([[1, 1], [2, 0.4], [3, 0.15, 0.6]], 187, sr, false);
  addLoopVoice(blades, sr, { f: 187, amp: 1, table: bladeTable, vibRate: 0.25, vibDepth: 0.8 });
  addLoopVoice(blades, sr, { f: 193.5, amp: 0.6, vibRate: 0.375, vibDepth: 0.6, phase: 0.3 });
  mixInto(out, setRms(blades, 0.035));
  const whine = new Float32Array(n);
  addLoopVoice(whine, sr, { f: Math.min(9620, sr * 0.42), amp: 1, amRate: 0.25, amDepth: 0.4 });
  mixInto(out, setRms(whine, 0.004));
  const hum = new Float32Array(n);
  addLoopVoice(hum, sr, { f: 60, amp: 1, table: makeTable([[1, 0.5], [2, 1], [3, 0.3]], 60, sr) });
  mixInto(out, setRms(hum, 0.02));
  addRelay(out, sr, rng, 1.73, 0.12, true);
  addRelay(out, sr, rng, 5.21, 0.1, true);
  addRelay(out, sr, rng, 5.27, 0.07, true);
  return finish(out, sr, { peak: 0.5, loop: true, hp: 40 });
}

function attentionDrone(sr: number): Float32Array {
  const rng = new Rng(0x1008);
  const L = 12;
  const out = buffer(sr, L);
  const n = out.length;
  const table = makeTable([[1, 1], [2, 0.45, 0.3], [3, 0.25, 0.1], [4, 0.12, 0.7], [5, 0.08, 0.4], [7, 0.04, 0.2]], 240, sr);
  const voices: readonly LoopVoice[] = [
    { f: 36.7, amp: 0.4 },
    { f: 55, amp: 1, table, vibRate: 1 / L, vibDepth: 0.25, amRate: 0.25, amDepth: 0.15 },
    { f: 58.27, amp: 0.45, table, vibRate: 2 / L, vibDepth: 0.6, amRate: 1 / L, amDepth: 0.5, amPhase: 0.5 },
    { f: 77.78, amp: 0.3, table, amRate: 1 / L, amDepth: 0.8, amPhase: 0.25 },
    { f: 82.4, amp: 0.5, vibRate: 1 / L, vibDepth: 0.4, amRate: 2 / L, amDepth: 0.3 },
    { f: 110.3, amp: 0.35, vibRate: 3 / L, vibDepth: 0.5 },
    { f: 164.9, amp: 0.12, vibRate: 2 / L, vibDepth: 1 },
    { f: 233.1, amp: 0.06, amRate: 2 / L, amDepth: 0.9, amPhase: 0.6 },
  ];
  for (const v of voices) addLoopVoice(out, sr, v);
  setRms(out, 0.25);
  const air = filter(noise(n, rng, 'pink', true), sr, [['bandpass', 420, 1.2]], true);
  const swell = smoothRandom(n, sr, 0.3, rng, true);
  shape(air, (i) => 0.5 + 0.5 * swell[i]);
  mixInto(out, setRms(air, 0.04));
  filter(out, sr, [['lowpass', 1800, 0.7]], true);
  return finish(out, sr, { peak: 0.7, loop: true, hp: 25, clip: 1.3 });
}

function elevatorMotor(sr: number): Float32Array {
  const rng = new Rng(0x1009);
  const out = buffer(sr, 6);
  const n = out.length;
  addLoopVoice(out, sr, { f: 95, amp: 1, table: motorTable(sr, rng, 95, 12, 1.2), vibRate: 0.5, vibDepth: 0.6, amRate: 0.333, amDepth: 0.08 });
  setRms(out, 0.22);
  const whine = new Float32Array(n);
  addLoopVoice(whine, sr, { f: 1180, amp: 1, vibRate: 0.333, vibDepth: 3, amRate: 0.5, amDepth: 0.2 });
  addLoopVoice(whine, sr, { f: 2360, amp: 0.3, vibRate: 0.333, vibDepth: 6 });
  mixInto(out, setRms(whine, 0.035));
  const rumble = filter(noise(n, rng, 'brown', true), sr, [['lowpass', 160, 0.7]], true);
  mixInto(out, setRms(rumble, 0.2));
  const rattle = filter(noise(n, rng, 'white'), sr, [['bandpass', 750, 1.5]], true);
  const bumps = smoothRandom(n, sr, 9, rng, true);
  shape(rattle, (i) => {
    const b = Math.max(0, bumps[i]);
    return b * b;
  });
  mixInto(out, setRms(rattle, 0.03));
  filter(out, sr, [['lowpass', 3000, 0.7]], true);
  return finish(out, sr, { peak: 0.7, loop: true, hp: 30 });
}

// =================================================================================================
// Recipes - music loops
// =================================================================================================

const PAD_HARMONICS: readonly Harmonic[] = [[1, 1], [2, 0.45, 0.1], [3, 0.25, 0.3], [4, 0.14, 0.55], [5, 0.08, 0.8], [6, 0.05, 0.2]];

function musicMenu(sr: number): Float32Array {
  const L = 20;
  const out = buffer(sr, L);
  const n = out.length;
  const table = makeTable(PAD_HARMONICS, 220, sr);
  const morph = 1 / L;
  // Dm (peaks at t = 0) slowly morphs into Bbmaj7 (peaks at L / 2) and back.
  const pad = new Float32Array(n);
  const voices: readonly LoopVoice[] = [
    { f: 73.42, amp: 0.5, amRate: morph, amDepth: 1, amPhase: 0.25 },
    { f: 110, amp: 0.35, amRate: morph, amDepth: 1, amPhase: 0.25 },
    { f: 58.27, amp: 0.5, amRate: morph, amDepth: 1, amPhase: 0.75 },
    { f: 87.31, amp: 0.35, amRate: morph, amDepth: 1, amPhase: 0.75 },
    { f: 146.83, amp: 0.3, amRate: 0.1, amDepth: 0.25 },
    { f: 146.93, amp: 0.2, phase: 0.4 },
    { f: 174.61, amp: 0.26, amRate: 0.15, amDepth: 0.3, amPhase: 0.5 },
    { f: 220, amp: 0.2, amRate: 0.05, amDepth: 0.5, amPhase: 0.1 },
    { f: 220.1, amp: 0.12, phase: 0.7 },
  ];
  for (const v of voices) addLoopVoice(pad, sr, { ...v, table, vibRate: 0.2, vibDepth: 0.08 });
  filter(pad, sr, [['lowpass', 750, 0.6]], true);
  mixInto(out, setRms(pad, 0.1));
  const keys = new Float32Array(n);
  const notes: readonly (readonly [number, number, number])[] = [
    [0.4, 293.66, 1],
    [3.1, 440, 0.65],
    [4.9, 349.23, 0.8],
    [8.6, 523.25, 0.5],
    [10.9, 220, 0.85],
    [13.8, 587.33, 0.45],
    [15.4, 440, 0.6],
    [17.9, 349.23, 0.7],
  ];
  for (const [t, f, a] of notes) addPiano(keys, sr, t, f, a, true);
  mixInto(out, normalize(keys, 0.5));
  reverb(out, sr, { rt60: 3.6, wet: 0.5, dry: 0.85, size: 1.3, damp: 0.45, predelay: 0.02 }, true);
  return finish(out, sr, { peak: 0.8, loop: true, hp: 30 });
}

function musicAmbient(sr: number): Float32Array {
  const rng = new Rng(0x2002);
  const L = 12;
  const out = buffer(sr, L);
  const n = out.length;
  const table = makeTable([[1, 1], [2, 0.3, 0.2], [3, 0.12, 0.5]], 160, sr);
  const pad = new Float32Array(n);
  const voices: readonly LoopVoice[] = [
    { f: 65.41, amp: 1, amRate: 1 / L, amDepth: 0.3 },
    { f: 98, amp: 0.6, amRate: 2 / L, amDepth: 0.4, amPhase: 0.3 },
    { f: 155.56, amp: 0.35, amRate: 1 / L, amDepth: 0.8, amPhase: 0.5 },
    { f: 146.83, amp: 0.2, amRate: 1 / L, amDepth: 1, amPhase: 0 },
  ];
  for (const v of voices) addLoopVoice(pad, sr, { ...v, table, vibRate: 0.125, vibDepth: 0.1 });
  filter(pad, sr, [['lowpass', 450, 0.6]], true);
  mixInto(out, setRms(pad, 0.15));
  const wind = filter(noise(n, rng, 'pink', true), sr, [['bandpass', 250, 0.8]], true);
  const gust = smoothRandom(n, sr, 0.25, rng, true);
  shape(wind, (i) => 0.6 + 0.4 * gust[i]);
  mixInto(out, setRms(wind, 0.03));
  reverb(out, sr, { rt60: 4, wet: 0.35, dry: 0.8, size: 1.4, damp: 0.5 }, true);
  return finish(out, sr, { peak: 0.6, loop: true, hp: 25 });
}

function musicTension(sr: number): Float32Array {
  const L = 12;
  const out = buffer(sr, L);
  const n = out.length;
  // Pulse every 2 s; continuous across the period boundary (no zipper).
  const T = 2;
  const atk = 0.3;
  const tau = 0.7;
  const endVal = Math.exp(-(T - atk) / tau);
  const pulse = (t: number): number => {
    const x = t % T;
    return x < atk ? lerp(endVal, 1, smoothstep(x / atk)) : Math.exp(-(x - atk) / tau);
  };
  const saw: Harmonic[] = [];
  for (let k = 1; k <= 10; k++) saw.push([k, 1 / k]);
  const table = makeTable(saw, 95, sr);
  const cluster = new Float32Array(n);
  addLoopVoice(cluster, sr, { f: 61.74, amp: 1, table, vibRate: 0.125, vibDepth: 0.15 });
  addLoopVoice(cluster, sr, { f: 65.41, amp: 0.8, table, vibRate: 0.1875, vibDepth: 0.2, phase: 0.3 });
  addLoopVoice(cluster, sr, { f: 87.31, amp: 0.6, table, phase: 0.6 });
  addLoopVoice(cluster, sr, { f: 92.5, amp: 0.35, table, amRate: 1 / L, amDepth: 0.8, phase: 0.1 });
  sweep(cluster, sr, 'lowpass', 1.2, (i) => 160 + 1300 * pulse(i / sr) ** 2, true);
  shape(cluster, (i) => 0.3 + 0.7 * pulse(i / sr));
  mixInto(out, setRms(cluster, 0.18));
  const throb = new Float32Array(n);
  for (let b = 0; b < L / T; b++) {
    addNote(throb, sr, { t: b * T + 0.02, dur: 0.5, f: 41.2, f1: 38, amp: 1, attack: 0.03, release: 0.2, decay: 0.35, wrap: true });
  }
  mixInto(out, normalize(throb, 0.35));
  const shimmer = new Float32Array(n);
  addLoopVoice(shimmer, sr, { f: 1975.5, amp: 1, amRate: 1 / L, amDepth: 1, amPhase: 0.75, vibRate: 5.5, vibDepth: 4 });
  addLoopVoice(shimmer, sr, { f: 2093, amp: 0.8, amRate: 1 / L, amDepth: 1, amPhase: 0.75, vibRate: 4.25, vibDepth: 3 });
  mixInto(out, setRms(shimmer, 0.012));
  reverb(out, sr, { rt60: 3, wet: 0.3, dry: 0.9, size: 1.3, damp: 0.5 }, true);
  return finish(out, sr, { peak: 0.75, loop: true, hp: 25, clip: 1.3 });
}

function musicEnding(sr: number): Float32Array {
  const L = 16;
  const out = buffer(sr, L);
  const n = out.length;
  const table = makeTable(PAD_HARMONICS, 220, sr);
  const morph = 1 / L;
  // Fmaj7 <-> Dm9 with a shared E3, plus a high E that never quite resolves.
  const pad = new Float32Array(n);
  const voices: readonly LoopVoice[] = [
    { f: 87.31, amp: 0.5, amRate: morph, amDepth: 1, amPhase: 0.25 },
    { f: 130.81, amp: 0.3, amRate: morph, amDepth: 1, amPhase: 0.25 },
    { f: 220, amp: 0.22, amRate: morph, amDepth: 1, amPhase: 0.25 },
    { f: 73.42, amp: 0.5, amRate: morph, amDepth: 1, amPhase: 0.75 },
    { f: 110, amp: 0.3, amRate: morph, amDepth: 1, amPhase: 0.75 },
    { f: 174.61, amp: 0.22, amRate: morph, amDepth: 1, amPhase: 0.75 },
    { f: 164.81, amp: 0.25, amRate: 0.1, amDepth: 0.2 },
    { f: 164.91, amp: 0.15, phase: 0.5 },
  ];
  for (const v of voices) addLoopVoice(pad, sr, { ...v, table, vibRate: 0.15, vibDepth: 0.06 });
  filter(pad, sr, [['lowpass', 900, 0.6]], true);
  mixInto(out, setRms(pad, 0.12));
  const high = new Float32Array(n);
  addLoopVoice(high, sr, { f: 659.26, amp: 1, amRate: 0.1, amDepth: 0.6, vibRate: 0.25, vibDepth: 0.6 });
  mixInto(out, setRms(high, 0.008));
  const keys = new Float32Array(n);
  const notes: readonly (readonly [number, number, number])[] = [
    [1.2, 440, 0.8],
    [5.6, 659.26, 0.5],
    [9.4, 523.25, 0.65],
    [13.3, 349.23, 0.75],
  ];
  for (const [t, f, a] of notes) addPiano(keys, sr, t, f, a, true);
  mixInto(out, normalize(keys, 0.4));
  reverb(out, sr, { rt60: 4.5, wet: 0.45, dry: 0.85, size: 1.4, damp: 0.45, predelay: 0.02 }, true);
  return finish(out, sr, { peak: 0.75, loop: true, hp: 25 });
}

// =================================================================================================
// Recipes - player foley
// =================================================================================================

function stepCarpet(sr: number): Float32Array {
  const rng = new Rng(0x3001);
  const out = buffer(sr, 0.3);
  addThump(out, sr, rng, 0.004, 0.8, 85, 55, 0.035, 0.9, 380);
  addBurst(out, sr, rng, { t: 0.006, amp: 0.06, attack: 0.008, decay: 0.03, color: 'pink', filters: [['bandpass', 2200, 0.8]] });
  addThump(out, sr, rng, 0.055, 0.35, 95, 60, 0.025, 0.9, 450);
  filter(out, sr, [['lowpass', 900, 0.7]]);
  return finish(out, sr, { peak: 0.9 });
}

function stepHard(sr: number): Float32Array {
  const rng = new Rng(0x3002);
  const out = buffer(sr, 0.7);
  addHardStep(out, sr, rng, 0.004, 1);
  reverb(out, sr, { rt60: 0.7, wet: 0.22, size: 0.8, damp: 0.5, predelay: 0.006 });
  return finish(out, sr, { peak: 0.9 });
}

function flashlightClick(sr: number): Float32Array {
  const rng = new Rng(0x3003);
  const out = buffer(sr, 0.12);
  addClick(out, sr, rng, 0.003, 1, [[3200, 0.5, 0.004], [5100, 0.3, 0.002], [2100, 0.25, 0.005]], 1500, 0.0008);
  addBurst(out, sr, rng, { t: 0.003, amp: 0.2, decay: 0.006, filters: [['lowpass', 700, 0.7]] });
  addClick(out, sr, rng, 0.021, 0.45, [[3800, 0.25, 0.003], [2600, 0.15, 0.004]], 1500, 0.0006);
  return finish(out, sr, { peak: 0.85, fadeOut: 0.01 });
}

function inspect(sr: number): Float32Array {
  const rng = new Rng(0x3004);
  const out = buffer(sr, 0.3);
  addCrinkle(out, sr, rng, 0.005, 0.12, 0.5, 60);
  addBurst(out, sr, rng, { t: 0.09, amp: 0.5, decay: 0.0015, filters: [['bandpass', 1900, 1.5]] });
  addModes(out, sr, 0.09, [[1850, 0.25, 0.01]]);
  filter(out, sr, [['lowpass', 7000, 0.7]]);
  return finish(out, sr, { peak: 0.8 });
}

function notebook(sr: number): Float32Array {
  const rng = new Rng(0x3005);
  const out = buffer(sr, 0.75);
  addSwish(out, sr, rng, 0.02, 0.45, 0.5, 1200, 3800);
  addCrinkle(out, sr, rng, 0.03, 0.35, 0.5, 70);
  addThump(out, sr, rng, 0.43, 0.35, 160, 110, 0.02, 1, 500);
  addBurst(out, sr, rng, { t: 0.43, amp: 0.2, decay: 0.01, filters: [['bandpass', 900, 1]] });
  return finish(out, sr, { peak: 0.85 });
}

// =================================================================================================
// Recipes - interaction
// =================================================================================================

function doorOpen(sr: number): Float32Array {
  const rng = new Rng(0x3006);
  const out = buffer(sr, 1.4);
  addLatch(out, sr, rng, 0.005, 0.8);
  addLatch(out, sr, rng, 0.07, 0.45);
  addCreak(out, sr, rng, { t: 0.12, dur: 0.65, amp: 0.55, rates: [48, 85, 62], body: [[430, 9], [780, 7], [1260, 6], [2100, 5]] });
  addBurst(out, sr, rng, { t: 0.1, amp: 0.08, attack: 0.15, decay: 0.2, color: 'pink', filters: [['lowpass', 600, 0.7]] });
  reverb(out, sr, { rt60: 0.8, wet: 0.2, size: 0.9, damp: 0.45, predelay: 0.008 });
  return finish(out, sr, { peak: 0.9 });
}

function doorClose(sr: number): Float32Array {
  const rng = new Rng(0x3007);
  const out = buffer(sr, 1.3);
  addBurst(out, sr, rng, { t: 0.005, amp: 0.06, attack: 0.08, decay: 0.04, color: 'pink', filters: [['lowpass', 500, 0.7]] });
  addModes(out, sr, 0.1, [[92, 1, 0.09], [158, 0.7, 0.07], [247, 0.5, 0.05], [388, 0.35, 0.035], [610, 0.2, 0.02]], 0.9);
  addBurst(out, sr, rng, { t: 0.1, amp: 0.7, decay: 0.02, filters: [['lowpass', 900, 0.7]] });
  addThump(out, sr, rng, 0.1, 0.5, 75, 50, 0.06, 0.3, 250);
  addLatch(out, sr, rng, 0.118, 0.5);
  addModes(out, sr, 0.14, [[1320, 0.15, 0.03], [2140, 0.1, 0.02]]);
  reverb(out, sr, { rt60: 0.9, wet: 0.25, size: 1, damp: 0.5, predelay: 0.01 });
  return finish(out, sr, { peak: 0.9 });
}

function doorLocked(sr: number): Float32Array {
  const rng = new Rng(0x3008);
  const out = buffer(sr, 0.9);
  let t = 0.005;
  for (let k = 0; k < 5; k++) {
    const a = k % 2 === 0 ? 1 : 0.7;
    const v = rng.vary(1, 0.05);
    addBurst(out, sr, rng, { t, amp: 0.6 * a, decay: 0.001, filters: [['highpass', 1500, 0.7]] });
    addModes(out, sr, t, [[610 * v, 0.2, 0.02], [1750 * v, 0.4, 0.018], [2900 * v, 0.3, 0.012], [4300 * v, 0.2, 0.008]], a);
    addModes(out, sr, t, [[180, 0.35, 0.03], [290, 0.2, 0.02]], a);
    t += rng.range(0.05, 0.1);
  }
  reverb(out, sr, { rt60: 0.6, wet: 0.18, size: 0.8, damp: 0.45 });
  return finish(out, sr, { peak: 0.9 });
}

function doorSlam(sr: number): Float32Array {
  const rng = new Rng(0x3009);
  const out = buffer(sr, 2.8);
  addThump(out, sr, rng, 0.01, 1, 60, 38, 0.18, 0.5, 400);
  addModes(out, sr, 0.01, [[85, 0.9, 0.2], [142, 0.7, 0.16], [228, 0.5, 0.12], [371, 0.35, 0.08], [590, 0.25, 0.05], [930, 0.15, 0.03]]);
  addBurst(out, sr, rng, { t: 0.01, amp: 1, attack: 0.0005, decay: 0.05, filters: [['lowpass', 1800, 0.7]] });
  addBurst(out, sr, rng, { t: 0.01, amp: 0.4, decay: 0.006, filters: [['highpass', 2000, 0.7]] });
  addLatch(out, sr, rng, 0.022, 0.6);
  addModes(out, sr, 0.05, [[1300, 0.2, 0.04], [2100, 0.15, 0.03]]);
  reverb(out, sr, { rt60: 2.2, wet: 0.5, size: 1.4, damp: 0.4, predelay: 0.018 });
  return finish(out, sr, { peak: 0.95, clip: 1.6, fadeOut: 0.15 });
}

function glassDoor(sr: number): Float32Array {
  const rng = new Rng(0x3010);
  const out = buffer(sr, 1.1);
  const glass: readonly Mode[] = [[1180, 0.5, 0.09], [2290, 0.35, 0.07], [3570, 0.28, 0.05], [5030, 0.2, 0.04], [6820, 0.12, 0.03]];
  const taps: readonly (readonly [number, number])[] = [[0.01, 0.9], [0.07, 0.5], [0.11, 0.6], [0.16, 0.35], [0.24, 0.3], [0.33, 0.2]];
  for (const [t, a] of taps) {
    addModes(out, sr, t, glass, a, { pitch: rng.vary(1, 0.01) });
    addBurst(out, sr, rng, { t, amp: a * 0.4, decay: 0.001, filters: [['highpass', 3000, 0.7]] });
  }
  addSwish(out, sr, rng, 0.02, 0.55, 0.25, 900, 2600, 0.8);
  addClick(out, sr, rng, 0.5, 0.3, [[2600, 0.2, 0.008], [4100, 0.12, 0.005]], 1500, 0.001);
  reverb(out, sr, { rt60: 0.7, wet: 0.2, size: 0.9, damp: 0.35 });
  return finish(out, sr, { peak: 0.85 });
}

function keyboard(sr: number): Float32Array {
  const rng = new Rng(0x3011);
  const out = buffer(sr, 1.0);
  let t = 0.005;
  for (let k = 0; k < 6; k++) {
    const pitch = rng.range(0.85, 1.2);
    addBurst(out, sr, rng, { t, amp: rng.range(0.7, 1), decay: 0.0025, filters: [['highpass', 1200, 0.7], ['peak', 3000 * pitch, 2, 6]] });
    addModes(out, sr, t, [[900 * pitch, 0.25, 0.012], [2200 * pitch, 0.3, 0.008], [3400 * pitch, 0.2, 0.005]], rng.range(0.6, 1));
    addBurst(out, sr, rng, { t, amp: 0.5, decay: 0.008, filters: [['lowpass', 600, 0.7]] });
    const back = t + rng.range(0.035, 0.06);
    addBurst(out, sr, rng, { t: back, amp: 0.35, decay: 0.0015, filters: [['highpass', 1800, 0.7]] });
    addModes(out, sr, back, [[2600 * pitch, 0.15, 0.005]]);
    t += rng.range(0.08, 0.17);
  }
  reverb(out, sr, { rt60: 0.35, wet: 0.1, size: 0.7, damp: 0.5 });
  return finish(out, sr, { peak: 0.85 });
}

function terminalBeep(sr: number): Float32Array {
  const out = buffer(sr, 0.2);
  addNote(out, sr, { t: 0.004, dur: 0.12, f: 880, amp: 0.8, wave: 'square', attack: 0.002, release: 0.012 });
  filter(out, sr, [['lowpass', 3200, 0.7], ['highpass', 300, 0.7]]);
  return finish(out, sr, { peak: 0.7, fadeOut: 0.01 });
}

function reportOk(sr: number): Float32Array {
  const out = buffer(sr, 0.5);
  addNote(out, sr, { t: 0.004, dur: 0.1, f: 880, amp: 0.8, attack: 0.003, release: 0.04 });
  addNote(out, sr, { t: 0.004, dur: 0.1, f: 1760, amp: 0.1, attack: 0.003, release: 0.03 });
  addNote(out, sr, { t: 0.16, dur: 0.16, f: 1318.5, amp: 0.8, attack: 0.003, release: 0.08 });
  addNote(out, sr, { t: 0.16, dur: 0.16, f: 2637, amp: 0.08, attack: 0.003, release: 0.05 });
  return finish(out, sr, { peak: 0.75 });
}

function reportBad(sr: number): Float32Array {
  const out = buffer(sr, 0.6);
  addNote(out, sr, { t: 0.004, dur: 0.42, f: 98, wave: 'saw', amp: 0.6, attack: 0.01, release: 0.06 });
  addNote(out, sr, { t: 0.004, dur: 0.42, f: 103.8, wave: 'square', amp: 0.35, attack: 0.01, release: 0.06 });
  filter(out, sr, [['lowpass', 650, 0.9]]);
  return finish(out, sr, { peak: 0.8, clip: 1.5 });
}

function elevatorButton(sr: number): Float32Array {
  const rng = new Rng(0x3014);
  const out = buffer(sr, 0.45);
  addClick(out, sr, rng, 0.004, 0.8, [[1500, 0.2, 0.008], [2600, 0.3, 0.006], [4100, 0.2, 0.004]], 1200, 0.001);
  addClick(out, sr, rng, 0.05, 0.3, [[2800, 0.15, 0.004]], 1500, 0.0008);
  addNote(out, sr, { t: 0.035, dur: 0.13, f: 1046.5, amp: 0.45, attack: 0.006, release: 0.06 });
  addNote(out, sr, { t: 0.035, dur: 0.13, f: 2093, amp: 0.05, attack: 0.006, release: 0.04 });
  return finish(out, sr, { peak: 0.8 });
}

function elevatorDingLayer(sr: number): Float32Array {
  const rng = new Rng(0x3015);
  const out = buffer(sr, 2.8);
  addChime(out, sr, rng, 0.005, 783.99, 0.9);
  addChime(out, sr, rng, 0.56, 659.26, 0.85);
  reverb(out, sr, { rt60: 1.3, wet: 0.22, size: 1.1, damp: 0.35, predelay: 0.012 });
  return out;
}

function elevatorDoorsLayer(sr: number): Float32Array {
  const rng = new Rng(0x3016);
  const out = buffer(sr, 2.4);
  const n = out.length;
  const stopAt = 1.95;
  const speed = (t: number): number => smoothstep(t / 0.35) * (1 - smoothstep((t - 1.5) / 0.42));
  const table = makeTable([[1, 1], [2, 0.6, 0.2], [3, 0.4, 0.5], [4, 0.2, 0.1], [5, 0.15, 0.7], [6, 0.08, 0.3], [8, 0.05, 0.6]], 260, sr);
  const motor = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const s = speed(i / sr);
    phase += (120 + 110 * s) / sr;
    motor[i] = readTable(table, phase) * s;
  }
  filter(motor, sr, [['lowpass', 1400, 0.7]]);
  mixInto(out, setRms(motor, 0.12));
  const rumble = filter(noise(n, rng, 'brown'), sr, [['lowpass', 200, 0.7]]);
  shape(rumble, (i) => speed(i / sr));
  mixInto(out, setRms(rumble, 0.15));
  const rollers = filter(noise(n, rng, 'white'), sr, [['bandpass', 950, 1.3]]);
  shape(rollers, (i) => {
    const t = i / sr;
    return speed(t) * (0.35 + 0.65 * sinePulse(11.5, t, 3));
  });
  mixInto(out, setRms(rollers, 0.05));
  addThump(out, sr, rng, stopAt, 0.35, 95, 60, 0.05, 0.5, 400);
  addModes(out, sr, stopAt, [[175, 0.2, 0.05], [410, 0.12, 0.03], [1250, 0.05, 0.015]]);
  reverb(out, sr, { rt60: 0.6, wet: 0.15, size: 0.9, damp: 0.45 });
  return out;
}

function elevatorDing(sr: number): Float32Array {
  return finish(elevatorDingLayer(sr), sr, { peak: 0.85, fadeOut: 0.4 });
}

function elevatorDoors(sr: number): Float32Array {
  return finish(elevatorDoorsLayer(sr), sr, { peak: 0.85, fadeOut: 0.1 });
}

function elevatorArrival(sr: number): Float32Array {
  const out = buffer(sr, 3.3);
  mixInto(out, normalize(elevatorDingLayer(sr), 1));
  mixInto(out, normalize(elevatorDoorsLayer(sr), 0.7), samplesFor(sr, 0.8));
  return finish(out, sr, { peak: 0.9, fadeOut: 0.1 });
}

function pickup(sr: number): Float32Array {
  const rng = new Rng(0x3017);
  const out = buffer(sr, 0.45);
  addCrinkle(out, sr, rng, 0.005, 0.12, 0.4, 50);
  addBurst(out, sr, rng, { t: 0.005, amp: 0.2, attack: 0.04, decay: 0.05, color: 'pink', filters: [['bandpass', 2500, 0.8]] });
  addModes(out, sr, 0.06, [[1900, 0.1, 0.04], [3100, 0.2, 0.03], [4700, 0.12, 0.02]]);
  addBurst(out, sr, rng, { t: 0.06, amp: 0.25, decay: 0.0008, filters: [['highpass', 2500, 0.7]] });
  addBurst(out, sr, rng, { t: 0.1, amp: 0.25, decay: 0.015, filters: [['lowpass', 450, 0.7]] });
  return finish(out, sr, { peak: 0.8 });
}

function relief(sr: number): Float32Array {
  const out = buffer(sr, 3.4);
  const chord: readonly (readonly [number, number])[] = [[87.31, 0.9], [130.81, 0.6], [174.61, 0.55], [220, 0.4], [261.63, 0.22]];
  for (const [f, a] of chord) {
    addNote(out, sr, { t: 0.01, dur: 1.9, f, amp: a, attack: 1.1, release: 1.3, vibRate: 0.3, vibDepth: 0.0015 });
    addNote(out, sr, { t: 0.01, dur: 1.9, f: f * 1.003, amp: a * 0.5, wave: 'tri', attack: 1.3, release: 1.3 });
  }
  filter(out, sr, [['lowpass', 1100, 0.6]]);
  return finish(out, sr, { peak: 0.7, fadeOut: 0.1 });
}

function hazard(sr: number): Float32Array {
  const rng = new Rng(0x3019);
  const out = buffer(sr, 1.7);
  const clank: readonly Mode[] = [[523, 0.8, 0.35], [797, 0.5, 0.3], [1287, 0.6, 0.25], [2210, 0.5, 0.18], [3170, 0.4, 0.12], [4400, 0.3, 0.08], [5800, 0.2, 0.05]];
  addModes(out, sr, 0.005, clank, 0.9);
  addBurst(out, sr, rng, { t: 0.005, amp: 1, decay: 0.004, filters: [['highpass', 1000, 0.7]] });
  addBurst(out, sr, rng, { t: 0.005, amp: 0.5, decay: 0.015, filters: [['lowpass', 1500, 0.7]] });
  addModes(out, sr, 0.07, clank, 0.35, { pitch: 1.03 });
  const low = new Float32Array(out.length);
  addNote(low, sr, { t: 0.005, dur: 1.1, f: 58, f1: 49, wave: 'saw', amp: 1, attack: 0.01, release: 0.3, decay: 0.6 });
  filter(low, sr, [['lowpass', 300, 0.7]]);
  mixInto(out, normalize(low, 0.5));
  reverb(out, sr, { rt60: 1.2, wet: 0.25, size: 1.1, damp: 0.4 });
  return finish(out, sr, { peak: 0.9, clip: 1.4, fadeOut: 0.1 });
}

function uiHover(sr: number): Float32Array {
  const rng = new Rng(0x3020);
  const out = buffer(sr, 0.05);
  addBurst(out, sr, rng, { t: 0.002, amp: 0.5, decay: 0.0006, filters: [['bandpass', 4200, 1.2]] });
  addModes(out, sr, 0.002, [[3300, 0.3, 0.004]]);
  return finish(out, sr, { peak: 0.5, fadeOut: 0.015 });
}

function uiSelect(sr: number): Float32Array {
  const rng = new Rng(0x3021);
  const out = buffer(sr, 0.16);
  addBurst(out, sr, rng, { t: 0.003, amp: 0.7, decay: 0.0015, filters: [['lowpass', 2200, 0.7]] });
  addNote(out, sr, { t: 0.003, dur: 0.03, f: 190, f1: 120, amp: 0.8, attack: 0.001, release: 0.03, decay: 0.02 });
  addModes(out, sr, 0.003, [[1400, 0.15, 0.01]]);
  filter(out, sr, [['lowpass', 3000, 0.7]]);
  return finish(out, sr, { peak: 0.8 });
}

// =================================================================================================
// Recipes - horror / anomaly
// =================================================================================================

function phoneRing(sr: number): Float32Array {
  const out = buffer(sr, 2.5);
  const dur = 2;
  const ring = buffer(sr, dur);
  for (let i = 0; i < ring.length; i++) {
    const t = i / sr;
    const trill = 0.5 + 0.5 * Math.tanh(5 * Math.sin(TAU * 20 * t));
    const tone = Math.sin(TAU * 440 * t) + 0.9 * Math.sin(TAU * 480 * t);
    const env = smoothstep(t / 0.02) * (1 - smoothstep((t - (dur - 0.06)) / 0.06));
    ring[i] = tone * trill * env;
  }
  softClip(ring, 2.2);
  filter(ring, sr, [['highpass', 350, 0.7], ['lowpass', 3400, 0.7]]);
  mixInto(out, ring, samplesFor(sr, 0.01));
  reverb(out, sr, { rt60: 0.8, wet: 0.2, size: 0.9, damp: 0.4 });
  return finish(out, sr, { peak: 0.85 });
}

function knock(sr: number): Float32Array {
  const rng = new Rng(0x3023);
  const out = buffer(sr, 3.0);
  const hits: readonly (readonly [number, number])[] = [[0.01, 1], [0.62, 0.92], [1.24, 0.97]];
  for (const [t, a] of hits) addWoodKnock(out, sr, rng, t, a);
  reverb(out, sr, { rt60: 1.6, wet: 0.38, size: 1.3, damp: 0.45, predelay: 0.012 });
  return finish(out, sr, { peak: 0.9, fadeOut: 0.1 });
}

function distantFootsteps(sr: number): Float32Array {
  const rng = new Rng(0x3024);
  const out = buffer(sr, 4.4);
  let t = 0.05;
  for (const a of [0.55, 0.75, 0.9, 1, 0.85, 0.65]) {
    addHardStep(out, sr, rng, t, a);
    t += rng.range(0.54, 0.62);
  }
  filter(out, sr, [['lowpass', 1100, 0.6]]);
  reverb(out, sr, { rt60: 1.9, wet: 0.75, dry: 0.5, size: 1.5, damp: 0.55, predelay: 0.03 });
  filter(out, sr, [['lowpass', 1800, 0.7]]);
  return finish(out, sr, { peak: 0.85, fadeOut: 0.3 });
}

function staticBurst(sr: number): Float32Array {
  const rng = new Rng(0x3025);
  const out = buffer(sr, 0.75);
  const len = samplesFor(sr, 0.62);
  const s = noise(len, rng, 'white');
  const crackleChance = 90 / sr;
  let g = 1;
  let next = 0;
  for (let i = 0; i < len; i++) {
    if (i >= next) {
      g = rng.range(0.35, 1);
      next = i + Math.round(rng.range(0.012, 0.04) * sr);
    }
    s[i] *= g;
    if (rng.next() < crackleChance) s[i] += rng.bi() * 2.5;
  }
  filter(s, sr, [['highpass', 380, 0.7], ['lowpass', 5200, 0.7]]);
  for (let i = 0; i < len; i++) s[i] += 0.12 * Math.sign(Math.sin((TAU * 60 * i) / sr)) * 0.5;
  shape(s, (i) => {
    const t = i / sr;
    return smoothstep(t / 0.006) * (1 - smoothstep((t - 0.48) / 0.14));
  });
  mixInto(out, s, samplesFor(sr, 0.003));
  return finish(out, sr, { peak: 0.8, clip: 1.6 });
}

function fluorescentZap(sr: number): Float32Array {
  const rng = new Rng(0x3026);
  const out = buffer(sr, 0.75);
  const n = out.length;
  const table = fluorescentTable(sr, rng);
  const stutter = smoothRandom(n, sr, 40, rng, false);
  const env = (t: number): number => smoothstep(t / 0.012) * Math.exp(-Math.max(0, t - 0.08) / 0.12);
  const buzz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    buzz[i] = readTable(table, 120 * t) * env(t) * (0.55 + 0.45 * Math.max(0, stutter[i]));
  }
  const arc = noise(n, rng, 'white');
  shape(arc, (i) => {
    const t = i / sr;
    return env(t) * (0.3 + 0.7 * Math.max(0, stutter[i])) * sinePulse(60, t, 2);
  });
  filter(arc, sr, [['highpass', 1200, 0.7]]);
  mixInto(out, buzz, 0, 0.6);
  mixInto(out, arc, 0, 0.7);
  addClick(out, sr, rng, 0.006, 0.8, [[1900, 0.2, 0.01], [3100, 0.15, 0.006]], 800, 0.003);
  return finish(out, sr, { peak: 0.9, clip: 2.2 });
}

function lightOn(sr: number): Float32Array {
  const rng = new Rng(0x3027);
  const out = buffer(sr, 2.6);
  const n = out.length;
  // starter tick, then the tube strikes with a bright ping
  addClick(out, sr, rng, 0.01, 0.7, [[1700, 0.22, 0.01], [2800, 0.3, 0.006], [4300, 0.12, 0.004]], 1500, 0.0012);
  addModes(out, sr, 0.2, [[2210, 0.22, 0.3], [3300, 0.35, 0.22], [4950, 0.16, 0.12], [6610, 0.07, 0.07]], 0.55);
  addBurst(out, sr, rng, { t: 0.2, amp: 0.4, decay: 0.002, filters: [['highpass', 2000, 0.7]] });
  // flicker bursts, then the buzz swells in to a steady state
  const flickers: readonly (readonly [number, number, number])[] = [[0.27, 0.41, 0.7], [0.52, 0.6, 0.5], [0.71, 0.77, 0.8], [0.86, 0.9, 0.4]];
  const gate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = 0.15 * smoothstep((t - 0.95) / 0.05) + 0.85 * smoothstep((t - 0.95) / 1.4);
    for (const [a, b, lvl] of flickers) g = Math.max(g, lvl * smoothstep((t - a) / 0.006) * (1 - smoothstep((t - b) / 0.012)));
    gate[i] = g;
  }
  const table = fluorescentTable(sr, rng);
  const buzz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    buzz[i] = (readTable(table, 120 * t) + 0.25 * readTable(SINE_TABLE, 60 * t)) * gate[i];
  }
  const arc = noise(n, rng, 'white');
  shape(arc, (i) => {
    const t = i / sr;
    const unstable = 1 - smoothstep((t - 1) / 0.6);
    return gate[i] * (0.25 + 0.75 * unstable) * sinePulse(60, t, 4);
  });
  filter(arc, sr, [['highpass', 2200, 0.7]]);
  mixInto(out, buzz, 0, 0.45);
  mixInto(out, arc, 0, 0.35);
  return finish(out, sr, { peak: 0.85, fadeOut: 0.25 });
}

function paChime(sr: number): Float32Array {
  const rng = new Rng(0x3028);
  const out = buffer(sr, 3.0);
  for (const [t, f] of [[0.01, 392], [0.46, 523.25], [0.91, 659.25]] as const) {
    addModes(out, sr, t, [[f, 1, 0.9], [f * 1.0025, 0.35, 0.75], [f * 2, 0.03, 0.3], [f * 4, 0.16, 0.15]], 0.8, { attack: 0.002 });
    addBurst(out, sr, rng, { t, amp: 0.1, decay: 0.004, filters: [['lowpass', 1500, 0.7]] });
  }
  filter(out, sr, [['highpass', 280, 0.7], ['lowpass', 4200, 0.7]]);
  softClip(out, 1.3);
  reverb(out, sr, { rt60: 1.9, wet: 0.38, size: 1.4, damp: 0.4, predelay: 0.025 });
  return finish(out, sr, { peak: 0.85, fadeOut: 0.3 });
}

function heartbeat(sr: number): Float32Array {
  const rng = new Rng(0x3029);
  const L = 4;
  const out = buffer(sr, L);
  for (let b = 0; b < 4; b++) {
    const t = 0.02 + b + rng.bi() * 0.015;
    const a = rng.range(0.85, 1);
    addNote(out, sr, { t, dur: 0.1, f: 62, f1: 44, glide: 0.06, amp: a, attack: 0.008, release: 0.05, decay: 0.06, wrap: true });
    addBurst(out, sr, rng, { t, amp: a * 0.35, attack: 0.004, decay: 0.03, filters: [['lowpass', 180, 0.7]], wrap: true });
    const t2 = t + 0.27;
    addNote(out, sr, { t: t2, dur: 0.08, f: 74, f1: 52, glide: 0.05, amp: a * 0.7, attack: 0.006, release: 0.04, decay: 0.045, wrap: true });
    addBurst(out, sr, rng, { t: t2, amp: a * 0.25, attack: 0.004, decay: 0.025, filters: [['lowpass', 220, 0.7]], wrap: true });
  }
  filter(out, sr, [['lowpass', 260, 0.7]], true);
  return finish(out, sr, { peak: 0.85, loop: true, hp: 22, clip: 1.4 });
}

function stinger(sr: number): Float32Array {
  const rng = new Rng(0x3030);
  const out = buffer(sr, 3.6);
  const n = out.length;
  const low = new Float32Array(n);
  addNote(low, sr, { t: 0.01, dur: 1.7, f: 49, amp: 1, attack: 1.3, release: 1.4, vibRate: 0.25, vibDepth: 0.004 });
  addNote(low, sr, { t: 0.01, dur: 1.7, f: 51.91, amp: 0.55, attack: 1.5, release: 1.3 });
  addNote(low, sr, { t: 0.01, dur: 1.7, f: 73.42, amp: 0.45, wave: 'saw', attack: 1.4, release: 1.3 });
  filter(low, sr, [['lowpass', 320, 0.7]]);
  mixInto(out, normalize(low, 0.8));
  const shimmer = new Float32Array(n);
  for (const [f, a] of [[1760, 0.6], [1864.66, 0.5], [2489.02, 0.35], [3520, 0.15]] as const) {
    addNote(shimmer, sr, { t: 0.3, dur: 1.4, f, amp: a, attack: 1.2, release: 1.4, vibRate: rng.range(4.5, 6.5), vibDepth: 0.003 });
  }
  shape(shimmer, (i) => 0.65 + 0.35 * Math.sin((TAU * 6.3 * i) / sr));
  mixInto(out, normalize(shimmer, 0.14));
  const air = noise(samplesFor(sr, 2.2), rng, 'pink');
  filter(air, sr, [['bandpass', 3500, 0.9]]);
  shape(air, (i) => {
    const t = i / sr;
    return smoothstep(t / 1.4) * (1 - smoothstep((t - 1.5) / 0.6));
  });
  mixInto(out, normalize(air, 0.08), samplesFor(sr, 0.1));
  reverb(out, sr, { rt60: 2.6, wet: 0.45, size: 1.5, damp: 0.4, predelay: 0.02 });
  return finish(out, sr, { peak: 0.8, fadeOut: 0.3 });
}

function thud(sr: number): Float32Array {
  const rng = new Rng(0x3031);
  const out = buffer(sr, 1.0);
  addThump(out, sr, rng, 0.005, 1, 72, 42, 0.12, 0.7, 260);
  addModes(out, sr, 0.005, [[118, 0.5, 0.08], [187, 0.35, 0.06], [290, 0.2, 0.04]], 0.8);
  filter(out, sr, [['lowpass', 900, 0.7]]);
  reverb(out, sr, { rt60: 0.8, wet: 0.2, size: 1, damp: 0.6 });
  return finish(out, sr, { peak: 0.9, hp: 25, fadeOut: 0.08 });
}

function lowBoom(sr: number): Float32Array {
  const rng = new Rng(0x3032);
  const out = buffer(sr, 3.2);
  addNote(out, sr, { t: 0.005, dur: 1.8, f: 50, f1: 30, glide: 0.9, amp: 1, attack: 0.006, release: 0.6, decay: 0.7 });
  addNote(out, sr, { t: 0.005, dur: 1.4, f: 100, f1: 62, glide: 0.6, amp: 0.25, attack: 0.006, release: 0.4, decay: 0.4 });
  addBurst(out, sr, rng, { t: 0.005, amp: 0.6, attack: 0.01, decay: 0.5, color: 'brown', filters: [['lowpass', 140, 0.7]] });
  addBurst(out, sr, rng, { t: 0.005, amp: 0.3, decay: 0.03, filters: [['lowpass', 500, 0.7]] });
  reverb(out, sr, { rt60: 3, wet: 0.35, size: 1.6, damp: 0.7, predelay: 0.02 });
  filter(out, sr, [['lowpass', 400, 0.7]]);
  return finish(out, sr, { peak: 0.95, hp: 15, clip: 1.4, fadeOut: 0.3 });
}

function whisper(sr: number): Float32Array {
  const rng = new Rng(0x3033);
  const out = buffer(sr, 1.5);
  const vowels: readonly (readonly [number, number])[] = [[320, 2250], [700, 1150], [480, 880], [560, 1750], [380, 1950]];
  const pickVowel = (): readonly [number, number] => vowels[Math.floor(rng.next() * vowels.length)];
  const end = 1.25;
  let t = 0.06;
  let from = pickVowel();
  while (t < end - 0.15) {
    const d = rng.range(0.16, 0.3);
    const to = pickVowel();
    const m = samplesFor(sr, d);
    const base = noise(m, rng, 'pink');
    const f1 = sweep(base.slice(), sr, 'bandpass', 6, (i) => lerp(from[0], to[0], i / m));
    const f2 = sweep(base.slice(), sr, 'bandpass', 8, (i) => lerp(from[1], to[1], i / m));
    const f3 = filter(base.slice(), sr, [['bandpass', 2700, 5]]);
    const seg = new Float32Array(m);
    for (let i = 0; i < m; i++) seg[i] = (f1[i] + 0.8 * f2[i] + 0.4 * f3[i]) * Math.pow(Math.sin((Math.PI * i) / m), 0.6);
    mixInto(out, normalize(seg, rng.range(0.45, 0.65)), samplesFor(sr, t));
    if (rng.next() < 0.6) {
      addBurst(out, sr, rng, {
        t: Math.max(0.005, t - 0.05),
        amp: rng.range(0.25, 0.4),
        attack: 0.03,
        hold: 0.02,
        decay: 0.03,
        filters: [['bandpass', Math.min(6500, sr * 0.4), 2], ['highpass', 3500, 0.7]],
      });
    }
    from = to;
    t += d + rng.range(0.01, 0.06);
  }
  const breath = noise(samplesFor(sr, end), rng, 'pink');
  filter(breath, sr, [['highpass', 900, 0.7]]);
  shape(breath, (i) => Math.sin((Math.PI * i) / breath.length));
  mixInto(out, normalize(breath, 0.08), samplesFor(sr, 0.03));
  reverb(out, sr, { rt60: 0.6, wet: 0.15, size: 0.9, damp: 0.5 });
  return finish(out, sr, { peak: 0.8, hp: 120 });
}

// =================================================================================================
// Recipes - decoys (mundane noises)
// =================================================================================================

function ventRattle(sr: number): Float32Array {
  const rng = new Rng(0x3034);
  const out = buffer(sr, 1.6);
  addModes(out, sr, 0.01, [[88, 0.6, 0.12], [143, 0.4, 0.08]]);
  addBurst(out, sr, rng, { t: 0.01, amp: 0.4, decay: 0.02, filters: [['lowpass', 300, 0.7]] });
  let t = 0.05;
  while (t < 0.95) {
    const x = (t - 0.05) / 0.9;
    const env = Math.sin(Math.PI * x);
    const v = rng.vary(1, 0.06);
    addModes(out, sr, t, [[610 * v, 0.4, 0.05], [1450 * v, 0.3, 0.035], [2700 * v, 0.25, 0.02], [3900 * v, 0.15, 0.012]], env * rng.range(0.3, 0.8));
    addBurst(out, sr, rng, { t, amp: env * 0.3, decay: 0.0007, filters: [['highpass', 2000, 0.7]] });
    t += 1 / (8 + 27 * env) + rng.range(0, 0.02);
  }
  reverb(out, sr, { rt60: 0.9, wet: 0.3, size: 0.8, damp: 0.3 });
  return finish(out, sr, { peak: 0.9 });
}

function pipes(sr: number): Float32Array {
  const rng = new Rng(0x3035);
  const out = buffer(sr, 2.6);
  const pipe: readonly Mode[] = [[340, 0.6, 0.35], [912, 0.45, 0.25], [1705, 0.35, 0.16], [2650, 0.2, 0.1], [3790, 0.1, 0.06]];
  for (const [t, a] of [[0.01, 1], [0.34, 0.6], [0.49, 0.8], [1.25, 0.45]] as const) {
    addModes(out, sr, t, pipe, a, { pitch: rng.vary(1, 0.02) });
    addThump(out, sr, rng, t, a * 0.5, 100, 70, 0.05, 0.4, 400);
    addBurst(out, sr, rng, { t, amp: a * 0.3, decay: 0.006, filters: [['lowpass', 1200, 0.7]] });
  }
  filter(out, sr, [['lowpass', 2400, 0.7]]);
  reverb(out, sr, { rt60: 1.2, wet: 0.3, size: 1.1, damp: 0.5 });
  return finish(out, sr, { peak: 0.9, fadeOut: 0.1 });
}

function monitorClick(sr: number): Float32Array {
  const rng = new Rng(0x3036);
  const out = buffer(sr, 1.8);
  const n = out.length;
  addClick(out, sr, rng, 0.01, 0.9, [[900, 0.3, 0.012], [2400, 0.3, 0.008], [3700, 0.2, 0.005]], 1200, 0.0012);
  // degauss coil: a big 60 Hz "thoom" with mechanical rattle, decaying
  const table = makeTable([[1, 1], [2, 0.25, 0.1], [3, 0.6, 0.3], [5, 0.35, 0.2], [7, 0.2, 0.6], [9, 0.12, 0.4], [11, 0.08, 0.1], [13, 0.05, 0.7]], 60, sr);
  const g = (t: number): number => (t < 0.02 ? 0 : smoothstep((t - 0.02) / 0.015) * Math.exp(-(t - 0.035) / 0.32));
  const coil = new Float32Array(n);
  for (let i = 0; i < n; i++) coil[i] = readTable(table, (60 * i) / sr) * g(i / sr);
  mixInto(out, coil, 0, 0.7);
  const rattle = noise(n, rng, 'white');
  shape(rattle, (i) => g(i / sr) * sinePulse(60, i / sr, 3));
  filter(rattle, sr, [['bandpass', 1700, 1.2]]);
  mixInto(out, normalize(rattle, 0.2));
  for (let k = 0; k < 7; k++) {
    addBurst(out, sr, rng, { t: rng.range(0.05, 0.45), amp: rng.range(0.05, 0.15), decay: 0.0005, filters: [['highpass', 3000, 0.7]] });
  }
  addNote(out, sr, { t: 0.3, dur: 1.2, f: Math.min(9800, sr * 0.42), amp: 0.015, attack: 0.8, release: 0.2 });
  return finish(out, sr, { peak: 0.85, fadeOut: 0.1 });
}

function printer(sr: number): Float32Array {
  const rng = new Rng(0x3037);
  const out = buffer(sr, 2.8);
  const n = out.length;
  addThump(out, sr, rng, 0.01, 0.5, 170, 115, 0.025, 0.6, 900);
  addModes(out, sr, 0.01, [[640, 0.3, 0.04], [1530, 0.2, 0.02], [2900, 0.1, 0.01]]);
  const env = (t: number): number => smoothstep((t - 0.1) / 0.35) * (1 - smoothstep((t - 2.05) / 0.3));
  const table = motorTable(sr, rng, 240, 10, 0.9);
  const motor = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (105 + 125 * smoothstep((t - 0.1) / 0.5) + 3 * Math.sin(TAU * 2.3 * t)) / sr;
    motor[i] = readTable(table, phase) * env(t);
  }
  filter(motor, sr, [['bandpass', 600, 0.6]]);
  mixInto(out, normalize(motor, 0.35));
  const gears = noise(n, rng, 'white');
  shape(gears, (i) => {
    const t = i / sr;
    const c = 0.5 + 0.5 * readTable(SINE_TABLE, 47 * t);
    return env(t) * c * c * c;
  });
  filter(gears, sr, [['bandpass', 2300, 1.4]]);
  mixInto(out, normalize(gears, 0.25));
  for (let t = 0.85; t < 1.9; t += 1 / 14) {
    addClick(out, sr, rng, t + rng.bi() * 0.003, 0.12, [[1800, 0.1, 0.01], [3100, 0.12, 0.006]], 2000, 0.0008);
  }
  addThump(out, sr, rng, 2.38, 0.4, 150, 100, 0.02, 0.6, 800);
  addModes(out, sr, 2.38, [[560, 0.2, 0.03], [1400, 0.12, 0.015]]);
  reverb(out, sr, { rt60: 0.5, wet: 0.12, size: 0.8, damp: 0.5 });
  return finish(out, sr, { peak: 0.85 });
}

function coolerGurgle(sr: number): Float32Array {
  const rng = new Rng(0x3038);
  const out = buffer(sr, 2.1);
  let t = 0.02;
  for (let k = 0; k < 6; k++) {
    const f0 = rng.range(230, 520);
    const a = rng.range(0.55, 1);
    addChirp(out, sr, t, f0, f0 * rng.range(1.5, 1.9), 0.03, rng.range(0.035, 0.07), a);
    addBurst(out, sr, rng, { t, amp: a * 0.3, attack: 0.003, decay: 0.02, color: 'pink', filters: [['lowpass', 260, 0.8]] });
    if (rng.next() < 0.5) addChirp(out, sr, t + rng.range(0.02, 0.05), f0 * 1.6, f0 * 2.4, 0.02, 0.03, a * 0.35);
    t += rng.range(0.12, 0.32);
  }
  filter(out, sr, [['lowpass', 3000, 0.7]]);
  reverb(out, sr, { rt60: 0.45, wet: 0.22, size: 0.6, damp: 0.3 });
  return finish(out, sr, { peak: 0.85 });
}

function paperSettle(sr: number): Float32Array {
  const rng = new Rng(0x3039);
  const out = buffer(sr, 1.0);
  addSwish(out, sr, rng, 0.01, 0.5, 0.4, 1800, 3200, 0.7);
  addCrinkle(out, sr, rng, 0.05, 0.5, 0.4, 40);
  addBurst(out, sr, rng, { t: 0.55, amp: 0.3, decay: 0.008, filters: [['lowpass', 900, 0.7]] });
  addModes(out, sr, 0.55, [[700, 0.1, 0.02]]);
  reverb(out, sr, { rt60: 0.5, wet: 0.12, size: 0.8, damp: 0.5 });
  return finish(out, sr, { peak: 0.8 });
}

function drip(sr: number): Float32Array {
  const rng = new Rng(0x3040);
  const out = buffer(sr, 1.8);
  for (const [t, a] of [[0.02, 1], [0.63, 0.7], [1.02, 0.85]] as const) {
    const f0 = rng.range(800, 1200);
    addChirp(out, sr, t, f0, f0 * 1.9, 0.006, 0.022, a);
    addBurst(out, sr, rng, { t, amp: a * 0.2, decay: 0.0005, filters: [['highpass', 3000, 0.7]] });
  }
  reverb(out, sr, { rt60: 1.4, wet: 0.45, size: 1, damp: 0.25, predelay: 0.01 });
  return finish(out, sr, { peak: 0.85, fadeOut: 0.1 });
}

function radiatorTick(sr: number): Float32Array {
  const rng = new Rng(0x3041);
  const out = buffer(sr, 2.3);
  let t = 0.01;
  while (t < 1.8) {
    const v = rng.vary(1, 0.06);
    const a = rng.range(0.5, 1);
    addBurst(out, sr, rng, { t, amp: a, decay: 0.0006, filters: [['highpass', 2500, 0.7]] });
    addModes(out, sr, t, [[290 * v, 0.2, 0.03], [2200 * v, 0.35, 0.015], [3600 * v, 0.25, 0.01], [5000 * v, 0.15, 0.006]], a);
    t += rng.range(0.12, 0.45);
  }
  reverb(out, sr, { rt60: 0.7, wet: 0.2, size: 0.9, damp: 0.4 });
  return finish(out, sr, { peak: 0.9 });
}

function elevatorMachinery(sr: number): Float32Array {
  const rng = new Rng(0x3042);
  const out = buffer(sr, 3.6);
  const n = out.length;
  addThump(out, sr, rng, 0.02, 0.7, 80, 55, 0.08, 0.5, 300);
  addModes(out, sr, 0.02, [[210, 0.3, 0.05]]);
  const env = (t: number): number => smoothstep((t - 0.05) / 0.7) * (1 - smoothstep((t - 2.6) / 0.8));
  const table = motorTable(sr, rng, 95, 10, 1.1);
  const motor = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (80 + 15 * smoothstep(t / 0.7)) / sr;
    motor[i] = readTable(table, phase) * env(t);
  }
  mixInto(out, normalize(motor, 0.45));
  const rumble = filter(noise(n, rng, 'brown'), sr, [['lowpass', 120, 0.7]]);
  shape(rumble, (i) => env(i / sr));
  mixInto(out, normalize(rumble, 0.35));
  addThump(out, sr, rng, 3.0, 0.4, 90, 60, 0.05, 0.5, 300);
  filter(out, sr, [['lowpass', 350, 0.7]]);
  reverb(out, sr, { rt60: 0.8, wet: 0.25, size: 1, damp: 0.6 });
  return finish(out, sr, { peak: 0.8, fadeOut: 0.1 });
}

// =================================================================================================
// Registry & public API
// =================================================================================================

type Recipe = (sr: number) => Float32Array;

const RECIPES: Record<string, Recipe> = {
  // ambience loops
  'amb-hum': ambHum,
  'amb-fluorescent': ambFluorescent,
  'amb-vent': ambVent,
  'amb-office': ambOffice,
  'amb-room-tone': ambRoomTone,
  'amb-fridge': ambFridge,
  'amb-electronics': ambElectronics,
  'attention-drone': attentionDrone,
  'elevator-motor': elevatorMotor,
  // music loops
  'music-menu': musicMenu,
  'music-ambient': musicAmbient,
  'music-tension': musicTension,
  'music-ending': musicEnding,
  // player
  'step-carpet': stepCarpet,
  'step-hard': stepHard,
  'flashlight-click': flashlightClick,
  inspect,
  notebook,
  // interaction
  'door-open': doorOpen,
  'door-close': doorClose,
  'door-locked': doorLocked,
  'door-slam': doorSlam,
  'glass-door': glassDoor,
  keyboard,
  'terminal-beep': terminalBeep,
  'report-ok': reportOk,
  'report-bad': reportBad,
  'elevator-button': elevatorButton,
  'elevator-ding': elevatorDing,
  'elevator-arrival': elevatorArrival,
  'elevator-doors': elevatorDoors,
  pickup,
  relief,
  hazard,
  'ui-hover': uiHover,
  'ui-select': uiSelect,
  // horror / anomaly
  'phone-ring': phoneRing,
  knock,
  'distant-footsteps': distantFootsteps,
  'static-burst': staticBurst,
  'fluorescent-zap': fluorescentZap,
  'light-on': lightOn,
  'pa-chime': paChime,
  heartbeat,
  stinger,
  thud,
  'low-boom': lowBoom,
  whisper,
  // decoys
  'vent-rattle': ventRattle,
  pipes,
  'monitor-click': monitorClick,
  printer,
  'cooler-gurgle': coolerGurgle,
  'paper-settle': paperSettle,
  drip,
  'radiator-tick': radiatorTick,
  'elevator-machinery': elevatorMachinery,
};

export function hasRecipe(recipe: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, recipe);
}

export function listRecipes(): string[] {
  return Object.keys(RECIPES);
}

/** Returns mono PCM in [-1, 1]. Throws Error(`Unknown synth recipe: ${id}`) for unknown ids. */
export function synthesize(recipe: string, sampleRate: number = SYNTH_SAMPLE_RATE): Float32Array {
  if (!hasRecipe(recipe)) throw new Error(`Unknown synth recipe: ${recipe}`);
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError(`Unsupported synth sample rate: ${sampleRate}`);
  }
  return RECIPES[recipe](Math.round(sampleRate));
}

/** 16-bit PCM mono WAV (RIFF header + data). */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const rate = Math.round(sampleRate);
  const out = new ArrayBuffer(44 + n * 2);
  const view = new DataView(out);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = samples[i];
    const s = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return out;
}
