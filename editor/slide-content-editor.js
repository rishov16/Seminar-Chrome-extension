// Main panel: title, boardContent blocks (prose/equation/bullet-list), and
// revealSequence order — all editable inline. Live preview reuses the Writer
// Agent's renderer in 'static' mode (renderers/agent-chalkboard/, the
// HandwritingAgent transcript-bank renderer that replaced
// renderers/chalkboard/ — this import line is the entire cutover here)
// rather than a second render path, per the plan's renderer-interface contract.
import { renderSlide } from '../renderers/agent-chalkboard/agent-chalkboard-renderer.js';
import { RENDER_MODES } from '../renderers/renderer-interface.js';
import { mountDiagramFormEditor } from './diagram-form-editor.js';

/**
 * @param {HTMLElement} containerEl
 * @param {ReturnType<typeof import('./seminar-editor-controller.js').createSeminarEditorController>} controller
 */
export function mountSlideContentEditor(containerEl, controller) {
  let currentSlideId = null;

  containerEl.innerHTML = `
    <div class="content-editor">
      <input class="slide-title-input" placeholder="Slide title" />
      <textarea class="slide-objective-input" rows="2" placeholder="Learning objective"></textarea>
      <div class="board-blocks"></div>
      <div class="block-add-row">
        <button data-add="prose">+ Prose</button>
        <button data-add="equation">+ Equation</button>
        <button data-add="bullet-list">+ Bullet list</button>
      </div>
      <details class="reveal-order-section">
        <summary>Reveal order</summary>
        <div class="reveal-order-list"></div>
      </details>
      <details class="diagram-section" open>
        <summary>Diagram</summary>
        <div class="diagram-hint"></div>
        <div class="diagram-form-mount"></div>
      </details>
      <div class="live-preview-label">Live preview</div>
      <div class="live-preview-board chalkboard-board"></div>
    </div>
  `;

  const titleInput = containerEl.querySelector('.slide-title-input');
  const objectiveInput = containerEl.querySelector('.slide-objective-input');
  const blocksEl = containerEl.querySelector('.board-blocks');
  const revealListEl = containerEl.querySelector('.reveal-order-list');
  const diagramHintEl = containerEl.querySelector('.diagram-hint');
  const diagramMountEl = containerEl.querySelector('.diagram-form-mount');
  const previewEl = containerEl.querySelector('.live-preview-board');

  titleInput.addEventListener('change', () => {
    if (!currentSlideId) return;
    controller.updateSlideMeta(currentSlideId, { title: titleInput.value });
  });
  objectiveInput.addEventListener('change', () => {
    if (!currentSlideId) return;
    controller.updateSlideMeta(currentSlideId, { learningObjective: objectiveInput.value });
  });

  containerEl.querySelectorAll('.block-add-row button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!currentSlideId) return;
      const type = btn.dataset.add;
      const block = type === 'bullet-list'
        ? { type, items: [{ text: 'New item', level: 0 }] }
        : type === 'equation'
          ? { type, latex: '' }
          : { type, text: '' };
      controller.insertBlock(currentSlideId, { block });
    });
  });

  function renderBlocks(slide) {
    blocksEl.innerHTML = '';
    slide.boardContent.forEach((block) => {
      const row = document.createElement('div');
      row.className = 'block-row';

      if (block.type === 'prose') {
        const ta = document.createElement('textarea');
        ta.rows = 2;
        ta.value = block.text;
        ta.placeholder = 'Prose text (inline $latex$ allowed)';
        ta.addEventListener('change', () => controller.updateBlock(slide.slideId, block.id, { text: ta.value }));
        row.appendChild(ta);
      } else if (block.type === 'equation') {
        const input = document.createElement('input');
        input.value = block.latex;
        input.placeholder = 'LaTeX (no $ delimiters)';
        input.addEventListener('change', () => controller.updateBlock(slide.slideId, block.id, { latex: input.value }));
        row.appendChild(input);
      } else if (block.type === 'bullet-list') {
        const list = document.createElement('div');
        list.className = 'bullet-list-editor';
        block.items.forEach((item) => {
          const itemRow = document.createElement('div');
          itemRow.className = 'bullet-item-row';
          const input = document.createElement('input');
          input.value = item.text;
          input.style.marginLeft = `${item.level * 16}px`;
          input.addEventListener('change', () => {
            const items = block.items.map((it) => (it.id === item.id ? { ...it, text: input.value } : it));
            controller.updateBlock(slide.slideId, block.id, { items });
          });
          itemRow.appendChild(input);
          list.appendChild(itemRow);
        });
        const addItemBtn = document.createElement('button');
        addItemBtn.textContent = '+ item';
        addItemBtn.addEventListener('click', () => {
          const items = [...block.items, { id: `${block.id}-item-${block.items.length}`, text: 'New item', level: 0 }];
          controller.updateBlock(slide.slideId, block.id, { items });
        });
        list.appendChild(addItemBtn);
        row.appendChild(list);
      } else if (block.type === 'diagram') {
        // The hand-drawn figure's actual source (tikzCode, generated from
        // the source screenshot) is edited in the Notes tab, not here —
        // it's TikZ code, multi-line and not well suited to this tab's
        // compact per-block rows. This row just points there; caption (the
        // narration seed text) is ordinary plain text and stays genuinely
        // editable here, same pattern as a prose block's text. The live
        // preview below (renderPreview) already shows the actual drawn
        // figure, since it re-renders the whole slide on every change.
        const motifLabel = document.createElement('div');
        motifLabel.className = 'diagram-motif-label';
        motifLabel.textContent = '\u{1F4D0} Diagram — edit its TikZ in the Notes tab';
        motifLabel.title = 'The hand-drawn figure’s TikZ source is edited in the Notes tab.';
        row.appendChild(motifLabel);

        const captionInput = document.createElement('textarea');
        captionInput.rows = 2;
        captionInput.value = block.caption || '';
        captionInput.placeholder = 'Caption (what the narrator says about this figure)';
        captionInput.addEventListener('change', () => controller.updateBlock(slide.slideId, block.id, { caption: captionInput.value }));
        row.appendChild(captionInput);
      }

      const delBtn = document.createElement('button');
      delBtn.className = 'block-del-btn';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete block';
      delBtn.addEventListener('click', () => controller.deleteBlock(slide.slideId, block.id));
      row.appendChild(delBtn);

      blocksEl.appendChild(row);
    });
  }

  function renderRevealOrder(slide) {
    revealListEl.innerHTML = '';
    const blockOrderIds = slide.boardContent.map((b) => b.id);
    const boardOrderMismatch = JSON.stringify(slide.revealSequence.map((r) => r.targetBlockId)) !== JSON.stringify(blockOrderIds.filter((id) => slide.revealSequence.some((r) => r.targetBlockId === id)));

    if (boardOrderMismatch && slide.revealSequence.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'reveal-order-warning';
      warn.textContent = '⚠ Reveal order differs from board position (this may be intentional).';
      revealListEl.appendChild(warn);
    }

    slide.revealSequence.forEach((step, i) => {
      const block = slide.boardContent.find((b) => b.id === step.targetBlockId);
      const row = document.createElement('div');
      row.className = 'reveal-step-row';
      row.textContent = `${step.step}. ${block ? summarizeBlock(block) : '(missing block)'}`;
      const up = document.createElement('button');
      up.textContent = '↑';
      up.addEventListener('click', () => {
        const seq = [...slide.revealSequence];
        if (i > 0) { [seq[i - 1], seq[i]] = [seq[i], seq[i - 1]]; controller.setRevealSequence(slide.slideId, seq); }
      });
      row.appendChild(up);
      revealListEl.appendChild(row);
    });
  }

  function summarizeBlock(block) {
    if (block.type === 'prose') return block.text.slice(0, 40) || '(empty prose)';
    if (block.type === 'equation') return `$${block.latex.slice(0, 30)}$`;
    if (block.type === 'bullet-list') return `bullets (${block.items.length})`;
    if (block.type === 'diagram') return `\u{1F4D0} ${(block.caption || 'diagram').slice(0, 30)}`;
    return block.type;
  }

  let diagramEditorHandle = null;
  function renderDiagramSection(slide) {
    diagramHintEl.textContent = slide.diagramHint ? `Suggested by Head Agent: ${slide.diagramHint}` : '';
    diagramHintEl.style.display = slide.diagramHint ? 'block' : 'none';
    diagramEditorHandle = mountDiagramFormEditor(diagramMountEl, controller, slide.slideId);
  }

  function renderPreview(slide) {
    try { renderSlide(previewEl, slide, { mode: RENDER_MODES.STATIC }); } catch (e) { /* ignore mid-typing render races */ }
  }

  function render(slideId, { skipInputs = false } = {}) {
    const slide = controller.getSlide(slideId);
    if (!slide) return;
    if (!skipInputs) {
      titleInput.value = slide.title;
      objectiveInput.value = slide.learningObjective;
    }
    renderBlocks(slide);
    renderRevealOrder(slide);
    renderDiagramSection(slide);
    renderPreview(slide);
  }

  function setActiveSlide(slideId) {
    currentSlideId = slideId;
    render(slideId);
  }

  controller.on('seminarChanged', ({ slideId }) => {
    if (slideId === currentSlideId || slideId === null) render(currentSlideId);
  });

  return { setActiveSlide };
}
