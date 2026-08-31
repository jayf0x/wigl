# Manual: does sound actually come out?

`music.e2e.test.ts` proves everything up to "MA is streaming PCM to a client
that authenticated as this widget". The last hop — PCM → AudioContext →
speakers — only exists in a real browser, so it's checked by ear:

1. `docker start wigl-ma` (or the widget's "Auto-start server" setting)
2. Launch wigl (`bun run verify`), open the music widget
3. Type e.g. `lofi` in search, click a station
4. Within ~2s you should hear it. The now-playing title fills in and the
   header dot goes solid.

If it's silent but the title/queue updated (so the control path works):

- **Check the hidden sink element.** In the widget's webview devtools:
  `document.querySelector('audio[data-wigl-music]')` — it should exist,
  `.paused === false`, and `.srcObject` should be a `MediaStream`. If it's
  paused, the autoplay unlock didn't land — `unlock()` runs on the play
  click and on the transport buttons (`sendspin.ts`), check it's being
  called inside the gesture.
- **Codec.** The widget forces `codecs: ["pcm"]` (`music.config.ts`) so no
  decoder is involved. If MA logs a format-negotiation error, something
  rejected PCM — check `docker logs wigl-ma`.
- **Isolate the webview.** Drop a file at `.idea/test.m4a` (gitignored) and
  play it from a scratch `<audio>` in any widget to confirm the webview can
  produce sound at all, independent of MA/Sendspin.

`.idea/test.m4a` is a per-machine scratch file, not shipped — it's only for
that last isolation step.
