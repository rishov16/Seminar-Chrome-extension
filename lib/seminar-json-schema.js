// Seminar JSON v2 — the single source of truth for a generated seminar.
// All cross-references (revealSequence, diagramSpec) are id-based, never
// array-index-based, so structural edits (add/delete/reorder) never leave
// dangling references silently pointing at the wrong thing.
//
// @typedef {{ spoken: string, boardText: string }} NarrationFragment
// @typedef {{ id: string, text: string, level: number, narrationText: string, narrationFragments?: NarrationFragment[] }} BulletItem
// @typedef {
//   { type: 'prose', id: string, text: string, narrationText: string, narrationFragments?: NarrationFragment[] } |
//   { type: 'equation', id: string, latex: string, narrationText: string, narrationFragments?: NarrationFragment[] } |
//   { type: 'bullet-list', id: string, items: BulletItem[] } |
//   { type: 'diagram', id: string, tikzCode: string, caption: string, narrationText: string, narrationFragments?: NarrationFragment[] }
// } BoardBlock
// A diagram block's tikzCode is TikZ \draw-statement source, generated from
// the source screenshot by
// renderers/experimental-handwriting-agent/diagram-tikz-generator.js
// (called from editor/seminar-editor-controller.js's
// generateAllDiagramsUpfront, a separate pass after Head Agent planning —
// the Head Agent itself only decides a diagram belongs and writes its
// caption, never geometry) and parsed deterministically into stroke
// geometry by tikz-path-parser.js at render time — no LaTeX ever runs. It
// can legitimately be '' (pending generation, or generation found nothing
// sketchable/failed) — the renderer degrades to showing caption as plain
// text in that case, same as an unknown motifKey used to. This
// supersedes an earlier motifKey-based fixed-bank mechanism.
// caption is a short plain-English description (e.g. "a disk with a
// subdisk removed, shrinking to a point") that the Narrator Agent expands
// into real spoken narration — a diagram has no verbatim board text to
// transcribe the way prose/equations do, so this is closer to how the
// dead diagramHint field below was originally meant to work.
// narrationText lives ON the block/item it narrates (not in a separate
// array indexed by position) — the same id-based-not-index-based principle
// this file's own header comment states for revealSequence/diagramSpec.
// A bullet-list block has no narrationText of its own; each of its items
// does, since bullet items are the actual reveal unit (matching
// revealSequence's existing per-item targeting via targetItemId).
// narrationFragments (prose blocks, bullet items, and equation blocks — see
// agents/narrator-agent.js) is an optional, purely-internal breakdown of
// narrationText into several (spoken, boardText) pairs, so a line can be
// narrated and revealed in phrase-sized pieces instead of all at once — set
// only by agents/narrator-agent.js's generation (never hand-edited
// directly; editing narrationText or the block/item's own text/latex
// invalidates it — see lib/seminar-mutations.js). The boardText pieces,
// concatenated in order, always exactly reconstruct the block/item's own
// text/latex — narrator-agent.js discards any fragmentation that doesn't
// hold that invariant, falling back to ordinary single-unit narration/
// reveal. For an equation block specifically, each boardText piece must
// ALSO independently be valid, safely-cut LaTeX (balanced braces, balanced
// \left/\right, no bare-argument boundary — see narrator-agent.js's
// equation-specific checks), and a multi-row derivation is never
// fragmented at all — reconstruction alone isn't sufficient for LaTeX the
// way it is for plain text.
// @typedef {{ step: number, targetBlockId: string, targetItemId?: string, highlight?: boolean }} RevealStep
// @typedef {
//   { type: 'box', id: string, x: number, y: number, w: number, h: number, label?: string } |
//   { type: 'arrow', id: string, from: string, to: string, style?: 'solid'|'dashed', label?: string } |
//   { type: 'line', id: string, x1: number, y1: number, x2: number, y2: number, style?: 'solid'|'dashed'|'underline' } |
//   { type: 'label', id: string, x: number, y: number, text: string, anchor?: 'start'|'middle'|'end' } |
//   { type: 'highlight-region', id: string, targetBlockId: string, shape?: 'rect'|'ellipse', padding?: number } |
//   { type: 'custom-svg', id: string, raw: string }
// } DiagramShape
// @typedef {{ canvas: {width:number,height:number}, shapes: DiagramShape[], revealWithSteps: {step:number, showShapeIds:string[]}[] }} DiagramSpec
// @typedef {'fresh'|'stale'|'regenerating'|'error'} NarrationStatus
// @typedef {{
//   slideId: string, order: number, title: string, learningObjective: string,
//   boardContent: BoardBlock[], revealSequence: RevealStep[], diagramSpec: DiagramSpec|null,
//   diagramHint: string|null, narrationStatus: NarrationStatus, narrationRevision: number,
//   edited: { boardContent: boolean, narration: boolean, diagramSpec: boolean },
//   animationMetadata: { autoAdvance: boolean, minDisplaySeconds: number, pointerFollowsHighlight: boolean }
// }} Slide
// No presentationNotes field — narration lives per-block/per-item (see
// BoardBlock/BulletItem above). Anywhere "the whole spoken script" is
// needed, join each unit's narrationText in boardContent order
// (agents/narrator-agent.js's serializeNarrationUnits does this).
// @typedef {{
//   schemaVersion: 2, seminarId: string, createdAt: string,
//   sourceSelection: { rawText: string, restoredText: string },
//   meta: { title: string, estimatedSlideCount: number },
//   slides: Slide[]
// }} SeminarJson

