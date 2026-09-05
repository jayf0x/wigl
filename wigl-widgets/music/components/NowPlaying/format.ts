// Pure time/speed label formatters shared by Scrubber and SpeedControl.
export const fmt = (s: number) => {
  if (!s || s < 0 || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/** "1×" / "1.25×" — trailing zeros trimmed. */
export const fmtSpeed = (s: number) => `${Number(s.toFixed(2)).toString()}×`;
