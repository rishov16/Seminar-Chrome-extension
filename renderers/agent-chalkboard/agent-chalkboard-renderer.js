// Full RenderedSlideHandle contract (renderers/renderer-interface.js),
// mirroring renderers/chalkboard/chalkboard-renderer.js's shape exactly —
// same tokenize-per-word, same <span class="token"> per word/equation,
// same flex-wrap section, same revealUpTo/setTokenDrawn/setMathProgress/
// reset/tokensForSync handle shape — but sourcing every character's ink
// from the HandwritingAgent transcript bank (renderers/agent-chalkboard/
// agent-prose-word.js for words, agent-math-token.js for equations)
// instead of Kalam-font-outline+STROKE_MAP / static MathJax glyphs.
//
// renderers/chalkboard/* is left completely untouched — this is a new
// sibling module, not an in-place rewrite, so the two real call sites
// (orchestration/slide-deck-controller.js, editor/slide-content-editor.js)
// can revert to the old renderer with a two-line import change if needed.
import { RENDER_MODES } from '../renderer-interface.js';
import { queueTypeset } from '../mathjax-queue.js';
import { wrapEquationLatex } from '../latex-utils.js';
import { renderProseWordAgent, PROSE_BASELINE_FROM_TOP } from './agent-prose-word.js';
import { renderMathTokenAgent, setMathTokenProgress } from './agent-math-token.js';
import { renderDiagramTokenAgent } from './agent-diagram-token.js';
import { setAgentProgress } from './progress-timeline.js?v=1';
import { startAgentWriting, stopAgentWriting, getSegmentsTimeline, computeStrokeTiming, registerGeneratedTranscript } from '../experimental-handwriting-agent/handwriting-agent.js?v=25';
import { parseTikzToStrokes, strokesToTranscriptXml } from '../experimental-handwriting-agent/tikz-path-parser.js?v=2';
import { extractMathLayout } from '../experimental-handwriting-agent/mathjax-layout.js?v=8';

let globalTokenCounter = 0;

function tokenizeProse(text) {
  return text.split(/(\$[^$]+\$|\s+)/).filter((t) => t.trim().length > 0);
}

// Splits a prose block/bullet item's text into tokens tagged with which
// narrationFragment (see agents/narrator-agent.js) each belongs to, so a
// fragment's reveal (orchestration/live-narration-controller.js) can light
// up just that fragment's tokens instead of the whole line. A unit with no
// (or a single) fragment gets fragmentIndex 0 for every token — the same
// single reveal that already lights up the whole line today.
function tokenizeUnitProse(text, fragments) {
  if (!Array.isArray(fragments) || fragments.length <= 1) {
    return tokenizeProse(text).map((t) => ({ text: t, fragmentIndex: 0 }));
  }
  const out = [];
  fragments.forEach((f, fragmentIndex) => {
    tokenizeProse(f.boardText || '').forEach((t) => out.push({ text: t, fragmentIndex }));
  });
  return out;
}

function appendLineBreak(container) {
  const br = document.createElement('div');
  br.style.width = '100%';
  br.style.height = '6px';
  container.appendChild(br);
}

function appendParaBreak(container) {
  const gap = document.createElement('div');
  gap.style.width = '100%';
  gap.style.height = '18px';
  container.appendChild(gap);
}

