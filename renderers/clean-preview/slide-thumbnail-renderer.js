// A second, deliberately narrow renderer: a clean, light, structured slide
// thumbnail (title + prose/equation/bullet blocks, plain typography, no
// hand-writing animation) for the Slides-tab sidebar in ui/main.js — NOT a
// replacement for renderers/chalkboard/chalkboard-renderer.js, which still
// drives the actual chalkboard presentation. Scope is intentionally limited
// to this one sidebar preview; see renderers/renderer-interface.js if this
// ever needs to grow into a full swappable renderer.
//
// Reveal state is block-level (revealed vs "pending"/dimmed), driven by the
// same slide.revealSequence data the chalkboard renderer uses, but far
// simpler: no per-token/per-glyph animation, just an opacity toggle — right
// for a compact thumbnail, and cheap enough to call on every deck
// 'stepChanged' event without re-typesetting.
import { queueTypeset } from '../mathjax-queue.js';
import { wrapEquationLatex } from '../latex-utils.js';

/**
 * @param {HTMLElement} containerEl - gets `.clean-preview-title`/`.clean-preview-body` children; caller owns its class/size
 * @param {import('../../lib/seminar-json-schema.js').Slide} slide
 * @param {{ revealStep?: number }} opts - Infinity (default) shows everything revealed; a finite step dims blocks not yet reached
 * @returns {{ ready: Promise<void>, revealUpTo: (step: number) => void }}
 */
export function renderSlideThumbnail(containerEl, slide, { revealStep = Infinity } = {}) {
  containerEl.innerHTML = '';
  containerEl.classList.add('clean-preview'); // typography/content styling lives on this class, independent of the caller's own layout classes

  const titleEl = document.createElement('div');
  titleEl.className = 'clean-preview-title';
  titleEl.textContent = slide.title;
  containerEl.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'clean-preview-body';
  containerEl.appendChild(bodyEl);

  const blockEls = []; // { el, blockId }

  slide.boardContent.forEach((block) => {
    if (block.type === 'prose') {
      const p = document.createElement('p');
      p.className = 'clean-preview-prose';
      p.textContent = block.text; // raw text incl. inline $...$ — MathJax typesets in place below
      bodyEl.appendChild(p);
      blockEls.push({ el: p, blockId: block.id });
    } else if (block.type === 'equation') {
      const eq = document.createElement('div');
      eq.className = 'clean-preview-equation';
      eq.textContent = wrapEquationLatex(block.latex);
      bodyEl.appendChild(eq);
      blockEls.push({ el: eq, blockId: block.id });
    } else if (block.type === 'bullet-list') {
      const ul = document.createElement('ul');
      ul.className = 'clean-preview-bullets';
      block.items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'clean-preview-bullet-item';
        li.style.marginLeft = `${item.level * 16}px`;
        li.textContent = item.text; // may also contain inline $...$
        ul.appendChild(li);
      });
      bodyEl.appendChild(ul);
      // Reveal granularity is per-block, not per-item — revealSequence
      // entries target a whole bullet-list block for this compact preview.
      blockEls.push({ el: ul, blockId: block.id });
    } else if (block.type === 'diagram') {
      // No hand-drawing in this lightweight preview (see the file header) —
      // a plain labeled placeholder showing which curated motif is drawn,
      // same participation in revealUpTo's pending/dimmed toggle as every
      // other block type.
      const fig = document.createElement('div');
      fig.className = 'clean-preview-diagram';
      fig.textContent = `\u{1F4D0} ${block.caption || 'diagram'}`;
      bodyEl.appendChild(fig);
      blockEls.push({ el: fig, blockId: block.id });
    }
  });

  const ready = queueTypeset([bodyEl]).then(() => {});

  const stepByBlockId = new Map((slide.revealSequence || []).map((r) => [r.targetBlockId, r.step]));

  function revealUpTo(step) {
    blockEls.forEach(({ el, blockId }) => {
      const blockStep = stepByBlockId.get(blockId);
      const shouldReveal = blockStep === undefined || blockStep <= step;
      el.classList.toggle('pending', !shouldReveal);
    });
  }
  revealUpTo(revealStep);

  return { ready, revealUpTo };
}