export const SCHEMA_VERSION = 2;

const VALID_BLOCK_TYPES = new Set(['prose', 'equation', 'bullet-list', 'diagram']);
const VALID_SHAPE_TYPES = new Set(['box', 'arrow', 'line', 'label', 'highlight-region', 'custom-svg']);
const VALID_NARRATION_STATUS = new Set(['fresh', 'stale', 'regenerating', 'error']);

/** @returns {{ valid: boolean, errors: string[] }} */
export function validateSeminarJson(doc) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (!doc || typeof doc !== 'object') { err('document is not an object'); return { valid: false, errors }; }
  if (!doc.seminarId) err('missing seminarId');
  if (!Array.isArray(doc.slides) || doc.slides.length === 0) err('slides must be a non-empty array');

  const seenSlideIds = new Set();
  (doc.slides || []).forEach((slide, si) => {
    const where = `slides[${si}]`;
    if (!slide.slideId) err(`${where}: missing slideId`);
    else if (seenSlideIds.has(slide.slideId)) err(`${where}: duplicate slideId ${slide.slideId}`);
    else seenSlideIds.add(slide.slideId);

    if (!slide.title) err(`${where}: missing title`);
    if (!Array.isArray(slide.boardContent) || slide.boardContent.length === 0) {
      err(`${where}: boardContent must be a non-empty array`);
    }

    const blockIds = new Set();
    (slide.boardContent || []).forEach((block, bi) => {
      const bwhere = `${where}.boardContent[${bi}]`;
      if (!VALID_BLOCK_TYPES.has(block.type)) err(`${bwhere}: invalid type "${block.type}"`);
      if (!block.id) err(`${bwhere}: missing id`);
      else if (blockIds.has(block.id)) err(`${bwhere}: duplicate block id ${block.id}`);
      else blockIds.add(block.id);
      if (block.type === 'equation' && !block.latex) err(`${bwhere}: equation block missing latex`);
      if (block.type === 'prose' && typeof block.text !== 'string') err(`${bwhere}: prose block missing text`);
      if (block.type === 'bullet-list' && !Array.isArray(block.items)) err(`${bwhere}: bullet-list missing items[]`);
      if (block.type === 'diagram') {
        // tikzCode is intentionally not required here — it's legitimately
        // empty right after Head Agent planning (filled in by a later pass)
        // and can stay empty if generation fails; the renderer degrades to
        // caption text in that case rather than treating it as invalid.
        if (!block.caption) err(`${bwhere}: diagram block missing caption`);
      }
    });

    (slide.revealSequence || []).forEach((step, ri) => {
      const rwhere = `${where}.revealSequence[${ri}]`;
      if (!blockIds.has(step.targetBlockId)) err(`${rwhere}: targetBlockId "${step.targetBlockId}" not found in boardContent`);
    });

    if (slide.diagramSpec) {
      const shapeIds = new Set();
      (slide.diagramSpec.shapes || []).forEach((shape, shi) => {
        const swhere = `${where}.diagramSpec.shapes[${shi}]`;
        if (!VALID_SHAPE_TYPES.has(shape.type)) err(`${swhere}: invalid shape type "${shape.type}"`);
        if (!shape.id) err(`${swhere}: missing id`);
        else shapeIds.add(shape.id);
        if (shape.type === 'arrow' && (!shapeIds.has(shape.from) && shape.from)) {
          // arrows may reference shapes declared later in the array; skip strict order check here
        }
        if (shape.type === 'highlight-region' && !blockIds.has(shape.targetBlockId)) {
          err(`${swhere}: highlight-region targetBlockId "${shape.targetBlockId}" not found in boardContent`);
        }
      });
    }

    if (slide.narrationStatus && !VALID_NARRATION_STATUS.has(slide.narrationStatus)) {
      err(`${where}: invalid narrationStatus "${slide.narrationStatus}"`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/** Fills in workflow-metadata defaults the Head Agent's LLM output won't include. */
export function normalizeSeminarJson(doc) {
  doc.schemaVersion = SCHEMA_VERSION;
  doc.slides.forEach((slide, i) => {
    slide.order = i + 1;
    slide.narrationStatus = slide.narrationStatus || 'stale';
    slide.narrationRevision = slide.narrationRevision || 0;
    slide.edited = slide.edited || { boardContent: false, narration: false, diagramSpec: false };
    slide.animationMetadata = slide.animationMetadata || { autoAdvance: true, minDisplaySeconds: 3, pointerFollowsHighlight: true };
    slide.diagramSpec = slide.diagramSpec || null;
    slide.diagramHint = slide.diagramHint || null;
    slide.revealSequence = slide.revealSequence || [];
    (slide.boardContent || []).forEach((block) => {
      if (block.type === 'prose' || block.type === 'equation' || block.type === 'diagram') block.narrationText = block.narrationText || '';
      if (block.type === 'diagram') block.tikzCode = block.tikzCode || '';
      if (block.type === 'bullet-list') {
        (block.items || []).forEach((item) => { item.narrationText = item.narrationText || ''; });
      }
    });
  });
  return doc;
}
