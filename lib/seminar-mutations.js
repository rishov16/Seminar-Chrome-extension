// The only place Seminar JSON structural edits happen. Called exclusively
// from editor/seminar-editor-controller.js. All cross-references are
// id-based (see lib/seminar-json-schema.js), so reorders never need repair —
// only deletes do, via repairReferences().

import { newSlideId, newBlockId, newItemId, newShapeId } from './id-gen.js';

function findSlide(seminar, slideId) {
  const slide = seminar.slides.find((s) => s.slideId === slideId);
  if (!slide) throw new Error(`Slide not found: ${slideId}`);
  return slide;
}

function blankSlide() {
  const slideId = newSlideId();
  return {
    slideId,
    order: 0,
    title: 'New Slide',
    learningObjective: '',
    boardContent: [{ type: 'prose', id: newBlockId(slideId), text: '', narrationText: '' }],
    revealSequence: [],
    diagramSpec: null,
    diagramHint: null,
    narrationStatus: 'stale',
    narrationRevision: 0,
    edited: { boardContent: true, narration: false, diagramSpec: false },
    animationMetadata: { autoAdvance: true, minDisplaySeconds: 3, pointerFollowsHighlight: true },
  };
}

function renumberSlides(seminar) {
  seminar.slides.forEach((s, i) => { s.order = i + 1; });
}

// ---- Slide-level ops (no cross-reference repair needed — nothing else
// references a slideId, only the display-only `order` field is renumbered) ----

export function insertSlide(seminar, { afterSlideId = null } = {}) {
  const slide = blankSlide();
  if (afterSlideId == null) {
    seminar.slides.push(slide);
  } else {
    const idx = seminar.slides.findIndex((s) => s.slideId === afterSlideId);
    seminar.slides.splice(idx + 1, 0, slide);
  }
  renumberSlides(seminar);
  return slide;
}

export function deleteSlide(seminar, slideId) {
  seminar.slides = seminar.slides.filter((s) => s.slideId !== slideId);
  renumberSlides(seminar);
}

export function reorderSlides(seminar, slideId, newIndex) {
  const from = seminar.slides.findIndex((s) => s.slideId === slideId);
  if (from === -1) return;
  const [slide] = seminar.slides.splice(from, 1);
  seminar.slides.splice(Math.max(0, Math.min(newIndex, seminar.slides.length)), 0, slide);
  renumberSlides(seminar);
}

// ---- Block-level ops ----

export function insertBlock(seminar, slideId, { afterBlockId = null, block }) {
  const slide = findSlide(seminar, slideId);
  const newBlock = { ...block, id: block.id || newBlockId(slideId) };
  if (newBlock.type === 'bullet-list') {
    newBlock.items = (newBlock.items || []).map((it) => ({ narrationText: '', ...it, id: it.id || newItemId(newBlock.id) }));
  } else {
    newBlock.narrationText = newBlock.narrationText || '';
  }
  if (afterBlockId == null) {
    slide.boardContent.push(newBlock);
  } else {
    const idx = slide.boardContent.findIndex((b) => b.id === afterBlockId);
    slide.boardContent.splice(idx + 1, 0, newBlock);
  }
  slide.edited.boardContent = true;
  return newBlock;
}

export function deleteBlock(seminar, slideId, blockId) {
  const slide = findSlide(seminar, slideId);
  slide.boardContent = slide.boardContent.filter((b) => b.id !== blockId);
  slide.edited.boardContent = true;
  repairReferences(slide);
}

export function reorderBlock(seminar, slideId, blockId, newIndex) {
  const slide = findSlide(seminar, slideId);
  const from = slide.boardContent.findIndex((b) => b.id === blockId);
  if (from === -1) return;
  const [block] = slide.boardContent.splice(from, 1);
  slide.boardContent.splice(Math.max(0, Math.min(newIndex, slide.boardContent.length)), 0, block);
  slide.edited.boardContent = true;
  // Deliberately NOT auto-repairing revealSequence order here: reveal order
  // is an independently-editable pedagogical choice, not required to track
  // board position. The editor shows a divergence warning instead.
}

export function updateBlock(seminar, slideId, blockId, patch) {
  const slide = findSlide(seminar, slideId);
  const block = slide.boardContent.find((b) => b.id === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);

  // A hand-edit to a block/item's own board text invalidates any previously
  // generated narrationFragments — their boardText pieces no longer
  // reconstruct the new text (see agents/narrator-agent.js's reconstruction
  // invariant). Prose blocks, bullet items, and equation blocks can all
  // carry fragments.
  if ('text' in patch && block.type === 'prose' && patch.text !== block.text) {
    delete block.narrationFragments;
  }
  if ('latex' in patch && block.type === 'equation' && patch.latex !== block.latex) {
    delete block.narrationFragments;
  }
  if ('caption' in patch && block.type === 'diagram' && patch.caption !== block.caption) {
    delete block.narrationFragments;
  }
  if ('items' in patch && block.type === 'bullet-list') {
    const oldTextById = new Map((block.items || []).map((it) => [it.id, it.text]));
    (patch.items || []).forEach((it) => {
      if (!oldTextById.has(it.id) || oldTextById.get(it.id) !== it.text) delete it.narrationFragments;
    });
  }

  Object.assign(block, patch);
  slide.edited.boardContent = true;
}

