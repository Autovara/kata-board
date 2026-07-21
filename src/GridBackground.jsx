import { useEffect, useRef } from "react";

// Themed adaptation of the ReactBits "Shape Grid" background.
// A grid of square outlines with the square under the pointer filling in and
// easing out. The grid is drawn ONCE (static) rather than re-rendered every
// frame, and the animation loop runs ONLY while a cell is mid-transition -- it
// cancels itself the moment everything has settled. So at rest the canvas costs
// zero CPU/GPU: the dashboard stays light but still reacts to the cursor.
// (The previous version scrolled the whole grid diagonally and rebuilt a
// full-screen radial gradient on every one of ~60 frames per second, redrawing
// ~1,200 cells continuously even when idle -- a constant hardware drain.)
export default function GridBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const SIZE = 44; // cell size
    const BORDER = "rgba(244, 247, 239, 0.08)";
    const HOVER_FILL = "rgba(185, 255, 93, 0.18)"; // accent green
    const BG = "8, 9, 8"; // --bg rgb, for the edge vignette

    let W = 0;
    let H = 0;
    let raf = 0;
    let vignette = null; // cached gradient, rebuilt only on resize
    let hovered = null; // "col,row" of the cell under the pointer
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

    function drawGrid() {
      ctx.clearRect(0, 0, W, H);

      const cols = Math.ceil(W / SIZE) + 1;
      const rows = Math.ceil(H / SIZE) + 1;
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const sx = col * SIZE;
          const sy = row * SIZE;

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

      // soft vignette so the grid fades toward the edges (gradient is cached)
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
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
      drawGrid();
    }

    // Ease each cell toward its goal (1 if hovered, else 0) and redraw. Returns
    // to idle -- cancels the rAF loop -- as soon as no cell is still moving.
    function tick() {
      const target = hovered;
      if (target && !opacities.has(target)) opacities.set(target, 0);

      let animating = false;
      for (const [key, value] of opacities) {
        const goal = key === target ? 1 : 0;
        const next = value + (goal - value) * 0.15;
        if (Math.abs(goal - next) < 0.005) {
          // Settled: drop faded-out cells, snap held cells to full, and let the
          // loop stop unless another cell is still in motion.
          if (goal === 0) opacities.delete(key);
          else opacities.set(key, 1);
        } else {
          opacities.set(key, next);
          animating = true;
        }
      }

      drawGrid();
      raf = animating ? requestAnimationFrame(tick) : 0;
    }

    function wake() {
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function onMove(e) {
      const col = Math.floor(e.clientX / SIZE);
      const row = Math.floor(e.clientY / SIZE);
      const key = `${col},${row}`;
      if (key !== hovered) {
        hovered = key;
        wake();
      }
    }
    function onLeave() {
      if (hovered !== null) {
        hovered = null;
        wake();
      }
    }

    resize();
    window.addEventListener("resize", resize);

    // Reduced-motion (or no pointer interaction): the static grid is already
    // drawn, so there is nothing to animate.
    if (reduce) {
      return () => window.removeEventListener("resize", resize);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="grid-bg" aria-hidden="true" />;
}