// setTokenDrawn's speed argument is a pen-animation-rate multiplier: 1.0 =
// normal, higher = faster (orchestration/live-narration-controller.js
// always calls setTokenDrawn without one, defaulting to renderSlide's own
// `speed` param — orchestration/slide-deck-controller.js sources that from
// the Settings modal's handwritingSpeed, not derived from narration rate:
// Gemini Live has no speaking-rate control of its own, unlike the Web
// Speech/Sarvam TTS engines this replaced). startAgentWriting's own speed parameter is a different
// convention (0.35 = its hand-tuned "looks like real handwriting"
// baseline, higher = faster, on that module's own scale). Re-anchoring by
// multiplying keeps "speed=1" meaning "normal pace" under either
// renderer, without changing startAgentWriting's tuned baseline itself.
//
// Prose needs its own PAUSE entirely, not just the same formula re-anchored
// — verified numerically: a typical 8-12 letter word has ~12-18 individual
// strokes, and even with speed cranked up, the 70ms pen-lift pause
// (startAgentWriting's default, unscaled by speed) alone added
// 840ms-1260ms per word — several times slower than natural speech. That's
// the actual reason multiple words stayed visibly mid-stroke at once even
// after staggering each word's *start* — not a residual staggering bug, a
// pacing mismatch, back when this ran BEFORE the one-pen write queue
// existed (words could still overlap on screen). The queue below makes
// that impossible now regardless of per-word duration — only the pause
// needs to stay short (prose has far more strokes/word than a math glyph
// has strokes/symbol, so the SAME pause costs far more per word).
//
// PROSE_BASE_SPEED matches MATH_BASE_SPEED exactly — both equal
// startAgentWriting's own documented "looks like real handwriting"
// baseline (its `speed = 0.35` default) — after a user report that the
// prose speed (previously 1.0, ~3x faster, chosen back when overlap was
// still a real risk) read as noticeably too fast next to the equation
// pace once that risk was gone. Verified numerically via computeStrokeTiming
// against real rendered words ("the Brownian motion process considering
// probability"): 1.0 -> ~1.2s/word (~50 words/min); 0.35 -> ~2.8s/word
// (~21 words/min), a natural, deliberate blackboard pace.
const MATH_BASE_SPEED = 0.35;
const MATH_PAUSE_MS = 70; // startAgentWriting's own default
const PROSE_BASE_SPEED = MATH_BASE_SPEED;
const PROSE_PAUSE_MS = 20;

function toAgentTiming(speedMultiplier, isMath) {
  const mult = speedMultiplier || 1;
  return isMath
    ? { speed: MATH_BASE_SPEED * mult, pauseMs: MATH_PAUSE_MS }
    : { speed: PROSE_BASE_SPEED * mult, pauseMs: PROSE_PAUSE_MS };
}

// Hiding mirrors renderers/chalkboard/handwriting.js's setTokenDrawn
// drawn=false path: drop the .drawn class, cancel any in-flight
// animation, snap ink invisible. (Showing a token is never done here —
// every write goes through the shared one-pen queue below.) A token that
// fell back to plain MathJax typesetting (the documented `unsupported`
// punt) has no _agentProgressTimeline at all — stopAgentWriting/
// setAgentProgress silently no-op for it, and the .drawn class alone is
// enough to show/hide it, since it has no internal granular reveal.
function revealToken(el, drawn) {
  if (!el || drawn || !el.classList.contains('drawn')) return;
  el.classList.remove('drawn');
  stopAgentWriting(el);
  setAgentProgress(el._agentProgressTimeline, 0);
}

function revealTokenInstant(el) {
  if (!el) return;
  el.classList.add('drawn');
  stopAgentWriting(el);
  setAgentProgress(el._agentProgressTimeline, 1);
}

