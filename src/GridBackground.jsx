import { useEffect, useRef } from "react";

// Interactive dot-grid background (ReactBits "shape grid" style).
// Every dot sits at a home position and is physically pushed away from the
// pointer, then springs back — so the grid visibly moves and ripples as the
// cursor passes over it.
export default function GridBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const GAP = 30; // spacing between dots
    const BASE_R = 1.3; // resting dot radius
    const REPEL = 150; // pointer influence radius
    const REPEL2 = REPEL * REPEL;
    const PUSH = 0.9; // push strength
    const SPRING = 0.075; // return-to-home strength
    const FRICTION = 0.86; // velocity damping

    let width = 0;
    let height = 0;
    let dots = [];
    let raf = 0;

    const pointer = { x: -9999, y: -9999, active: false };

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      const cols = Math.ceil(width / GAP) + 1;
      const rows = Math.ceil(height / GAP) + 1;
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          const hx = ix * GAP;
          const hy = iy * GAP;
          dots.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0 });
        }
      }
      if (reduce) drawStatic();
    }

    function drawStatic() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(244, 247, 239, 0.07)";
      for (const d of dots) {
        ctx.beginPath();
        ctx.arc(d.hx, d.hy, BASE_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      for (const d of dots) {
        // push away from the pointer
        if (pointer.active) {
          const dx = d.x - pointer.x;
          const dy = d.y - pointer.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < REPEL2 && dist2 > 0.01) {
            const dist = Math.sqrt(dist2);
            const force = (1 - dist / REPEL) * PUSH;
            d.vx += (dx / dist) * force;
            d.vy += (dy / dist) * force;
          }
        }
        // spring back to the home cell
        d.vx += (d.hx - d.x) * SPRING;
        d.vy += (d.hy - d.y) * SPRING;
        d.vx *= FRICTION;
        d.vy *= FRICTION;
        d.x += d.vx;
        d.y += d.vy;

        // dots that have moved brighten and grow, fading toward the accent
        const off = Math.min(1, (Math.abs(d.x - d.hx) + Math.abs(d.y - d.hy)) / 26);
        const alpha = 0.06 + off * 0.55;
        const rad = BASE_R + off * 1.6;
        const r = Math.round(244 + (150 - 244) * off);
        const g = Math.round(247 + (255 - 247) * off);
        const b = Math.round(239 + (140 - 239) * off);

        ctx.beginPath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.arc(d.x, d.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }

    function onMove(e) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }
    function onLeave() {
      pointer.active = false;
    }

    build();
    window.addEventListener("resize", build);

    if (reduce) {
      return () => window.removeEventListener("resize", build);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", build);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="grid-bg" aria-hidden="true" />;
}
