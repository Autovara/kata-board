// Themed grid background. The grid drifts diagonally forever, but the motion is
// a pure GPU-compositor transform (see `.grid-bg` / `@keyframes grid-drift` in
// styles.css): the tiled layer is painted ONCE and the GPU just re-positions it
// each frame, so it moves continuously at ~zero CPU. A separate static vignette
// fades the edges. (The previous canvas version scrolled by clearing and
// redrawing ~1,200 cells + a full-screen gradient 60x/second, which was the
// dashboard's main hardware drain -- this keeps the movement without the cost.)
// Reduced-motion users get a static grid via the global media query in styles.css.
export default function GridBackground() {
  return (
    <>
      <div className="grid-bg" aria-hidden="true" />
      <div className="grid-vignette" aria-hidden="true" />
    </>
  );
}
