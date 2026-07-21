import { useEffect, useRef } from "react";

// Themed adaptation of the ReactBits "Shape Grid" background.
// A grid of lines that scrolls continuously (diagonally), with the cell under
// the pointer filling in and easing out -- so the grid is always gently moving
// and reacts to the cursor.
//
// Kept light: each frame draws the whole grid as TWO batched paths (all vertical
// then all horizontal lines) in a single stroke -- ~70 line segments instead of
// the ~1,200 per-cell strokeRects the first version used -- and the edge-vignette
// gradient is built once per resize, not rebuilt every frame. So the motion and
// the hover effect are both back, at a fraction of the original per-frame cost.
export default function GridBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const SIZE = 44; // cell size
    const SPEED = 0.4; // scroll speed (px/frame) -- clearly visible, ~24px/s
    const BORDER = "rgba(244, 247, 239, 0.08)";
    const HOVER_FILL = "rgba(185, 255, 93, 0.18)"; // accent green
    const BG = "8, 9, 8"; // --bg rgb, for the edge vignette

    let W = 0;
    let H = 0;
    let raf = 0;
    let vignette = null; // cached gradient, rebuilt only on resize
    const offset = { x: 0, y: 0 };
    let hovered = null; // {x, y} cell coords
    const opacities = new Map(); // "col,row" -> current fill alpha

    function buildVignette() {
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
      vignette = g;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      // Backing store is scaled for a crisp image on HiDPI screens...
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      // ...but the CSS display size must stay locked to the viewport, or a
      // canvas (a replaced element) renders at its intrinsic dpr-scaled size and
      // looks zoomed in, throwing off the pointer-to-cell mapping below.
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildVignette();
      if (reduce) drawGrid();
    }

    function drawGrid() {
      ctx.clearRect(0, 0, W, H);

      const offX = ((offset.x % SIZE) + SIZE) % SIZE;
      const offY = ((offset.y % SIZE) + SIZE) % SIZE;

      // Hovered cells: only the handful currently easing in/out get a fill.
      if (opacities.size) {
        ctx.fillStyle = HOVER_FILL;
        for (const [key, alpha] of opacities) {
          const comma = key.indexOf(",");
          const col = Number(key.slice(0, comma));
          const row = Number(key.slice(comma + 1));
          ctx.globalAlpha = alpha;
          ctx.fillRect(col * SIZE + offX, row * SIZE + offY, SIZE, SIZE);
        }
        ctx.globalAlpha = 1;
      }

      // All grid lines in a single batched path + one stroke (cheap), instead of
      // stroking every cell rectangle individually.
      ctx.beginPath();
      for (let x = offX - SIZE; x <= W; x += SIZE) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = offY - SIZE; y <= H; y += SIZE) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.strokeStyle = BORDER;
      ctx.stroke();

      // soft vignette so the grid fades toward the edges (gradient is cached)
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    }

    function updateOpacities() {
      const target = hovered ? `${hovered.x},${hovered.y}` : null;
      if (target && !opacities.has(target)) opacities.set(target, 0);
      for (const [key, value] of opacities) {
        const goal = key === target ? 1 : 0;
        const next = value + (goal - value) * 0.15;
        if (next < 0.005 && goal === 0) opacities.delete(key);
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
      // Static grid already drawn; no animation loop for reduced-motion users.
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
