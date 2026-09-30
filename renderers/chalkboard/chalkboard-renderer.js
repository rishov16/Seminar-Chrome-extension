// Port+adapt of the board-construction half of playChalkboardDemo (old
// sidepanel.js:708-813): walks a slide's boardContent[] blocks (instead of
// rawText.split(/\r?\n/)) building one <span class="token"> per word / one
// per equation block, then MathJax-typesets the section. Supports the new
// 'static' render mode (all tokens shown immediately, no animation — used by
// the editor's live preview) alongside 'animated' (Present mode).
import { renderHandwritingWord, setTokenDrawn, setTokenDrawnInstant, isFontReady } from './handwriting.js';
import { RENDER_MODES } from '../renderer-interface.js';
import { queueTypeset } from '../mathjax-queue.js';
import { wrapEquationLatex } from '../latex-utils.js';

let globalTokenCounter = 0;

function tokenizeProse(text) {
  return text.split(/(\$[^$]+\$|\s+)/).filter((t) => t.trim().length > 0);
}

// isMathHint covers equation-block tokens, which are wrapped in \[...\]
// (see wrapEquationLatex) rather than the $...$ prose convention detected
// below, so a plain startsWith('$') check alone would misclassify them.
function buildTokenSpan(tokenText, blockId, itemId, isMathHint = false) {
  const span = document.createElement('span');
  span.className = 'token';
  span.id = `token-${globalTokenCounter++}`;
  const isMath = isMathHint || tokenText.startsWith('$');
  span._blockId = blockId;
  span._itemId = itemId || null;
  span._isMath = isMath;

  if (isFontReady() && !isMath && !tokenText.includes('\\') && tokenText.trim().length > 0) {
    const hwSvg = renderHandwritingWord(tokenText, span);
    if (hwSvg) span.appendChild(hwSvg);
    else span.textContent = tokenText;
  } else {
    span.textContent = tokenText;
  }
  return span;
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

/**
 * @param {HTMLElement} containerEl
 * @param {import('../../lib/seminar-json-schema.js').Slide} slide
 * @param {{ mode?: 'animated'|'static' }} opts
 */
export function renderSlide(containerEl, slide, { mode = RENDER_MODES.ANIMATED } = {}) {
  clearSlide(containerEl);
  const section = document.createElement('div');
  section.className = 'math-section';
  containerEl.appendChild(section);

  const tokenSpans = []; // { el, text, isMath, blockId, itemId }

  slide.boardContent.forEach((block, blockIdx) => {
    if (blockIdx > 0) appendParaBreak(section);

    if (block.type === 'prose') {
      tokenizeProse(block.text).forEach((t) => {
        const span = buildTokenSpan(t, block.id, null);
        section.appendChild(span);
        tokenSpans.push({ el: span, text: t, isMath: t.startsWith('$'), blockId: block.id, itemId: null });
      });
    } else if (block.type === 'equation') {
      const latexToken = wrapEquationLatex(block.latex);
      const span = buildTokenSpan(latexToken, block.id, null, true);
      section.appendChild(span);
      tokenSpans.push({ el: span, text: latexToken, isMath: true, blockId: block.id, itemId: null });
    } else if (block.type === 'bullet-list') {
      block.items.forEach((item, itemIdx) => {
        if (itemIdx > 0) appendLineBreak(section);
        const indent = document.createElement('span');
        indent.style.width = `${20 + item.level * 24}px`;
        indent.style.display = 'inline-block';
        section.appendChild(indent);
        const bullet = document.createElement('span');
        bullet.textContent = '• ';
        bullet.style.marginRight = '4px';
        section.appendChild(bullet);
        tokenizeProse(item.text).forEach((t) => {
          const span = buildTokenSpan(t, block.id, item.id);
          section.appendChild(span);
          tokenSpans.push({ el: span, text: t, isMath: t.startsWith('$'), blockId: block.id, itemId: item.id });
        });
      });
    }
  });

  const typesetPromise = queueTypeset([section]).then(() => {
    tokenSpans.forEach(({ el }) => {
      if (el.querySelector('mjx-container')) {
        el._isMath = true;
        el._mathPaths = Array.from(el.querySelectorAll('mjx-container svg path, mjx-container svg rect, mjx-container svg line'));
      }
    });
  });

  const revealedStep = { current: 0 };
  const stepByBlockId = new Map((slide.revealSequence || []).map((r) => [r.targetBlockId, r.step]));

  const handle = {
    ready: typesetPromise,

    revealUpTo(step) {
      revealedStep.current = step;
      tokenSpans.forEach(({ el, blockId }) => {
        const blockStep = stepByBlockId.get(blockId);
        const shouldReveal = blockStep === undefined || blockStep <= step;
        if (mode === RENDER_MODES.STATIC) {
          if (shouldReveal) setTokenDrawnInstant(el);
        } else {
          setTokenDrawn(el, shouldReveal);
        }
      });
    },

    setTokenDrawn(tokenIndex, drawn, speed = 1) {
      const t = tokenSpans[tokenIndex];
      if (!t) return;
      if (mode === RENDER_MODES.STATIC) { if (drawn) setTokenDrawnInstant(t.el); return; }
      setTokenDrawn(t.el, drawn, speed);
    },

    setMathProgress(tokenIndex, progress) {
      const t = tokenSpans[tokenIndex];
      if (!t || !t.el._mathPaths) return;
      if (!t.el.classList.contains('drawn')) t.el.classList.add('drawn');
      const numRevealed = Math.min(t.el._mathPaths.length, Math.ceil(progress * t.el._mathPaths.length));
      t.el._mathPaths.forEach((path, idx) => {
        if (idx < numRevealed) path.classList.add('revealed');
        else path.classList.remove('revealed');
      });
    },

    reset() {
      tokenSpans.forEach(({ el }) => setTokenDrawn(el, false));
      revealedStep.current = 0;
    },

    tokensForSync() {
      return tokenSpans;
    },
  };

  if (mode === RENDER_MODES.STATIC) {
    typesetPromise.then(() => tokenSpans.forEach(({ el }) => setTokenDrawnInstant(el)));
  }

  return handle;
}

export function clearSlide(containerEl) {
  containerEl.innerHTML = '';
  globalTokenCounter = 0;
}
