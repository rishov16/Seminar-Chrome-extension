// capture -> vision-ocr -> head-agent -> diagram-tikz-generation (all
// diagram blocks, in parallel) -> narrator-agent (all slides, in parallel)
// -> returns an editor controller ready to hand to the 3-panel editor UI.
// Both diagrams and narration are generated upfront (not lazily per-slide)
// so a single slide's failure doesn't strand a mid-presentation dead-end,
// and so the revealSequence-alignment check runs before the learner ever
// sees slide 1. The same screenshot (captured once at selection time,
// background.js) is threaded through selectionPayload and reused THREE
// times, never recaptured: vision-ocr.js for text OCR, head-agent.js so
// the Head Agent can actually see a figure to decide it belongs in the
// plan (restoredText alone is a text transcription with no trace of
// diagrams — vision-ocr.js's own prompt only asks it to transcribe text),
// and the diagram-generation pass below for the actual TikZ sketch.
import { restoreLatexFromSelection } from '../agents/vision-ocr.js';
import { planSeminar } from '../agents/head-agent.js';
import { createSeminarEditorController } from '../editor/seminar-editor-controller.js';
import { getSettings } from '../lib/storage.js';

/**
 * @param {{ text: string, screenshotDataUrl?: string }} selectionPayload
 * @param {{ onStatus?: (phase: string, detail?: object) => void }} opts
 * @returns {Promise<ReturnType<typeof createSeminarEditorController>>}
 */
export async function runPipeline(selectionPayload, { onStatus } = {}) {
  const settings = await getSettings();
  if (!settings.geminiApiKey) {
    throw new Error('Set your Gemini API key in Settings before building a seminar.');
  }

  onStatus?.('reading-selection');
  const restoredText = await restoreLatexFromSelection(selectionPayload, settings.geminiApiKey);

  onStatus?.('planning-seminar');
  const seminarJson = await planSeminar(restoredText, settings.geminiApiKey, {
    screenshotDataUrl: selectionPayload.screenshotDataUrl,
  });

  const editorController = createSeminarEditorController(seminarJson);

  onStatus?.('generating-diagrams', { done: 0, total: 0 });
  await editorController.generateAllDiagramsUpfront(
    selectionPayload.screenshotDataUrl,
    settings.geminiApiKey,
    (done, total) => onStatus?.('generating-diagrams', { done, total }),
  );

  onStatus?.('preparing-narration', { done: 0, total: seminarJson.slides.length });
  await editorController.generateAllNarrationUpfront((done, total) => onStatus?.('preparing-narration', { done, total }));

  onStatus?.('ready');
  return editorController;
}