// startAgentWriting starts its own independent requestAnimationFrame loop
// per element (its own performance.now() t0), so any caller that starts
// several tokens close together — revealUpTo revealing a whole block, or
// orchestration/live-narration-controller.js calling setTokenDrawn at real
// speech cadence (~350ms/word, faster than a word takes to write) — ends up with
// multiple words visibly mid-stroke at once. User feedback settled the
// design: there is ONE pen. Every write request, from either entry
// point, goes through a single shared per-slide queue that writes tokens
// strictly one at a time — each token's full computed duration elapses
// before the next starts (computeStrokeTiming, the exact formula
// startAgentWriting itself uses, so the wait always matches the real
// animation length). Under narration this means the writing can lag
// slightly behind the voice when words are spoken faster than they can
// be written — a deliberate trade: a single legible writing hand over
// exact voice-sync (the highlighted-word sync in the transcript panel is
// unaffected). Queue items record the generation they were enqueued
// under; revealUpTo/reset bump it, so stale queued writes from a
// superseded reveal are dropped instead of racing the new one.
//
// (Two earlier designs both failed on real use, back before this one-pen
// queue existed: full-sequential at the original equation-tuned pen pace
// (speed 0.35, 70ms pause — both math's values) took ~40s per 18-word
// block, and a 100ms start-stagger kept several words mid-stroke at once.
// Once the queue made overlap impossible regardless of per-word duration,
// PROSE_PAUSE_MS (not speed) is what keeps a full sentence's total time
// reasonable — PROSE_BASE_SPEED now equals MATH_BASE_SPEED (0.35, see the
// comment above it), but the much shorter prose pause keeps the resulting
// per-word cost far below the rejected 70ms-pause design's.)
const WORD_GAP_MS = 80; // pen-lift-style beat between tokens

function makeWriteQueue(generationRef) {
  const queue = [];
  let draining = false;
  const idleResolvers = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function notifyIfIdle() {
    if (!draining && queue.length === 0) {
      while (idleResolvers.length) idleResolvers.shift()();
    }
  }

  async function writeWithPen(el, isMath, speedMultiplier, catchUp, gapMs) {
    // The pen-lift pause must scale with catch-up too — it's the dominant
    // per-stroke cost (same shape as the original prose-pacing bug), so a
    // sprint that only speeds up stroke drawing still crawls through a
    // 12-word backlog on pauses alone.
    const { speed, pauseMs } = toAgentTiming(speedMultiplier, isMath);
    const effSpeed = speed * catchUp;
    const effPause = pauseMs / catchUp;
    startAgentWriting(el, effSpeed, effPause);
    const strokes = getSegmentsTimeline(el);
    if (strokes && strokes.length) {
      const { total } = computeStrokeTiming(strokes, effSpeed, effPause);
      await sleep(total + gapMs);
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        if (item.generation !== generationRef.current) continue; // superseded — drop silently
        const { el, isMath, speedMultiplier } = item;
        if (!el || el.classList.contains('drawn')) continue; // already visible

        el.classList.add('drawn');
        // catchUp=1 (no speedup) in the normal case — a configured writing
        // speed (settings.handwritingSpeed) must stay constant regardless
        // of backlog, not silently ramp back up (reported live: "speed
        // gradually increases" after slowing PROSE_BASE_SPEED down, since
        // a slower pen naturally backlogs faster against narration's fixed
        // cueing rate, which used to ramp this toward its old 2.5x cap).
        // A wordy unit backlogging the pen just means a longer pause after
        // narration finishes for that unit — orchestration/
        // live-narration-controller.js's run() loop already gates the
        // NEXT unit's turn on whenWritingIdle(), so backlog cannot compound
        // *across* units regardless of this value; it only affects how
        // long that one pause is.
        //
        // The one exception: once the voice has already started narrating
        // an equation that's still waiting in this queue, the formula must
        // be on the board while it's being talked about (user requirement)
        // — the pen still sprints through the prose backlog with no
        // inter-word gap to reach it. (An earlier design "parked" the pen
        // at a narrated equation and revealed it locked to the voice's
        // position instead of writing it. That crawled: lib/sync-engine.js
        // allocates equations a large share of the narration window — its
        // weight heuristic doubles LaTeX word counts — so symbols trickled
        // in so slowly the writing looked stopped until narration ended,
        // which the user reported twice. A real lecturer writes the
        // formula at natural hand speed WHILE talking about it, usually
        // finishing before the explanation does — so a narrated equation
        // is now just a normal pen write, at math pace, started as soon as
        // the pen can get there.)
        const equationBeingNarrated = queue.some((q) => q.kind === 'narratedMath');
        const catchUp = equationBeingNarrated ? 6 : 1;
        const gapMs = equationBeingNarrated ? 0 : WORD_GAP_MS;
        await writeWithPen(el, isMath, speedMultiplier, catchUp, gapMs);
      }
    } finally {
      draining = false;
      notifyIfIdle();
    }
  }

  return {
    enqueue(el, isMath, speedMultiplier, kind = 'write') {
      if (!el || el.classList.contains('drawn')) return;
      if (queue.some((q) => q.el === el)) return; // already pending
      queue.push({ el, isMath, speedMultiplier, kind, generation: generationRef.current });
      drain();
    },
    remove(el) {
      const i = queue.findIndex((q) => q.el === el);
      if (i !== -1) queue.splice(i, 1);
      notifyIfIdle();
    },
    /** Resolves when the pen has nothing left to write (queue empty, current token finished). */
    whenIdle() {
      return new Promise((resolve) => {
        if (!draining && queue.length === 0) resolve();
        else idleResolvers.push(resolve);
      });
    },
  };
}

