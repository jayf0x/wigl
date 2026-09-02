# TODO — playback speed (server-side `atempo`)

Owner decision (this session): ship speed control **server-side**. The widget
sends one command; Music Assistant does the time-stretch in its own ffmpeg
chain. No new widget audio pipeline, nothing runs at 1×, Sendspin transport
unchanged. This supersedes the old "Blocked — playback speed" entry in
`backlog-music.md`.

Pitch preservation is not required by the owner, but `atempo` preserves pitch
anyway — free.

## Why this shape (context for the implementer)

- MA **already** time-stretches: `player_queues/set_playback_speed` →
  `queue_item.extra_attributes["playback_speed"]` → `atempo=` ffmpeg filter,
  wired through flow mode, crossfade, and elapsed-time correction
  (`controllers/streams/audio.py`, `get_queue_item_stream(playback_speed=…)`).
- It is gated to audiobooks/podcasts by **one line** in
  `music_assistant/controllers/player_queues/controller.py` (the
  `set_playback_speed` method, ~line 465 in the MA version cloned this
  session):

  ```py
  if queue_item.media_type not in (MediaType.AUDIOBOOK, MediaType.PODCAST_EPISODE):
      raise InvalidCommand("Variable playback speed is only supported for audiobooks…")
  ```

  That is a product choice, not a capability limit. Removing it unlocks speed
  for music tracks with zero other MA changes.
- The Sendspin SDK's `trackProgress` **already** compensates position for
  `playback_speed` (MA sends it in `ServerStateMetadata.progress.playback_speed`,
  ×1000; `core/core.js` `get trackProgress()` uses it). So the widget's
  scrubber needs **no clock changes** — `api.getProgress().position` stays
  correct automatically once MA reports a non-1× speed.

## Part 1 — MA-side: unlock the command

We do not build the MA image (`ghcr.io/sproft/ytmusic-free-provider:latest`).
Patch the running container. Two options — **prefer A** (least fragile, no
rebuild):

### Option A — `sitecustomize.py` monkeypatch (recommended)

`@api_command` only tags the function with attributes; the webserver scans
class members for `.api_cmd` at startup, well after interpreter init. So a
`sitecustomize.py` on `sys.path` that replaces the method before the scan
works cleanly.

1. New file `SETUP-files/sitecustomize.py` in this widget folder (or wherever
   `SETUP.md` keeps mount assets):

   ```python
   # wigl: allow player_queues/set_playback_speed for music tracks, not just
   # audiobooks/podcasts. MA gates it by media_type as a product choice; the
   # atempo machinery underneath is fully general.
   # Pinned to MA behaviour as of <git sha / date>. Re-check after `docker pull`.
   import time
   from music_assistant.common.models.enums import PlaybackState
   from music_assistant.common.models.errors import InvalidCommand, QueueEmpty, InvalidDataError
   from music_assistant.controllers.player_queues.controller import PlayerQueuesController

   async def _set_playback_speed(self, queue_id, speed, queue_item_id=None):
       if not (0.5 <= speed <= 3.0):
           raise InvalidDataError(f"Playback speed must be between 0.5 and 3.0, got {speed}")
       queue = self._queue_data[queue_id].queue
       if not queue.current_item:
           raise QueueEmpty("Cannot set playback speed: queue is empty")
       queue_item_id = queue_item_id or queue.current_item.queue_item_id
       queue_item = self.get_item(queue_id, queue_item_id)
       if not queue_item:
           raise InvalidDataError(f"Queue item {queue_item_id} not found in queue")
       # (media_type gate deliberately removed)
       if not queue_item.duration:
           raise InvalidCommand("Cannot set playback speed for items with unknown duration")
       current_speed = float(queue_item.extra_attributes.get("playback_speed") or 1.0)
       if abs(current_speed - speed) < 0.001:
           return
       queue_item.extra_attributes["playback_speed"] = speed
       if queue.current_item and queue.current_item.queue_item_id == queue_item_id:
           if queue.state == PlaybackState.PLAYING:
               queue.elapsed_time = queue.corrected_elapsed_time
               queue.elapsed_time_last_updated = time.time()
           queue.playback_speed = speed
       self.signal_update(queue_id)
       if queue.state == PlaybackState.PLAYING:
           await self.resume(queue_id)

   # carry the api_command attributes across so the scanner still registers it
   for attr in ("api_cmd", "api_authenticated", "api_required_scope",
                "api_allow_impersonation", "api_alias"):
       if hasattr(PlayerQueuesController.set_playback_speed, attr):
           setattr(_set_playback_speed, attr, getattr(PlayerQueuesController.set_playback_speed, attr))
   PlayerQueuesController.set_playback_speed = _set_playback_speed
   ```

   **Verify the import paths** (`InvalidCommand` etc.) against the cloned MA
   source before committing — they moved around historically. Clone with
   `git clone --depth 1 https://github.com/music-assistant/server` and diff
   the real `set_playback_speed` body into the sketch above.

