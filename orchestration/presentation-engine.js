// Thin glue around slide-deck-controller.js: owns only the Present-button
// transition (flush pending narration regens, wait bounded by a timeout,
// snapshot the Seminar JSON) and Presenter View sync via chrome.runtime
// messaging. Strictly read-only over the Seminar JSON — never calls
// lib/seminar-mutations.js.
import { createSlideDeckController } from './slide-deck-controller.js';

const PRESENTER_CHANNEL = 'seminar-presenter';

/**
 * @param {{ boardEl, diagramSvgEl, getSettings, editorController, confirmFn?: (msg:string)=>Promise<boolean> }} deps
 */
export function createPresentationEngine({ boardEl, diagramSvgEl, getSettings, editorController, confirmFn }) {
  const confirm = confirmFn || ((msg) => Promise.resolve(window.confirm(msg)));

  const deck = createSlideDeckController({
    boardEl,
    diagramSvgEl,
    getSettings,
    ensureNarrationGenerated: (slide) => editorController.ensureNarrationGenerated(slide.slideId),
  });

  deck.on('slideChanged', (slide, idx) => broadcastToPresenter({ type: 'slideChanged', slide, idx, total: deck.slideCount }));
  deck.on('progress', (cur, total) => broadcastToPresenter({ type: 'progress', cur, total }));

  function broadcastToPresenter(payload) {
    chrome.runtime?.sendMessage({ channel: PRESENTER_CHANNEL, ...payload }).catch(() => {});
  }

  chrome.runtime?.onMessage.addListener((msg) => {
    if (msg?.channel !== PRESENTER_CHANNEL || msg.type !== 'control') return;
    if (msg.action === 'play') deck.play();
    else if (msg.action === 'pause') deck.pause();
    else if (msg.action === 'next') deck.next();
    else if (msg.action === 'prev') deck.prev();
  });

  let presenterWindowId = null;

  async function openPresenterView() {
    const win = await chrome.windows.create({ url: chrome.runtime.getURL('presenter-view.html'), type: 'popup', width: 480, height: 360 });
    presenterWindowId = win.id;
  }

  function closePresenterView() {
    if (presenterWindowId != null) {
      chrome.windows.remove(presenterWindowId).catch(() => {});
      presenterWindowId = null;
    }
  }

  /** @returns {Promise<boolean>} whether presentation actually started */
  async function enterPresentationMode({ timeoutMs = 15000, withPresenterView = true } = {}) {
    editorController.lockEditing();
    editorController.flushAllPendingRegenerations();
    const settled = await editorController.waitForAllNarrationSettled({ timeoutMs });
    const erroredSlides = editorController.getSlidesWithNarrationError();

    if (!settled) {
      const proceed = await confirm('Some slides are still updating narration. Present anyway with their last-known narration?');
      if (!proceed) { editorController.unlockEditing(); return false; }
    } else if (erroredSlides.length > 0) {
      const proceed = await confirm(`${erroredSlides.length} slide(s) failed to update narration and will be silent. Present anyway?`);
      if (!proceed) { editorController.unlockEditing(); return false; }
    }

    const snapshot = structuredClone(editorController.getSeminarJson());
    if (withPresenterView) await openPresenterView();
    await deck.start(snapshot);
    return true;
  }

  function exitPresentationMode() {
    deck.stop();
    editorController.unlockEditing();
    closePresenterView();
  }

  return { deck, enterPresentationMode, exitPresentationMode };
}

export { PRESENTER_CHANNEL };
