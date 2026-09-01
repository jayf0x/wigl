# music widget — what it does

The basics work like any player: search, click to play, the bar at the top is
now-playing with play/pause/skip, drag the timeline to seek. This page is the
stuff that isn't obvious.

## The queue is not fragile

A plain click on a track **adds it to the end of the queue** and doesn't touch
what's already there — one misclick can't wipe your queue. To change that:

- The small **⇄ toggle** next to shuffle/repeat switches between **Append**
  (default) and **Replace** (a click clears the queue and plays).
- Every track's **⋯ menu** always has **Play now** (jump to it, keep the rest)
  and **Play next** regardless of the toggle.
- **Clear** (in the Up-next tab) is the only button that empties the queue,
  and it asks twice.

**Save a queue** you like: the **Save** button in the Up-next tab copies it to
a new playlist (named `queue - …`, rename it after). The queue keeps playing.

## Rows: the ⋯ menu and the inline shortcuts

Hovering a track shows a couple of inline icons (add to queue, favourite) — on
a wider tile more of them appear. The **⋯** opens the full menu: Play next,
Add to queue, **Add to playlist** (pick one, or "New playlist…"), Favourite,
**{Track/Artist/Album} radio**, Go to artist, Go to album. On queue rows it
also has Remove and Move to top/bottom (or just drag rows to reorder).

The **now-playing bar** has the same menu (the ⋯ on the right).

## "Radio"

"Artist radio" / "Album radio" / "Track radio" opens a **generated mix** —
that seed plus similar tracks — as a playlist. It doesn't hijack your queue;
you get a Play button (which follows the Append/Replace toggle) and Add-to-queue
right there. Radio stations and already-generated mixes don't have this.

## Playlists

- **Create** from the Playlists tab, or from any track's ⋯ → Add to playlist →
  New playlist.
- Open a playlist to **rename** it, set a **background image** (a local file),
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

## Effects

The **Effects** tab: a 3-band EQ, reverb, and echo, applied live. It needs the
media-element audio path — the tab offers a one-tap switch (playback blips
while it reconnects). There's no speed control (a technical limit of how the
audio is streamed). Turn everything back to zero (or hit reset) and switch the
path back for the lowest-latency output.

## Keyboard (when the widget has focus, not a text field)

`/` search · `space` play/pause · `←` `→` seek ±5 s · `n` `p` next/previous ·
`↑` `↓` move through the list · `enter` play the focused row · `a` add it to
the queue.

## Settings (right-click the desktop → Settings → Music)

Server host/port/login, a search-provider filter, "Auto-start server", the
audio-effects path toggle, and **Backend controls** — Restart / Clear cache /
Update server — so you never need a terminal for the Docker side. Setup and
recovery details are in `SETUP.md`.
