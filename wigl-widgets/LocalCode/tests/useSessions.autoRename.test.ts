// Covers useSessions.ts's session-numbering + auto-rename wiring: the
// idempotency guard (never overwrite an existing title, whether from a
// prior auto-rename or a manual one), the one shared counter driving both
// "Empty #N" (assigned eagerly at creation) and the real "#N ..." title
// (assigned lazily if a session somehow reaches its first message without
// one), and that it actually calls through to the opencode API when a
// server is connected. sessionTitle.test.ts covers the title-generation
// algorithm itself; this file covers the state machine around it.
//
// `@/wigl/hooks` and `../client` only resolve inside the app's own Vite
// build, not for a widget test run directly by `bun test` (same reasoning
// as tests/ollama.test.ts) — both mocked below with minimal fakes rather
// than routed through that build. The fake useStorage is a plain in-memory
// substitute (no sqlite, no polling) since this file is testing
// useSessions' own logic, not useStorage's persistence guarantees.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let store: Map<string, unknown>;

mock.module("@/wigl/hooks", () => ({
  useStorage: (key: string, initial: unknown) => {
    const React = require("react");
    const [value, setValue] = React.useState(() => (store.has(key) ? store.get(key) : initial));
    const setAndStore = (next: unknown) => {
      store.set(key, next);
      setValue(next);
    };
    return [value, setAndStore, { loading: false }];
  },
}));

const renameSession = mock(async (_baseUrl: string, _sessionID: string, _title: string) => ({}) as never);
let nextFakeSessionId = 0;
const createSessionMock = mock(async (_baseUrl: string, opts: { directory: string }) => {
  nextFakeSessionId += 1;
  return {
    id: `ses_fake_${nextFakeSessionId}`,
    projectID: "proj",
    directory: opts.directory,
    title: "",
    time: { created: Date.now(), updated: Date.now() },
  };
});
// Mutable per-test canned response — only the "legacy session" test below
// (one populated via the initial list fetch, not `createSession`) needs
// this non-empty; every other test passes `directory: null`, which skips
// the fetch entirely (see useSessions.ts's `refresh`).
let cannedSessions: unknown[] = [];

mock.module("../client", () => ({
  listSessions: async () => cannedSessions,
  subscribeEvents: () => () => {},
  createSession: createSessionMock,
  renameSession,
  deleteSession: async () => {},
}));

const { useSessions } = await import("../useSessions");

beforeEach(() => {
  store = new Map();
  renameSession.mockClear();
  createSessionMock.mockClear();
  nextFakeSessionId = 0;
  cannedSessions = [];
});

afterEach(() => {
  mock.restore();
});

