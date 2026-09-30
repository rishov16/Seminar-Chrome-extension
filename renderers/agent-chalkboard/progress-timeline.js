// Converts handwriting-agent.js's wall-clock rAF animation model into a
// pure `progress ∈ [0,1] → which segments are visible` function.
//
// Why this exists: the real renderer contract (renderers/renderer-interface.js)
// requires `setMathProgress(tokenIndex, progress)` — narration-sync driven
// (historically lib/sync-engine.js, since removed; today unused by
// orchestration/live-narration-controller.js, which reveals a whole unit at
// once rather than a fractional progress value), which can scrub to an
// arbitrary fraction at any moment, not just play forward from t=0. `startAgentWriting` in
// handwriting-agent.js is fundamentally "start a real-time rAF loop now,
// play until done" — the right model for the standalone demo page's
// autoplay, but not for narration-driven scrubbing. `startAgentWriting`
// itself is untouched; this module reads the same underlying segment
// timeline and builds a second, independent reveal mechanism from it.
//
// The key fact that makes this straightforward: computeStrokeTiming's
// per-stroke duration/start values depend only on rendered stroke length
// and the speed setting — pure geometry, no wall-clock time — so they can
// be computed once, up front, rather than inside a rAF tick.
import { getSegmentsTimeline, computeStrokeTiming } from '../experimental-handwriting-agent/handwriting-agent.js?v=25';

/**
 * Builds a flat, precomputed reveal timeline for one rendered token (an
 * equation's <span>, or a prose word's <span> — anything with segments
 * from renderMathLineAgent/renderProseWordAgent). Call once per render,
 * cache the result (e.g. on the span itself), and feed it to
 * setAgentProgress on every narration tick — don't rebuild it per tick.
 *
 * @param {HTMLElement} spanElement
 * @param {number} [speed] - same speed convention as startAgentWriting;
 *   only affects relative pacing between strokes (a slow stroke still
 *   takes proportionally longer), not the [0,1] progress scale itself.
 * @returns {Array<{el:SVGElement, globalT:number, fade:boolean}>|null}
 *   null if spanElement has no segments (e.g. a plain-text fallback token)
 */
export function buildProgressTimeline(spanElement, speed = 0.35) {
  const strokes = getSegmentsTimeline(spanElement);
  if (!strokes || !strokes.length) return null;

  const { durations, starts, total } = computeStrokeTiming(strokes, speed);
  if (total <= 0) return null;

  const flat = [];
  strokes.forEach((segs, si) => {
    segs.forEach(({ el, t }) => {
      const globalT = (starts[si] + t * durations[si]) / total;
      flat.push({ el, globalT: Math.min(1, Math.max(0, globalT)), fade: !!el.dataset.hwFade });
    });
  });
  return flat;
}

/**
 * Pure reveal: sets every segment's opacity based on whether its globalT
 * has been reached by `progress`. Bidirectional — scrubbing progress
 * backward hides segments again — matching how chalkboard-renderer.js's
 * existing MathJax-based setMathProgress already behaves (a revealed-class
 * toggle, added or removed each call, not a one-way reveal).
 *
 * @param {Array<{el:SVGElement, globalT:number, fade:boolean}>} timeline - from buildProgressTimeline
 * @param {number} progress - 0..1
 */
export function setAgentProgress(timeline, progress) {
  if (!timeline) return;
  for (const { el, globalT, fade } of timeline) {
    const shouldShow = globalT <= progress;
    const isShown = el.style.opacity !== '0';
    if (shouldShow === isShown) continue; // avoid restarting an in-flight CSS transition needlessly
    if (shouldShow && fade) el.style.transition = 'opacity 200ms ease-in';
    else if (!shouldShow) el.style.transition = 'none';
    el.style.opacity = shouldShow ? '1' : '0';
  }
}
