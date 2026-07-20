import { useState } from "react";
import { Widget, WidgetHeader } from "@/wigl";
import Breakout from "./breakout";
import Snake from "./snake";
import Tetris from "./tetris";

// Retro mini games for while a build runs. Session-only, no storage.
// Only the selected game is mounted — back to the menu unmounts it entirely,
// so an idle widget holds no game state and runs no loops.
const GAMES = [
  { id: "snake", name: "SNAKE", Game: Snake },
  { id: "tetris", name: "TETRIS", Game: Tetris },
  { id: "breakout", name: "BREAKOUT", Game: Breakout },
] as const;

export default function GamesWidget() {
  const [active, setActive] = useState<(typeof GAMES)[number] | null>(null);

  return (
    <Widget w={4} h={4} col={0} row={6}>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">GAMES{active ? ` · ${active.name}` : ""}</span>
        {active && (
          <button
            data-no-drag
            onClick={() => setActive(null)}
            className="ml-auto rounded px-1.5 text-[10px] tracking-widest opacity-40 hover:bg-white/10 hover:opacity-80"
          >
            MENU
          </button>
        )}
      </WidgetHeader>
      {active ? (
        <active.Game onExit={() => setActive(null)} />
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1.5 p-3">
          {GAMES.map((game) => (
            <button
              key={game.id}
              data-no-drag
              onClick={() => setActive(game)}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left font-mono text-[11px] tracking-widest opacity-70 hover:bg-white/10 hover:opacity-100"
            >
              {game.name}
            </button>
          ))}
        </div>
      )}
    </Widget>
  );
}
