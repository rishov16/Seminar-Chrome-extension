// Notes tab: one row per narration unit (see agents/narrator-agent.js's
// getNarrationUnits, the exact same unit list the Narrator Agent narrates
// and Live playback reveals, in order) — each unit's board content directly
// above its own editable narration text, with per-row remove/add-after
// controls. Every mutation here — editing text, adding a line/item, removing
// one — writes through the exact same controller.insertBlock/deleteBlock/
// updateBlock calls the Slides tab (editor/slide-content-editor.js) uses, so
// an edit in either tab is really an edit to the same Seminar JSON: both
// panels re-render independently from the same seminarChanged event, with
// no separate copy of board content kept here.
import { getNarrationUnits } from '../agents/narrator-agent.js';
import { newItemId, newBlockId } from '../lib/id-gen.js';

const STATUS_LABEL = {
  fresh: '✓ Script ready',
  stale: '○ Not generated yet',
  regenerating: '⟳ Writing script…',
  error: '⚠ Generation failed — try Regenerate again',
};

// Grows the textarea to fit its content instead of scrolling internally —
// same fix applied to the old single-textarea notes-editor and
// .slide-card-preview elsewhere in this codebase.
function autoGrowTextarea(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function findUnitTarget(slide, blockId, itemId) {
  const block = slide.boardContent.find((b) => b.id === blockId);
  return itemId ? block.items.find((it) => it.id === itemId) : block;
}

// The board-content value for a unit, read directly off the block/item —
// not getNarrationUnits' own unit.get(), which wraps equation latex in
// "$...$" for the Narrator Agent's benefit. Editing wants the raw value:
// block.latex (no delimiters), matching exactly what slide-content-editor.js's
// own equation input already shows and edits.
//
// A diagram block shows a short read-only summary of its tikzCode here
// (a \draw-statement count), not its caption — this field's role is "what's
// actually on the board" (the same role latex/text play for other block
// types), and full TikZ editing lives in its own dedicated toggle+textarea
// (see the isDiagram branch in buildRows below) since TikZ is multi-line
// and doesn't fit this single-line field. caption is narration raw
// material, closer in spirit to narrationText, and stays editable there
// (see narrationInput below).
function unitBoardValue(block, unit, target) {
  if (unit.itemId) return target.text || '';
  if (block.type === 'equation') return target.latex || '';
  if (block.type === 'diagram') {
    const drawCount = (target.tikzCode || '').split('\n').filter((l) => l.includes('\\draw')).length;
    return drawCount > 0 ? `${drawCount} \\draw statement${drawCount === 1 ? '' : 's'}` : '(no diagram generated yet)';
  }
  return target.text || '';
}

// Writes an edited board-content value back through the same
// controller.updateBlock call the Slides tab uses — bullet items patch the
// whole items array (mirroring slide-content-editor.js's own bullet-edit
// code) since a block is updated as a unit, not per-item. Never called for
// a diagram block — its board-content field here is a read-only summary
// (see boardInput's own readOnly toggle below); the actual editable TikZ
// source lives in its own textarea (see buildRows). An earlier version had
// no diagram case here at all, which fell through to the prose branch and
// wrote a stray `text` field onto the block instead of touching its real
// fields — silently losing the user's edit with no error.
function writeUnitBoardValue(controller, slideId, block, unit, value) {
  if (unit.itemId) {
    const items = block.items.map((it) => (it.id === unit.itemId ? { ...it, text: value } : it));
    controller.updateBlock(slideId, block.id, { items });
  } else if (block.type === 'equation') {
    controller.updateBlock(slideId, block.id, { latex: value });
  } else if (block.type === 'diagram') {
    // no-op — read-only summary, see the comment above.
  } else {
    controller.updateBlock(slideId, block.id, { text: value });
  }
}

function unitsKey(units) {
  return units.map((u) => `${u.blockId}:${u.itemId || ''}`).join('|');
}

// Removing a unit means removing a whole block (prose/equation) or just one
// item out of a bullet-list block's items array — never the reverse, so a
// bullet row's "remove" never surprises the user by deleting the whole list.
// Deleting a bullet-list block's last remaining item removes the now-empty
// block entirely rather than leaving a dangling empty list, via the exact
// same controller.deleteBlock/updateBlock calls the Slides tab uses.
function deleteUnit(controller, slideId, block, unit) {
  if (!unit.itemId) { controller.deleteBlock(slideId, block.id); return; }
  const items = block.items.filter((it) => it.id !== unit.itemId);
  if (items.length === 0) controller.deleteBlock(slideId, block.id);
  else controller.updateBlock(slideId, block.id, { items });
}

// Inserting after a bullet-item row adds another item to that SAME list
// (matching slide-content-editor.js's own "+ item" behavior); inserting
// after a prose/equation row adds a new, empty prose block — the lowest-
// friction default for "one more narrated line," reusing
// controller.insertBlock's existing afterBlockId positioning rather than
// always appending at the very end of the slide.
//
// Returns {id, run} rather than just running the mutation immediately:
// controller.insertBlock/updateBlock emit 'seminarChanged' *synchronously*,
// which re-renders this same tray before the mutation call even returns —
// so the caller must set pendingFocusItemId (below) BEFORE calling run(),
// or the rebuild that insertion itself triggers won't see it yet. The new
// item/block's id is generated here, up front, specifically so the caller
// can know it before the mutation runs.
function insertUnitAfter(controller, slideId, block, unit) {
  if (unit.itemId) {
    const idx = block.items.findIndex((it) => it.id === unit.itemId);
    const level = block.items[idx]?.level || 0;
    const newItem = { id: newItemId(block.id), text: '', level, narrationText: '' };
    const items = [...block.items];
    items.splice(idx + 1, 0, newItem);
    return { id: newItem.id, run: () => controller.updateBlock(slideId, block.id, { items }) };
  }
  const id = newBlockId(slideId);
  return { id, run: () => controller.insertBlock(slideId, { afterBlockId: block.id, block: { type: 'prose', id, text: '' } }) };
}

export function mountNotesEditor(containerEl, controller) {
  let currentSlideId = null;
  let lastUnitsKey = null;
  let pendingFocusItemId = null; // set right before an insert, consumed by the next buildRows()

  containerEl.innerHTML = `
    <div class="notes-editor">
      <div class="narration-tray"></div>
      <div class="notes-editor-footer">
        <div class="narration-status-badge"></div>
        <button type="button" class="regenerate-btn" title="Rewrite every block/item's script from this slide's current board content (discards hand edits)">↻ Regenerate</button>
      </div>
      <div class="board-notes-drift-nudge" style="display:none;">Board content changed since this script was written — consider regenerating.</div>
    </div>
  `;

  const trayEl = containerEl.querySelector('.narration-tray');
  const statusEl = containerEl.querySelector('.narration-status-badge');
  const driftEl = containerEl.querySelector('.board-notes-drift-nudge');
  const regenerateBtn = containerEl.querySelector('.regenerate-btn');

  regenerateBtn.addEventListener('click', () => {
    if (!currentSlideId) return;
    const slide = controller.getSlide(currentSlideId);
    const hasExisting = getNarrationUnits(slide).some((unit) => findUnitTarget(slide, unit.blockId, unit.itemId).narrationText?.trim());
    if (hasExisting && !confirm('Rewrite every block/item’s script from this slide’s board content? This replaces all current narration.')) return;
    controller.regenerateNarration(currentSlideId);
  });

  function renderStatus(slide) {
    statusEl.textContent = STATUS_LABEL[slide.narrationStatus] || '';
    statusEl.className = `narration-status-badge status-${slide.narrationStatus}`;
    regenerateBtn.disabled = slide.narrationStatus === 'regenerating';
    driftEl.style.display = (slide.edited.boardContent && slide.narrationStatus === 'fresh') ? 'block' : 'none';
  }

  // Full rebuild — only when the unit list's structure actually changed
  // (a block/item was added/deleted/reordered from the Slides tab). Rebuilds
  // every row's DOM.
  function buildRows(slide) {
    trayEl.innerHTML = '';
    getNarrationUnits(slide).forEach((unit) => {
      const block = slide.boardContent.find((b) => b.id === unit.blockId);
      const target = findUnitTarget(slide, unit.blockId, unit.itemId);

      const row = document.createElement('div');
      row.className = 'tray-row';
      row.dataset.blockId = unit.blockId;
      if (unit.itemId) row.dataset.itemId = unit.itemId;

      const rowHeader = document.createElement('div');
      rowHeader.className = 'tray-row-header';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'tray-row-del-btn';
      delBtn.title = unit.itemId ? 'Remove this item' : 'Remove this block';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => deleteUnit(controller, currentSlideId, block, unit));
      rowHeader.appendChild(delBtn);

      const narrationInput = document.createElement('textarea');
      narrationInput.className = 'tray-narration-input';
      narrationInput.rows = 2;
      narrationInput.placeholder = 'Spoken narration for this — click Regenerate to write it, or type your own.';
      narrationInput.value = target.narrationText || '';
      narrationInput.addEventListener('input', () => {
        autoGrowTextarea(narrationInput);
        controller.updateBlockNarration(currentSlideId, unit.blockId, unit.itemId, narrationInput.value);
      });

      // Editable board content — writes through controller.updateBlock,
      // the same call slide-content-editor.js's own block editors use, so
      // this is a second view onto the same field, not a separate copy.
      // 'change' (fires on blur), not 'input', matching that same editor's
      // convention — an equation edit re-typesets on the Slides tab/live
      // board, which shouldn't happen on every keystroke.
      const boardInput = document.createElement('textarea');
      boardInput.className = 'tray-block-preview';
      boardInput.rows = 1;
      const isDiagram = block.type === 'diagram' && !unit.itemId;
      boardInput.placeholder = block.type === 'equation' && !unit.itemId ? 'LaTeX (no $ delimiters)'
        : isDiagram ? 'Diagram summary (see TikZ code below to edit)'
        : 'Board text';
      boardInput.value = unitBoardValue(block, unit, target);
      boardInput.readOnly = isDiagram;
      if (isDiagram) boardInput.title = 'A summary of the generated diagram — use the TikZ code toggle below to edit it.';
      boardInput.addEventListener('input', () => autoGrowTextarea(boardInput));
      boardInput.addEventListener('change', () => {
        writeUnitBoardValue(controller, currentSlideId, block, unit, boardInput.value);
      });

      // Diagram blocks get a dedicated toggle + textarea for the actual
      // editable TikZ source — kept separate from boardInput above (which
      // stays a compact, read-only, single-line summary) since TikZ is
      // multi-line and would blow out that field. Live redraw on every
      // keystroke (no debounce), matching narrationInput's pattern above —
      // per explicit product decision, not boardInput's blur-only
      // convention, since correcting a wrong diagram benefits from seeing
      // the result as you type, not just after leaving the field.
      let tikzToggleBtn = null;
      let tikzInput = null;
      if (isDiagram) {
        tikzToggleBtn = document.createElement('button');
        tikzToggleBtn.type = 'button';
        tikzToggleBtn.className = 'tray-tikz-toggle-btn';
        tikzToggleBtn.textContent = '▸ TikZ code';

        tikzInput = document.createElement('textarea');
        tikzInput.className = 'tray-tikz-input';
        tikzInput.rows = 6;
        tikzInput.spellcheck = false;
        tikzInput.style.display = 'none';
        tikzInput.placeholder = '% component label\n\\draw (0,0) circle (3);';
        tikzInput.value = target.tikzCode || '';
        tikzInput.addEventListener('input', () => {
          controller.updateBlock(currentSlideId, block.id, { tikzCode: tikzInput.value });
        });

        tikzToggleBtn.addEventListener('click', () => {
          const open = tikzInput.style.display !== 'none';
          tikzInput.style.display = open ? 'none' : 'block';
          tikzToggleBtn.textContent = open ? '▸ TikZ code' : '▾ TikZ code';
        });
      }

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'tray-row-add-btn';
      addBtn.textContent = unit.itemId ? '+ Add item' : '+ Add line';
      addBtn.addEventListener('click', () => {
        const { id, run } = insertUnitAfter(controller, currentSlideId, block, unit);
        pendingFocusItemId = id; // must be set before run() — see insertUnitAfter's own comment
        run();
      });

      // Narration first, board content second — matches reveal order: the
      // model speaks a unit's narration, then its board content is
      // written, never the other way round. The green
      // color alone is the signal for "this is on the board" — no text
      // label, per explicit feedback that the color distinction reads
      // clearly enough on its own.
      row.appendChild(rowHeader);
      row.appendChild(narrationInput);
      row.appendChild(boardInput);
      if (tikzToggleBtn) row.appendChild(tikzToggleBtn);
      if (tikzInput) row.appendChild(tikzInput);
      row.appendChild(addBtn);
      trayEl.appendChild(row);
      autoGrowTextarea(narrationInput);
      autoGrowTextarea(boardInput);

      if (unit.itemId && unit.itemId === pendingFocusItemId) boardInput.focus();
      else if (!unit.itemId && unit.blockId === pendingFocusItemId) boardInput.focus();
    });
    pendingFocusItemId = null;
  }

  // Lightweight patch — same unit structure, just refresh preview content
  // (board text/latex may have changed in the Slides tab) and narration
  // text (e.g. after Regenerate), skipping whichever textarea currently has
  // focus so an in-progress keystroke never gets clobbered by its own
  // resulting seminarChanged event.
  function patchRows(slide) {
    getNarrationUnits(slide).forEach((unit) => {
      const row = trayEl.querySelector(unit.itemId
        ? `[data-block-id="${unit.blockId}"][data-item-id="${unit.itemId}"]`
        : `[data-block-id="${unit.blockId}"]:not([data-item-id])`);
      if (!row) return;
      const block = slide.boardContent.find((b) => b.id === unit.blockId);
      const target = findUnitTarget(slide, unit.blockId, unit.itemId);
      const boardInput = row.querySelector('.tray-block-preview');
      const narrationInput = row.querySelector('.tray-narration-input');

      const currentBoardValue = unitBoardValue(block, unit, target);
      if (document.activeElement !== boardInput && boardInput.value !== currentBoardValue) {
        boardInput.value = currentBoardValue;
        autoGrowTextarea(boardInput);
      }

      if (document.activeElement !== narrationInput && narrationInput.value !== (target.narrationText || '')) {
        narrationInput.value = target.narrationText || '';
        autoGrowTextarea(narrationInput);
      }

      const tikzInput = row.querySelector('.tray-tikz-input');
      if (tikzInput && document.activeElement !== tikzInput && tikzInput.value !== (target.tikzCode || '')) {
        tikzInput.value = target.tikzCode || '';
      }
    });
  }

  function render(slideId) {
    const slide = controller.getSlide(slideId);
    if (!slide) return;
    const key = unitsKey(getNarrationUnits(slide));
    if (key !== lastUnitsKey) {
      buildRows(slide);
      lastUnitsKey = key;
    } else {
      patchRows(slide);
    }
    renderStatus(slide);
  }

  function setActiveSlide(slideId) {
    currentSlideId = slideId;
    lastUnitsKey = null; // force a full rebuild on slide switch
    render(slideId);
  }

  controller.on('seminarChanged', ({ slideId }) => { if (slideId === currentSlideId) render(currentSlideId); });
  controller.on('narrationStatusChanged', (slideId) => { if (slideId === currentSlideId) render(currentSlideId); });

  // scrollHeight is always 0 while this row's tab panel is display:none (e.g.
  // mounted on load, before the user has ever switched to the Narrator Notes
  // tab), which silently collapsed every textarea to ~0px height. Re-measure
  // once the tab is actually visible — called by ui/main.js's notesTabBtn
  // click handler for every currently-mounted notes editor.
  function refresh() {
    trayEl.querySelectorAll('.tray-narration-input, .tray-block-preview').forEach(autoGrowTextarea);
  }

  return { setActiveSlide, refresh };
}
