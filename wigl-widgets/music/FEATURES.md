# music widget — what it does

The basics work like any player: search, click to play, the bar at the top is
now-playing with play/pause/skip, drag the timeline to seek. This page is the
stuff that isn't obvious.

## The queue is not fragile

A plain click on a track **plays it right now** — but in the default **Append**
mode the rest of your queue stays intact (the track is inserted after the
current one and skipped to). One misclick can't wipe your queue.

- The small **⇄ toggle** next to shuffle/repeat switches between **Append**
  (default — keep the tail) and **Replace** (a click clears the queue first).
- **Add to queue** (a track's **⋯** menu, or the detail-view button in Append
  mode) is the silent "queue it for later, don't interrupt" action.
- **Clear** (in the Up-next tab) is the only button that empties the queue,
  and it asks twice.

**Save a queue** you like: the **Save** button in the Up-next tab copies it to
a new playlist (named `queue - …`, rename it after) and confirms with a
"saved as …" flash. The queue keeps playing.

## Rows: the ⋯ menu and the inline shortcuts

A click (or double-click) anywhere on a track's main area always plays it —
even when the **⋯** panel is open, in which case the click also closes the
panel.

Hovering a track shows a couple of inline icons (add to queue, favourite) — on
a wider tile more of them appear. The **⋯** opens the full menu (icons with
hover tooltips): Play next, Add to queue, **Add to playlist** (pick one, or
"New playlist…"), Favourite, **{Track/Artist/Album} radio**, Go to artist, Go
to album — minus whatever's already shown as an inline icon, so nothing is
listed twice. On queue rows it also has Remove and Move to top/bottom (or just
drag rows to reorder).

The **now-playing bar** has the same menu (the ⋯ on the right).

## "Radio"

"Artist radio" / "Album radio" / "Track radio" opens a **generated mix** —
that seed plus similar tracks — as a playlist. It doesn't hijack your queue;
you get a Play button (which follows the Append/Replace toggle) and Add-to-queue
right there. Radio stations and already-generated mixes don't have this.

## Playlists

- **Create** from the Playlists tab, or from any track's ⋯ → Add to playlist →
  New playlist.
- Open a playlist to **rename** it, set a **background image** (a local file —
  it also becomes the playlist's cover in the list and the pinned strip),
  **pin** it to the strip above the tabs, or **delete** it (two-tap).
- **Merge**: a playlist's ⋯ menu → "Merge into…" appends all its tracks to
  another playlist.
- The "Smart" playlists (All favorited tracks, Recently played, …) are
  MA's — you can play them but not edit them.

## Search

- **Filter pills** above the results narrow by type (Stations / Tracks /
  Artists / …) and by source. The set is remembered.
- Results come in **per source** — RadioBrowser is near-instant, YouTube takes
  a second or two; a "searching…" strip shows while any source is still going,
  and the old results stay put until the new ones land.
- Recent searches show as **chips** under an empty search box.

## Info panel

The **ⓘ** on the now-playing bar folds down what's actually playing: source,
format (codec / sample rate / bitrate / loudness), album, year, genre,
performers/credits. Artist and credit names are clickable — they run a search.
Some fields are blank unless Music Assistant has a metadata provider configured
(MusicBrainz etc.).

## Playback speed

The **gauge** button on the now-playing bar folds out a speed slider
(0.5×–2×, pitch preserved). At anything other than 1× a small `1.25×` badge
shows on the timeline row — tap it to snap back to normal. Music Assistant
does the stretch server-side, so it survives skips and reconnects. Not
available for live radio.

## Effects

The **Effects** tab: a 4-band graphic EQ (vertical faders, ±12 dB, centre
detent) and a reverb, applied live on the audio. Opening the tab switches the
audio to the effects path automatically — playback blips once while it
reconnects, then picks up where it was. Reverb is obvious by 60–70%. **on/off** bypasses the whole chain but keeps your
fader positions; **reset** zeroes them. The tab-bar dot lights when the chain
is actually colouring the sound.

## Keyboard (when the widget has focus, not a text field)

`/` search · `space` play/pause · `←` `→` seek ±5 s · `n` `p` next/previous ·
`↑` `↓` move through the list · `enter` play the focused row · `a` add it to
the queue.

## Settings (right-click the desktop → Settings → Music)

Server host/port/login, a search-provider filter, "Auto-start server", the
audio-effects path toggle, and **Backend controls** — Restart / Clear cache /
Update server — so you never need a terminal for the Docker side. Setup and
recovery details are in `SETUP.md`.
