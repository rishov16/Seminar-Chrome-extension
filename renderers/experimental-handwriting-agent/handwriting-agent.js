// Full pipeline for the HandwritingAgent protocol (arxiv.org/abs/2606.18788),
// downstream of the LLM step:
//
//   LaTeX → LLM / Stroke Generator → (x,y,t,pressure) → SVG Path Generator
//        → Browser Animation (requestAnimationFrame)
//
// The LLM step is replayed from pre-generated transcripts
// (handwriting-agent-transcripts.js — see there for why no live API call);
// everything from XML parsing onward runs live here:
// - parse each character's <answer><char><strokes><s1><points>/<t_values>
//   XML into ordered (x, y, t) point sequences (paper §3.2.3),
// - synthesize per-point pressure from pen speed (the protocol XML carries
//   only points + t_values; pressure is the one element of the pipeline
//   sketch not in the wire format, so it's derived: slower pen → heavier
//   pressure → thicker ink, the standard ballistic-writing relationship),
// - smooth through the waypoints with a centripetal Catmull-Rom spline
//   (the paper fits cubic Béziers; centripetal parameterization is used
//   here specifically because it cannot overshoot into loops at tight
//   turns, a failure mode uniform splines hit on sharp-cornered shapes
//   like ≤'s chevron or Δ's vertices),
// - emit one short SVG <path> segment per resampled step, each with its
//   own pressure-scaled stroke-width (SVG has no variable-width single
//   path, so variable width means many small segments; round caps make
//   the joints invisible),
// - animate via requestAnimationFrame, revealing each segment when the
//   clock passes its interpolated t_value — the protocol's "temporal
//   values for the dynamic writing sequence" driving the writing motion
//   directly (rather than a CSS dashoffset transition).
//
// Layout still comes from mathjax-layout.js (MathJax's typeset output is
// this project's equivalent of the paper's grid-canvas slots): each
// glyph's cell-local coordinates are refit into the leaf bbox MathJax
// computed for that symbol.
//
import { wrapEquationLatex } from '../latex-utils.js';
import { queueTypeset } from '../mathjax-queue.js';
// Versioned to match handwriting-agent.html's own import of this module
// exactly — ES modules are instanced per resolved URL, so a bare
// './mathjax-layout.js' here would be a *different* module instance from
// the page's 'mathjax-layout.js?v=8', and worse, one the browser may serve
// stale from cache since no ?v bump ever touches a bare URL. That exact
// staleness once made a user's browser keep an old layout gate (punting
// superscripts) active after it had been lifted on disk. Keep this ?v in
// sync with the page's import when bumping.
import { extractMathLayout } from './mathjax-layout.js?v=8';
// Versioned for the same stale-cache reason as mathjax-layout above.
import { TRANSCRIPTS, CHAR_ALIASES } from './handwriting-agent-transcripts.js?v=11';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHALK_COLOR = '#dff5e3';
const DISPLAY_HEIGHT = 64; // px — MathJax's native equation size is tiny (~18px tall), scaled up to a fixed display height

// ---------------------------------------------------------------- parsing

const glyphBank = new Map(); // char -> { strokes: [{pts:[[x,y,t],...]}], bbox }

