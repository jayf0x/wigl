# music widget — backend setup

The `music` widget is a player + control surface for a **local Music Assistant
(MA) server**. It has no backend of its own; MA does search, the queue, and the
audio (streamed to the widget over MA's Sendspin web-player protocol). This doc
is the exact, reproducible setup. Architecture and API details are in
`todo-musicplayer.md`.

We run a **community MA image** — `ghcr.io/sproft/ytmusic-free-provider` — which
is the stock MA server plus one extra provider, `ytmusic_free`, giving free
no-account YouTube Music (search + playback via `yt-dlp`, the same technique
NewPipe/SimpMusic use). Everything else (RadioBrowser, the queue, Sendspin) is
stock MA and unaffected. See "About the YouTube provider" at the bottom for the
tradeoffs.

## Prerequisites

- **Docker Desktop** running (`/usr/local/bin/docker` on this machine).
- ~3 GB disk for the image, plus a bit for MA's data.
- Ports **8095** and **8097** free on localhost.

## One-time setup

```bash
# 1. Pull the image
docker pull ghcr.io/sproft/ytmusic-free-provider:latest

# 2. Create + start the container. The data volume can live anywhere;
#    this repo uses .idea/ma-data (gitignored). MA-in-Docker sees it as /data.
docker run -d --name wigl-ma \
  --restart unless-stopped \
  -p 8095:8095 -p 8097:8097 \
  -v "$(git rev-parse --show-toplevel)/.idea/ma-data:/data" \
  ghcr.io/sproft/ytmusic-free-provider:latest

# 3. Wait ~15s for first boot (it downloads a torch checkpoint once), then
#    onboard. MA requires an 8-char minimum password.
curl -s -X POST http://127.0.0.1:8095/setup \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"testtest","display_name":"test"}'
```

Then add the two music providers. Either in the MA web UI at
**http://127.0.0.1:8095** (log in `test` / `testtest` → Settings → Music
sources → Add) — add **RadioBrowser** and **YouTube Music (Free)**, neither
needs credentials — or via the API:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8095/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"provider_id":"builtin","credentials":{"username":"test","password":"testtest"}}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

for domain in radiobrowser ytmusic_free; do
  curl -s -X POST http://127.0.0.1:8095/api -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"command\":\"config/providers/setup\",\"args\":{\"provider_domain\":\"$domain\"}}"
  echo
done
```

The `ytmusic_free` instance gets an id like `ytmusic_free--iB4KsJ6x` (MA
suffixes multi-instance providers). That's expected; the widget matches on the
`ytmusic` prefix.

## Verify

```bash
# providers loaded?
curl -s -X POST http://127.0.0.1:8095/api -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"command":"config/providers"}' \
  | python3 -c 'import sys,json;print([p["instance_id"] for p in json.load(sys.stdin)["result"] if p["type"]=="music" and p["enabled"]])'
# → ['builtin', ..., 'radiobrowser', 'ytmusic_free--XXXXXXXX']
```

Then in wigl: open the music widget, search something (`daft punk`), play a
result. The header dot goes solid; now-playing + progress fill in. Whether
sound actually reaches the speakers is a by-ear check — see
`tests/audio-check.md` if it's silent.

`wigl-widgets/music/tests/music.e2e.test.ts` (`wigl test widgets`) also checks
the login / search-shape / audio-proxy / YouTube path live, skipping when MA is
down.

## Day to day

| Task | Command |
|------|---------|
| Stop MA | `docker stop wigl-ma` |
| Start MA | `docker start wigl-ma` (also automatic when Docker starts, via `--restart`) |
| Logs | `docker logs -f wigl-ma` |
| Update MA + provider | `docker pull ghcr.io/sproft/ytmusic-free-provider:latest && docker rm -f wigl-ma && <the `docker run` above>` — the `/data` volume keeps your onboarding + providers |
| Provider version | `docker logs wigl-ma 2>&1 \| grep 'provider version'` |

The widget's Settings has an **"Auto-start server"** toggle (off by default)
that runs `docker start wigl-ma` when MA is unreachable — a small convenience
on top of the `--restart` policy, not a replacement for this setup.

## Reverting to stock Music Assistant

```bash
docker rm -f wigl-ma
docker run -d --name wigl-ma --restart unless-stopped \
  -p 8095:8095 -p 8097:8097 \
  -v "$(git rev-parse --show-toplevel)/.idea/ma-data:/data" \
  ghcr.io/music-assistant/server:latest
# then remove the ytmusic_free provider in the MA UI (it'll show as failed)
docker rmi ghcr.io/sproft/ytmusic-free-provider    # optional, reclaims ~3 GB
```

## Optional: YouTube Music library sync

Anonymous mode covers search + playback. A browser cookie additionally unlocks
your liked songs / playlists / subscriptions and the personalized home feed.
In the MA UI → the "YouTube Music (Free)" entry → Authentication → Browser
cookie, then paste the `Cookie:` request header from a logged-in
`music.youtube.com` tab (grab it in an incognito window and **don't log out** —
closing the window keeps it valid). Full steps:
<https://github.com/sproft/ytmusic-free-provider#authentication-optional>

## Troubleshooting

- **Docker CLI hangs on `start`/`rm`/`run`** (seen once on this machine): the
  daemon still answers reads on the unix socket but lifecycle calls hang.
  Restart Docker Desktop — that clears it.
- **No sound** — `tests/audio-check.md`.
- **YouTube stops working** — Google shipped a player change; `docker pull` a
  fresh image (the `:latest` tag rolls forward). If it persists, it's a
  `ytmusic_free` bug: report at
  <https://github.com/sproft/ytmusic-free-provider/issues> — **not** to the
  Music Assistant project, which does not support this provider.
- **Onboarding lost after `docker rm`** — the `-v …/.idea/ma-data:/data` mount
  was missing or pointed somewhere else. That directory *is* the persistent
  state.

## About the YouTube provider

`ytmusic_free` is an independent MIT project, not part of Music Assistant. It
uses YouTube's internal (unofficial) APIs, which is against YouTube's ToS — as
is every free YouTube option. Upsides over MA's built-in YouTube Music provider:
no paid subscription, **no Google account, no cookie** (so nothing tying
playback to an identity — your home IP is exposed to YouTube exactly as a
browser visit would be). Downsides: occasional breakage on Google's cadence
(fixed by pulling a new image), premium-only content (offline, hi-res)
unavailable, and the MA team won't help debug it.
