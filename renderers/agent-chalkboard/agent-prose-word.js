// Renders one prose word (a single whitespace-free token — chalkboard's
// existing tokenizeProse already splits on whitespace, so this never sees
// an internal space) using the HandwritingAgent transcript bank, in place
// of renderers/chalkboard/handwriting.js's Kalam-font-outline + STROKE_MAP
// mask technique. Reuses buildGlyphSegments — the same per-character
// geometry pipeline (stretchy detection, resampling, pressure-scaled
// width) the math renderer uses — so a letter looks identical whether it
// appears in an equation or a sentence.
//
// Unlike the math renderer (which refits each leaf into a bbox MathJax
// already computed), prose has no per-character target size handed to it
// — every glyph must share one common scale and one common baseline, the
// way a real font's em-square works. That's done by picking ONE global
// scale factor S and constructing each glyph's own targetBBox
// proportional to its *own* native bbox scaled by S (never resetting Y to
// 0): given refitPoint's formula, that specific construction reduces
// exactly to `x' = cursorX + (x - nativeBBox.x) * S`, `y' = y * S` for
// every character — i.e. one consistent baseline, each glyph keeping its
// authored proportions, with cursorX doing the advancing. No new
// transform math was needed in handwriting-agent.js for this; it's a
// property of how refitPoint already works when width/height scale by the
// same factor.
import { getAgentGlyph, buildGlyphSegments, hasAgentGlyph } from '../experimental-handwriting-agent/handwriting-agent.js?v=25';
import { buildProgressTimeline } from './progress-timeline.js?v=1';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHALK_COLOR = '#dff5e3';

// Matches renderers/chalkboard/handwriting.js's own FONT_SIZE exactly, so
// prose drawn by this renderer sits at the same visual scale as before.
const FONT_SIZE = 38;
// The transcript-authoring convention documented in
// handwriting-agent-transcripts.js: "x roughly 0-60, y roughly 0-90...
// baseline around y≈86" — one fixed reference, not derived per-glyph, so
// every character shares the same em-square and baseline.
const NATIVE_CELL_SIZE = 90;
const SCALE = FONT_SIZE / NATIVE_CELL_SIZE;
// A prose word's baseline, in display px from the top of its rendered SVG
// (baselineY below is the same value). Exported so agent-chalkboard-renderer.js
// can drop an inline $math$ token onto this same baseline instead of
// top-aligning it (which floats the math above the surrounding words).
export const PROSE_BASELINE_FROM_TOP = 86 * SCALE;
const LETTER_GUTTER = 2; // display px between characters
const MIN_STROKE_WIDTH = 1.2; // display px floor, same floor value used elsewhere for equation-level strokes
// A visually sensible minimum cursor advance, in native units — verified
// against the bank directly: 'I'/'|' are the only exactly-zero-width
// transcripts (a straight vertical stroke has no horizontal extent at
// all), and without a floor here they'd advance almost nothing, crowding
// the next character against their stroke. 15 sits comfortably above
// genuinely narrow-but-nonzero letters ('i' is 2, 'l' is 7 native units,
// both fine as-is) without artificially widening them.
const MIN_ADVANCE_NATIVE_WIDTH = 15;

// Rough single-character width estimate for the plain-text fallback path
// (a character with no transcript at all) — deliberately a heuristic, not
// a measured value: this path is rare (the bank covers the practical
// prose character set) and doesn't warrant a forced-layout measurement.
const FALLBACK_CHAR_WIDTH = FONT_SIZE * 0.52;

// Plain, non-handwritten fallback for a character truly outside the bank.
// Unlike addStaticGlyph's math fallback (which traces MathJax's own glyph
// outline), there's no outline available here at all — prose never goes
// through MathJax — so this draws ordinary SVG text instead of leaving a
// silent gap. Joins the same fade-in-on-reveal convention as the math
// fallback (dataset.hwFade + a one-segment synthetic "stroke") so it
// takes its turn in writing order like everything else.
function buildFallbackChar(svg, char, x, baselineY, color, segmentsTimeline) {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', x.toFixed(2));
  el.setAttribute('y', baselineY.toFixed(2));
  el.setAttribute('font-size', String(FONT_SIZE));
  el.setAttribute('fill', color);
  el.textContent = char;
  el.style.opacity = '0';
  el.dataset.hwFade = '1';
  svg.appendChild(el);
  segmentsTimeline.push([{ el, t: 0 }]);
  return FALLBACK_CHAR_WIDTH;
}

