import { useRef, useState } from "react";
import { GameChrome, useLoop, usePhase, type GameProps } from "../engine";

const COLS = 10;
const ROWS = 18;
const CELL = 16;
const PANEL = 80; // right side: next piece + lines
const W = COLS * CELL + PANEL;
const H = ROWS * CELL;

type Cell = { x: number; y: number };

// base shapes in a size×size box; rotations precomputed once at module load
const BASE: { size: number; cells: Cell[]; color: string }[] = [
  {
    size: 4,
    cells: [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
    color: "rgba(125,211,252,0.85)",
  }, // I
  {
    size: 2,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    color: "rgba(253,224,71,0.85)",
  }, // O
  {
    size: 3,
    cells: [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    color: "rgba(216,180,254,0.85)",
  }, // T
  {
    size: 3,
    cells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    color: "rgba(134,239,172,0.85)",
  }, // S
  {
    size: 3,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    color: "rgba(252,165,165,0.85)",
  }, // Z
  {
    size: 3,
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    color: "rgba(147,197,253,0.85)",
  }, // J
  {
    size: 3,
    cells: [
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    color: "rgba(253,186,116,0.85)",
  }, // L
];

const ROTATIONS: Cell[][][] = BASE.map(({ size, cells }) => {
  const rots = [cells];
  for (let r = 1; r < 4; r++) rots.push(rots[r - 1].map(({ x, y }) => ({ x: size - 1 - y, y: x })));
  return rots;
});

type Piece = { idx: number; rot: number; x: number; y: number };

function cellsOf(p: Piece): Cell[] {
  return ROTATIONS[p.idx][p.rot].map((c) => ({ x: c.x + p.x, y: c.y + p.y }));
}

function collides(board: Uint8Array, p: Piece): boolean {
  return cellsOf(p).some((c) => c.x < 0 || c.x >= COLS || c.y >= ROWS || (c.y >= 0 && board[c.y * COLS + c.x] !== 0));
}

function spawn(): Piece {
  return { idx: (Math.random() * BASE.length) | 0, rot: 0, x: 3, y: -1 };
}

function newGame() {
  return { board: new Uint8Array(COLS * ROWS), piece: spawn(), next: spawn(), score: 0, lines: 0 };
}

export default function Tetris({ onExit }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef(newGame());
  const { phase, setPhase } = usePhase();
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(0);

  const lock = () => {
    const s = g.current;
    for (const c of cellsOf(s.piece)) {
      if (c.y < 0) {
        setPhase("over");
        return;
      }
      s.board[c.y * COLS + c.x] = s.piece.idx + 1;
    }
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (s.board.subarray(y * COLS, y * COLS + COLS).every((v) => v !== 0)) {
        s.board.copyWithin(COLS, 0, y * COLS);
        s.board.fill(0, 0, COLS);
        cleared++;
        y++; // recheck same row after shift
      }
    }
    if (cleared) {
      s.lines += cleared;
      s.score += [0, 40, 100, 300, 1200][cleared] * (((s.lines / 10) | 0) + 1);
      setScore(s.score);
      setLevel((s.lines / 10) | 0);
    }
    s.piece = s.next;
    s.next = spawn();
    if (collides(s.board, s.piece)) setPhase("over");
  };

  const tick = () => {
    const s = g.current;
    const moved = { ...s.piece, y: s.piece.y + 1 };
    if (collides(s.board, moved)) lock();
    else s.piece = moved;
  };

  const draw = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const s = g.current;
    ctx.clearRect(0, 0, W, H);

    // board frame + locked cells
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(0.5, 0.5, COLS * CELL - 1, H - 1);
    for (let i = 0; i < s.board.length; i++) {
      const v = s.board[i];
      if (!v) continue;
      ctx.fillStyle = BASE[v - 1].color;
      ctx.fillRect((i % COLS) * CELL + 1, ((i / COLS) | 0) * CELL + 1, CELL - 2, CELL - 2);
    }

    // ghost
    const ghost = { ...s.piece };
    while (!collides(s.board, { ...ghost, y: ghost.y + 1 })) ghost.y++;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (const c of cellsOf(ghost)) if (c.y >= 0) ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);

    // current piece
    ctx.fillStyle = BASE[s.piece.idx].color;
    for (const c of cellsOf(s.piece)) if (c.y >= 0) ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);

    // side panel: next piece + lines
    const px = COLS * CELL + 12;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText("NEXT", px, 14);
    ctx.fillStyle = BASE[s.next.idx].color;
    for (const c of ROTATIONS[s.next.idx][0]) ctx.fillRect(px + c.x * 10, 22 + c.y * 10, 8, 8);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(`LINES ${s.lines}`, px, H - 10);
  };

  useLoop(phase === "running", Math.max(80, 480 - level * 40), tick, draw);

  return (
    <GameChrome
      phase={phase}
      score={score}
      hint="← → move · ↑ rotate · ↓ drop · space slam · esc pauses"
      width={W}
      height={H}
      canvasRef={canvasRef}
      setPhase={setPhase}
      onExit={onExit}
      onStart={() => {
        g.current = newGame();
        setScore(0);
        setLevel(0);
        setPhase("running");
      }}
      onKey={(e) => {
        const s = g.current;
        const p = s.piece;
        let moved: Piece | null = null;
        if (e.key === "ArrowLeft") moved = { ...p, x: p.x - 1 };
        else if (e.key === "ArrowRight") moved = { ...p, x: p.x + 1 };
        else if (e.key === "ArrowDown") moved = { ...p, y: p.y + 1 };
        else if (e.key === "ArrowUp") {
          // rotate with simple ±1 wall kick
          for (const dx of [0, -1, 1]) {
            const r = { ...p, rot: (p.rot + 1) % 4, x: p.x + dx };
            if (!collides(s.board, r)) {
              moved = r;
              break;
            }
          }
        } else if (e.key === " ") {
          e.preventDefault();
          while (!collides(s.board, { ...s.piece, y: s.piece.y + 1 })) s.piece.y++;
          lock();
          return;
        } else return;
        e.preventDefault();
        if (moved && !collides(s.board, moved)) s.piece = moved;
      }}
    />
  );
}