// Proportional math sizing (px per MathJax native unit — see
// renderMathLineAgent's opts doc). Calibrated against prose: FONT_SIZE 38
// over a 90-unit native cell puts a lowercase prose letter at ~17px;
// MathJax's lowercase x is ~8.6 native units, so ~2 px/unit makes inline
// `$p$` sit at the same visual size as the words around it instead of
// towering over them at the old fixed 64px (user-reported as "writing all
// over the place" on real content, which is full of inline math the test
// fixtures barely had). Display equations get a larger scale for chalk
// emphasis, clamped so a lone symbol isn't tiny and a tall multi-row
// derivation doesn't blow up the slide.
const INLINE_MATH_SIZING = { pxPerUnit: 2.0, maxHeightPx: 80 };
const DISPLAY_MATH_SIZING = { pxPerUnit: 2.6, minHeightPx: 34, maxHeightPx: 240 };

async function renderEquationInto(span, latex, sizing) {
  try {
    const result = await renderMathTokenAgent(latex, span, { ...sizing });
    if (result.svg) {
      span.appendChild(result.svg);
      return result;
    } else if (result.unsupported) {
      // Documented boundary (UNSUPPORTED_KINDS in
      // experimental-handwriting-agent/mathjax-layout.js — currently empty,
      // kept as the designated punt path for whatever's deferred next):
      // fall back to a plain MathJax typeset for this whole token, matching
      // this project's "degrade, don't misrender" convention.
      span.textContent = wrapEquationLatex(latex);
      await queueTypeset([span]);
    } else if (result.error) {
      console.warn('[agent-chalkboard] MathJax rejected equation:', latex, '—', result.errorMessage);
      span.textContent = '(equation error)';
    } else {
      span.textContent = latex; // e.g. an empty equation with zero leaves
    }
  } catch (e) {
    // One bad token must never take down the whole slide (a thrown
    // transcript-parse error once blanked an entire production slide over
    // a single character) — degrade this token to plain text and move on.
    console.warn('[agent-chalkboard] equation token degraded to text:', latex, e);
    span.textContent = latex;
  }
}

function buildTokenSpan(blockId, itemId) {
  const span = document.createElement('span');
  span.className = 'token';
  span.id = `token-${globalTokenCounter++}`;
  span._blockId = blockId;
  span._itemId = itemId || null;
  return span;
}

// A bullet item's marker glyph ("• ") — built as a real gated token (class
// 'token', tagged with this item's blockId/itemId) rather than a plain
// always-visible span, so it stays hidden until the item is actually
// revealed instead of giving away "there are N bullet points here" the
// instant the slide renders, before any narration has happened. It has no
// _agentSegments (never run through renderProseWordAgent/renderEquationInto,
// since a bullet glyph isn't hand-drawn ink), so the write queue's
// startAgentWriting/getSegmentsTimeline calls on it are no-ops — it just
// pops in via the same opacity CSS transition every token already has,
// adding no extra delay before the item's actual text starts writing.
function addBulletMarker(blockId, itemId, section, tokenSpans) {
  const span = buildTokenSpan(blockId, itemId);
  span._isMath = false;
  span.textContent = '• ';
  span.style.marginRight = '4px';
  section.appendChild(span);
  tokenSpans.push({ el: span, text: '•', isMath: false, blockId, itemId: itemId || null });
}

