// Port of the OCR fetch body from handleNewSelection (old sidepanel.js:1701-1737).
// Reconstructs accurate LaTeX from a full-tab screenshot + the mangled
// copy-pasted selection text, since PDF text selection often loses math notation.
import { generateText } from '../lib/llm-client.js';

/**
 * @param {{ text: string, screenshotDataUrl?: string }} selection
 * @returns {Promise<string>} restoredText
 */
export async function restoreLatexFromSelection({ text, screenshotDataUrl }, apiKey) {
  if (!screenshotDataUrl || !apiKey) return text;

  try {
    const base64Data = screenshotDataUrl.split(',')[1];
    const generatedText = await generateText(apiKey, {
      userContent: `The user copied this mangled text: "${text}". Please look at the image, find this exact section, and transcribe it perfectly back into text, converting all mathematical formulas into LaTeX enclosed in $. Return ONLY the transcribed text.`,
      imageBase64: base64Data,
      imageMimeType: 'image/jpeg',
    });
    return generatedText.trim();
  } catch (e) {
    console.error('Math OCR failed, falling back to raw selection text', e);
    return text;
  }
}
