// G — a small Web Audio effect chain tapped off the Sendspin hidden <audio>
// element (only possible in "media-element" output mode — see music.config.ts).
// Crib from /Users/me/Documents/GitHub/audio-bonanza's content.js, trimmed to
// what fits a compact widget: a 4-band graphic EQ (peaking filters) + a
// synthesised-impulse reverb. Echo was cut (feedback G).
//
// No playback-speed control here: the SDK feeds the element a live MediaStream
// (`srcObject`), and the HTML spec has `HTMLMediaElement.playbackRate` ignored
// for a MediaStream source. `player_queues/set_playback_speed` is audiobook-
// only ("Invalid or unsupported command" for a normal player). Real time-
// stretch needs a phase-vocoder AudioWorklet — parked, see backlog-music.md
// "Playback speed".
//
// The graph lives for the whole connection — `useMusic` owns its lifecycle;
// the FX tab only moves the knobs.
//
// P0.4 — the Sendspin SDK's "media-element" output is a MediaStream assigned to
// `<audio>.srcObject` (scheduler.js: gain → createMediaStreamDestination →
// el.srcObject), NOT a `src=` URL. On WebKit `createMediaElementSource` on a
// srcObject-backed element produces silence; the working tap is
// `createMediaStreamSource(el.srcObject)`. The element is then muted so the
// processed graph is the only audible path. `srcObject` is set lazily by the
// SDK (first stream), so we hook the source up once it appears.

/** Peaking-filter centre frequencies, low → high. */
export const BAND_HZ = [80, 400, 2000, 8000] as const;
export const BAND_COUNT = BAND_HZ.length;
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export interface FxState {
  /** per-band peaking gain in dB, EQ_MIN_DB..EQ_MAX_DB — length BAND_COUNT */
  bands: number[];
  /** 0..1 reverb wet mix */
  reverb: number;
  /** whole chain bypassed (dry passthrough) while keeping the values above */
  bypass: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const DEFAULT_FX: FxState = { bands: Array(BAND_COUNT).fill(0), reverb: 0, bypass: false };

/** Tolerate both the current shape and the legacy `{low,mid,high,reverb,echo}`
 * one still sitting in some users' storage blobs. */
// biome-ignore lint/suspicious/noExplicitAny: parsing an untyped storage value
export const normalizeFx = (v: any): FxState => {
  if (!v || typeof v !== "object") return { ...DEFAULT_FX, bands: [...DEFAULT_FX.bands] };
  let bands: number[];
  if (Array.isArray(v.bands)) {
    bands = Array.from({ length: BAND_COUNT }, (_, i) =>
      typeof v.bands[i] === "number" ? clamp(v.bands[i], EQ_MIN_DB, EQ_MAX_DB) : 0,
    );
  } else {
    // legacy low/mid/high → spread across the 4 bands (mid feeds both middles)
    const n = (x: unknown) => (typeof x === "number" ? clamp(x, EQ_MIN_DB, EQ_MAX_DB) : 0);
    bands = [n(v.low), n(v.mid), n(v.mid), n(v.high)];
  }
  return {
    bands,
    reverb: typeof v.reverb === "number" ? clamp(v.reverb, 0, 1) : 0,
    bypass: !!v.bypass,
  };
};

/** True when the EQ is flat and reverb is off (regardless of `bypass`). */
export const fxIsFlat = (fx: FxState): boolean => fx.bands.every((b) => b === 0) && fx.reverb === 0;

/** True when the chain is actually colouring the sound right now. */
export const fxIsActive = (fx: FxState): boolean => !fx.bypass && !fxIsFlat(fx);

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

/** Route `el`'s audio through EQ (4 peaking bands) → (dry + reverb) →
 * destination. Call once per element. Param changes are ramped with
 * `setTargetAtTime` so a fast slider drag never zippers. */
export const attachAudioFx = (el: HTMLAudioElement): AudioFx => {
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();

  const bands = BAND_HZ.map((hz) => {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = hz;
    f.Q.value = 1;
    f.gain.value = 0;
    return f;
  });

  const dry = ctx.createGain();
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 2.8, 2.0);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = 0;
  const master = ctx.createGain();

  // (source) → band0 → … → bandN → dry → master → destination
  //                              └→ reverb → reverbWet ┘
  for (let i = 0; i < bands.length - 1; i++) bands[i].connect(bands[i + 1]);
  const tail = bands[bands.length - 1];
  tail.connect(dry);
  dry.connect(master);
  tail.connect(reverb);
  reverb.connect(reverbWet);
  reverbWet.connect(master);
  master.connect(ctx.destination);

  // Hook the source in once the SDK has assigned a MediaStream to el.srcObject.
  // WebKit needs createMediaStreamSource here, not createMediaElementSource.
  let source: AudioNode | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  const connectSource = () => {
    if (source) return;
    const stream = (el as HTMLMediaElement).srcObject;
    try {
      if (stream instanceof MediaStream && stream.getAudioTracks().length) {
        source = ctx.createMediaStreamSource(stream);
        el.muted = true; // graph is the only audible path now
      } else if (!stream && el.currentSrc) {
        source = ctx.createMediaElementSource(el);
      } else {
        return;
      }
    } catch (e) {
      console.warn("[music] FX source tap failed", e);
      return;
    }
    source.connect(bands[0]);
    if (poll) clearInterval(poll);
    void ctx.resume();
  };
  connectSource();
  if (!source) poll = setInterval(connectSource, 250);

  // ~20ms time-constant: smooth to the ear, still tracks a drag closely.
  const TC = 0.02;
  const ramp = (p: AudioParam, target: number) => {
    const t = ctx.currentTime;
    p.setTargetAtTime(target, t, TC);
  };

  return {
    apply: (fx) => {
      if (ctx.state === "suspended") void ctx.resume();
      connectSource(); // no-op once tapped; catches a late srcObject on first knob move
      const on = !fx.bypass;
      bands.forEach((b, i) => ramp(b.gain, on ? clamp(fx.bands[i] ?? 0, EQ_MIN_DB, EQ_MAX_DB) : 0));
      const w = on ? clamp(fx.reverb, 0, 1) : 0;
      // Makeup on the wet path + a deeper dry cut so 100% is unmistakably wet.
      ramp(reverbWet.gain, w * 1.8);
      ramp(dry.gain, 1 - 0.5 * w);
    },
    resume: () => {
      if (ctx.state === "suspended") void ctx.resume();
      connectSource();
    },
    dispose: () => {
      if (poll) clearInterval(poll);
      try {
        el.muted = false;
        source?.disconnect();
        master.disconnect();
      } catch {
        /* already torn down */
      }
      void ctx.close();
    },
  };
};
