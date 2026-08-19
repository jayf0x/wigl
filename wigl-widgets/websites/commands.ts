import { isMacos, runCmd } from "@/wigl/utils";

/** Single-quote for `sh -c`, doubling any embedded single quote — same
 * pattern as wigl-widgets/repos/commands.ts. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The practical workaround for sites that refuse to render in any iframe
 * (X-Frame-Options/frame-ancestors) — hands the URL to the OS's real
 * browser instead. `open` on macOS, `xdg-open` on Linux, same
 * platform-detection pattern as `revealInFileManager`. */
export const openInBrowser = async (url: string): Promise<void> => {
  if (!url) return;
  const cmd = (await isMacos()) ? `open ${shQuote(url)}` : `xdg-open ${shQuote(url)}`;
  await runCmd("sh", ["-c", cmd]);
};
