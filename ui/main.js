// Sidepanel app shell. Single persistent chalkboard + player bar (matching
// the original SEMINAR extension's experience — no separate editor/present
// screens). Slide navigation and narrator-notes editing live in a tabbed
// bento side panel toggled by a player-bar pill, positioned exactly like
// SEMINAR_Webapp's Chapters/Transcript panel — "Slides" replaces "Chapters",
// "Narrator Notes" replaces "Transcript".
//
// Every Slides-tab card always renders the slide's *actual* board content
// — not a placeholder — via renderers/clean-preview/slide-thumbnail-renderer.js,
// a deliberately separate, light/structured renderer from the chalkboard one
// that still drives the actual presentation (renderers/chalkboard/). The
// sidebar preview's reveal state (which blocks are dimmed vs. shown) tracks
// the deck's live 'stepChanged' event for whichever slide is currently
// playing, mirroring the main board without duplicating its animation. The
// deep editor (editor/slide-content-editor.js) and the Narrator Notes
// accordion (editor/notes-editor.js) are lazily mounted per slide, pinned
// once via setActiveSlide() and never re-targeted; every mounted instance
// keeps itself in sync via its own 'seminarChanged' subscription, so this
// module only needs to patch card *header*/preview chrome on non-structural
// edits and do a full rebuild on structural ones (slide inserted/deleted/reordered).
import { runPipeline } from '../orchestration/pipeline-controller.js';
import { createSlideDeckController } from '../orchestration/slide-deck-controller.js';
import { mountSlideContentEditor } from '../editor/slide-content-editor.js';
import { mountNotesEditor } from '../editor/notes-editor.js';
import { renderSlideThumbnail } from '../renderers/clean-preview/slide-thumbnail-renderer.js';
import { loadKalamFont } from '../renderers/chalkboard/handwriting.js';
import { ensureGlyphsGenerated, collectProseChars } from '../renderers/experimental-handwriting-agent/handwriting-agent-generator.js?v=4';
import { getSettings, setSettings, getSession, removeSession } from '../lib/storage.js';

loadKalamFont(chrome.runtime.getURL('vendor/Kalam-Regular.ttf'));

// background.js opens this panel per-tab via sidePanel.setOptions({tabId,
// path: `sidepanel.html?tabId=${tabId}`}) so each tab gets its own isolated
// panel instead of sharing one across the whole window. The tab id travels
// via the query string (not chrome.tabs.getCurrent(), which isn't reliable
// from a side panel's own script context) so the pending-selection handoff
// below can be scoped to this tab and ignore messages meant for others.
const CURRENT_TAB_ID = new URLSearchParams(location.search).get('tabId');

const STATUS_COLOR = { fresh: '#4ade80', stale: '#f5cf65', regenerating: '#60a5fa', error: '#f87171' };
const STATUS_LABEL_SHORT = { fresh: '✓ Ready', stale: '○ No script', regenerating: '⟳ Writing', error: '⚠ Error' };

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- toast ----

const toastEl = document.getElementById('toast');
let toastTimer = null;
function showError(message) {
  toastEl.textContent = message;
  toastEl.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('active'), 6000);
}

// ---- status overlay ----

const statusOverlay = document.getElementById('statusOverlay');
const statusPhaseEl = document.getElementById('statusPhase');
const statusDetailEl = document.getElementById('statusDetail');
const STATUS_LABELS = {
  'reading-selection': 'Reading selection (math OCR)…',
  'planning-seminar': 'Head Agent is planning your seminar…',
  'generating-diagrams': 'Sketching diagrams…',
  'preparing-narration': 'Narrator Agent is preparing narration…',
  ready: 'Ready!',
};
function onStatus(phase, detail) {
  statusPhaseEl.textContent = STATUS_LABELS[phase] || phase;
  statusDetailEl.textContent = (phase === 'preparing-narration' || phase === 'generating-diagrams') && detail
    ? `${detail.done} / ${detail.total}`
    : '';
}

