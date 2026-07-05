import { useEffect, useRef } from "react";

// Interactive dot-grid background (ReactBits "shape grid" style):
// a fixed field of dots behind all content that gently pulses on its own and
// lights up around the pointer, with a spotlight that eases toward the cursor.
export default function GridBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const GAP = 34; // spacing between dots
    const BASE_R = 1.1; // idle dot radius
    const HOVER_R = 2.7; // dot radius at the pointer center
    const RADIUS = 175; // spotlight radius around the pointer
    const RADIUS2 = RADIUS * RADIUS;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let raf = 0;
    let start = 0;

    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / GAP) + 1;
      rows = Math.ceil(height / GAP) + 1;
      if (reduce) drawStatic();
    }

    function drawStatic() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(244, 247, 239, 0.06)";
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          ctx.beginPath();
          ctx.arc(ix * GAP, iy * GAP, BASE_R, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function draw(now) {
      const t = (now - start) / 1000;
      // spotlight eases toward the pointer for a soft trailing feel
      pointer.x += (pointer.tx - pointer.x) * 0.12;
      pointer.y += (pointer.ty - pointer.y) * 0.12;
      ctx.clearRect(0, 0, width, height);

      for (let iy = 0; iy < rows; iy++) {
        const y = iy * GAP;
        for (let ix = 0; ix < cols; ix++) {
          const x = ix * GAP;
          // slow diagonal wave so the field is alive without a pointer
          const wave = 0.5 + 0.5 * Math.sin((x + y) * 0.01 - t * 1.1);

          let influence = 0;
          if (pointer.active) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < RADIUS2) {
              influence = 1 - Math.sqrt(d2) / RADIUS;
              influence *= influence; // ease-in for a tighter spotlight
            }
          }

          const alpha = 0.05 + wave * 0.05 + influence * 0.6;
          const rad = BASE_R + influence * (HOVER_R - BASE_R);
          // fade dot color from soft white toward the green→cyan accent
          const r = Math.round(244 + (150 - 244) * influence);
          const g = Math.round(247 + (255 - 247) * influence);
          const b = Math.round(239 + (140 - 239) * influence);

          ctx.beginPath();
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    }

    function onMove(e) {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      if (!pointer.active) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.active = true;
      }
    }
    function onLeave() {
      pointer.active = false;
      pointer.tx = -9999;
      pointer.ty = -9999;
    }

    resize();
    window.addEventListener("resize", resize);

    if (reduce) {
      return () => window.removeEventListener("resize", resize);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    start = performance.now();
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="grid-bg" aria-hidden="true" />;
}
