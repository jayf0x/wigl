// Thin client over Music Assistant's control WebSocket (`/ws`). One socket,
// message_id request/response correlation, plus an event fan-out. The exact
// handshake and command shapes are in state.md ("Runtime shape" +
// "MA command cheatsheet") and, live, at `/api-docs/commands.json`.

export interface MaEndpoint {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface MaEvent {
  event: string;
  object_id?: string;
  data?: unknown;
}

const httpBase = (e: MaEndpoint) => `http://${e.host}:${e.port}`;

/** POST /auth/login → short-lived bearer token. Thrown errors surface as an
 * "offline" state upstream, not a crash. */
export const login = async (e: MaEndpoint): Promise<string> => {
  const info = await fetch(`${httpBase(e)}/info`).then((r) => r.json());
  if (info.onboard_done === false) {
    // Fresh server — do first-run onboarding with the configured creds.
    const res = await fetch(`${httpBase(e)}/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: e.username, password: e.password, display_name: e.username }),
    }).then((r) => r.json());
    if (res.token) return res.token as string;
  }
  const res = await fetch(`${httpBase(e)}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider_id: "builtin",
      credentials: { username: e.username, password: e.password },
    }),
  }).then((r) => r.json());
  if (!res.token) throw new Error(res.details || "Music Assistant login failed");
  return res.token as string;
};

export class MaClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private listeners = new Set<(ev: MaEvent) => void>();
  private token = "";

  constructor(
    private endpoint: MaEndpoint,
    private onClose: () => void,
  ) {}

  /** Resolves once the socket is open and authenticated. Rejects (and tears
   * its own socket down) on any failure before that — the caller owns the
   * reconnect, so a failed connect must not also fire `onClose`. */
  async connect(): Promise<void> {
    this.token = await login(this.endpoint);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.endpoint.host}:${this.endpoint.port}/ws`);
      this.ws = ws;
      let settled = false;
      let gotServerInfo = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        ws.onclose = null;
        ws.close();
        reject(new Error(msg));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (!gotServerInfo && msg.server_version) {
          gotServerInfo = true;
          ws.send(JSON.stringify({ message_id: "auth", command: "auth", args: { token: this.token } }));
          return;
        }
        if (msg.message_id === "auth") {
          if (msg.result?.authenticated) {
            settled = true;
            resolve();
          } else {
            fail(msg.details || "auth rejected");
          }
          return;
        }
        this.dispatch(msg);
      };
      ws.onerror = () => fail("Music Assistant WebSocket error");
      ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error("connection closed"));
        this.pending.clear();
        this.onClose();
      };
    });
  }

  get authToken(): string {
    return this.token;
  }

  private dispatch(msg: Record<string, unknown>) {
    if (typeof msg.message_id === "string" && this.pending.has(msg.message_id)) {
      const p = this.pending.get(msg.message_id)!;
      this.pending.delete(msg.message_id);
      if (msg.error_code != null) p.reject(new Error(String(msg.details ?? `error ${msg.error_code}`)));
      else p.resolve(msg.result);
      return;
    }
    if (typeof msg.event === "string") {
      for (const l of this.listeners) l(msg as unknown as MaEvent);
    }
  }

  command<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
    const message_id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(message_id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ message_id, command, args }));
    });
  }

  onEvent(fn: (ev: MaEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.listeners.clear();
    this.ws?.close();
    this.ws = null;
  }
}
