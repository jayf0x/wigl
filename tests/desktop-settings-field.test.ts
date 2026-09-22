// Wiring check for "always show the grid while Settings is open, in the
// same accent color as a drag's locked drop target" — useAnchorField's own
// force-override behavior is covered in tests/anchor-field.test.ts; this is
// the Desktop.tsx wiring off `menu.settingsOpen` (the field's `.active`
// visibility, and the `.settings-open` class App.css uses to give every
// anchor the `.locked` accent treatment instead of just the drop target's),
// exercised through the real right-click menu → "Settings" action.
import * as React from "react";
import { act, render } from "@testing-library/react";
import { mockStorage } from "./mock-storage";
import { afterEach, expect, mock, test } from "bun:test";
import { TILING } from "../src/wigl/grid/config";

const storage = mockStorage();
storage.kv.set("widget_layout", JSON.stringify({ w1: { col: 0, row: 0, m: 0 } }));

mock.module("@tauri-apps/api/core", () => {
  const actual = require("@tauri-apps/api/core");
  return { ...actual, invoke: async () => undefined };
});
mock.module("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [{ name: "0", position: { x: 0, y: 0 }, size: { width: 1000, height: 800 }, scaleFactor: 1 }],
}));

const { Desktop } = await import("../src/wigl/Desktop");

const Header = () => React.createElement("div", { "data-widget-header": true, "data-testid": "header" }, "w1");

const originalShow = TILING.field.show;
afterEach(() => {
  TILING.field.show = originalShow;
  storage.restore();
});

test('opening Settings shows the grid even with field.show: "never"; closing it hides it again', async () => {
  TILING.field.show = "never"; // the exact case a naive fix would leave stuck either way
  const { container, unmount } = render(
    React.createElement(Desktop, { widgets: { w1: Header }, monitorIndex: 0, windowed: false }),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  const field = () => container.querySelector(".wigl-field") as HTMLElement;
  expect(field().classList.contains("active")).toBe(false);
  expect(field().classList.contains("settings-open")).toBe(false);

  const header = container.querySelector('[data-testid="header"]') as HTMLElement;
  await act(async () => {
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  const settingsBtn = [...container.querySelectorAll(".wigl-menu button")].find((b) => b.textContent === "Settings") as
    | HTMLButtonElement
    | undefined;
  expect(settingsBtn).toBeDefined();
  await act(async () => {
    settingsBtn!.click();
  });

  expect(field().classList.contains("active")).toBe(true);
  expect(field().classList.contains("settings-open")).toBe(true);

  unmount();
});