async function waitForMathJax(timeoutMs = 4000) {
  const startupPromise = window.MathJax?.startup?.promise;
  if (!startupPromise) return;
  await Promise.race([startupPromise, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

// ---- state ----

let editorController = null;
let deck = null;
const expandedSlideCards = new Set();
const expandedNotesCards = new Set();
const contentEditorHandles = new Map();
const notesEditorHandles = new Map();
const slidePreviewHandles = new Map(); // slideId -> { ready, revealUpTo } from renderSlideThumbnail
let notesCardsInitialized = false;
let activeRevealStep = 0; // reveal progress for whichever slide is currently playing

// ---- pipeline ----

async function startPipeline(selectionPayload) {
  statusOverlay.classList.remove('hidden');
  onStatus('reading-selection');
  try {
    await waitForMathJax();
    editorController = await runPipeline(selectionPayload, { onStatus });
    await mountSeminar(editorController);
    closeEditModal();
  } catch (e) {
    console.error('[seminar] pipeline failed', e);
    showError(e.message || 'Failed to build seminar.');
  } finally {
    statusOverlay.classList.add('hidden');
  }
}

chrome.runtime.onMessage.addListener((message) => {
  // targetTabId filters out selections meant for a different tab's panel —
  // with per-tab panels, more than one tab's instance of this script can be
  // alive at once, and runtime.sendMessage is a broadcast to all of them.
  if (message?.action === 'playMath' && String(message.targetTabId) === String(CURRENT_TAB_ID)) {
    startPipeline({ text: message.text, screenshotDataUrl: message.screenshotDataUrl });
  }
});

(async function consumePendingSelection() {
  if (!CURRENT_TAB_ID) return;
  const key = `pendingMathSelection_${CURRENT_TAB_ID}`;
  const pending = await getSession(key);
  if (!pending) return;
  await removeSession(key);
  startPipeline({ text: pending.text, screenshotDataUrl: pending.screenshotDataUrl });
})();

// ---- mounting a freshly generated (or regenerated) seminar ----

async function mountSeminar(controller) {
  deck?.stop();
  expandedSlideCards.clear();
  expandedNotesCards.clear();
  notesCardsInitialized = false;
  contentEditorHandles.clear();
  notesEditorHandles.clear();
  slidePreviewHandles.clear();
  activeRevealStep = 0;

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('seminarTitle').textContent = controller.getSeminarJson().meta?.title || 'Untitled Seminar';

  deck = createSlideDeckController({
    boardEl: document.getElementById('board'),
    diagramSvgEl: document.getElementById('diagramSvg'),
    getSettings,
    ensureNarrationGenerated: (slide) => controller.ensureNarrationGenerated(slide.slideId),
  });
  wireDeck(deck);

  controller.on('seminarChanged', ({ slideId }) => {
    if (slideId === null) { renderSlidesTab(); renderNotesTab(); return; }
    patchCardHeaders(slideId);
  });

  renderSlidesTab();
  renderNotesTab();

  // Best-effort background prewarm for the handwriting-agent transcript
  // bank (renderers/experimental-handwriting-agent/) — not awaited, and
  // never blocks playback: a character not yet generated by the time its
  // slide is reached just uses the existing plain-text fallback, exactly
  // as it did before this existed.
  getSettings().then(({ geminiApiKey }) => {
    if (!geminiApiKey) return;
    const chars = new Set();
    controller.getSeminarJson().slides.forEach((slide) => collectProseChars(slide).forEach((c) => chars.add(c)));
    ensureGlyphsGenerated(chars, geminiApiKey).catch((e) => console.error('[handwriting-agent-generator]', e));
  });

  // start() is the only place slide-deck-controller.js's internal `seminar`
  // reference gets assigned — loadSlide() alone leaves it null and every
  // subsequent play()/prev()/next() silently no-ops against a null deck.
  await deck.start(controller.getSeminarJson(), { startIndex: 0, autoplay: false });
}

// ---- player bar / deck wiring ----

function updatePlayIcon() {
  const playing = !!deck?.isPlaying;
  document.getElementById('playIcon').style.display = playing ? 'none' : 'inline';
  document.getElementById('pauseIcon').style.display = playing ? 'inline' : 'none';
}

// The newly-active slide's preview resets to "nothing revealed yet" (step 0,
// mirroring how the main board starts each slide blank and reveals as
// narration proceeds); every other slide's preview shows fully revealed —
// matching the old always-STATIC behavior for slides that aren't playing.
function highlightActiveSlideCard(slideId) {
  document.querySelectorAll('#slidesTabContent .slide-card').forEach((card) => {
    const isActive = card.dataset.slideId === slideId;
    card.classList.toggle('active', isActive);
    slidePreviewHandles.get(card.dataset.slideId)?.revealUpTo(isActive ? 0 : Infinity);
  });
}

function wireDeck(deckInstance) {
  deckInstance.on('slideChanged', (slide, idx) => {
    document.getElementById('currentSlideBtnText').textContent = `Slide ${idx + 1}/${deckInstance.slideCount}`;
    document.getElementById('progressBar').value = 0;
    activeRevealStep = 0;
    highlightActiveSlideCard(slide.slideId);
    updatePlayIcon();
  });
  deckInstance.on('progress', (cur, total) => {
    const bar = document.getElementById('progressBar');
    bar.max = total || 0;
    bar.value = cur || 0;
    document.getElementById('timeDisplay').textContent = `${formatTime(cur)} / ${formatTime(total)}`;
  });
  // Cheap, synchronous — no re-typesetting, just an opacity toggle — so this
  // is safe to call on every reveal step during playback.
  deckInstance.on('stepChanged', (step) => {
    activeRevealStep = step;
    const activeSlide = editorController?.getSeminarJson().slides[deckInstance.currentIndex];
    if (activeSlide) slidePreviewHandles.get(activeSlide.slideId)?.revealUpTo(step);
  });
  deckInstance.on('ended', updatePlayIcon);
  updatePlayIcon();
}

document.getElementById('playBtn').addEventListener('click', () => {
  if (!deck) { openEditModal(); return; }
  if (deck.isPlaying) deck.pause(); else deck.play();
  setTimeout(updatePlayIcon, 30);
});
document.getElementById('prevBtn').addEventListener('click', () => deck?.prev());
document.getElementById('nextBtn').addEventListener('click', () => deck?.next());

// Floating ask-a-question orb: click to start listening, click again to end
// your question and hear the answer. Mirrors orchestration/slide-deck-
// controller.js's startQuestion/stopQuestion, which no-op safely if
// narration hasn't been started for this slide yet (no liveController) —
// nothing else here needs to guard for that case.
const askOrbWrap = document.getElementById('askOrbWrap');
const askOrbBtn = document.getElementById('askOrbBtn');
const askOrbCaption = document.getElementById('askOrbCaption');
let questionState = 'idle'; // 'idle' | 'listening' | 'answering' — drives the orb's CSS via a class on askOrbWrap

function setQuestionState(state, caption = '') {
  questionState = state;
  askOrbWrap.classList.remove('listening', 'answering');
  if (state !== 'idle') askOrbWrap.classList.add(state);
  askOrbCaption.textContent = caption;
}

// A Chrome side panel cannot display the getUserMedia permission prompt — it's
// auto-dismissed ("Permission dismissed"), so the mic never gets granted from
// here. Microphone permission is per-origin, though, and every extension page
// shares the chrome-extension://<id> origin, so granting it once from a normal
// browser tab (where the prompt works) persists to the side panel too. When
// permission isn't already granted, open that grant page instead of trying to
// capture from the panel and silently failing.
async function micPermissionGranted() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state === 'granted';
  } catch {
    return false; // permissions API unavailable — route through the grant page to be safe
  }
}

async function toggleQuestion() {
  if (!deck || questionState === 'answering') return; // busy — v1 is a single exchange, ignore clicks mid-answer

  if (questionState === 'idle') {
    if (!(await micPermissionGranted())) {
      chrome.tabs.create({ url: chrome.runtime.getURL('permissions/request-microphone.html') });
      showError('Microphone access is needed to ask a question. Grant it in the tab that just opened, then click the orb again.');
      return;
    }
    setQuestionState('listening', 'Listening… click to finish');
    try {
      await deck.startQuestion();
    } catch (err) {
      console.error('[ui/main] failed to start question', err.message);
      setQuestionState('idle');
    }
    return;
  }

  // questionState === 'listening' — this click ends the question.
  setQuestionState('answering', 'Answering…');
  try {
    await deck.stopQuestion();
  } catch (err) {
    console.error('[ui/main] failed to get answer', err.message);
  } finally {
    setQuestionState('idle');
  }
}
askOrbBtn.addEventListener('click', toggleQuestion);

// ---- Slides / Narrator Notes side panel toggle + tabs ----

const stage = document.getElementById('stage');
const slidesSidePanel = document.getElementById('slidesSidePanel');
const toggleSlidesBtn = document.getElementById('toggleSlidesBtn');

function setPanelOpen(open) {
  slidesSidePanel.classList.toggle('open', open);
  stage.classList.toggle('sidepanel-open', open);
  toggleSlidesBtn.classList.toggle('active', open);
}
toggleSlidesBtn.addEventListener('click', () => setPanelOpen(!slidesSidePanel.classList.contains('open')));
document.getElementById('closeSlidesPanelBtn').addEventListener('click', () => setPanelOpen(false));

const slidesTabBtn = document.getElementById('slidesTabBtn');
const notesTabBtn = document.getElementById('notesTabBtn');
const slidesTabContent = document.getElementById('slidesTabContent');
const notesTabContent = document.getElementById('notesTabContent');

slidesTabBtn.addEventListener('click', () => {
  slidesTabBtn.classList.add('active');
  notesTabBtn.classList.remove('active');
  slidesTabContent.style.display = 'flex';
  notesTabContent.style.display = 'none';
});
notesTabBtn.addEventListener('click', () => {
  notesTabBtn.classList.add('active');
  slidesTabBtn.classList.remove('active');
  notesTabContent.style.display = 'flex';
  slidesTabContent.style.display = 'none';
  // Tray textareas mounted while this panel was display:none measured
  // scrollHeight as 0 (collapsed height) — re-measure now that it's visible.
  notesEditorHandles.forEach((handle) => handle.refresh());
});

// ---- Slides tab: one card per slide, chapter-card styled ----

function renderSlidesTab() {
  const prevScrollTop = slidesTabContent.scrollTop;
  contentEditorHandles.clear();
  slidePreviewHandles.clear();
  slidesTabContent.innerHTML = '';
  if (!editorController) {
    slidesTabContent.innerHTML = '<div class="sidepanel-empty-hint">No seminar loaded yet.</div>';
    return;
  }
  const seminar = editorController.getSeminarJson();
  seminar.slides.forEach((slide, idx) => {
    const isActive = !!deck && deck.currentIndex === idx;
    const isExpanded = expandedSlideCards.has(slide.slideId);

    const card = document.createElement('div');
    card.className = `slide-card${isActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}`;
    card.dataset.slideId = slide.slideId;

    const header = document.createElement('div');
    header.className = 'slide-card-header';

    const info = document.createElement('div');
    info.className = 'slide-card-info';
    const title = document.createElement('div');
    title.className = 'slide-card-title';
    title.textContent = slide.title;
    const badgeRow = document.createElement('div');
    badgeRow.className = 'slide-card-badge-row';
    const order = document.createElement('span');
    order.className = 'slide-card-order';
    order.textContent = `Slide ${slide.order}`;
    const dot = document.createElement('span');
    dot.className = 'slide-card-status-dot';
    dot.style.background = STATUS_COLOR[slide.narrationStatus] || STATUS_COLOR.stale;
    dot.title = `Narration: ${slide.narrationStatus}`;
    badgeRow.append(order, dot);
    info.append(title, badgeRow);

    const actions = document.createElement('div');
    actions.className = 'slide-card-actions';
    actions.append(
      mkSlideActionBtn('▶', 'Jump to this slide & play', (e) => { e.stopPropagation(); deck?.loadSlide(idx, { autoplay: true }); }),
      mkSlideActionBtn('+', 'Insert slide after', (e) => {
        e.stopPropagation();
        const s = editorController.insertSlide({ afterSlideId: slide.slideId });
        expandedSlideCards.add(s.slideId);
      }),
      mkSlideActionBtn('✕', 'Delete slide', (e) => {
        e.stopPropagation();
        if (seminar.slides.length <= 1) return;
        if (confirm(`Delete slide "${slide.title}"?`)) editorController.deleteSlide(slide.slideId);
      }),
    );

    const chevron = document.createElement('span');
    chevron.className = 'slide-card-chevron';
    chevron.title = 'Edit this slide\'s board content';
    chevron.textContent = '▼';

    header.append(info, actions, chevron);

    // Always-visible, actual board content — not a placeholder — rendered
    // clean/light (renderers/clean-preview/), not as a mini chalkboard.
    const preview = document.createElement('div');
    preview.className = 'slide-card-preview';
    try {
      const handle = renderSlideThumbnail(preview, slide, { revealStep: isActive ? activeRevealStep : Infinity });
      slidePreviewHandles.set(slide.slideId, handle);
    } catch (e) { /* ignore mid-edit render races */ }

    const body = document.createElement('div');
    body.className = 'slide-card-body';

    header.addEventListener('click', () => {
      const nowExpanded = card.classList.toggle('expanded');
      if (nowExpanded) { expandedSlideCards.add(slide.slideId); ensureContentEditorMounted(slide.slideId, body); }
      else expandedSlideCards.delete(slide.slideId);
    });

    if (isExpanded) ensureContentEditorMounted(slide.slideId, body);

    card.append(header, preview, body);
    slidesTabContent.appendChild(card);
  });
  slidesTabContent.scrollTop = prevScrollTop;
}

function mkSlideActionBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'slide-card-btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function ensureContentEditorMounted(slideId, bodyEl) {
  if (contentEditorHandles.has(slideId)) return;
  const handle = mountSlideContentEditor(bodyEl, editorController);
  handle.setActiveSlide(slideId);
  contentEditorHandles.set(slideId, handle);
}

