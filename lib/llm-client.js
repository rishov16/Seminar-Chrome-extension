// Dedupes the Gemini fetch call sites that were duplicated across the old
// sidepanel.js (narration generation at line 226, vision OCR at line 1706).
// All entry points accept an AbortSignal so the editor's debounced narration
// regeneration (editor/seminar-editor-controller.js) can cancel a superseded
// in-flight call.

// The default model every existing caller (Head Agent, Narrator Agent,
// vision OCR) gets unless it explicitly opts into a different one via
// opts.model — a per-call override, not a second global default, added
// specifically so diagram generation (renderers/experimental-handwriting-
// agent/diagram-tikz-generator.js and friends) can use a more capable
// model for that specific task without changing every other call site's
// behavior.
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

function geminiEndpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

class LlmError extends Error {}

async function callGemini(apiKey, body, { signal, model = DEFAULT_GEMINI_MODEL } = {}) {
  const response = await fetch(`${geminiEndpoint(model)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new LlmError(err.error?.message || `Gemini API request failed (${response.status})`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new LlmError('Gemini response was truncated (MAX_TOKENS) — input may be too large for one call.');
  }
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new LlmError('No text returned from Gemini API.');
  return text;
}

/** Plain-text generation (narration script, OCR transcription). */
export async function generateText(apiKey, { systemPrompt, userContent, imageBase64, imageMimeType } = {}, opts = {}) {
  const parts = [];
  if (userContent) parts.push({ text: userContent });
  if (imageBase64) parts.push({ inlineData: { mimeType: imageMimeType || 'image/jpeg', data: imageBase64 } });

  const body = { contents: [{ parts }] };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  return callGemini(apiKey, body, opts);
}

/**
 * Structured JSON-mode generation (Head Agent's seminar plan; also used by
 * diagram-formula-detector.js's image-conditioned classification).
 * Retries once with a repair prompt if the model's output fails to parse.
 */
export async function generateStructured(apiKey, { systemPrompt, userContent, responseSchema, imageBase64, imageMimeType, thinkingConfig } = {}, opts = {}) {
  const parts = [{ text: userContent }];
  if (imageBase64) parts.push({ inlineData: { mimeType: imageMimeType || 'image/jpeg', data: imageBase64 } });

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      // thinkingConfig (e.g. { thinkingBudget: -1 } for "let the model
      // decide") requests Gemini's extended-reasoning mode for this call
      // specifically — omitted entirely unless a caller opts in, so every
      // existing call site (Head Agent, narration) is unaffected.
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const rawText = await callGemini(apiKey, body, opts);
  try {
    return JSON.parse(rawText);
  } catch (parseErr) {
    // One repair attempt: ask the model to fix its own malformed JSON.
    const repairBody = {
      contents: [{
        parts: [{
          text: `The following was supposed to be valid JSON matching a schema, but failed to parse with error "${parseErr.message}". Return ONLY corrected, valid JSON, no prose, no markdown fences:\n\n${rawText}`,
        }],
      }],
      generationConfig: { responseMimeType: 'application/json', responseSchema, ...(thinkingConfig ? { thinkingConfig } : {}) },
    };
    const repaired = await callGemini(apiKey, repairBody, opts);
    return JSON.parse(repaired); // let this throw if still broken — caller surfaces an error state
  }
}

export { LlmError };