function parseTranscript(char, transcript) {
  const answerMatch = transcript.match(/<answer>[\s\S]*<\/answer>/);
  if (!answerMatch) throw new Error(`[handwriting-agent] transcript for ${JSON.stringify(char)} has no <answer> block`);
  const doc = new DOMParser().parseFromString(answerMatch[0], 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`[handwriting-agent] transcript XML for ${JSON.stringify(char)} failed to parse`);
  }

  const strokes = [];
  // Accept any <s*> stroke tag (s1/s2/... per the paper's Figure 6; the
  // protocol text's "<sl>" is that same tag with the 1 misread as l).
  doc.querySelectorAll('char > strokes > *').forEach((el) => {
    if (!/^s/i.test(el.tagName)) return;
    const pointsText = (el.querySelector('points') || {}).textContent || '';
    const tText = (el.querySelector('t_values') || {}).textContent || '';
    const xy = pointsText.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
    const ts = tText.trim().split(/\s+/).map(Number);
    if (xy.length < 2 || xy.length !== ts.length) {
      throw new Error(`[handwriting-agent] malformed stroke in ${JSON.stringify(char)}: ${xy.length} points vs ${ts.length} t_values`);
    }
    strokes.push({ pts: xy.map(([x, y], i) => [x, y, ts[i]]) });
  });
  if (!strokes.length) throw new Error(`[handwriting-agent] no strokes in transcript for ${JSON.stringify(char)}`);

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  strokes.forEach(({ pts }) => pts.forEach(([x, y]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }));
  return { strokes, bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

function canonicalChar(char) {
  return Object.prototype.hasOwnProperty.call(CHAR_ALIASES, char) ? CHAR_ALIASES[char] : char;
}

// Runtime overlay for transcripts synthesized live by
// handwriting-agent-generator.js (Gemini, prompted with this bank's own
// SYSTEM_PROMPT) for characters TRANSCRIPTS has no entry for — kept
// separate from the static imported TRANSCRIPTS object rather than mutating
// it, since that object is a module-level const from another file.
const GENERATED_TRANSCRIPTS = {};

function lookupTranscript(key) {
  return TRANSCRIPTS[key] || GENERATED_TRANSCRIPTS[key];
}

/**
 * A character's parsed transcript — { strokes, bbox } in native cell-local
 * units (see handwriting-agent-transcripts.js's authoring convention) — or
 * null if no transcript exists for it. Exported so other renderers (e.g.
 * a per-word prose builder) can read a glyph's own native bbox for advance-
 * width purposes without duplicating the parse-and-cache logic.
 */
export function getAgentGlyph(char) {
  const key = canonicalChar(char);
  if (glyphBank.has(key)) return glyphBank.get(key);
  const transcript = lookupTranscript(key);
  let glyph = null;
  if (transcript) {
    try {
      glyph = parseTranscript(key, transcript);
    } catch (e) {
      // A malformed transcript degrades to the same fallback as a missing
      // one (gray glyph / plain text) instead of throwing — a throw here
      // once killed an entire production slide because ONE character's
      // transcript ('<', with an unescaped < in its label attribute) was
      // invalid XML. The null is cached, so the warning fires once per
      // character, not once per occurrence.
      console.warn(`[handwriting-agent] falling back for ${JSON.stringify(key)}:`, e.message);
    }
  }
  glyphBank.set(key, glyph);
  return glyph;
}

/**
 * Registers a live-generated transcript (handwriting-agent-generator.js)
 * for a character TRANSCRIPTS has no entry for. Parses it through the same
 * validation path as a pre-authored transcript — an invalid one (bad XML,
 * same failure mode a hand-authored entry can hit) is rejected rather than
 * cached, so a bad generation degrades to the existing fallback instead of
 * corrupting the bank. Busts any cached "not found" result for this
 * character so the very next getAgentGlyph call picks it up.
 * @returns {boolean} whether it was valid and registered
 */
export function registerGeneratedTranscript(char, transcriptXml) {
  const key = canonicalChar(char);
  try {
    const glyph = parseTranscript(key, transcriptXml);
    GENERATED_TRANSCRIPTS[key] = transcriptXml;
    glyphBank.set(key, glyph);
    return true;
  } catch (e) {
    console.warn(`[handwriting-agent] generated transcript for ${JSON.stringify(key)} rejected:`, e.message);
    return false;
  }
}

/**
 * Reads back the segment timeline renderMathLineAgent/renderProseWordAgent
 * stored on spanElement — an accessor rather than having other modules
 * reach for `spanElement._agentSegments` directly, so that internal
 * property name can change without breaking anything outside this file.
 */
export function getSegmentsTimeline(spanElement) {
  return spanElement._agentSegments || null;
}

export function hasAgentGlyph(char) {
  const key = canonicalChar(char);
  return Object.prototype.hasOwnProperty.call(TRANSCRIPTS, key) || Object.prototype.hasOwnProperty.call(GENERATED_TRANSCRIPTS, key);
}

// ------------------------------------------------- smoothing + resampling

// Centripetal Catmull-Rom interpolation between p1 and p2 (p0/p3 are the
// outer neighbors), sampled at parameter u in [0,1].
function catmullRom(p0, p1, p2, p3, u) {
  const alpha = 0.5;
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-6;
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const t = t1 + u * (t2 - t1);
  const lerp = (pa, pb, ta, tb) => {
    const w = (t - ta) / (tb - ta || 1e-6);
    return [pa[0] + (pb[0] - pa[0]) * w, pa[1] + (pb[1] - pa[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

// Waypoints [[x,y,t],...] → dense samples [{x, y, t, pressure}], smoothed
// and with pressure derived from local pen speed.
function resampleStroke(pts) {
  const samples = [];
  if (pts.length === 2) {
    // Straight segment — no spline (2 points carry no curvature intent).
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const w = i / n;
      samples.push({
        x: pts[0][0] + (pts[1][0] - pts[0][0]) * w,
        y: pts[0][1] + (pts[1][1] - pts[0][1]) * w,
        t: pts[0][2] + (pts[1][2] - pts[0][2]) * w,
      });
    }
  } else {
    const per = 6; // samples per waypoint interval
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < per; k++) {
        const u = k / per;
        const [x, y] = catmullRom(p0, p1, p2, p3, u);
        samples.push({ x, y, t: p1[2] + (p2[2] - p1[2]) * u });
      }
    }
    const last = pts[pts.length - 1];
    samples.push({ x: last[0], y: last[1], t: last[2] });
  }

  // Pressure from speed: v_k = ds/dt between neighbors; slower → heavier.
  const speeds = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]; const b = samples[i + 1];
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = Math.max(b.t - a.t, 1e-4);
    speeds.push(ds / dt);
  }
  const sorted = [...speeds].sort((a, b) => a - b);
  const vMed = sorted[Math.floor(sorted.length / 2)] || 1;
  samples.forEach((s, i) => {
    const v = speeds[Math.min(i, speeds.length - 1)] / vMed;
    s.pressure = Math.min(1.35, Math.max(0.6, 1.25 - 0.35 * v));
  });
  return samples;
}

// ------------------------------------------------------------- placement

// Small marks — the multiplication dot ('⋅', a 2x2-native-unit bbox) and
// '.' are the known cases — have a native bbox far tinier than a letter's
// IN BOTH DIMENSIONS, since bbox is just the literal min/max of their
// (intentionally tiny) ink points. Using that directly as the scale-
// reference denominator assumes bbox size roughly tracks a glyph's full
// visual weight (true for letters, false for a dot), so it blew both
// position and stroke-width up by ~10x — but ONLY where that assumption is
// actually wrong: an EQUATION token's targetBBox comes from MathJax's own
// independent layout (renderMathLineAgent), unrelated to the glyph's native
// bbox, so a tiny native bbox against a normal-sized target really does
// blow the scale up (verified against '⋅'s transcript after a user
// reported "6 • ¼ • ¼" showing fat bullets instead of small dots).
//
// PROSE is a different story entirely, and must NOT get this floor: its
// targetBBox (agent-prose-word.js) is built *proportionally from the
// glyph's own bbox* (same SCALE constant on both axes, by construction),
// so cellScale there is always exactly SCALE regardless of the glyph's
// size or aspect ratio — a dot, an 'i', a '−' are all already correctly,
// consistently scaled with no bug to fix. Applying the floor there anyway
// (tried first, before this comment) regressed 'i' (bbox 2x60) and '−'/'-'
// (bbox 40x1) into near-invisible slivers, and — if gated on "both axes
// tiny" instead to spare those — would have equally broken the ordinary,
// correctly-sized period/dot in running prose text. So this floor is
// applied ONLY where buildGlyphSegments is told the target is independent
// (opts.independentTarget, set by the equation call site only).
const MIN_SCALE_REFERENCE_DIM = 20;

function tinyMarkScaleReference(bboxWidth, bboxHeight) {
  const w = bboxWidth || 1;
  const h = bboxHeight || 1;
  const bothTiny = w < MIN_SCALE_REFERENCE_DIM && h < MIN_SCALE_REFERENCE_DIM;
  return bothTiny ? { width: MIN_SCALE_REFERENCE_DIM, height: MIN_SCALE_REFERENCE_DIM } : { width: w, height: h };
}

// Uniform-scale refit of a glyph's cell-local bbox into a target bbox,
// centered on the slack axis. Applied numerically to each point (rather
// than as a single SVG transform attribute on a group) since every
// resampled step becomes its own small segment with its own pressure-scaled
// stroke-width, computed in final coordinates. Takes whatever nativeBBox
// it's handed at face value — buildGlyphSegments decides whether that's
// the glyph's raw bbox or a tiny-mark-floored version of it.
function refitPoint(x, y, nativeBBox, targetBBox) {
  const nw = nativeBBox.width || 1;
  const nh = nativeBBox.height || 1;
  const s = Math.min(targetBBox.width / nw, targetBBox.height / nh);
  const ox = targetBBox.x + (targetBBox.width - nw * s) / 2;
  const oy = targetBBox.y + (targetBBox.height - nh * s) / 2;
  return [ox + (x - nativeBBox.x) * s, oy + (y - nativeBBox.y) * s];
}

// Delimiters MathJax can stretch to any height (matrix/cases brackets,
// tall inline parens) — their hand-drawn transcripts are narrow, tall
// shapes (e.g. '(' is 15 native units wide by 94 tall) that are *more*
// slender than any real MathJax leaf box asks for, at any size. That means
// refitPoint's uniform Math.min scaling always ends up height-limited,
// leaving the bracket's curve narrower than MathJax's own glyph box —
// subtle inline, obvious once a leaf box gets tall (a 2-row matrix
// delimiter). Verified numerically (not assumed): widthScale ends up
// larger than heightScale for '(' in both a plain "(x)" context and a
// stretched matrix context, so this uses independent x/y scaling
// unconditionally for these characters, not just above some size
// threshold — real extensible bracket glyphs get proportionally wider as
// they stretch too, so this isn't a special case so much as a more
// accurate fit than a single uniform scale factor ever gives these shapes.
// '√' (the radical hook) joins this set too — its height scales with the
// radicand's height independently of its own width (empirically: 14.9×19.0
// for \sqrt{x} vs 17.3×22.9 for \sqrt{x+y}, same story as a paren). '―'
// (\overline's bar) joins for the same reason on the other axis — its
// width genuinely grows with content length (16.3 for \overline{x} vs 43.5
// for \overline{xyz}) while height stays ~0.
const STRETCHY_CHARS = new Set(['(', ')', '[', ']', '|', '√', '―', '{', '}']);

function refitPointNonUniform(x, y, nativeBBox, targetBBox) {
  const sx = targetBBox.width / (nativeBBox.width || 1);
  const sy = targetBBox.height / (nativeBBox.height || 1);
  return [targetBBox.x + (x - nativeBBox.x) * sx, targetBBox.y + (y - nativeBBox.y) * sy];
}

/**
 * Builds and appends the drawable stroke segments for one glyph refit into
 * targetBBox, in native SVG units — the exact per-character geometry
 * pipeline (stretchy detection, resampling, pressure-scaled width) used by
 * renderMathLineAgent, factored out so a prose renderer can place single
 * characters the same way without duplicating this logic. Segments start
 * at opacity 0, ready for a caller-driven reveal (e.g. startAgentWriting
 * against whatever _agentSegments-shaped array the caller assembles).
 *
 * @param {SVGElement} svg - segments are appended here
 * @param {string} char
 * @param {{x:number,y:number,width:number,height:number}} targetBBox
 * @param {{ color?: string, strokeWidthScale?: number, minStrokeWidth?: number }} [opts]
 *   minStrokeWidth: floor on stroke width, in the same native units as targetBBox
 * @returns {Array<Array<{el:SVGElement,t:number}>>|null} one array of
 *   {el,t} per stroke (t local to that stroke, in [0,1]), or null if char
 *   has no transcript — caller should fall back (e.g. addStaticGlyph, or a
 *   plain-text glyph where no MathJax outline exists to fall back to).
 */
export function buildGlyphSegments(svg, char, targetBBox, opts = {}) {
  const { color = CHALK_COLOR, strokeWidthScale = 1, minStrokeWidth = 1.6, independentTarget = false } = opts;
  const glyph = getAgentGlyph(char);
  if (!glyph) return null;

  const stretchy = STRETCHY_CHARS.has(char);
  // The tiny-mark floor only ever applies when the caller says targetBBox
  // was computed independently of this glyph's own bbox (equations, via
  // MathJax's layout — renderMathLineAgent passes independentTarget: true)
  // AND it isn't a stretchy delimiter (those get independent x/y scaling
  // below instead, already correct for their own reasons). Prose
  // (agent-prose-word.js) never passes independentTarget — its targetBBox
  // is built proportionally from this same glyph.bbox, so cellScale is
  // already exactly right regardless of size; flooring there would break
  // that self-consistency (see the comment above tinyMarkScaleReference).
  const effectiveNativeBBox = (independentTarget && !stretchy)
    ? { ...glyph.bbox, ...tinyMarkScaleReference(glyph.bbox.width, glyph.bbox.height) }
    : glyph.bbox;
  const cellScale = stretchy
    ? Math.sqrt((targetBBox.width / (glyph.bbox.width || 1)) * (targetBBox.height / (glyph.bbox.height || 1)))
    : Math.min(targetBBox.width / (effectiveNativeBBox.width || 1), targetBBox.height / (effectiveNativeBBox.height || 1));
  const baseWidth = Math.max(4.5 * cellScale, minStrokeWidth) * strokeWidthScale;
  const refit = stretchy ? refitPointNonUniform : refitPoint;
  const refitNativeBBox = stretchy ? glyph.bbox : effectiveNativeBBox;

  const segmentsForGlyph = [];
  glyph.strokes.forEach(({ pts }) => {
    const samples = resampleStroke(pts);
    const strokeSegs = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const [ax, ay] = refit(a.x, a.y, refitNativeBBox, targetBBox);
      const [bx, by] = refit(b.x, b.y, refitNativeBBox, targetBBox);
      const seg = document.createElementNS(SVG_NS, 'path');
      seg.setAttribute('d', `M${ax.toFixed(2)},${ay.toFixed(2)} L${bx.toFixed(2)},${by.toFixed(2)}`);
      seg.setAttribute('fill', 'none');
      seg.setAttribute('stroke', color);
      seg.setAttribute('stroke-width', (baseWidth * a.pressure).toFixed(3));
      seg.setAttribute('stroke-linecap', 'round');
      seg.style.opacity = '0';
      svg.appendChild(seg);
      strokeSegs.push({ el: seg, t: a.t });
    }
    segmentsForGlyph.push(strokeSegs);
  });
  return segmentsForGlyph;
}