// ---- Narrator Notes tab: one accordion card per slide, act-edit-card styled ----

function renderNotesTab() {
  const prevScrollTop = notesTabContent.scrollTop;
  notesEditorHandles.clear();
  notesTabContent.innerHTML = '';
  if (!editorController) {
    notesTabContent.innerHTML = '<div class="sidepanel-empty-hint">No seminar loaded yet.</div>';
    return;
  }
  const seminar = editorController.getSeminarJson();
  seminar.slides.forEach((slide) => {
    if (!notesCardsInitialized) expandedNotesCards.add(slide.slideId); // default: all expanded on first load
    const isExpanded = expandedNotesCards.has(slide.slideId);

    const card = document.createElement('div');
    card.className = `notes-card${isExpanded ? ' expanded' : ''}`;
    card.dataset.slideId = slide.slideId;

    const header = document.createElement('div');
    header.className = 'notes-card-header';
    header.innerHTML = `
      <div class="notes-card-header-left"><span class="notes-card-title"></span></div>
      <div class="notes-card-header-right">
        <span class="notes-card-status status-${slide.narrationStatus}"></span>
        <span class="notes-card-chevron">▼</span>
      </div>
    `;
    header.querySelector('.notes-card-title').textContent = slide.title;
    header.querySelector('.notes-card-status').textContent = STATUS_LABEL_SHORT[slide.narrationStatus] || slide.narrationStatus;

    const body = document.createElement('div');
    body.className = 'notes-card-body';

    header.addEventListener('click', () => {
      const nowExpanded = card.classList.toggle('expanded');
      if (nowExpanded) { expandedNotesCards.add(slide.slideId); ensureNotesEditorMounted(slide.slideId, body); }
      else expandedNotesCards.delete(slide.slideId);
    });

    card.append(header, body);
    notesTabContent.appendChild(card);

    // Mounted only after the card is attached to the live document — the tray's
    // textarea auto-grow (editor/notes-editor.js's autoGrowTextarea) reads
    // scrollHeight, which is always 0 on a detached node, so measuring it here
    // before append silently collapsed every textarea to ~0px height.
    if (isExpanded) ensureNotesEditorMounted(slide.slideId, body);
  });
  notesCardsInitialized = true;
  notesTabContent.scrollTop = prevScrollTop;
}

