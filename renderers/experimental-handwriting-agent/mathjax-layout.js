// Extracts per-symbol 2D position/scale/identity out of MathJax's own SVG
// typeset output, so a hand-drawn renderer can place strokes exactly where
// MathJax already decided each symbol belongs — fraction stacking,
// superscript shrinking, radical sizing, all "for free" without
// reimplementing any LaTeX layout ourselves.
//
// Two facts about this repo's MathJax setup make this tractable:
// - ui/mathjax-config.js sets `svg: { fontCache: 'none' }`, so every leaf
//   glyph renders as an inline `<path data-c="HEX" d="...">` directly under
//   its `<g data-mml-node="mi|mn|mo|mtext">` wrapper — no <defs>/<use>
//   indirection to resolve.
// - MathJax's assistive-mathml mirror (`<mjx-assistive-mml>`, on by default)
//   is a real parsed DOM tree holding the original literal Unicode
//   characters, built by the same recursive walk over the same MmlNode
//   tree as the visual SVG — so a DFS-preorder walk of both trees, each
//   filtered to token kinds, produces two sequences that line up 1:1 by
//   index. That sidesteps decoding data-c's Unicode codepoint back to a
//   character (fragile across mathvariants — italic mi tokens use
//   Mathematical Alphanumeric Symbols codepoints, not plain ASCII).
//
// Position comes from the browser's own getBoundingClientRect(), not by
// hand-parsing MathJax's transform="..." strings (which take at least
// three different forms internally — translate(), matrix() for the
// internal y-flip, scale()+translate() for cached glyph placement — and
// reconstructing the accumulated matrix by hand is exactly the kind of
// thing that's fragile in an edge case). A leaf's bbox already reflects any
// scriptlevel shrink (e.g. a superscript), so there's no separate "scale
// relative to base font-size" to track.

const TOKEN_KINDS = new Set(['mi', 'mn', 'mo', 'mtext']);

// Structural kinds requiring special handling, all resolved — kept as an
// empty set (rather than deleted) as the designated place to punt a future
// construct that turns out not to decompose as cleanly as these did.
//
// msup/msub/msubsup/mfrac used to need a punt here (the Phase 1 boundary)
// but need none after all, verified empirically: a script's children are
// ordinary token leaves whose getBoundingClientRect() already reflects
// MathJax's scriptlevel shrink and raised/lowered placement, and they
// appear in the assistive-mathml tree in the same DFS order, so the
// count-alignment zip below holds unchanged. Fractions additionally need
// their bar extracted — the rule is a bare <rect> child of the mfrac <g>,
// not a token leaf, with no assistive-tree counterpart (handled as a
// synthetic 'frac-bar' leaf below, merged in document order so writing
// order stays natural: numerator, denominator, then bar).
//
// msqrt/mroot used to need a punt too. Verified empirically (real DOM
// inspection of \sqrt{x}, \sqrt{x+y}, \sqrt{a+b+c+d+e}, \sqrt[3]{x},
// \sqrt[n]{x+y}): both render as their radicand's ordinary token content
// (already handled by the generic walk below) plus two extras that are NOT
// ordinary tokens — a direct-child <g data-mml-node="mo"> holding the hook
// glyph (data-c 221A), and a direct-child bare <rect> holding the overbar,
// exactly parallel to mfrac's bar. The hook has no assistive-mathml
// counterpart (it's a rendering artifact, not a semantic MathML token), so
// it's excluded from the generic TOKEN_KINDS walk below — left in, it
// would trip the visual/assistive count-mismatch check — and re-added as a
// synthetic leaf with a known character ('√'), same pattern as frac-bar.
// mroot's index (the "3" in \sqrt[3]{x}) turned out to need nothing extra
// at all: verified it's an ordinary mn/mi token *with* an assistive-tree
// counterpart, already scaled/positioned correctly by the same generic
// script-handling that superscripts use — the only mroot-specific work is
// widening the hook/bar selectors below to match either parent.
const UNSUPPORTED_KINDS = new Set([]);