// Static fallback for characters with no transcript: MathJax's own glyph
// outline, not animated stroke-by-stroke (there's no pen trajectory to
// replay). Filled with the same chalk color as every hand-drawn character
// (not the dimmer gray this used to hardcode) — that gray was originally a
// deliberate "this one's a fallback" visual marker, but curly braces (no
// transcript at all — see STRETCHY_CHARS in this file and the coverage
// list in HANDWRITING_AGENT.md) turned out to need this path routinely
// once the Head Agent started correctly escaping literal \{ \} for
// probability set-builder notation (agents/head-agent.js) instead of
// writing them bare (where they'd silently vanish as LaTeX grouping
// syntax) — a low-contrast gray brace against the dark board was reported
// as effectively invisible at a glance, verified by rendering it forced to
// full opacity: it was there, just much fainter than the surrounding white
// ink. MathJax's SVG glyph outlines are authored in the standard font
// convention — Y increasing *upward*, baseline at 0 — and MathJax flips
// that to screen (Y-down) coordinates via a transform on an ancestor
// element that the raw `d` string alone doesn't carry. Skipping the flip
// looks identical to correct for anything top-bottom symmetric (digits, +,
// =) and only becomes obviously wrong for something asymmetric — found by
// rendering \Delta alone and getting an upside-down triangle (∇ instead of
// Δ). The `matrix(1,0,0,-1,0,...)` below undoes it, mirroring around the
// glyph's own native bbox center so the bbox extents stay unchanged.
//
// Still joins the same rAF reveal timeline as every hand-drawn stroke
// (pushed as a one-segment synthetic "stroke") so it takes its natural
// turn in writing order instead of popping in at full opacity the instant
// the SVG is built — `hwFade` on the dataset marks it so startAgentWriting
// gives it a real CSS opacity transition instead of the instant on/off
// toggle real stroke segments use (a stroke segment "existing" is already
// a discrete event; a whole glyph appearing at once reads better as a
// soft fade than a hard cut).
let measureHost = null;
function addStaticGlyph(svg, leaf, segmentsTimeline, color = CHALK_COLOR) {
  if (!leaf.glyphPathData.length) return;
  if (!measureHost) {
    measureHost = document.createElement('div');
    measureHost.style.cssText = 'visibility:hidden; position:absolute; left:-99999px; top:0;';
    document.body.appendChild(measureHost);
  }
  const tmpSvg = document.createElementNS(SVG_NS, 'svg');
  const tmpPath = document.createElementNS(SVG_NS, 'path');
  tmpPath.setAttribute('d', leaf.glyphPathData.join(' '));
  tmpSvg.appendChild(tmpPath);
  measureHost.appendChild(tmpSvg);
  const nb = tmpPath.getBBox();
  measureHost.removeChild(tmpSvg);

  const s = Math.min(leaf.bbox.width / (nb.width || 1), leaf.bbox.height / (nb.height || 1));
  const ox = leaf.bbox.x + (leaf.bbox.width - nb.width * s) / 2;
  const oy = leaf.bbox.y + (leaf.bbox.height - nb.height * s) / 2;
  const glyphEl = document.createElementNS(SVG_NS, 'path');
  glyphEl.setAttribute('d', leaf.glyphPathData.join(' '));
  glyphEl.setAttribute(
    'transform',
    `translate(${ox - nb.x * s},${oy - nb.y * s}) scale(${s},${s}) matrix(1,0,0,-1,0,${2 * nb.y + nb.height})`
  );
  glyphEl.setAttribute('fill', color);
  glyphEl.style.opacity = '0';
  glyphEl.dataset.hwFade = '1';
  svg.appendChild(glyphEl);
  segmentsTimeline.push([{ el: glyphEl, t: 0 }]);
}