function ensureNotesEditorMounted(slideId, bodyEl) {
  if (notesEditorHandles.has(slideId)) return;
  const handle = mountNotesEditor(bodyEl, editorController);
  handle.setActiveSlide(slideId);
  notesEditorHandles.set(slideId, handle);
}

// ---- lightweight header patch for non-structural per-slide edits (title
// rename, narration status change) — avoids tearing down mounted editors ----

function patchCardHeaders(slideId) {
  const slide = editorController.getSlide(slideId);
  if (!slide) return;

  const slideCard = slidesTabContent.querySelector(`.slide-card[data-slide-id="${slideId}"]`);
  if (slideCard) {
    const titleEl = slideCard.querySelector('.slide-card-title');
    if (titleEl) titleEl.textContent = slide.title;
    const orderEl = slideCard.querySelector('.slide-card-order');
    if (orderEl) orderEl.textContent = `Slide ${slide.order}`;
    const dotEl = slideCard.querySelector('.slide-card-status-dot');
    if (dotEl) { dotEl.style.background = STATUS_COLOR[slide.narrationStatus] || STATUS_COLOR.stale; dotEl.title = `Narration: ${slide.narrationStatus}`; }
    const previewEl = slideCard.querySelector('.slide-card-preview');
    if (previewEl) {
      try {
        const isActive = slideCard.classList.contains('active');
        const handle = renderSlideThumbnail(previewEl, slide, { revealStep: isActive ? activeRevealStep : Infinity });
        slidePreviewHandles.set(slideId, handle);
      } catch (e) { /* ignore mid-edit render races */ }
    }
  }

  const notesCard = notesTabContent.querySelector(`.notes-card[data-slide-id="${slideId}"]`);
  if (notesCard) {
    const titleEl = notesCard.querySelector('.notes-card-title');
    if (titleEl) titleEl.textContent = slide.title;
    const statusEl = notesCard.querySelector('.notes-card-status');
    if (statusEl) { statusEl.textContent = STATUS_LABEL_SHORT[slide.narrationStatus] || slide.narrationStatus; statusEl.className = `notes-card-status status-${slide.narrationStatus}`; }
  }
}

