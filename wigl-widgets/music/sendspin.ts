// The audio half. Music Assistant's built-in web player is Sendspin (a
// push-PCM / Web-Audio protocol — see todo-musicplayer.md "Phase 0"), not an
// `<audio>` flow stream. We bundle MA's own client SDK and feed it a
// WebSocket we authenticated ourselves against the `/sendspin` proxy, so we
// never have to monkey-patch `window.WebSocket` the way MA's frontend does
// (a wigl widget shares one JS realm with its neighbours — hard rule 4).

import { loadSendspinClientIdentity, SendspinPlayer } from "@sendspin/sendspin-js";
import { SENDSPIN_CODECS } from "./music.config";

export interface SendspinState {
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  errored: boolean;
}

/** Open + authenticate the `/sendspin` proxy socket. Resolves once the
 * server has acknowledged (`{"type":"auth_ok"}`); the SDK adopts it from
 * there. */
const openAuthedSocket = (host: string, port: number, token: string, clientId: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/sendspin`);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Sendspin proxy handshake timed out"));
    }, 10_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token, client_id: clientId }));
    ws.onmessage = (e) => {
      clearTimeout(timer);
      let ok = false;
      try {
        ok = typeof e.data === "string" && JSON.parse(e.data).type === "auth_ok";
      } catch {
        /* fall through to reject */
      }
      // Hand the socket over cleanly — the SDK's adopt() installs its own
      // handlers next.
      ws.onmessage = null;
      ws.onopen = null;
      if (ok) resolve(ws);
      else reject(new Error("Sendspin proxy rejected auth"));
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Sendspin proxy socket error"));
    };
  });

export interface SendspinHandle {
  /** == the Music Assistant player_id / queue_id for this widget. */
  playerId: string;
  setVolume: (v: number) => void;
  /** Must be called from within a user gesture before first playback. */
  unlock: () => Promise<void>;
  disconnect: () => void;
}

/** Build, connect and auto-pair a Sendspin web player. `onState` fires on
 * every local/server state change; `onDrop` fires if the transport closes
 * (the hook rebuilds from scratch — adopted sockets don't self-reconnect). */
export const connectSendspin = async (opts: {
  host: string;
  port: number;
  token: string;
  clientName: string;
  pair: (pairingToken: string) => Promise<unknown>;
  onState: (s: SendspinState) => void;
  onDrop: () => void;
}): Promise<SendspinHandle> => {
  const identity = loadSendspinClientIdentity();
  const socket = await openAuthedSocket(opts.host, opts.port, opts.token, identity.clientId);

  const player = new SendspinPlayer({
    webSocket: socket,
    clientName: opts.clientName,
    // How MA recognises us as its built-in web player (auto-trusted, no
    // operator pairing step) rather than a third-party device.
    productName: "Web Player",
    codecs: [...SENDSPIN_CODECS],
    // Single local device — never pitch-shift to chase a group clock.
    correctionMode: "quality-local",
    minBufferMs: 500,
    requiredLeadTimeMs: 250,
    onStateChange: (s) =>
      opts.onState({
        isPlaying: s.isPlaying,
        volume: s.volume,
        muted: s.muted,
        errored: s.playerState === "error",
      }),
    onPairing: (event, detail) => console.debug("[music] sendspin pairing", event, detail ?? ""),
  });

  let dropped = false;
  const fireDrop = () => {
    if (dropped) return;
    dropped = true;
    opts.onDrop();
  };
  socket.addEventListener("close", fireDrop);

  await player.connect();

  // Auto-pair: the token names the client, so MA can pair us with no operator
  // step. Best-effort — a "Web Player" also gets guest-trusted server-side, so
  // playback works even if this call loses a race.
  if (player.pairingToken) {
    opts.pair(player.pairingToken).catch((e) => console.warn("[music] auto-pair failed", e));
  }

  return {
    playerId: player.clientId,
    setVolume: (v) => player.setVolume(v),
    unlock: () => player.unlock(),
    disconnect: () => {
      dropped = true;
      socket.removeEventListener("close", fireDrop);
      player.disconnect("user_request");
    },
  };
};