// ------------------------------------------------------------ rendering

/**
 * Renders a LaTeX line entirely via the HandwritingAgent protocol bank —
 * no bridge server, no other renderer involved.
 *
 * @param {string} latex - raw LaTeX (not yet wrapped)
 * @param {HTMLElement} spanElement - receives `_agentSegments` animation state
 * @param {{ color?: string, strokeWidthScale?: number,
 *           pxPerUnit?: number, minHeightPx?: number, maxHeightPx?: number,
 *           maxWidthPx?: number }} [opts]
 *   Sizing: by default the rendered SVG is scaled so its total height is a
 *   fixed DISPLAY_HEIGHT px — right for a standalone demo, wrong inside
 *   flowing slide content, where it makes a lone inline `$p$` tower over
 *   the prose beside it and crushes a multi-row derivation into the same
 *   64px. Passing pxPerUnit switches to proportional sizing (display px
 *   per MathJax native unit, optionally clamped) so an equation's size
 *   tracks its actual content: agent-chalkboard uses a small pxPerUnit for
 *   inline math (matching prose scale) and a larger one for display
 *   equations.
 * @returns {Promise<{ svg: SVGElement|null, unsupported: boolean, error?: boolean, errorMessage?: string }>}
 */
export async function renderMathLineAgent(latex, spanElement, opts = {}) {
  const { color = CHALK_COLOR, strokeWidthScale = 1 } = opts;
  const wrapped = wrapEquationLatex(latex);

  // Dedicated typeset host per call, not a shared/memoized one: the page
  // calls this and renderDebugOverlay's own extractMathLayout concurrently
  // (Promise.all) — sharing one host would let one call's
  // `stagingHost.innerHTML = ''` clear the other's in-progress content
  // mid-typeset.
  const typesetHost = document.createElement('div');
  typesetHost.style.cssText = 'visibility:hidden; position:absolute; left:-99999px; top:0;';
  document.body.appendChild(typesetHost);
  let layout;
  try {
    layout = await extractMathLayout(wrapped, typesetHost, queueTypeset);
  } finally {
    document.body.removeChild(typesetHost);
  }
  if (layout.unsupported) return { svg: null, unsupported: true };
  // Malformed/unparseable LaTeX (merror, an unrecognized macro's raw red
  // text, or MathJax producing no container at all) — surfaced distinctly
  // from `unsupported` so the caller can show a clean explanation instead
  // of confidently hand-drawing whatever garbage characters an error state
  // happens to contain.
  if (layout.error) return { svg: null, unsupported: false, error: true, errorMessage: layout.errorMessage };
  if (layout.leaves.length === 0) return { svg: null, unsupported: false };

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'hw-math-agent');
  const { x, y, width, height } = layout.containerBBox;
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  let displayScale;
  if (opts.pxPerUnit) {
    displayScale = opts.pxPerUnit;
    if (opts.maxHeightPx && height * displayScale > opts.maxHeightPx) displayScale = opts.maxHeightPx / height;
    if (opts.minHeightPx && height * displayScale < opts.minHeightPx) displayScale = opts.minHeightPx / height;
    // A long multi-term derivation (several conditional-probability terms
    // chained with +) has modest height but can run arbitrarily wide —
    // the height clamps above don't bound that at all, so it was free to
    // overflow the board's right edge with no wrap (equations render as
    // one unbroken display-math line) and no visible scroll affordance.
    // Applied last, after the height clamps, so a maxWidthPx narrower than
    // what height-based scaling would have given further shrinks the whole
    // equation uniformly (both axes) rather than distorting its aspect ratio.
    if (opts.maxWidthPx && width * displayScale > opts.maxWidthPx) displayScale = opts.maxWidthPx / width;
  } else {
    displayScale = DISPLAY_HEIGHT / height;
  }
  svg.setAttribute('width', Math.ceil(width * displayScale) + 'px');
  svg.setAttribute('height', Math.ceil(height * displayScale) + 'px');

  // Protocol config says Stroke Width 4.50 on a 1000x500 canvas with
  // ~100-unit-tall glyph cells; scaled to each leaf's height that ratio
  // (4.5/100) is preserved, then converted to this svg's native units.
  const segmentsTimeline = []; // flattened [{el, tStart}] in writing order

  // Equation-level pen width for synthetic strokes with no glyph cell of
  // their own (fraction bars), in native units — same sizing rule the
  // neural renderer uses for its whole-equation width. Derived from the
  // actual on-screen height (not the fixed DISPLAY_HEIGHT constant) so it
  // stays proportionate under pxPerUnit sizing too.
  const equationPenWidth = (Math.max(1.2, (height * displayScale) * 0.045) * strokeWidthScale) / displayScale;

  layout.leaves.forEach((leaf) => {
    if (leaf.kind === 'frac-bar' || leaf.kind === 'radical-bar') {
      // A fraction rule or a radical's overbar: both are just one straight
      // horizontal pen stroke, sampled into a handful of segments so the
      // rAF timeline sweeps it left to right like every other stroke.
      const midY = leaf.bbox.y + leaf.bbox.height / 2;
      const n = 10;
      const strokeSegs = [];
      for (let i = 0; i < n; i++) {
        const ax = leaf.bbox.x + (leaf.bbox.width * i) / n;
        const bx = leaf.bbox.x + (leaf.bbox.width * (i + 1)) / n;
        const seg = document.createElementNS(SVG_NS, 'path');
        seg.setAttribute('d', `M${ax.toFixed(2)},${midY.toFixed(2)} L${bx.toFixed(2)},${midY.toFixed(2)}`);
        seg.setAttribute('fill', 'none');
        seg.setAttribute('stroke', color);
        seg.setAttribute('stroke-width', equationPenWidth.toFixed(3));
        seg.setAttribute('stroke-linecap', 'round');
        seg.style.opacity = '0';
        svg.appendChild(seg);
        strokeSegs.push({ el: seg, t: i / n });
      }
      segmentsTimeline.push(strokeSegs);
      return;
    }

    const built = buildGlyphSegments(svg, leaf.char, leaf.bbox, {
      color, strokeWidthScale, minStrokeWidth: 1.6 / displayScale, independentTarget: true,
    });
    if (!built) { addStaticGlyph(svg, leaf, segmentsTimeline, color); return; }
    built.forEach((strokeSegs) => segmentsTimeline.push(strokeSegs));
  });

  spanElement._agentSegments = segmentsTimeline;
  spanElement._agentRafId = null;
  // baselinePx: how far below the SVG's top edge the math baseline sits, in
  // display px — lets a caller placing this inline in prose drop the token
  // so its baseline meets the surrounding text's baseline (see
  // agent-chalkboard-renderer.js). (layout.baselineFraction defaults to 1
  // when unreadable, i.e. baseline at the bottom — a no-op adjustment.)
  const baselinePx = (layout.baselineFraction ?? 1) * height * displayScale;
  return { svg, unsupported: false, baselinePx };
}

