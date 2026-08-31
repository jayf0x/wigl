# Global deps

CLI tools/packages installed **outside** this repo's own `node_modules`
(globally via `bun`/`npm`, or via the OS package manager) that something
here — a widget, a script — actually depends on. Kept so a global install
can be found and removed later if the thing that needed it goes away, and so
"can I use this library" questions can check what's already on the machine
before reaching for `bun add`.

One line per dep: what it is, how it got installed, what depends on it.
Delete the line when nothing here depends on it anymore.

- **Music Assistant server** — runs as a Docker container, not installed on
  the host. Image `ghcr.io/sproft/ytmusic-free-provider:latest` (stock MA
  2.10.1 + the community `ytmusic_free` provider for free no-account YouTube
  Music, ~3 GB), container `wigl-ma` (`--restart unless-stopped`), ports
  `8095`/`8097` on localhost, data in `.idea/ma-data/` (gitignored). Depended
  on by `wigl-widgets/music` (control WS + Sendspin audio proxy). **Full
  setup + revert steps: `wigl-widgets/music/SETUP.md`.** Requires Docker
  Desktop (`/usr/local/bin/docker` here). Remove entirely: `docker rm -f
  wigl-ma && docker rmi ghcr.io/sproft/ytmusic-free-provider
  ghcr.io/music-assistant/server` and delete `.idea/ma-data/`.
- **opencode** — installed globally via `bun` (binary resolves to
  `~/.bun/bin/opencode` on the machine this was set up on — see
  `wigl-widgets/LocalCode/serverProcess.ts`'s `OPENCODE_CANDIDATES` for the
  full PATH fallback list it's looked up through). Depended on by
  `wigl-widgets/LocalCode` (`opencode serve`, driven over HTTP+SSE — see its
  `AGENTS.md`). Check `opencode --version` / `which opencode` before
  assuming this is still accurate on a different machine.
