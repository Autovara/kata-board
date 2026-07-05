import { useEffect, useRef } from "react";

// Themed adaptation of the ReactBits "Shape Grid" background.
// A grid of square outlines that scrolls continuously (diagonally), with the
// square under the pointer filling in and easing out — so the grid is always
// gently moving and reacts to the cursor.
export default function GridBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const SIZE = 44; // cell size
    const SPEED = 0.45; // scroll speed (px/frame)
    const BORDER = "rgba(244, 247, 239, 0.08)";
    const HOVER_FILL = "rgba(185, 255, 93, 0.18)"; // accent green
    const BG = "8, 9, 8"; // --bg rgb, for the edge vignette

    let W = 0;
    let H = 0;
    let raf = 0;
    const offset = { x: 0, y: 0 };
    let hovered = null; // {x, y} cell coords
    const opacities = new Map(); // "col,row" -> current fill alpha

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) drawGrid();
    }

    function drawGrid() {
      ctx.clearRect(0, 0, W, H);

      const offX = ((offset.x % SIZE) + SIZE) % SIZE;
      const offY = ((offset.y % SIZE) + SIZE) % SIZE;
      const cols = Math.ceil(W / SIZE) + 3;
      const rows = Math.ceil(H / SIZE) + 3;

      for (let col = -2; col < cols; col++) {
        for (let row = -2; row < rows; row++) {
          const sx = col * SIZE + offX;
          const sy = row * SIZE + offY;

          const alpha = opacities.get(`${col},${row}`);
          if (alpha) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = HOVER_FILL;
            ctx.fillRect(sx, sy, SIZE, SIZE);
            ctx.globalAlpha = 1;
          }

          ctx.strokeStyle = BORDER;
          ctx.strokeRect(sx, sy, SIZE, SIZE);
        }
      }

      // soft vignette so the grid fades toward the edges
      const g = ctx.createRadialGradient(
        W / 2,
        H / 2,
        0,
        W / 2,
        H / 2,
        Math.sqrt(W * W + H * H) / 2
      );
      g.addColorStop(0, `rgba(${BG}, 0)`);
      g.addColorStop(1, `rgba(${BG}, 0.55)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    function updateOpacities() {
      const target = hovered ? `${hovered.x},${hovered.y}` : null;
      if (target && !opacities.has(target)) opacities.set(target, 0);
      for (const [key, value] of opacities) {
        const goal = key === target ? 1 : 0;
        const next = value + (goal - value) * 0.15;
        if (next < 0.005) opacities.delete(key);
        else opacities.set(key, next);
      }
    }

    function tick() {
      // continuous diagonal scroll
      offset.x = (offset.x - SPEED + SIZE) % SIZE;
      offset.y = (offset.y - SPEED + SIZE) % SIZE;
      updateOpacities();
      drawGrid();
      raf = requestAnimationFrame(tick);
    }

    function onMove(e) {
      const offX = ((offset.x % SIZE) + SIZE) % SIZE;
      const offY = ((offset.y % SIZE) + SIZE) % SIZE;
      const col = Math.floor((e.clientX - offX) / SIZE);
      const row = Math.floor((e.clientY - offY) / SIZE);
      hovered = { x: col, y: row };
    }
    function onLeave() {
      hovered = null;
    }

    resize();
    window.addEventListener("resize", resize);

    if (reduce) {
      return () => window.removeEventListener("resize", resize);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="grid-bg" aria-hidden="true" />;
}