describe("useSessions — autoRenameSession", () => {
  test("first call sets a '#1 ...' title and calls through to the server", () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    act(() => result.current.autoRenameSession("ses_a", "fix flaky auth test in login flow"));

    const view = () => result.current.sessions; // empty in this test — titles overlay is checked via the mocked storage instead
    void view;
    expect(store.get("localcode_titles")).toEqual({ ses_a: expect.stringContaining("#1 ") });
    expect(store.get("localcode_session_counter")).toBe(1);
    expect(renameSession).toHaveBeenCalledTimes(1);
    expect(renameSession.mock.calls[0]).toEqual(["http://opencode.local", "ses_a", (store.get("localcode_titles") as Record<string, string>).ses_a]);
  });

  test("a second call for the same session is a no-op — never overwrites an existing title", () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    act(() => result.current.autoRenameSession("ses_a", "fix flaky auth test in login flow"));
    const firstTitle = (store.get("localcode_titles") as Record<string, string>).ses_a;
    renameSession.mockClear();

    act(() => result.current.autoRenameSession("ses_a", "a completely different second message"));

    expect((store.get("localcode_titles") as Record<string, string>).ses_a).toBe(firstTitle);
    expect(store.get("localcode_session_counter")).toBe(1); // not bumped again
    expect(renameSession).not.toHaveBeenCalled();
  });

  test("a pre-existing manual title also blocks auto-rename — guard covers rename-before-first-message too", () => {
    store.set("localcode_titles", { ses_a: "my own title" });
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    act(() => result.current.autoRenameSession("ses_a", "fix flaky auth test in login flow"));

    expect((store.get("localcode_titles") as Record<string, string>).ses_a).toBe("my own title");
    expect(store.get("localcode_session_counter") ?? 0).toBe(0);
    expect(renameSession).not.toHaveBeenCalled();
  });

  // Regression: `useStorage`'s setter takes a literal value, not a
  // `(prev) => next` updater, so a naive `setTitles({...titles, [id]: t})`
  // closes over whatever `titles` looked like at the last render — two
  // calls in the same tick (no render in between) would both read the same
  // stale snapshot and the second write would silently clobber the first's.
  test("two auto-renames for different sessions in the same tick both survive — neither write clobbers the other", () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    act(() => {
      result.current.autoRenameSession("ses_a", "fix flaky auth test in login flow");
      result.current.autoRenameSession("ses_b", "resolve the bug with the widgets not resizing");
    });

    const titles = store.get("localcode_titles") as Record<string, string>;
    expect(titles.ses_a?.startsWith("#1 ")).toBe(true);
    expect(titles.ses_b?.startsWith("#2 ")).toBe(true);
  });

  test("the counter is global across sessions, not per-session", () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    act(() => result.current.autoRenameSession("ses_a", "fix flaky auth test in login flow"));
    act(() => result.current.autoRenameSession("ses_b", "resolve the bug with the widgets not resizing"));

    const titles = store.get("localcode_titles") as Record<string, string>;
    expect(titles.ses_a?.startsWith("#1 ")).toBe(true);
    expect(titles.ses_b?.startsWith("#2 ")).toBe(true);
    expect(store.get("localcode_session_counter")).toBe(2);
  });

  test("a content-free first message still gets titled — the bare counter fallback", () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    act(() => result.current.autoRenameSession("ses_a", "y"));

    const titles = store.get("localcode_titles") as Record<string, string>;
    expect(titles.ses_a).toBe("#1");
    expect(renameSession).toHaveBeenCalledWith("http://opencode.local", "ses_a", "#1");
  });

  test("without a connected server, the title is still assigned locally but nothing is sent over the network", () => {
    const { result } = renderHook(() => useSessions(null, null));

    act(() => result.current.autoRenameSession("ses_a", "fix flaky auth test in login flow"));

    expect((store.get("localcode_titles") as Record<string, string>).ses_a).toContain("#1 ");
    expect(renameSession).not.toHaveBeenCalled();
  });
});

describe("useSessions — session numbering ('Empty #N')", () => {
  test("createSession assigns a number immediately, shown as 'Empty #N' before any message", async () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    await act(async () => {
      await result.current.createSession("/some/dir");
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.displayTitle).toBe("Empty #1");
  });

  test("the number assigned at creation carries over into the real title — not bumped a second time", async () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    let session!: Awaited<ReturnType<typeof result.current.createSession>>;
    await act(async () => {
      session = await result.current.createSession("/some/dir");
    });
    expect(result.current.sessions[0]?.displayTitle).toBe("Empty #1");

    act(() => result.current.autoRenameSession(session.id, "fix flaky auth test in login flow"));

    expect(result.current.sessions[0]?.displayTitle.startsWith("#1 ")).toBe(true);
    expect(store.get("localcode_session_counter")).toBe(1); // one session, one number, ever
  });

  test("two sessions created back to back get distinct, increasing numbers", async () => {
    const { result } = renderHook(() => useSessions("http://opencode.local", null));

    await act(async () => {
      await result.current.createSession("/dir/a");
      await result.current.createSession("/dir/b");
    });

    const titles = result.current.sessions.map((s) => s.displayTitle).sort();
    expect(titles).toEqual(["Empty #1", "Empty #2"]);
  });

  test("a session that predates numbering (never went through createSession) falls back to a timestamp, not 'Empty #undefined'", async () => {
    cannedSessions = [
      {
        id: "ses_legacy",
        projectID: "proj",
        directory: "/legacy/dir",
        title: "",
        time: { created: Date.UTC(2020, 0, 1), updated: Date.UTC(2020, 0, 1) },
      },
    ];
    const { result } = renderHook(() => useSessions("http://opencode.local", "/legacy/dir"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sessions[0]?.displayTitle).not.toContain("Empty #");
    expect(result.current.sessions[0]?.displayTitle).not.toContain("undefined");
  });
});
