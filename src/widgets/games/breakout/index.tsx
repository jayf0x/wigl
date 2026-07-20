import { useRef, useState } from "react";
import { GameChrome, type GameProps, useLoop, usePhase } from "../engine";

const W = 320;
const H = 260;
const TICK_MS = 16;
const BRICK_COLS = 8;
const BRICK_ROWS = 5;
const BW = W / BRICK_COLS;
const BH = 14;
const PAD_W = 56;
const PAD_H = 6;
const R = 4; // ball radius

const newLevel = (speed: number) => ({
  bricks: new Uint8Array(BRICK_COLS * BRICK_ROWS).fill(1),
  x: W / 2,
  y: H - 40,
  vx: speed * 0.6,
  vy: -speed,
  pad: W / 2 - PAD_W / 2,
  speed,
});

const newGame = () => ({ ...newLevel(3), score: 0, lives: 3, won: false });

const Breakout = ({ onExit }: GameProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef(newGame());
  const keys = useRef<Record<string, boolean>>({});
  const { phase, setPhase } = usePhase();
  const [score, setScore] = useState(0);

  const tick = () => {
    const s = g.current;
    if (keys.current.ArrowLeft) s.pad = Math.max(0, s.pad - 5);
    if (keys.current.ArrowRight) s.pad = Math.min(W - PAD_W, s.pad + 5);

    s.x += s.vx;
    s.y += s.vy;
    if (s.x < R || s.x > W - R) {
      s.vx = -s.vx;
      s.x = Math.max(R, Math.min(W - R, s.x));
    }
    if (s.y < R) {
      s.vy = Math.abs(s.vy);
      s.y = R;
    }

    // paddle bounce, angle from hit position
    if (s.vy > 0 && s.y > H - 16 - R && s.y < H - 8 && s.x > s.pad - R && s.x < s.pad + PAD_W + R) {
      const rel = (s.x - (s.pad + PAD_W / 2)) / (PAD_W / 2);
      s.vx = rel * s.speed;
      s.vy = -Math.sqrt(Math.max(s.speed * s.speed - s.vx * s.vx, 1));
    }

    // brick hit — one per tick is plenty at this speed
    const bx = (s.x / BW) | 0;
    const by = ((s.y - 20) / BH) | 0;
    if (by >= 0 && by < BRICK_ROWS && bx >= 0 && bx < BRICK_COLS && s.bricks[by * BRICK_COLS + bx]) {
      s.bricks[by * BRICK_COLS + bx] = 0;
      s.vy = -s.vy;
      s.score += 10;
      setScore(s.score);
      if (!s.bricks.some((b) => b)) {
        if (s.speed >= 5) {
          s.won = true;
          setPhase("over");
          return;
        }
        Object.assign(s, newLevel(s.speed + 0.5)); // next level, faster
      }
    }

    if (s.y > H + R) {
      if (--s.lives <= 0) {
        setPhase("over");
        return;
      }
      Object.assign(s, { x: W / 2, y: H - 40, vx: s.speed * 0.6, vy: -s.speed });
    }
  };

  const draw = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const s = g.current;
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < s.bricks.length; i++) {
      if (!s.bricks[i]) continue;
      const row = (i / BRICK_COLS) | 0;
      ctx.fillStyle = `rgba(255,255,255,${0.55 - row * 0.08})`;
      ctx.fillRect((i % BRICK_COLS) * BW + 1, 20 + row * BH + 1, BW - 2, BH - 2);
    }

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(s.pad, H - 14, PAD_W, PAD_H);
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText("●".repeat(s.lives), 4, 12);
  };

  useLoop(phase === "running", TICK_MS, tick, draw);

  return (
    <GameChrome
      phase={phase}
      score={score}
      overLabel={g.current.won ? "YOU WIN" : "GAME OVER"}
      hint="← → move paddle · esc pauses"
      width={W}
      height={H}
      canvasRef={canvasRef}
      setPhase={setPhase}
      onExit={onExit}
      onStart={() => {
        g.current = newGame();
        setScore(0);
        setPhase("running");
      }}
      onKey={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          keys.current[e.key] = true;
        }
      }}
      onKeyUp={(e) => {
        keys.current[e.key] = false;
      }}
    />
  );
};

export default Breakout;
