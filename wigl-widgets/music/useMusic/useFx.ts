// ── G — FX: `applyFx` hits the live graph every move (cheap, ramped in
// audioGraph); `setFx` also persists and should be debounced by the caller
// so a drag doesn't round-trip through storage and fight the slider. ──────
import { useCallback, useMemo, useRef } from "react";
import { useStorage } from "@/wigl/hooks";
import { type AudioFx, DEFAULT_FX, type FxState, normalizeFx } from "../audioGraph";
import { KEYS } from "../music.config";

/** Owns the persisted 4-band EQ + reverb/echo state and the live Web Audio
 * graph reference. `fxRef` is populated by useConnection once the audio
 * element is attached (media-element output mode only) — this hook only
 * knows how to apply a value to whatever graph is currently there. */
export const useFx = () => {
  const [fxStored, setFxStored] = useStorage<FxState>(KEYS.fx, DEFAULT_FX);
  // Storage may still hold the pre-4-band `{low,mid,high,reverb,echo}` shape —
  // normalise on read so every consumer sees the current `FxState`.
  const fx = useMemo(() => normalizeFx(fxStored), [fxStored]);

  // G1 — the Web Audio FX graph, alive for the connection lifetime.
  const fxRef = useRef<AudioFx | null>(null);
  const fxValRef = useRef<FxState>(fx);
  fxValRef.current = fx;

  const applyFx = useCallback((next: FxState) => {
    fxRef.current?.apply(next);
  }, []);
  const setFx = useCallback(
    (next: FxState) => {
      setFxStored(next);
      fxRef.current?.apply(next);
    },
    [setFxStored],
  );

  return { fx, setFx, applyFx, fxRef, fxValRef };
};
