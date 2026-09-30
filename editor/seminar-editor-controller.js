// The sole write path for the Seminar JSON. No panel (ui/main.js's Slides tab,
// slide-content-editor.js, notes-editor.js, diagram-form-editor.js) mutates
// the JSON directly — every edit calls a method here, which delegates to
// lib/seminar-mutations.js and emits 'seminarChanged' for panels to re-render
// from. Narration lives per-block/per-item (narrationText — see
// lib/seminar-json-schema.js), generated once from a slide's boardContent
// (agents/narrator-agent.js), then becomes directly, freely editable per
// unit — matching the original SEMINAR extension's paperInput -> Generate ->
// freely hand-editable spokenInput flow, not an auto-reconvert-on-every-
// keystroke loop. Narration no longer needs a runtime cache (no
// narrationCache/getNarrationCache) — it's already sitting on the schema,
// so orchestration/slide-deck-controller.js reads it directly off the slide.
import * as mutations from '../lib/seminar-mutations.js';
import { generateForSlide, applyNarrationSegments, getNarrationUnits } from '../agents/narrator-agent.js';
import { getSettings } from '../lib/storage.js';
import { generateTikzDiagramFromImage } from '../renderers/experimental-handwriting-agent/diagram-tikz-generator.js?v=1';

export function createSeminarEditorController(seminarJson) {
  const seminar = seminarJson;
  let locked = false;
  const abortControllers = new Map();
  const listeners = { seminarChanged: [], narrationStatusChanged: [] };

  function on(event, cb) { listeners[event]?.push(cb); return () => { listeners[event] = listeners[event].filter((f) => f !== cb); }; }
  function emit(event, ...args) { listeners[event]?.forEach((cb) => cb(...args)); }

  function getSlide(slideId) { return seminar.slides.find((s) => s.slideId === slideId); }
  function getSeminarJson() { return seminar; }
  function notifyChanged(slideId) { emit('seminarChanged', { slideId }); }

  function setNarrationStatus(slideId, status) {
    const slide = getSlide(slideId);
    if (!slide) return;
    slide.narrationStatus = status;
    emit('narrationStatusChanged', slideId, status);
    notifyChanged(slideId);
  }

  function updateSlideMeta(slideId, patch) {
    if (locked) return;
    const slide = getSlide(slideId);
    if (!slide) return;
    Object.assign(slide, patch);
    slide.edited.boardContent = true;
    notifyChanged(slideId);
  }

  // ---- structural mutation dispatch (wraps lib/seminar-mutations.js) ----
  function insertSlide(opts) { if (locked) return; const s = mutations.insertSlide(seminar, opts); notifyChanged(null); return s; }
  function deleteSlide(slideId) { if (locked) return; mutations.deleteSlide(seminar, slideId); notifyChanged(null); }
  function reorderSlides(slideId, newIndex) { if (locked) return; mutations.reorderSlides(seminar, slideId, newIndex); notifyChanged(null); }
  function insertBlock(slideId, opts) { if (locked) return; const b = mutations.insertBlock(seminar, slideId, opts); notifyChanged(slideId); return b; }
  function deleteBlock(slideId, blockId) { if (locked) return; mutations.deleteBlock(seminar, slideId, blockId); notifyChanged(slideId); }
  function reorderBlock(slideId, blockId, newIndex) { if (locked) return; mutations.reorderBlock(seminar, slideId, blockId, newIndex); notifyChanged(slideId); }
  function updateBlock(slideId, blockId, patch) { if (locked) return; mutations.updateBlock(seminar, slideId, blockId, patch); notifyChanged(slideId); }
  function setRevealSequence(slideId, seq) { if (locked) return; mutations.setRevealSequence(seminar, slideId, seq); notifyChanged(slideId); }
  function addShape(slideId, shape) { if (locked) return; const s = mutations.addShape(seminar, slideId, shape); notifyChanged(slideId); return s; }
  function updateShape(slideId, shapeId, patch) { if (locked) return; mutations.updateShape(seminar, slideId, shapeId, patch); notifyChanged(slideId); }
  function deleteShape(slideId, shapeId) { if (locked) return; mutations.deleteShape(seminar, slideId, shapeId); notifyChanged(slideId); }
  function findDependentArrows(slideId, shapeId) { return mutations.findDependentArrows(seminar, slideId, shapeId); }

  // ---- notes editing: direct and WYSIWYG — the transcript IS the spoken script, no hidden reconversion ----

  function slideNarrationState(slide) {
    const units = getNarrationUnits(slide).map((unit) => {
      const block = slide.boardContent.find((b) => b.id === unit.blockId);
      return unit.itemId ? block.items.find((it) => it.id === unit.itemId).narrationText : block.narrationText;
    });
    const anyText = units.some((t) => t && t.trim());
    return anyText ? 'fresh' : 'stale';
  }

  /** Hand-edits one unit's narration (a block, or one bullet item) directly —
   * per-unit equivalent of the old whole-slide onNotesTextChanged. */
  function updateBlockNarration(slideId, blockId, itemId, text) {
    if (locked) return;
    const slide = getSlide(slideId);
    if (!slide) return;
    mutations.updateBlockNarration(seminar, slideId, blockId, itemId, text);
    slide.narrationRevision++;
    setNarrationStatus(slideId, slideNarrationState(slide));
  }

  /** Explicit action (Notes tab "Regenerate" button): (re)writes every unit's
   * narrationText from the slide's current boardContent, discarding any hand
   * edits. Guarded by applyNarrationSegments — if the agent's segment count
   * doesn't match the slide's narration-unit count, nothing is overwritten
   * and the slide is marked 'error' instead of silently misaligning
   * narration to the wrong block/item. */
  async function regenerateNarration(slideId) {
    abortControllers.get(slideId)?.abort();
    const slide = getSlide(slideId);
    if (!slide) return;
    const myRevision = ++slide.narrationRevision;
    const ac = new AbortController();
    abortControllers.set(slideId, ac);
    setNarrationStatus(slideId, 'regenerating');
    try {
      const settings = await getSettings();
      const result = await generateForSlide(slide, {
        apiKey: settings.geminiApiKey,
        includeFillers: settings.includeFillers,
        signal: ac.signal,
      });
      if (slide.narrationRevision !== myRevision) return; // superseded — another edit/regenerate happened meanwhile
      const applied = applyNarrationSegments(slide, result.segments);
      if (!applied) {
        console.error(`Narrator Agent segment count (${result.segments.length}) didn't match slide ${slideId}'s narration-unit count — not applied.`);
        setNarrationStatus(slideId, 'error');
        return;
      }
      slide.edited.narration = false;
      setNarrationStatus(slideId, slideNarrationState(slide));
    } catch (err) {
      if (err.name === 'AbortError' || slide.narrationRevision !== myRevision) return;
      console.error(`Narrator Agent failed for slide ${slideId}`, err);
      setNarrationStatus(slideId, 'error');
    } finally {
      abortControllers.delete(slideId);
    }
  }

  function flushAllPendingRegenerations() {
    // No-op: notes edits are synchronous now (see updateBlockNarration above).
    // Kept so orchestration/presentation-engine.js's lock/snapshot flow still
    // has something to call without needing a special case.
  }

  async function waitForAllNarrationSettled({ timeoutMs = 15000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const anyPending = seminar.slides.some((s) => s.narrationStatus === 'regenerating');
      if (!anyPending) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  function getSlidesWithNarrationError() {
    return seminar.slides.filter((s) => s.narrationStatus === 'error');
  }

  /** Ensures a slide actually has narration before playback — e.g. a slide
   * inserted after the initial upfront batch (orchestration/pipeline-controller.js)
   * never got a narrationText pass. Consumed by
   * orchestration/slide-deck-controller.js right before Play; a no-op once
   * narration exists (status isn't 'stale'). */
  async function ensureNarrationGenerated(slideId) {
    const slide = getSlide(slideId);
    if (!slide || slide.narrationStatus !== 'stale') return;
    await regenerateNarration(slideId);
  }

  /** Initial upfront batch generation right after the Head Agent produces the plan (pipeline-controller.js). */
  async function generateAllNarrationUpfront(onProgress) {
    const settings = await getSettings();
    let done = 0;
    await Promise.all(seminar.slides.map(async (slide) => {
      setNarrationStatus(slide.slideId, 'regenerating');
      try {
        const result = await generateForSlide(slide, { apiKey: settings.geminiApiKey, includeFillers: settings.includeFillers });
        const applied = applyNarrationSegments(slide, result.segments);
        if (!applied) {
          console.error(`Narrator Agent segment count (${result.segments.length}) didn't match slide ${slide.slideId}'s narration-unit count — not applied.`);
          setNarrationStatus(slide.slideId, 'error');
        } else {
          setNarrationStatus(slide.slideId, slideNarrationState(slide));
        }
      } catch (e) {
        console.error(`Narrator Agent failed for slide ${slide.slideId}`, e);
        setNarrationStatus(slide.slideId, 'error');
      }
      done++;
      onProgress?.(done, seminar.slides.length);
    }));
  }

  /** Initial upfront pass right after the Head Agent produces the plan
   * (pipeline-controller.js), one step before generateAllNarrationUpfront —
   * fills in every diagram block's tikzCode from the source screenshot
   * (the same one already captured for OCR at selection time, threaded
   * through here rather than re-captured). Mirrors
   * generateAllNarrationUpfront's shape: iterate in parallel, mutate
   * directly, report progress. A diagram block's tikzCode staying '' (no
   * screenshot available, generation found nothing sketchable, or the
   * call failed) is not an error here — the renderer degrades to showing
   * caption as plain text, so this never throws or blocks the rest of the
   * pipeline. */
  async function generateAllDiagramsUpfront(screenshotDataUrl, apiKey, onProgress) {
    const diagramTasks = [];
    seminar.slides.forEach((slide) => {
      (slide.boardContent || []).forEach((block) => {
        if (block.type === 'diagram') diagramTasks.push({ slide, block });
      });
    });

    const total = diagramTasks.length;
    let done = 0;
    onProgress?.(done, total);
    if (total === 0) return;

    if (!screenshotDataUrl) {
      console.warn('[seminar-editor-controller] no source screenshot available — diagram blocks will show their caption as plain text.');
      onProgress?.(total, total);
      return;
    }

    const commaIdx = screenshotDataUrl.indexOf(',');
    const imageBase64 = commaIdx >= 0 ? screenshotDataUrl.slice(commaIdx + 1) : screenshotDataUrl;

    await Promise.all(diagramTasks.map(async ({ slide, block }) => {
      try {
        const result = await generateTikzDiagramFromImage({
          apiKey, imageBase64, imageMimeType: 'image/jpeg', label: block.id, hint: block.caption,
        });
        block.tikzCode = result.tikzCode || '';
      } catch (e) {
        console.error(`Diagram TikZ generation failed for block ${block.id}`, e);
        block.tikzCode = '';
      }
      done++;
      onProgress?.(done, total);
      notifyChanged(slide.slideId);
    }));
  }

  function lockEditing() { locked = true; }
  function unlockEditing() { locked = false; }
  function isLocked() { return locked; }

  return {
    on, getSeminarJson, getSlide,
    updateSlideMeta,
    insertSlide, deleteSlide, reorderSlides,
    insertBlock, deleteBlock, reorderBlock, updateBlock, setRevealSequence,
    addShape, updateShape, deleteShape, findDependentArrows,
    updateBlockNarration, regenerateNarration,
    flushAllPendingRegenerations, waitForAllNarrationSettled, getSlidesWithNarrationError,
    ensureNarrationGenerated, generateAllNarrationUpfront, generateAllDiagramsUpfront,
    lockEditing, unlockEditing, isLocked,
  };
}