// A prose token is a plain word unless it's an inline `$...$` math run
// (tokenizeProse's regex already isolates these) — matches the shape
// tokensForSync() has always returned (`isMath: t.startsWith('$')`).
function addProseToken(tokenText, blockId, itemId, fragmentIndex, section, tokenSpans, renderPromises) {
  const span = buildTokenSpan(blockId, itemId);
  const isInlineMath = tokenText.startsWith('$') && tokenText.length > 1;
  span._isMath = isInlineMath;
  // Trailing punctuation ("$a$," / "0.") is split into its own token by
  // tokenizeProse (the $...$ / \s+ split leaves a bare "," or "." as a
  // separate piece), so the inter-word margin lands on BOTH sides of it —
  // "level a , where" with a floating comma. Tag punctuation-only tokens so
  // the CSS can pull them back against the preceding token (.token-punct).
  if (!isInlineMath && /^[,.;:!?)\]}]+$/.test(tokenText)) span.classList.add('token-punct');
  section.appendChild(span);
  tokenSpans.push({ el: span, text: tokenText, isMath: isInlineMath, blockId, itemId: itemId || null, fragmentIndex });

  if (isInlineMath) {
    // Drop the inline-math token so its own baseline lands on the prose
    // baseline of the words beside it. All tokens in the flex .math-section
    // row top-align, and prose text sits PROSE_BASELINE_FROM_TOP px below a
    // word token's top; a tightly-bounded math SVG top-aligned the same way
    // rides high (baselinePx from mathjax-layout.js is where the math
    // baseline actually is). marginTop closes that gap — negative for a tall
    // inline fraction (it legitimately extends above the line), positive for
    // small sub/superscript math.
    renderPromises.push(renderEquationInto(span, tokenText, INLINE_MATH_SIZING).then((r) => {
      if (r && typeof r.baselinePx === 'number') span.style.marginTop = `${(PROSE_BASELINE_FROM_TOP - r.baselinePx).toFixed(2)}px`;
    }));
  } else {
    try {
      const svg = renderProseWordAgent(tokenText, span);
      if (svg) span.appendChild(svg); else span.textContent = tokenText;
    } catch (e) {
      // Same degrade-don't-crash rule as renderEquationInto.
      console.warn('[agent-chalkboard] prose token degraded to text:', tokenText, e);
      span.textContent = tokenText;
    }
  }
}

function addEquationToken(latex, blockId, itemId, fragmentIndex, section, tokenSpans, renderPromises, sizing) {
  const span = buildTokenSpan(blockId, itemId);
  span._isMath = true;
  section.appendChild(span);
  tokenSpans.push({ el: span, text: latex, isMath: true, blockId, itemId: itemId || null, fragmentIndex });
  renderPromises.push(renderEquationInto(span, latex, sizing));
}