// ---- edit / generate modal ----

const editModal = document.getElementById('editModal');
function openEditModal() { editModal.classList.add('active'); }
function closeEditModal() { editModal.classList.remove('active'); }

document.getElementById('editSeminarBtn').addEventListener('click', openEditModal);
document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
document.getElementById('cancelEditModalBtn').addEventListener('click', closeEditModal);
document.getElementById('pasteGenerateBtn').addEventListener('click', () => {
  const text = document.getElementById('pasteInput').value.trim();
  if (!text) { showError('Paste some text first.'); return; }
  startPipeline({ text });
});

// ---- settings modal ----

const settingsModal = document.getElementById('settingsModal');
const settingsFields = {
  geminiApiKey: document.getElementById('geminiApiKeyInput'),
  includeFillers: document.getElementById('includeFillersInput'),
  handwritingSpeed: document.getElementById('handwritingSpeedInput'),
};

async function openSettings() {
  const settings = await getSettings();
  settingsFields.geminiApiKey.value = settings.geminiApiKey;
  settingsFields.includeFillers.checked = settings.includeFillers;
  settingsFields.handwritingSpeed.value = String(settings.handwritingSpeed);
  settingsModal.classList.add('active');
}
function closeSettings() { settingsModal.classList.remove('active'); }

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  await setSettings({
    geminiApiKey: settingsFields.geminiApiKey.value.trim(),
    includeFillers: settingsFields.includeFillers.checked,
    handwritingSpeed: Number(settingsFields.handwritingSpeed.value),
  });
  closeSettings();
});

// First-run nudge: pop Settings open automatically if no Gemini key is set yet.
getSettings().then((s) => { if (!s.geminiApiKey) openSettings(); });