2. `SETUP.md` `docker run` gains:

   ```
   -v "$(pwd)/sitecustomize.py":/app/venv/lib/python3.14/site-packages/sitecustomize.py:ro \
   ```

   (Confirm the python minor version — `docker run --rm <image> python -V`.
   It was 3.14 in the cloned source's `pyproject.toml`. If it drifts, a
   version-agnostic mount is `-e PYTHONPATH=/wigl-patch` +
   `-v "$(pwd)/wigl-patch":/wigl-patch:ro` holding `sitecustomize.py`.)

3. The `PYTHONPATH` form is the safer one — do that, not the site-packages
   path. Update `SETUP.md`'s "Update MA" one-liner note to mention re-checking
   this file after a pull.

### Option B — derived image (fallback if monkeypatch proves brittle)

`SETUP.md` ships a 3-line `Dockerfile`:

```dockerfile
FROM ghcr.io/sproft/ytmusic-free-provider:latest
RUN sed -i 's/if queue_item.media_type not in (MediaType.AUDIOBOOK, MediaType.PODCAST_EPISODE):/if False:/' \
    /app/venv/lib/python*/site-packages/music_assistant/controllers/player_queues/controller.py
```

Rejected as primary because it adds a `docker build` step to a setup that is
currently one `docker run`.

## Part 2 — widget side

All in `useMusic.ts` + one small UI control. Model it on the existing
`repeatMode` / `cycleRepeat` pair.

1. **`MusicApi`** (`useMusic.ts` ~line 67):
   ```ts
   /** 0.5–3.0; 1 = normal. Server-side atempo (see todo-speed.md). */
   playbackSpeed: number;
   setPlaybackSpeed: (speed: number) => void;
   ```

2. **State**: `const [playbackSpeed, setPlaybackSpeed_] = useState(1);`
   next to `repeatMode`/`shuffle` (~line 211).

3. **Read it back** in `refreshQueue` (~line 291, alongside
   `setRepeatMode`/`setShuffle`):
   ```ts
   setPlaybackSpeed_(Number(q.playback_speed) || 1);
   ```
   Add `playback_speed?: number` to the `PlayerQueue` type in `types.ts`
   (~line 127, near `flow_mode`). **Verify** `player_queues/get` actually
   returns `playback_speed` at the queue level — if not, read it from the
   current item's `extra_attributes.playback_speed` via
   `player_queues/items`, or from the `queue_updated` event payload.

4. **Action** (~line 690, model on `cycleRepeat`):
   ```ts
   const setPlaybackSpeed = useCallback((speed: number) => {
     const s = Math.min(3, Math.max(0.5, speed));
     setPlaybackSpeed_(s);                       // optimistic
     cmd("player_queues/set_playback_speed", { queue_id: queueId, speed: s });
   }, [cmd, queueId]);
   ```
   `queueId` is `audio.playerId` — check how `cmd` callers get it (the seek
   handler at ~line 685 is the closest example; it may close over it).

5. **Return + deps array** (~line 1002): add `playbackSpeed`, `setPlaybackSpeed`.

6. **Reconnect re-assert** (optional, ~line 465 `playIntentRef` block): if
   `playbackSpeedRef.current !== 1` after a reconnect, re-send
   `set_playback_speed`. `extra_attributes` is per-queue-item and in-memory,
   so a track change or server restart drops it. Cheap insurance; mirror the
   `playIntentRef` pattern (ref written in effect cleanup, replayed on
   reconnect).

7. **UI** — smallest thing that works, owner wants it unobtrusive:
   - A `0.5×–2×` (cap the slider below the command's 3× hard max — 2× is the
     musically useful range) control in the `⋯` `RowActionPanel` on
     `NowPlaying`, OR a compact stepper in the Effects tab next to the EQ.
   - Show a speed badge on the scrubber row **only when `playbackSpeed !== 1`**
     (e.g. `0.8×`), tappable to reset. No always-visible chrome at 1×.
   - Reuse `.mx-press` / `.mx-tap` motion classes like the other transport
     controls. Theme tokens only.
   - Disable / hide it when `now` is radio (`currentItem?.media_type` is
     `radio`, or `now.duration === 0`) — atempo on a live radio stream has the
     same realtime ceiling as everything else; not worth it.

