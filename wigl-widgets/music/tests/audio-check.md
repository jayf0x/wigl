# Manual: does sound actually come out?

`music.e2e.test.ts` proves everything up to "MA is streaming PCM to a client
that authenticated as this widget". The last hop — PCM → AudioContext →
speakers — only exists in a real browser, so it's checked by ear:

1. `docker start wigl-ma` (or the widget's "Auto-start server" setting)
2. Launch wigl (`bun run verify`), open the music widget
3. Type e.g. `lofi` in search, click a station
4. Within ~2s you should hear it. The now-playing title fills in and the
   header dot goes solid.

If it's silent but the title/queue updated (so the control path works), in
rough order of likelihood:

1. **Flip the output mode.** `SENDSPIN_OUTPUT` in `music.config.ts`: switch
   `"direct"` → `"media-element"` (or back), then `bun run widget:install
   wigl-widgets/music` and reload widgets. "direct" avoids a WebKit media
   process (an unsigned dev build can't get the `WebKit Media Playback` RBS
   assertion — you'll see that warning in `log show` either way, it's only
   load-bearing for background suspension); "media-element" is the path
   WebKit blesses but is unproven for an always-on-bottom window.
2. **In "media-element" mode, check the sink.** Widget webview devtools:
   `document.querySelector('audio[data-wigl-music]')` should exist, be
   `.paused === false`, `.srcObject` a `MediaStream`. Paused → the autoplay
   unlock didn't land (it runs on the play click + transport buttons).
3. **Codec.** The widget forces `codecs: ["pcm"]` so no decoder is involved.
   `docker logs wigl-ma` for a format-negotiation error.
4. **Isolate the webview.** Drop a file at `.idea/test.m4a` (gitignored) and
   play it from a scratch `<audio>` in any widget — confirms the webview can
   make sound at all, independent of MA/Sendspin.

`.idea/test.m4a` is a per-machine scratch file, not shipped — it's only for
that last isolation step.