// A diagram token draws one whole figure (agent-diagram-token.js) as a
// single indivisible hand-drawn piece — tagged isMath: true so the write
// queue paces it like an equation (a deliberate, compound piece of ink),
// not word-by-word like prose. block.tikzCode (generated from the source
// screenshot by editor/seminar-editor-controller.js's
// generateAllDiagramsUpfront — never authored here) is parsed fresh on
// EVERY render, not cached from a prior registration: tikzCode in the
// seminar JSON is the single source of truth, and handwriting-agent.js's
// in-memory transcript bank doesn't survive a side-panel reopen, so
// re-deriving it here is what makes a live TikZ edit (editor/notes-editor.js)
// actually redraw, and what makes reopening the panel later still work.
// parseTikzToStrokes/registerGeneratedTranscript are synchronous (pure JS,
// no network), so — like the old motif-bank lookup this replaces — this
// renders synchronously and isn't pushed onto renderPromises. Diagram
// blocks are never fragmented (see agents/narrator-agent.js's dedicated
// always-collapse branch), so unlike equations there's no multi-fragment
// counterpart to this function.
function addDiagramToken(block, section, tokenSpans) {
  const span = buildTokenSpan(block.id, null);
  span._isMath = true;
  section.appendChild(span);
  tokenSpans.push({ el: span, text: block.caption, isMath: true, blockId: block.id, itemId: null, fragmentIndex: 0 });
  try {
    const { strokes } = parseTikzToStrokes(block.tikzCode || '');
    if (strokes.length === 0) {
      // Same degrade-don't-crash rule as renderEquationInto — empty/
      // unparseable tikzCode (pending generation, generation found nothing
      // sketchable, or a bad hand-edit) shouldn't take down the whole slide.
      span.textContent = block.caption || '[diagram]';
      return;
    }
    const xml = strokesToTranscriptXml(strokes, block.id, {});
    registerGeneratedTranscript(block.id, xml);
    const result = renderDiagramTokenAgent(block.id, span);
    if (!result.svg) {
      console.warn('[agent-chalkboard] diagram token has no transcript for block:', block.id);
      span.textContent = block.caption || '[diagram]';
    }
  } catch (e) {
    console.warn('[agent-chalkboard] diagram token degraded to text:', block.id, e);
    span.textContent = block.caption || '[diagram]';
  }
}

// Measures the WHOLE equation's own natural height (via extractMathLayout,
// the same layout step renderMathLineAgent itself uses internally) and
// derives the one displayScale DISPLAY_MATH_SIZING's own clamps would have
// produced for it — used by addMultiFragmentEquationTokens below so every
// fragment renders at this SAME scale, rather than each fragment
// auto-deriving its own from its own (much smaller) height.
async function measureEquationDisplayScale(latex) {
  const host = document.createElement('div');
  host.style.cssText = 'visibility:hidden; position:absolute; left:-99999px; top:0;';
  document.body.appendChild(host);
  let layout;
  try {
    layout = await extractMathLayout(wrapEquationLatex(latex), host, queueTypeset);
  } finally {
    document.body.removeChild(host);
  }
  const { height } = layout.containerBBox;
  let displayScale = DISPLAY_MATH_SIZING.pxPerUnit;
  if (DISPLAY_MATH_SIZING.maxHeightPx && height * displayScale > DISPLAY_MATH_SIZING.maxHeightPx) displayScale = DISPLAY_MATH_SIZING.maxHeightPx / height;
  if (DISPLAY_MATH_SIZING.minHeightPx && height * displayScale < DISPLAY_MATH_SIZING.minHeightPx) displayScale = DISPLAY_MATH_SIZING.minHeightPx / height;
  return displayScale;
}

