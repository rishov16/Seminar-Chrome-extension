// Transcribes synthesized audio back to text for WER scoring, reusing
// lib/llm-client.js's generateText — its imageBase64/imageMimeType params
// just become a generic inlineData part regardless of media type, so no new
// production code is needed for audio input.
import { generateText } from '../../lib/llm-client.js';

// "Do not convert spoken math into symbols" was added after a real failure
// found during development: on equation-heavy audio, the model's default
// transcription behavior silently "auto-corrects" spoken math back into
// symbolic notation (writing "(a+b)^2" for audio that actually says "the
// quantity a plus b, squared") — a transcription-side normalization, not a
// phonetic recognition error, that inflates WER against a plain-English
// reference for reasons having nothing to do with the narration's own
// quality. Without this instruction the eval's WER numbers would be
// confounded by the ASR step's own behavior on math content specifically.
const TRANSCRIBE_PROMPT = 'Transcribe this audio verbatim, word for word, exactly as spoken. Write out every word as it is actually SPOKEN — never convert spoken math back into symbols, digits, or notation (e.g. if the audio says "a plus b, squared", write "a plus b squared", NOT "(a+b)^2"; if it says "two", write "two", not "2"). Output ONLY the transcript — no commentary, no notation, no paraphrasing.';

/** @param {Buffer} wavBuffer @returns {Promise<string>} */
export async function transcribeAudio(apiKey, wavBuffer) {
  const text = await generateText(apiKey, {
    userContent: TRANSCRIBE_PROMPT,
    imageBase64: wavBuffer.toString('base64'),
    imageMimeType: 'audio/wav',
  });
  return text.trim();
}