// Zero-width "operator" characters MathJax inserts for implicit
// multiplication/function-application (e.g. between adjacent factors like
// "5x") — present in both trees symmetrically (so they don't break the
// count-alignment check below), but have no ink to draw, so they're
// filtered out of the final leaves list by the zero-size bbox check.
const INVISIBLE_CHARS = new Set(['⁡', '⁢', '⁣', '⁤']);

// How MathJax signals malformed/unparseable LaTeX — verified empirically
// (not assumed) against real broken input, because it turns out to take two
// different, easily-missed forms:
// - A genuine TeX syntax error (unclosed \begin{aligned}, a bad script) adds
//   a `<g data-mml-node="merror" data-mjx-error="...">` node with a useful
//   description in the attribute.
// - An *unrecognized macro* (e.g. a typo'd command name) has no merror node
//   at all — MathJax just renders the raw source text verbatim as a normal
//   mtext token, colored red. Since mtext is a TOKEN_KINDS member, this
//   would otherwise sail straight through extraction as if it were
//   legitimate content, and get hand-drawn character-by-character as
//   confident-looking nonsense — a worse failure than a crash, since it
//   looks like real output. Both forms use MathJax's own red error color,
//   so checking for `fill="red"` catches the undeclared case without
//   needing to enumerate every way TeX can be malformed.
const ERROR_SELECTOR = '[data-mml-node="merror"], [fill="red"], [stroke="red"]';

/**
 * @param {string} wrappedLatex - LaTeX already run through wrapEquationLatex()
 * @param {HTMLElement} stagingHost - a hidden but *attached* element MathJax
 *   can typeset into (visibility:hidden + off-screen position — NEVER
 *   display:none, which makes getBoundingClientRect() return all-zero rects)
 * @param {(elements: HTMLElement[]) => Promise<void>} queueTypeset - the
 *   shared MathJax typeset queue (renderers/mathjax-queue.js) — MathJax's
 *   typesetPromise() is not reentrant, so this must never be called directly
 * @returns {Promise<{
 *   unsupported: true
 * } | {
 *   unsupported: false, error: true, errorMessage: string
 * } | {
 *   unsupported: false,
 *   containerBBox: {x:number, y:number, width:number, height:number},
 *   leaves: Array<{ char: string|null, kind: string, bbox: {x:number,y:number,width:number,height:number}, glyphPathData: string[] }>
 *     (char is null only for kind 'frac-bar'/'radical-bar' — a plain horizontal stroke, no glyph)
 * }>}
 */
