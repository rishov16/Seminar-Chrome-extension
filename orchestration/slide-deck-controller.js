// Per-slide playback state machine. Replaces the glue logic that used to live
// inline in the old playChalkboardDemo (sidepanel.js:708-1690) — board
// construction moved to renderers/chalkboard/chalkboard-renderer.js (later
// renderers/agent-chalkboard/), narration+sync moved to
// orchestration/live-narration-controller.js; this module wires them
// together per-slide and drives auto-advance.
// agent-chalkboard (HandwritingAgent transcript-bank ink for prose AND math)
// replaced renderers/chalkboard/chalkboard-renderer.js here — same
// renderer-interface.js contract, so this import line is the entire
// cutover, and reverting it restores the old renderer wholesale.
//
// Narration+playback used to be lib/sync-engine.js's character-weight
// reveal heuristic driving Web Speech/Sarvam TTS — both replaced entirely
// by Gemini Live narration (orchestration/live-narration-controller.js,
// which reveals board content by matching its own streamed audio
// transcript against the narration, not a tool call), which reads
// narrationText directly off the slide's boardContent/bullet items rather
// than needing a separately-fetched narration blob, so this module no
// longer needs a getNarrationForSlide dependency at all.
import { renderSlide, clearSlide } from '../renderers/agent-chalkboard/agent-chalkboard-renderer.js';
import { renderDiagram, clearDiagram } from '../renderers/chalkboard/diagram-renderer.js';
import { createLiveNarrationController } from './live-narration-controller.js';
import { getNarrationUnits } from '../agents/narrator-agent.js';
import { RENDER_MODES } from '../renderers/renderer-interface.js';

/**
 * @param {{ boardEl: HTMLElement, diagramSvgEl: SVGSVGElement, getSettings: () => Promise<object>,
 *           ensureNarrationGenerated: (slide) => Promise<void> }} deps
 */
export function createSlideDeckController({ boardEl, diagramSvgEl, getSettings, ensureNarrationGenerated }) {
  let seminar = null;
  let slideIndex = 0;
  let rendererHandle = null;
  let diagramHandle = null;
  let liveController = null;
  // play() awaits ensureNarrationGenerated/getSettings/connectLiveSession
  // before liveController is actually assigned — a real window (WebSocket
  // handshake, not instant) during which the synchronous `if (liveController)`
  // guard alone lets a second concurrent play() call sail straight through
  // and open a SECOND Live session narrating the same slide (reported live:
  // every line spoken twice, and the board garbled — two independent
  // controllers both calling setTokenDrawn on the same renderer handle).
  // This flag closes that window: set synchronously before the first await,
  // checked before anything else.
  let startingPlayback = false;
  let autoAdvanceEnabled = true;
  const listeners = { slideChanged: [], ended: [], progress: [], stepChanged: [] };

  function on(event, cb) { listeners[event]?.push(cb); return () => { listeners[event] = listeners[event].filter((f) => f !== cb); }; }
  function emit(event, ...args) { listeners[event]?.forEach((cb) => cb(...args)); }

  function currentSlide() { return seminar?.slides[slideIndex] || null; }

  function teardownPlayback() {
    liveController?.stop();
    liveController = null;
    startingPlayback = false;
  }

  async function loadSlide(index, { autoplay = false } = {}) {
    teardownPlayback();
    slideIndex = Math.max(0, Math.min(index, seminar.slides.length - 1));
    const slide = currentSlide();
    const { handwritingSpeed } = await getSettings();
    rendererHandle = renderSlide(boardEl, slide, { mode: RENDER_MODES.ANIMATED, speed: handwritingSpeed });
    await rendererHandle.ready;
    diagramHandle = slide.diagramSpec
      ? renderDiagram(diagramSvgEl, slide.diagramSpec, { mode: RENDER_MODES.ANIMATED, boardContainerEl: boardEl })
      : (diagramSvgEl && clearDiagram(diagramSvgEl), null);
    emit('slideChanged', slide, slideIndex);
    if (autoplay) await play();
  }

  async function play() {
    const slide = currentSlide();
    if (!slide) return;
    if (liveController) { liveController.play(); return; }
    if (startingPlayback) return; // a session is already being connected for this slide — see note above
    startingPlayback = true;

    try {
      await ensureNarrationGenerated(slide); // e.g. a slide inserted after the initial upfront batch
      const hasAnyNarration = getNarrationUnits(slide).some((unit) => {
        const block = slide.boardContent.find((b) => b.id === unit.blockId);
        const target = unit.itemId ? block.items.find((it) => it.id === unit.itemId) : block;
        return target.narrationText?.trim();
      });

      const handleAtStart = rendererHandle;
      const onEnded = async () => {
        liveController = null;
        if (rendererHandle !== handleAtStart) return; // user navigated away while this session was finishing up
        emit('ended', slide, slideIndex);
        if (autoAdvanceEnabled && slide.animationMetadata?.autoAdvance && slideIndex < seminar.slides.length - 1) {
          loadSlide(slideIndex + 1, { autoplay: true });
        }
      };

      if (!hasAnyNarration) { await onEnded(); return; }

      const settings = await getSettings();
      // Re-check after these awaits: teardownPlayback() (a slide change, or
      // stop()) may have run while we were connecting, in which case this
      // now-stale connection attempt must not install itself as the live
      // controller for whatever slide is current now.
      if (currentSlide() !== slide) return;
      liveController = await createLiveNarrationController({
        rendererHandle,
        slide,
        apiKey: settings.geminiApiKey,
        onStepChange: (step) => { diagramHandle?.revealUpTo(step); emit('stepChanged', step); },
        onTimeUpdate: (cur, total) => emit('progress', cur, total),
        onEnded,
      });
      if (currentSlide() !== slide) { liveController.stop(); liveController = null; }
    } finally {
      startingPlayback = false;
    }
  }

  function pause() { liveController?.pause(); }

  // Push-to-talk forwards — see live-narration-controller.js's
  // startQuestion/stopQuestion for the actual pause/Q&A-session/resume
  // design. No-op if narration isn't currently playing (no liveController).
  function startQuestion() { return liveController?.startQuestion(); }
  function stopQuestion() { return liveController?.stopQuestion(); }

  async function next() { if (seminar && slideIndex < seminar.slides.length - 1) await loadSlide(slideIndex + 1); }
  async function prev() { if (slideIndex > 0) await loadSlide(slideIndex - 1); }

  async function start(seminarJson, { autoAdvance = true, startIndex = 0, autoplay = true } = {}) {
    seminar = seminarJson;
    autoAdvanceEnabled = autoAdvance;
    await loadSlide(startIndex, { autoplay });
  }

  function stop() {
    teardownPlayback();
    clearSlide(boardEl);
    if (diagramSvgEl) clearDiagram(diagramSvgEl);
    seminar = null;
  }

  return {
    start, stop, play, pause, next, prev, loadSlide, on, startQuestion, stopQuestion,
    get currentIndex() { return slideIndex; },
    get slideCount() { return seminar?.slides.length || 0; },
    get isPlaying() { return !!liveController && !liveController.paused; },
  };
}
