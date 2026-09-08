// useGlobalActions feeds both the desktop right-click menu and the
// system-tray menu (menu/native.ts) off one shared registry. The sharp
// invariant, spelled out in the source: useSyncExternalStore calls
// getSnapshot on every render and loops forever (React error #185) if it
// ever returns a referentially-new array when nothing changed — hence the
// cached array, rebuilt only in notify(). A drag re-renders Desktop dozens
// of times a second, so a regression here is an instant hard hang, not a
// subtle bug.
import { renderHook } from "@testing-library/react";
import { useGlobalActions, useRegisterGlobalAction } from "../src/wigl/hooks/useGlobalActions";
import { describe, expect, test } from "bun:test";

describe("useGlobalActions snapshot stability", () => {
  test("returns the same array reference across a re-render with no registry change", () => {
    const { result, rerender } = renderHook(() => useGlobalActions());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  test("registering an action produces a new snapshot containing it; unmount removes it", () => {
    const action = { id: "t-reset", label: "Reset", run: () => {} };
    const { result, unmount } = renderHook(() => {
      useRegisterGlobalAction(action);
      return useGlobalActions();
    });
    expect(result.current.some((a) => a.id === "t-reset")).toBe(true);

    unmount();
    // A fresh reader no longer sees it — the unmount cleanup deleted it.
    const { result: after } = renderHook(() => useGlobalActions());
    expect(after.current.some((a) => a.id === "t-reset")).toBe(false);
  });

  test("two consumers see one shared list", () => {
    const action = { id: "t-shared", label: "Shared", run: () => {} };
    const { result: writer } = renderHook(() => {
      useRegisterGlobalAction(action);
      return useGlobalActions();
    });
    const { result: reader } = renderHook(() => useGlobalActions());
    expect(writer.current.some((a) => a.id === "t-shared")).toBe(true);
    expect(reader.current.some((a) => a.id === "t-shared")).toBe(true);
  });
});