/**
 * Per-stroke duration (from its drawn length, display px, scaled by the
 * speed slider, clamped so dots don't blink and long strokes don't crawl)
 * and cumulative start time (with a pen-lift pause between strokes).
 * Pure geometry — no wall-clock dependency — so it's shared by
 * startAgentWriting's real-time playback and progress-timeline.js's
 * scrub-to-an-arbitrary-progress model, rather than duplicating this
 * formula in two places.
 *
 * @param {Array<Array<{el:SVGElement,t:number}>>} strokes
 * @param {number} speed
 * @param {number} [pauseMs] - pen-lift pause between strokes, in ms.
 *   Defaults to 70, tuned for equations (a handful of strokes, worth
 *   watching closely). Prose is a different regime: a typical 8-12
 *   letter word has ~12-18 individual strokes, and even with speed
 *   cranked up this pause alone (unscaled by speed, unlike stroke
 *   duration) added 840ms-1260ms per word on its own — several times
 *   slower than natural speech, so ANY reasonably-paced reveal (staggered
 *   starts, real narration timing) ended up with multiple words visibly
 *   mid-stroke at once no matter how well the *starts* were staggered.
 *   renderers/agent-chalkboard/agent-chalkboard-renderer.js passes a much
 *   smaller value for prose tokens specifically; equations keep the
 *   default.
 * @returns {{ durations: number[], starts: number[], total: number }}
 */
