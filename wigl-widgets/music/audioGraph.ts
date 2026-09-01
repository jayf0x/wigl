// G1 — a small Web Audio effect chain tapped off the Sendspin hidden <audio>
// element (only possible in "media-element" output mode — see music.config.ts).
// Crib from /Users/me/Documents/GitHub/audio-bonanza's content.js, trimmed to
// what fits a compact widget: 3-band EQ + a synthesised-impulse reverb + a
// feedback echo. No playback-speed control — the SDK feeds the element a live
// MediaStream (`srcObject`), and `playbackRate` is ignored on a MediaStream;
// real time-stretch needs a phase-vocoder AudioWorklet (backlog G1).
//
// The graph lives for the whole connection (createMediaElementSource can only
// run once per element and reroutes it permanently) — `useMusic` owns its
// lifecycle; the FX tab only moves the knobs.

export interface FxState {
  /** shelf/peak gain in dB, -12..+12 */
  low: number;
  mid: number;
  high: number;
  /** 0..1 reverb wet mix */
  reverb: number;
  /** 0..1 echo amount (delay wet + feedback) */
  echo: number;
}

export const DEFAULT_FX: FxState = { low: 0, mid: 0, high: 0, reverb: 0, echo: 0 };

export const fxIsFlat = (fx: FxState): boolean =>
  fx.low === 0 && fx.mid === 0 && fx.high === 0 && fx.reverb === 0 && fx.echo === 0;

export interface AudioFx {
  apply: (fx: FxState) => void;
  resume: () => void;
  dispose: () => void;
}

/** A decaying white-noise impulse response — a cheap, asset-free room reverb. */
const makeImpulse = (ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer => {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
};

/** Route `el` through EQ → (dry + reverb + echo) → destination. Call once. */
export const attachAudioFx = (el: HTMLAudioElement): AudioFx => {
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaElementSource(el);

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 220;
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1200;
  mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 4500;

  const dry = ctx.createGain();
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 2.6, 2.2);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = 0;

  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0;

  const master = ctx.createGain();

  source.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(dry);
  dry.connect(master);
  high.connect(reverb);
  reverb.connect(reverbWet);
  reverbWet.connect(master);
  high.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(echoWet);
  echoWet.connect(master);
  master.connect(ctx.destination);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  return {
    apply: (fx) => {
      low.gain.value = clamp(fx.low, -12, 12);
      mid.gain.value = clamp(fx.mid, -12, 12);
      high.gain.value = clamp(fx.high, -12, 12);
      const w = clamp(fx.reverb, 0, 1);
      reverbWet.gain.value = w;
      dry.gain.value = 1 - 0.35 * w;
      const e = clamp(fx.echo, 0, 1);
      echoWet.gain.value = e * 0.5;
      feedback.gain.value = e * 0.55;
    },
    resume: () => {
      if (ctx.state === "suspended") void ctx.resume();
    },
    dispose: () => {
      try {
        source.disconnect();
        master.disconnect();
      } catch {
        /* already torn down */
      }
      void ctx.close();
    },
  };
};