/**
 * Builds one word's ink and stores its reveal timeline on spanElement in
 * exactly the shape startAgentWriting (handwriting-agent.js) already
 * expects — so playing a word's writing animation is just
 * `startAgentWriting(spanElement, speed)`, no new reveal-timing code
 * needed for prose at all.
 *
 * @param {string} word - one whitespace-free token
 * @param {HTMLElement} spanElement - receives `_agentSegments`/`_agentRafId`
 * @param {{ color?: string, strokeWidthScale?: number }} [opts]
 * @returns {SVGElement|null} null for an empty word
 */
export function renderProseWordAgent(word, spanElement, opts = {}) {
  if (!word) return null;
  const { color = CHALK_COLOR, strokeWidthScale = 1 } = opts;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'hw-agent-word');
  const segmentsTimeline = [];

  let cursorX = 0;
  const baselineY = 86 * SCALE; // shared baseline, matching every transcript's own convention

  for (const char of word) {
    const glyph = getAgentGlyph(char);
    if (glyph) {
      // A perfectly straight vertical stroke ('I', '|') has a native bbox
      // width of exactly 0 — verified directly against the transcript
      // bank, not assumed. Building targetBBox.width as a bare 0*SCALE
      // breaks refitPoint's own internal ratio math (it falls back
      // nativeBBox.width to 1 when dividing, but had no matching fallback
      // on the target side, so the ratio silently collapsed to 0 and
      // every point of the glyph mapped to the same x). Mirroring
      // refitPoint's own `|| 1` fallback here keeps the ratio equal to
      // SCALE regardless of degenerate native widths.
      const targetBBox = {
        x: cursorX,
        y: glyph.bbox.y * SCALE,
        width: (glyph.bbox.width || 1) * SCALE,
        height: (glyph.bbox.height || 1) * SCALE,
      };
      const built = buildGlyphSegments(svg, char, targetBBox, {
        color, strokeWidthScale, minStrokeWidth: MIN_STROKE_WIDTH,
      });
      built.forEach((strokeSegs) => segmentsTimeline.push(strokeSegs));
      // Cursor advance uses its own, separate minimum — unlike the fix
      // above (which only needs to avoid an exact-zero ratio), a
      // real "I" needs a visually sensible amount of horizontal space
      // reserved for it, not the ~1-native-unit sliver that fix alone
      // would give it.
      cursorX += Math.max(glyph.bbox.width, MIN_ADVANCE_NATIVE_WIDTH) * SCALE + LETTER_GUTTER;
    } else {
      cursorX += buildFallbackChar(svg, char, cursorX, baselineY, color, segmentsTimeline) + LETTER_GUTTER;
    }
  }

  if (cursorX === 0) return null;
  const totalW = Math.ceil(cursorX);
  const totalH = Math.ceil(FONT_SIZE * 1.3);
  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.setAttribute('width', totalW + 'px');
  svg.setAttribute('height', totalH + 'px');

  spanElement._agentSegments = segmentsTimeline;
  spanElement._agentRafId = null;
  // Cached the same way agent-math-token.js caches it for equations, so
  // agent-chalkboard-renderer.js can implement instant show/hide
  // uniformly for prose and math tokens via setAgentProgress, without a
  // per-render-kind branch.
  spanElement._agentProgressTimeline = buildProgressTimeline(spanElement);
  return svg;
}

/** True if every character in word has a real transcript (no plain-text fallback needed). */
export function wordFullyCovered(word) {
  return [...word].every((ch) => hasAgentGlyph(ch));
}