// A unit with narrationFragments (agents/narrator-agent.js) reveals piece
// by piece instead of all at once — each piece gets its own token (tagged
// with fragmentIndex, same convention as tokenizeUnitProse for prose), but
// they must look like ONE continuous hand-written equation, not several
// unrelated snippets. Verified in a throwaway rendering experiment before
// this was built: MathJax's own glyph-level font metrics are already
// consistent across independently-typeset pieces of the same equation (no
// fix needed there) — the two things that DID need fixing were (a) each
// piece auto-deriving its own displayScale via DISPLAY_MATH_SIZING's
// minHeightPx/maxHeightPx clamps, which can diverge between a tall piece
// and a short/flat one, and (b) each piece's own baselinePx (already
// tracked for inline math, see addProseToken) needing alignment to a
// shared reference instead of each piece's own. Both fixed the same way:
// measure ONE displayScale from the WHOLE equation's own natural height,
// pass it explicitly to every fragment's render call with no further
// per-fragment clamping, then align every fragment to the group's max
// baselinePx once all their renders resolve.
function addMultiFragmentEquationTokens(block, section, tokenSpans, renderPromises, equationMaxWidthPx) {
  const fragments = block.narrationFragments;
  // Spans are created and appended to the DOM synchronously, in order —
  // same as every other token — even though their ink is filled in
  // asynchronously below, once the shared scale is known. Getting this
  // backwards (deferring span creation itself) would let a later block's
  // synchronously-created spans land before this equation's in the DOM.
  const spans = fragments.map((f, fragmentIndex) => {
    const span = buildTokenSpan(block.id, null);
    span._isMath = true;
    section.appendChild(span);
    tokenSpans.push({ el: span, text: f.boardText, isMath: true, blockId: block.id, itemId: null, fragmentIndex });
    return span;
  });

  renderPromises.push((async () => {
    const sharedScale = await measureEquationDisplayScale(block.latex);
    const results = await Promise.all(fragments.map((f, i) =>
      renderEquationInto(spans[i], f.boardText, { pxPerUnit: sharedScale, maxWidthPx: equationMaxWidthPx })
    ));
    const groupBaseline = Math.max(...results.map((r) => (r && typeof r.baselinePx === 'number' ? r.baselinePx : 0)));
    results.forEach((r, i) => {
      const ownBaseline = r && typeof r.baselinePx === 'number' ? r.baselinePx : 0;
      spans[i].style.marginTop = `${(groupBaseline - ownBaseline).toFixed(2)}px`;
    });
  })());
}

/**
 * @param {HTMLElement} containerEl
 * @param {import('../../lib/seminar-json-schema.js').Slide} slide
 * @param {{ mode?: 'animated'|'static', speed?: number }} opts
 *   speed: writing-speed multiplier for reveals this handle drives itself
 *   (revealUpTo) and the default for setTokenDrawn when its caller doesn't
 *   pass one — same convention as settings.speed (1.0 = normal).
 */
