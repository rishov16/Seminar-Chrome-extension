// Iterative self-correction for the TikZ-generated diagram pipeline: after
// the initial generation (diagram-tikz-generator.js), render it, show
// Gemini BOTH the original source image and a picture of the current
// attempt side by side, and ask it to judge whether they match — if not,
// take its corrected TikZ and repeat, until it reports a satisfactory
// match or a caller-set iteration limit is hit.
//
// This revives the real technique SketchAgent (Vinker et al.) actually
// uses (their own
// chat_and_edit.py renders the model's sketch back to an image for a
// self-correction pass rather than treating one generation as final),
// applied here to the TikZ pipeline instead of the older raw-coordinate
// one Phase E built it for. lib/llm-client.js's generateText/
// generateStructured only accept ONE inline image per call, so — same
// workaround Phase E used — the source image and the current attempt's
// rendered picture are composited side by side into a single image before
// being sent.
//
// Rendering/compositing (canvas, image loading) needs a browser DOM, so
// this module — unlike the plain-generation modules in this directory —
// is written assuming it's only ever imported by a page, not reused
// server-side; there is no server-side context in this project anyway.
import { generateStructured, LlmError } from '../../lib/llm-client.js';
import { registerGeneratedTranscript, buildGlyphSegments } from './handwriting-agent.js?v=25';
import { parseTikzToStrokes, strokesToTranscriptXml } from './tikz-path-parser.js';
import { TIKZ_SUBSET_SPEC, DEFAULT_DIAGRAM_MODEL, DEFAULT_DIAGRAM_THINKING_CONFIG } from './diagram-tikz-generator.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const DIAGRAM_COMPARISON_SYSTEM_PROMPT = `You will be shown ONE combined image with two panels side by side: "ORIGINAL SOURCE" (a diagram from a math textbook, paper, or lecture notes) and "CURRENT ATTEMPT" (a hand-drawn TikZ reproduction of it, low-fidelity/schematic by design — proportions, styling, and exact pixel positions are NOT expected to match).

Judge only the STRUCTURE: the same number of distinct components, the same connections/crossings/branch points, the same overall topology and relative arrangement. Minor differences in proportion, curve smoothness, or exact size are FINE and should be judged as matching — only flag a genuine structural mismatch (a missing component, an extra component, a crossing that should or shouldn't be there, components in the wrong relative position or order).

If the attempt already captures the original's structure well enough, set "same" to true and briefly say why in "reason".

If not, set "same" to false, explain SPECIFICALLY what's structurally wrong in "reason" (not what's stylistically different), and provide "correctedTikz": a complete, corrected \\draw sequence fixing exactly that problem — keep every part that was already correct unchanged, per the same rules below.

${TIKZ_SUBSET_SPEC}`;

function buildComparisonSchema() {
  return {
    type: 'object',
    properties: {
      same: { type: 'boolean' },
      reason: { type: 'string' },
      correctedTikz: { type: 'string', description: 'only when same=false — a complete corrected \\draw sequence' },
    },
    required: ['same', 'reason'],
  };
}

/**
 * Renders tikzCode into a fully-inked (non-animated) <svg> — used to build
 * each stage's picture, both for showing the user and for what gets sent
 * back to the model for comparison. Returns null if the TikZ has nothing
 * parseable in it.
 */
export function renderTikzToStaticSvg(tikzCode, label, target = { x: 0, y: 0, width: 320, height: 240 }) {
  const { strokes, errors } = parseTikzToStrokes(tikzCode);
  if (strokes.length === 0) return { svg: null, errors };
  const xml = strokesToTranscriptXml(strokes, label, {});
  registerGeneratedTranscript(label, xml);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'hw-diagram-agent');
  svg.setAttribute('viewBox', `${target.x} ${target.y} ${target.width} ${target.height}`);
  svg.setAttribute('width', target.width + 'px');
  svg.setAttribute('height', target.height + 'px');
  const segments = buildGlyphSegments(svg, label, target, { color: '#dff5e3', strokeWidthScale: 1 });
  if (!segments) return { svg: null, errors };
  // Fully inked immediately — this is a static snapshot, not an animation;
  // every segment already exists in the DOM the moment buildGlyphSegments
  // returns, just start at opacity 0 like every other token does before
  // startAgentWriting reveals it. Force it visible here instead.
  segments.forEach((segs) => segs.forEach(({ el }) => { el.style.opacity = '1'; }));
  return { svg, errors };
}

/** Rasterizes an <svg> (already fully inked — see renderTikzToStaticSvg) into a PNG data URL. */
export function svgToPngDataUrl(svg, width, height, backgroundColor = '#0d0f0b') {
  return new Promise((resolve, reject) => {
    const xml = new XMLSerializer().serializeToString(svg);
    const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = svgDataUrl;
  });
}

/** Composites the source image and the current attempt side by side into one labeled image — see this file's header for why (only one inline image per call). */
export function compositeSideBySide(sourceDataUrl, attemptDataUrl, panelW = 400, panelH = 300) {
  return new Promise((resolve, reject) => {
    const srcImg = new Image();
    const attemptImg = new Image();
    let loaded = 0;
    const onBothLoaded = () => {
      const canvas = document.createElement('canvas');
      canvas.width = panelW * 2 + 20;
      canvas.height = panelH + 40;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.font = '16px sans-serif';
      ctx.fillText('ORIGINAL SOURCE', 10, 20);
      ctx.fillText('CURRENT ATTEMPT', panelW + 30, 20);
      ctx.drawImage(srcImg, 10, 30, panelW, panelH);
      ctx.drawImage(attemptImg, panelW + 30, 30, panelW, panelH);
      const dataUrl = canvas.toDataURL('image/png');
      resolve({ dataUrl, base64: dataUrl.split(',')[1] });
    };
    srcImg.onload = () => { loaded++; if (loaded === 2) onBothLoaded(); };
    attemptImg.onload = () => { loaded++; if (loaded === 2) onBothLoaded(); };
    srcImg.onerror = reject;
    attemptImg.onerror = reject;
    srcImg.src = sourceDataUrl;
    attemptImg.src = attemptDataUrl;
  });
}

/**
 * One comparison round: sends a pre-composited (source + attempt) image,
 * gets back a same/different verdict and, if different, a corrected TikZ.
 *
 * @param {{ apiKey: string, combinedImageBase64: string,
 *   combinedImageMimeType?: string, signal?: AbortSignal, model?: string,
 *   thinkingConfig?: object }} opts
 * @returns {Promise<{ same: boolean, reason: string, correctedTikz: string|null }>}
 */
export async function compareDiagramToSource({ apiKey, combinedImageBase64, combinedImageMimeType = 'image/png', signal, model = DEFAULT_DIAGRAM_MODEL, thinkingConfig = DEFAULT_DIAGRAM_THINKING_CONFIG }) {
  if (!apiKey) throw new Error('Missing Gemini API key.');
  if (!combinedImageBase64) throw new Error('Missing comparison image.');

  let result;
  try {
    result = await generateStructured(apiKey, {
      systemPrompt: DIAGRAM_COMPARISON_SYSTEM_PROMPT,
      userContent: 'Compare the two panels and judge whether the attempt captures the original\'s structure, per the system instructions.',
      responseSchema: buildComparisonSchema(),
      imageBase64: combinedImageBase64,
      imageMimeType: combinedImageMimeType,
      thinkingConfig,
    }, { signal, model });
  } catch (e) {
    if (e instanceof LlmError) throw new Error(`Diagram comparison failed: ${e.message}`);
    throw e;
  }
  return { same: !!result.same, reason: result.reason || '', correctedTikz: result.correctedTikz || null };
}
