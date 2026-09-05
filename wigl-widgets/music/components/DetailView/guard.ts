// Shared fetch-and-fall-back-on-error wrapper for the artist/album/playlist
// detail views' useQuery `fn`s.
export const guard = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    console.warn("[music] detail fetch", e);
    return fallback;
  }
};
