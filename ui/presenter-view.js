// Thin popup UI for the PRESENTER_CHANNEL protocol defined in
// orchestration/presentation-engine.js: receives 'slideChanged'/'progress'
// broadcasts and sends back 'control' actions (play/pause/next/prev). Never
// touches the Seminar JSON directly.
import { parseCues } from '../lib/cue-parser.js';

const PRESENTER_CHANNEL = 'seminar-presenter';

const els = {
  title: document.getElementById('pvTitle'),
  counter: document.getElementById('pvCounter'),
  notes: document.getElementById('pvNotes'),
  time: document.getElementById('pvTime'),
  prev: document.getElementById('pvPrev'),
  play: document.getElementById('pvPlay'),
  pause: document.getElementById('pvPause'),
  next: document.getElementById('pvNext'),
};

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.channel !== PRESENTER_CHANNEL) return;
  if (msg.type === 'slideChanged') {
    els.title.textContent = msg.slide.title;
    els.counter.textContent = `${msg.idx + 1} / ${msg.total}`;
    els.notes.textContent = parseCues(msg.slide.presentationNotes || '').plainText;
  } else if (msg.type === 'progress') {
    els.time.textContent = `${formatTime(msg.cur)} / ${formatTime(msg.total)}`;
  }
});

function sendControl(action) {
  chrome.runtime.sendMessage({ channel: PRESENTER_CHANNEL, type: 'control', action }).catch(() => {});
}

els.prev.addEventListener('click', () => sendControl('prev'));
els.play.addEventListener('click', () => sendControl('play'));
els.pause.addEventListener('click', () => sendControl('pause'));
els.next.addEventListener('click', () => sendControl('next'));
