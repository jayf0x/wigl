import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Widget } from "@/wigl";
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

const GamesWidget = () => {
  const [active, setActive] = useState<(typeof GAMES)[number] | null>(null);

  return (
    <Widget
      w={4}
      h={4}
      col={0}
      row={6}
      minimizedBackground={<span className="text-lg">🚀</span>}
      headerContent={
        <>
          <span className="px-1 text-[10px] tracking-widest opacity-40">
            GAMES{active ? ` · ${active.name}` : ""}
          </span>
          {active && (
            <Button
              variant="ghost"
              data-no-drag
              onClick={() => setActive(null)}
              className="ml-auto h-auto rounded px-1.5 font-normal text-[10px] tracking-widest opacity-40 hover:bg-accent hover:opacity-80"
            >
              MENU
            </Button>
          )}
        </>
      }
    >
      {active ? (
        <active.Game onExit={() => setActive(null)} />
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1.5 p-3">
          {GAMES.map((game) => (
            <Button
              key={game.id}
              variant="ghost"
              data-no-drag
              onClick={() => setActive(game)}
              className="h-auto justify-start rounded-md border border-border bg-accent/10 px-3 py-2 text-left font-mono font-normal text-[11px] tracking-widest opacity-70 hover:bg-accent/25 hover:opacity-100"
            >
              {game.name}
            </Button>
          ))}
        </div>
      )}
    </Widget>
  );
};

export default GamesWidget;
