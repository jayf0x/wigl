/** "3m" / "2h" / "5d" / "1w" from an epoch-seconds timestamp — pure formatting,
 * no ticking. For a label that keeps itself current, use `useRelativeTime`
 * from `@/wigl/hooks` instead. */
export const relativeTime = (epochSeconds: number) => {
  if (!epochSeconds) return "?";
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
};