export function renderSlide(containerEl, slide, { mode = RENDER_MODES.ANIMATED, speed = 1 } = {}) {
  clearSlide(containerEl);
  const section = document.createElement('div');
  section.className = 'math-section';
  containerEl.appendChild(section);

  const tokenSpans = []; // { el, text, isMath, blockId, itemId, fragmentIndex }
  const renderPromises = []; // equation tokens only — prose renders synchronously

  // A long multi-term display equation has no wrap/scroll affordance of its
  // own (renderMathLineAgent draws it as one unbroken SVG) — bound it to
  // the board's actual available width (minus its own left/right padding)
  // instead of letting it run off the right edge uncapped. Falls back to a
  // sane minimum if the board hasn't been laid out with a real width yet.
  const equationMaxWidthPx = Math.max((containerEl.clientWidth || 0) - 48, 260);

  slide.boardContent.forEach((block, blockIdx) => {
    if (blockIdx > 0) appendParaBreak(section);

    if (block.type === 'prose') {
      tokenizeUnitProse(block.text, block.narrationFragments).forEach(({ text, fragmentIndex }) => {
        addProseToken(text, block.id, null, fragmentIndex, section, tokenSpans, renderPromises);
      });
    } else if (block.type === 'equation') {
      if (Array.isArray(block.narrationFragments) && block.narrationFragments.length > 1) {
        addMultiFragmentEquationTokens(block, section, tokenSpans, renderPromises, equationMaxWidthPx);
      } else {
        addEquationToken(block.latex, block.id, null, 0, section, tokenSpans, renderPromises, { ...DISPLAY_MATH_SIZING, maxWidthPx: equationMaxWidthPx });
      }
    } else if (block.type === 'bullet-list') {
      block.items.forEach((item, itemIdx) => {
        if (itemIdx > 0) appendLineBreak(section);
        const indent = document.createElement('span');
        indent.style.width = `${20 + item.level * 24}px`;
        indent.style.display = 'inline-block';
        section.appendChild(indent);
        addBulletMarker(block.id, item.id, section, tokenSpans);
        tokenizeUnitProse(item.text, item.narrationFragments).forEach(({ text, fragmentIndex }) => {
          addProseToken(text, block.id, item.id, fragmentIndex, section, tokenSpans, renderPromises);
        });
      });
    } else if (block.type === 'diagram') {
      addDiagramToken(block, section, tokenSpans);
    }
  });

  const ready = Promise.all(renderPromises);

  const revealedStep = { current: 0 };
  const stepByBlockId = new Map((slide.revealSequence || []).map((r) => [r.targetBlockId, r.step]));
  const generationRef = { current: 0 }; // bumped by revealUpTo/reset; stale queued writes are dropped
  const writeQueue = makeWriteQueue(generationRef);

  const handle = {
    ready,

    revealUpTo(step) {
      revealedStep.current = step;
      generationRef.current += 1;
      tokenSpans.forEach(({ el, blockId, isMath }) => {
        const blockStep = stepByBlockId.get(blockId);
        const shouldReveal = blockStep === undefined || blockStep <= step;
        if (mode === RENDER_MODES.STATIC) {
          if (shouldReveal) revealTokenInstant(el);
        } else if (shouldReveal) {
          writeQueue.enqueue(el, isMath, speed);
        } else {
          writeQueue.remove(el);
          revealToken(el, false); // hiding is instant, no queueing needed
        }
      });
    },

    setTokenDrawn(tokenIndex, drawn, speedMultiplier = speed) {
      const t = tokenSpans[tokenIndex];
      if (!t) return;
      if (mode === RENDER_MODES.STATIC) { if (drawn) revealTokenInstant(t.el); return; }
      if (drawn) {
        writeQueue.enqueue(t.el, t.isMath, speedMultiplier);
      } else {
        writeQueue.remove(t.el);
        revealToken(t.el, false);
      }
    },

    setMathProgress(tokenIndex, progress) {
      const t = tokenSpans[tokenIndex];
      if (!t || !t.isMath) return;
      if (mode === RENDER_MODES.STATIC) {
        if (!t.el.classList.contains('drawn')) t.el.classList.add('drawn');
        setMathTokenProgress(t.el, progress);
        return;
      }
      // In animated mode, narration position never paints the equation
      // directly — the pen does all writing (see the drain comment on the
      // abandoned voice-locked scrub design). The first progress signal
      // simply tells the pen "this equation's narration has begun": it
      // gets enqueued (marked narratedMath so the queue sprints its
      // backlog) and written at natural math pace when the pen arrives.
      if (!t.el.classList.contains('drawn')) {
        writeQueue.enqueue(t.el, true, speed, 'narratedMath');
      }
    },

    reset() {
      generationRef.current += 1; // drop every stale queued write
      tokenSpans.forEach(({ el }) => { writeQueue.remove(el); revealToken(el, false); });
      revealedStep.current = 0;
    },

    tokensForSync() {
      return tokenSpans;
    },

    // Additive extension beyond the base renderer-interface.js contract:
    // the writing hand deliberately lags the narration (one pen), so an
    // orchestrator that advances slides when the *voice* ends would wipe
    // the board mid-word. Await this before advancing. Callers use
    // optional chaining (handle.whenWritingIdle?.()) so renderers without
    // a pen — like the original chalkboard renderer — need no stub.
    whenWritingIdle() {
      return writeQueue.whenIdle();
    },
  };

  if (mode === RENDER_MODES.STATIC) {
    ready.then(() => tokenSpans.forEach(({ el }) => revealTokenInstant(el)));
  }

  return handle;
}

export function clearSlide(containerEl) {
  containerEl.innerHTML = '';
  globalTokenCounter = 0;
}
