import { useRef, useState } from "react";
import { GameChrome, type GameProps, useLoop, usePhase } from "../engine";

const COLS = 24;
const ROWS = 18;
const CELL = 16;
const TICK_MS = 110;

type Cell = { x: number; y: number };

const DIRS: Record<string, Cell> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function randomFood(snake: Cell[]): Cell {
  // ponytail: rejection sampling; fine until the snake nearly fills the board
  while (true) {
    const f = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
    if (!snake.some((c) => c.x === f.x && c.y === f.y)) return f;
  }
}

function newGame() {
  const snake: Cell[] = [
    { x: 8, y: 9 },
    { x: 7, y: 9 },
    { x: 6, y: 9 },
  ];
  return { snake, prev: snake, dir: DIRS.ArrowRight, nextDir: DIRS.ArrowRight, food: randomFood(snake), score: 0 };
}

export default function Snake({ onExit }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef(newGame());
  const { phase, setPhase } = usePhase();
  const [score, setScore] = useState(0);

  const tick = () => {
    const s = g.current;
    s.dir = s.nextDir;
    const head = {
      x: (s.snake[0].x + s.dir.x + COLS) % COLS,
      y: (s.snake[0].y + s.dir.y + ROWS) % ROWS,
    };
    if (s.snake.some((c) => c.x === head.x && c.y === head.y)) {
      setPhase("over");
      return;
    }
    s.prev = s.snake;
    const ate = head.x === s.food.x && head.y === s.food.y;
    s.snake = [head, ...(ate ? s.snake : s.snake.slice(0, -1))];
    if (ate) {
      s.food = randomFood(s.snake);
      setScore(++s.score);
    }
  };

  const draw = (t: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const s = g.current;
    ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc((s.food.x + 0.5) * CELL, (s.food.y + 0.5) * CELL, CELL * 0.28, 0, Math.PI * 2);
    ctx.fill();

    for (let i = s.snake.length - 1; i >= 0; i--) {
      const cur = s.snake[i];
      const was = s.prev[i] ?? cur;
      const wrap = Math.abs(cur.x - was.x) > 1 || Math.abs(cur.y - was.y) > 1;
      const x = wrap ? cur.x : was.x + (cur.x - was.x) * t;
      const y = wrap ? cur.y : was.y + (cur.y - was.y) * t;
      const fade = 1 - i / (s.snake.length + 4);
      ctx.fillStyle = i === 0 ? "rgba(255,255,255,0.95)" : `rgba(255,255,255,${0.15 + 0.45 * fade})`;
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    }
  };

  useLoop(phase === "running", TICK_MS, tick, draw);

  return (
    <GameChrome
      phase={phase}
      score={score}
      hint="arrows steer · esc pauses"
      width={COLS * CELL}
      height={ROWS * CELL}
      canvasRef={canvasRef}
      setPhase={setPhase}
      onExit={onExit}
      onStart={() => {
        g.current = newGame();
        setScore(0);
        setPhase("running");
      }}
      onKey={(e) => {
        const d = DIRS[e.key];
        if (!d) return;
        e.preventDefault();
        const s = g.current;
        if (d.x !== -s.dir.x || d.y !== -s.dir.y) s.nextDir = d;
      }}
    />
  );
}