8. **Scrubber**: no change needed. `api.getProgress()` (SDK `trackProgress`)
   already scales by MA's reported `playback_speed`. **Verify after wiring**:
   at 0.8×, the scrubber thumb should track the audible position, and
   `now.duration` should stay the real track length (media-time). If
   `now.elapsed` (from `queue_time_updated`, `useMusic.ts:446`) drifts against
   `getProgress().position`, MA is sending stream-time there — scale it by
   `1/playbackSpeed` in the event handler, or just prefer `getProgress()` for
   display (NowPlaying already samples it on a tick).

## Verification

- `docker run` with the mount → `docker exec wigl-ma python -c "from
  music_assistant.controllers.player_queues.controller import
  PlayerQueuesController as C; print(C.set_playback_speed.__module__)"` →
  should print `sitecustomize`, not the MA module.
- Play a track, send `set_playback_speed {queue_id, speed: 0.8}` (via the UI
  or `wscat` against `/ws`). Audio slows, no error, no disconnect.
- Scrubber + time labels stay coherent (see step 8).
- Test with crossfade **off** first. Then flip MA's crossfade on and confirm
  transitions still work (`audio.py` has `fade_in_playback_speed` handling —
  should be fine, but check).
- `next` / `previous` / `seek` during non-1× playback behave.
- Reconnect (toggle output mode in Settings) → speed re-asserts (step 6) or is
  cleanly back to 1×.
- Radio: speed control absent/disabled.
- `bun run typecheck` + `bun run typecheck:widgets` + `bun run widget:verify
  wigl-widgets/music` + `bun run wigl test widgets`. `bun run verify` for the
  visual QA build.
- Grow `tests/music.e2e.test.ts` for the new MA command (per
  `backlog-music.md` "How to work this list").

## Docs to update in the same change

- **`state.md`**: the audio paragraph (~line 58) currently says speed is
  "physically impossible in-widget" and "Needs an audio-transport change" —
  rewrite: speed is shipped **server-side** via `set_playback_speed` + a
  container `sitecustomize.py` patch; Sendspin/transport untouched; the
  "impossible in-widget" note stays true *for the client-side path* but is no
  longer the whole story. Update "Locked decisions" (~line 184) similarly:
  speed is no longer blocked; the locked part is "no client-side audio
  pipeline / Sendspin stays the transport", which this respects.
- **`SETUP.md`**: the mount + the "re-check after pull" note (Part 1).
- **`backlog-music.md`**: delete the "Blocked — playback speed" section.
- **`FEATURES.md`** / `COMPARISON.md`: add speed to the feature list if they
  enumerate transport controls.
- Delete **this file** once shipped.

## If the container patch is rejected

Fallback is client-side **slow-down only** (0.5–1.0×), no speed-up. Sketch,
in rough order of fiddliness:

1. `SendspinCore.onAudioData` PCM tap → growing ring buffer (`chunk.samples`
   is `Float32Array[]` per channel, `chunk.sampleRate`, `chunk.generation`
   bumps per track).
2. Play the ring at `rate` through an `AudioBufferSourceNode` /
   `AudioWorklet`; chipmunk is acceptable (no pitch dep). Silence the SDK
   scheduler (volume 0) but keep the connection for transport + metadata.
3. **Own position clock** = samplesDrained / sampleRate; feed it to the
   scrubber when `rate !== 1` (override `getProgress()`).
4. **Metadata swap by generation**: queue MA's now-playing payloads keyed by
   `chunk.generation`; surface the one whose generation you're currently
   draining, so title/art match the audio (they'd otherwise flip
   `(1-rate)×duration` early — ~48 s at 0.8×).
5. **Buffer growth**: keeping the SDK scheduler as MA's consumption signal
   means the ring grows unbounded over a long queue (MA stays 30 s ahead of
   realtime; you fall further behind each track). Fix = run `SendspinCore`
   without `AudioScheduler` so your drain is the pacing signal — this is the
   one genuinely hard piece (MA backpressure feedback lives in the scheduler,
   not the core; `providers/sendspin/playback.py` `_PRODUCER_BUFFER_LIMIT_US`
   = 30 s server cap).
6. Transport: pause both, flush-and-refill the ring on skip.

Est. a few hundred lines, one worklet, no dep. Server-side is smaller and has
none of 3–5.