// Sets narrationText on a block (prose/equation) or, if itemId is given, on
// one item inside a bullet-list block — the actual reveal unit in either
// case. Deliberately its own function, not a case of updateBlock/patch:
// hand-editing narration marks slide.edited.narration, never
// slide.edited.boardContent (they track independent dirty states — see
// lib/seminar-json-schema.js's Slide.edited shape).
export function updateBlockNarration(seminar, slideId, blockId, itemId, text) {
  const slide = findSlide(seminar, slideId);
  const block = slide.boardContent.find((b) => b.id === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);
  if (itemId) {
    const item = (block.items || []).find((it) => it.id === itemId);
    if (!item) throw new Error(`Bullet item not found: ${itemId}`);
    item.narrationText = text;
    delete item.narrationFragments;
  } else {
    block.narrationText = text;
    delete block.narrationFragments;
  }
  slide.edited.narration = true;
}

// ---- Reveal sequence ops ----

export function setRevealSequence(seminar, slideId, revealSequence) {
  const slide = findSlide(seminar, slideId);
  slide.revealSequence = revealSequence.map((r, i) => ({ ...r, step: i + 1 }));
}

// ---- Diagram shape ops ----

export function addShape(seminar, slideId, shape) {
  const slide = findSlide(seminar, slideId);
  if (!slide.diagramSpec) slide.diagramSpec = { canvas: { width: 600, height: 300 }, shapes: [], revealWithSteps: [] };
  const newShape = { ...shape, id: shape.id || newShapeId(slideId) };
  slide.diagramSpec.shapes.push(newShape);
  slide.edited.diagramSpec = true;
  return newShape;
}

export function updateShape(seminar, slideId, shapeId, patch) {
  const slide = findSlide(seminar, slideId);
  const shape = slide.diagramSpec?.shapes.find((s) => s.id === shapeId);
  if (!shape) throw new Error(`Shape not found: ${shapeId}`);
  Object.assign(shape, patch);
  slide.edited.diagramSpec = true;
}

/** Returns the ids of arrows that would be cascade-deleted with this shape, for a UI confirmation prompt. */
export function findDependentArrows(seminar, slideId, shapeId) {
  const slide = findSlide(seminar, slideId);
  if (!slide.diagramSpec) return [];
  return slide.diagramSpec.shapes.filter((s) => s.type === 'arrow' && (s.from === shapeId || s.to === shapeId));
}

export function deleteShape(seminar, slideId, shapeId) {
  const slide = findSlide(seminar, slideId);
  if (!slide.diagramSpec) return;
  const dependentArrowIds = new Set(findDependentArrows(seminar, slideId, shapeId).map((a) => a.id));
  slide.diagramSpec.shapes = slide.diagramSpec.shapes.filter(
    (s) => s.id !== shapeId && !dependentArrowIds.has(s.id)
  );
  const validShapeIds = new Set(slide.diagramSpec.shapes.map((s) => s.id));
  slide.diagramSpec.revealWithSteps = (slide.diagramSpec.revealWithSteps || [])
    .map((r) => ({ ...r, showShapeIds: r.showShapeIds.filter((id) => validShapeIds.has(id)) }))
    .filter((r) => r.showShapeIds.length > 0);
  slide.edited.diagramSpec = true;
}

// ---- Reference repair (called after block/item deletion) ----

export function repairReferences(slide) {
  const validBlockIds = new Set(slide.boardContent.map((b) => b.id));
  const itemIdsByBlock = new Map(
    slide.boardContent.filter((b) => b.type === 'bullet-list').map((b) => [b.id, new Set(b.items.map((it) => it.id))])
  );

  slide.revealSequence = (slide.revealSequence || [])
    .filter((r) => validBlockIds.has(r.targetBlockId))
    .filter((r) => {
      if (!r.targetItemId) return true;
      const items = itemIdsByBlock.get(r.targetBlockId);
      return items ? items.has(r.targetItemId) : false;
    })
    .sort((a, b) => a.step - b.step)
    .map((r, i) => ({ ...r, step: i + 1 }));

  if (slide.diagramSpec) {
    slide.diagramSpec.shapes = slide.diagramSpec.shapes.filter(
      (s) => s.type !== 'highlight-region' || validBlockIds.has(s.targetBlockId)
    );
    const validShapeIds = new Set(slide.diagramSpec.shapes.map((s) => s.id));
    slide.diagramSpec.revealWithSteps = (slide.diagramSpec.revealWithSteps || [])
      .map((r) => ({ ...r, showShapeIds: r.showShapeIds.filter((id) => validShapeIds.has(id)) }))
      .filter((r) => r.showShapeIds.length > 0);
  }
}