export function computeStrokeTiming(strokes, speed, pauseMs = 70) {
  const durations = strokes.map((segs) => {
    let len = 0;
    segs.forEach(({ el }) => { len += el.getTotalLength ? el.getTotalLength() : 2; });
    return Math.min(900, Math.max(120, len * 6)) / (speed / 0.35);
  });
  const starts = [];
  let acc = 0;
  durations.forEach((d, i) => { starts[i] = acc; acc += d + pauseMs; });
  return { durations, starts, total: acc > 0 ? acc - pauseMs : 0 };
}

/**
 * Plays the writing animation: strokes strictly in sequence, and within
 * each stroke, segments revealed when the clock passes their t_value —
 * the requestAnimationFrame stage of the pipeline sketch.
 * @param {number} speed - the page's draw-speed slider value; lower = slower
 * @param {number} [pauseMs] - see computeStrokeTiming's own doc comment
 */
export function startAgentWriting(spanElement, speed = 0.35, pauseMs = 70) {
  const strokes = spanElement._agentSegments;
  if (!strokes || !strokes.length) return;
  if (spanElement._agentRafId) cancelAnimationFrame(spanElement._agentRafId);
  // transition reset to 'none' so a replay snaps a fallback glyph back to
  // invisible instantly rather than fading it out first (the fade-in
  // transition is only (re-)applied at reveal time, below).
  strokes.forEach((segs) => segs.forEach(({ el }) => { el.style.transition = 'none'; el.style.opacity = '0'; }));

  const { durations: strokeDurations, starts: strokeStarts } = computeStrokeTiming(strokes, speed, pauseMs);

  const t0 = performance.now();
  const tick = (now) => {
    const elapsed = now - t0;
    let done = true;
    strokes.forEach((segs, si) => {
      const local = (elapsed - strokeStarts[si]) / strokeDurations[si];
      if (local < 1) done = false;
      segs.forEach(({ el, t }) => {
        if (local >= t) {
          if (el.dataset.hwFade) el.style.transition = 'opacity 200ms ease-in';
          el.style.opacity = '1';
        }
      });
    });
    if (!done) spanElement._agentRafId = requestAnimationFrame(tick);
    else spanElement._agentRafId = null;
  };
  spanElement._agentRafId = requestAnimationFrame(tick);
}

/**
 * Cancels any in-flight startAgentWriting animation on spanElement, if
 * one is running. An accessor for the same reason getSegmentsTimeline is
 * — so a caller that needs to snap straight to a specific reveal state
 * (e.g. an instant show/hide, bypassing real-time playback) doesn't reach
 * into the internal `_agentRafId` property directly.
 */
export function stopAgentWriting(spanElement) {
  if (spanElement._agentRafId) {
    cancelAnimationFrame(spanElement._agentRafId);
    spanElement._agentRafId = null;
  }
}
