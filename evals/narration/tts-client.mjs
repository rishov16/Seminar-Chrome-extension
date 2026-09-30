// Single-shot Gemini TTS call — separate from lib/llm-client.js on purpose:
// that module's generateText/generateStructured only ever request TEXT
// output, and this eval's audio needs (generationConfig.responseModalities:
// ['AUDIO'] + speechConfig) are unique to WER measurement, not something
// any production code path needs. Confirmed against a real API call during
// development (see evals/README.md): model 'gemini-3.1-flash-tts-preview'
// returns raw headerless PCM ("audio/l16; rate=24000; channels=1"), wrapped
// into a WAV container by wav-utils.mjs before being handed anywhere else.
import { wrapPcmAsWav } from './wav-utils.mjs';

const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const TTS_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;

/** @returns {Promise<Buffer>} a WAV-wrapped audio buffer of the spoken text */
export async function synthesizeSpeech(apiKey, text, { voiceName = 'Kore' } = {}) {
  const response = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini TTS request failed (${response.status})`);
  }

  const data = await response.json();
  const part = data.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) throw new Error('No audio returned from Gemini TTS.');

  const pcm = Buffer.from(part.inlineData.data, 'base64');
  // mimeType looks like "audio/l16; rate=24000; channels=1" — parse the
  // rate rather than hardcoding it, in case the model's default ever
  // changes; fall back to the documented default if the header is absent.
  const rateMatch = /rate=(\d+)/.exec(part.inlineData.mimeType || '');
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  return wrapPcmAsWav(pcm, { sampleRate });
}