export async function extractMathLayout(wrappedLatex, stagingHost, queueTypeset) {
  if (!(window.MathJax && window.MathJax.startup && window.MathJax.startup.promise)) {
    throw new Error('[mathjax-layout] window.MathJax is not loaded yet');
  }
  await window.MathJax.startup.promise;

  stagingHost.innerHTML = '';
  const holder = document.createElement('div');
  holder.textContent = wrappedLatex;
  stagingHost.appendChild(holder);

  await queueTypeset([stagingHost]);

  const mjxContainer = holder.querySelector('mjx-container');
  if (!mjxContainer) {
    // Some malformed input (e.g. a top-level unclosed brace) makes MathJax
    // give up before producing any container at all, with no exception
    // thrown — a content problem, not a code bug, so this is reported the
    // same way as the merror/red-text cases below rather than thrown.
    return { unsupported: false, error: true, errorMessage: 'MathJax could not parse this LaTeX.' };
  }

  // querySelector('') throws (not a no-match null) once UNSUPPORTED_KINDS
  // is empty, so this only runs the check when there's something to check.
  if (UNSUPPORTED_KINDS.size > 0
    && mjxContainer.querySelector([...UNSUPPORTED_KINDS].map((k) => `[data-mml-node="${k}"]`).join(','))) {
    return { unsupported: true };
  }

  const errorEl = mjxContainer.querySelector(ERROR_SELECTOR);
  if (errorEl) {
    const detail = mjxContainer.querySelector('[data-mjx-error]')?.getAttribute('data-mjx-error');
    return {
      unsupported: false,
      error: true,
      errorMessage: detail || 'MathJax could not parse this LaTeX.',
    };
  }

  const visualLeaves = Array.from(mjxContainer.querySelectorAll('[data-mml-node]'))
    .filter((el) => TOKEN_KINDS.has(el.getAttribute('data-mml-node')))
    // Exclude msqrt/mroot's radical-hook mo — see UNSUPPORTED_KINDS comment
    // above for why (no assistive-tree counterpart; re-added as a synthetic
    // leaf below, after the count-alignment check this would otherwise
    // break). mroot's index (the "3" in \sqrt[3]{x}) is a *different*
    // child — an ordinary mn/mi with a real assistive counterpart — so it's
    // deliberately not excluded here.
    .filter((el) => !(el.getAttribute('data-mml-node') === 'mo'
      && ['msqrt', 'mroot'].includes(el.parentElement.getAttribute('data-mml-node'))));

  const assistiveRoot = mjxContainer.querySelector('mjx-assistive-mml');
  if (!assistiveRoot) {
    throw new Error('[mathjax-layout] no <mjx-assistive-mml> found — is enableAssistiveMml disabled?');
  }
  // Custom DFS instead of querySelectorAll: for msubsup (a base with BOTH
  // a subscript and a superscript, e.g. P^{2n}_{00}), MathJax's *visual*
  // SVG emits the superscript's tokens before the subscript's in document
  // order, while the assistive MathML's child order is the MathML-spec
  // base/subscript/superscript. A flat zip therefore paired every
  // post-base token with the wrong glyph — verified empirically on
  // P^{2n}_{00}, where the sup "2" was labeled "00", the sup "n" labeled
  // "2", and the sub "00" labeled "n", exactly reproducing a garbled
  // production slide. The token *counts* still matched, so the
  // count-mismatch guard below sailed right past it. Visiting msubsup's
  // assistive children as [base, superscript, subscript] restores 1:1
  // pairing. munderover (∑/∫ limits) does NOT have the flip — its visual
  // order matches the assistive base/under/over — also verified
  // empirically, so it's deliberately left alone here.
  const assistiveLeaves = [];
  (function collectAssistive(node) {
    const name = (node.tagName || '').toLowerCase();
    if (name === 'mi' || name === 'mn' || name === 'mo' || name === 'mtext') {
      assistiveLeaves.push(node);
      return;
    }
    let children = Array.from(node.children);
    if (name === 'msubsup' && children.length === 3) {
      children = [children[0], children[2], children[1]];
    }
    children.forEach(collectAssistive);
  })(assistiveRoot);

  if (visualLeaves.length !== assistiveLeaves.length) {
    throw new Error(
      `[mathjax-layout] visual/assistive token count mismatch for "${wrappedLatex}": `
      + `${visualLeaves.length} visual vs ${assistiveLeaves.length} assistive — `
      + `extraction assumptions are broken, refusing to guess an alignment`
    );
  }

  const containerRect = mjxContainer.getBoundingClientRect();
  const toRelative = (rect) => ({
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  });

  // Where the math baseline (MathJax's y=0 line) sits as a fraction of the
  // container's height, measured from its top. MathJax authors the SVG
  // viewBox as "minX minY W H" with the baseline at y=0 and minY negative
  // (the ascent above the baseline), so ascent = -minY and this fraction is
  // -minY / H. A caller placing inline math inside a line of prose uses this
  // to drop the math token so its own baseline lands on the prose baseline,
  // instead of top-aligning it (which makes it visibly float above the
  // surrounding words). Defaults to 1 (baseline at the very bottom) if the
  // viewBox can't be read, matching the old no-adjustment behavior.
  let baselineFraction = 1;
  const innerSvg = mjxContainer.querySelector('svg');
  const vb = innerSvg && innerSvg.getAttribute('viewBox');
  if (vb) {
    const [, minY, , h] = vb.split(/\s+/).map(Number);
    if (h > 0 && Number.isFinite(minY)) baselineFraction = Math.min(1, Math.max(0, -minY / h));
  }

  const entries = [];
  for (let i = 0; i < visualLeaves.length; i++) {
    entries.push({
      el: visualLeaves[i],
      char: assistiveLeaves[i].textContent,
      kind: visualLeaves[i].getAttribute('data-mml-node'),
    });
  }
  // Fraction bars: bare <rect> children of each mfrac group (verified
  // structure — see UNSUPPORTED_KINDS comment). No character identity, no
  // glyph path; renderers draw them as a plain horizontal stroke.
  mjxContainer.querySelectorAll('g[data-mml-node="mfrac"] > rect').forEach((rectEl) => {
    entries.push({ el: rectEl, char: null, kind: 'frac-bar' });
  });
  // Radical hook + overbar (msqrt or mroot — same structure either way, see
  // UNSUPPORTED_KINDS comment for why these are synthetic entries rather
  // than part of the generic walk above). The hook gets a known character
  // ('√', has its own transcript) and flows through the ordinary
  // single-character leaf path below; the overbar draws identically to a
  // fraction's bar, just under a distinct kind label.
  mjxContainer.querySelectorAll('g[data-mml-node="msqrt"] > g[data-mml-node="mo"], g[data-mml-node="mroot"] > g[data-mml-node="mo"]').forEach((hookEl) => {
    entries.push({ el: hookEl, char: '√', kind: 'mo' });
  });
  mjxContainer.querySelectorAll('g[data-mml-node="msqrt"] > rect, g[data-mml-node="mroot"] > rect').forEach((rectEl) => {
    entries.push({ el: rectEl, char: null, kind: 'radical-bar' });
  });
  // Document order = natural writing order (numerator, denominator, bar).
  entries.sort((a, b) => ((a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1));

  const leaves = [];
  for (const { el, char, kind } of entries) {
    if (char !== null && INVISIBLE_CHARS.has(char)) continue;

    if (kind === 'frac-bar' || kind === 'radical-bar') {
      const bbox = toRelative(el.getBoundingClientRect());
      if (bbox.width === 0 || bbox.height === 0) continue;
      leaves.push({ char, kind, bbox, glyphPathData: [] });
      continue;
    }

    // Multi-character tokens (function names like "sin"/"lim", multi-digit
    // numbers like "42") render as one <path data-c> per character inside a
    // single <g data-mml-node="mi|mn|...">  wrapper — verified empirically
    // (not assumed): the paths appear in left-to-right document order,
    // lining up 1:1 by index with `char`'s own characters. Split into one
    // leaf per character, each keeping its own path's real bbox, instead of
    // treating the whole run as one atomic glyph — the stroke bank only has
    // single-character entries, so an atomic multi-char leaf always missed
    // and fell through to the static gray fallback.
    const charPaths = Array.from(el.querySelectorAll('path[data-c]'));
    if (char.length > 1 && charPaths.length === char.length) {
      for (let i = 0; i < charPaths.length; i++) {
        const bbox = toRelative(charPaths[i].getBoundingClientRect());
        if (bbox.width === 0 || bbox.height === 0) continue;
        leaves.push({ char: char[i], kind, bbox, glyphPathData: [charPaths[i].getAttribute('d')] });
      }
      continue;
    }

    const bbox = toRelative(el.getBoundingClientRect());
    if (bbox.width === 0 || bbox.height === 0) continue;
    leaves.push({ char, kind, bbox, glyphPathData: charPaths.map((p) => p.getAttribute('d')) });
  }

  return { unsupported: false, containerBBox: toRelative(containerRect), leaves, baselineFraction };
}
