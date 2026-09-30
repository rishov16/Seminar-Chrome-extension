// Asks Gemini to describe a diagram as TikZ — the way a math professor
// would draw it on a board: a clean, low-fidelity, schematic sketch, not a
// pixel-precise trace of the source image. TikZ is used purely as a
// structured, LLM-friendly INTERMEDIATE representation: real math papers
// and lecture notes overwhelmingly use TikZ for exactly this kind of
// figure, so the model is reproducing a format it has seen enormous real
// amounts of, rather than inventing a bespoke representation from scratch.
// Earlier experiments tried raw-coordinate guessing and closed-form
// parametric formulas — those approaches, and their supporting files, were
// removed once the decision was made to pursue TikZ instead.
// tikz-path-parser.js parses the result — geometry only, never runs
// LaTeX/pdflatex/dvisvgm anywhere — and the sampled points feed the exact
// same registerGeneratedTranscript/buildGlyphSegments pipeline every other
// motif in this directory uses.
//
// Uses Gemini (lib/llm-client.js), same as every other call in this
// project.
import { generateStructured, LlmError } from '../../lib/llm-client.js';
import { registerGeneratedTranscript } from './handwriting-agent.js?v=25';
import { parseTikzToStrokes, strokesToTranscriptXml } from './tikz-path-parser.js';

// Overrides lib/llm-client.js's default model choice for diagram
// generation specifically only in how much it thinks, not which model
// family: gemini-3.1-pro-preview 404s with a free-tier quota of 0
// (confirmed live — it's a paid-only model), so this stays on the same
// gemini-3.1-flash-lite every other call in this project already uses
// successfully, and reaches for more thinking instead (below) to get
// better structural reproduction without needing billing enabled.
// Exported so diagram-tikz-feedback-loop.js and explain-with-diagram-
// generator.js — which also generate/judge TikZ — share this one default
// rather than each guessing their own. Every diagram experiment page still
// exposes this as an editable field, so switching to a paid Pro model (or
// any renamed id) once billing is set up is a one-field UI fix, not a
// code change.
export const DEFAULT_DIAGRAM_MODEL = 'gemini-3.1-flash-lite';

// Gemini 3.x models take thinkingConfig.thinkingLevel ('minimal'|'low'|
// 'medium'|'high'), NOT the legacy Gemini 2.5 thinkingBudget field —
// sending thinkingBudget alongside a 3.x model is documented to 400
// ("cannot use both thinking_level and the legacy thinking_budget").
// 'high' asks for the most reasoning before answering, since reproducing
// a figure's actual structure (crossings, branch points, component
// counts) benefits more from that than from the fastest possible
// response, unlike most of this project's other Gemini calls (Head Agent
// planning, narration) which are tuned for the opposite tradeoff. Passed
// straight through to lib/llm-client.js's generateStructured, which
// leaves generationConfig.thinkingConfig out of the request entirely
// unless a caller supplies it — every other Gemini call in this project
// is untouched by this.
export const DEFAULT_DIAGRAM_THINKING_CONFIG = { thinkingLevel: 'high' };

// Exported for reuse by explain-with-diagram-generator.js, which needs the
// exact same TikZ grammar (parsed by the same tikz-path-parser.js) inside a
// larger prompt that also asks for narration and equation steps — kept as
// one shared source of truth rather than a second, independently-drifting
// copy of a precise technical spec.
export const TIKZ_SUBSET_SPEC = `Output ONLY a sequence of \\draw statements (no \\begin{tikzpicture}, no \\documentclass, no preamble, nothing else) using ONLY this subset of TikZ path syntax:
- Coordinates: (x,y) absolute; ++(dx,dy) relative to the current point; (angle:radius) polar, relative to the origin. Plain numbers only, no units (no "cm"/"pt").
- -- (x,y)  straight line to a coordinate
- -- cycle  straight line back to the path's starting point (closes the shape)
- .. controls (c1) and (c2) .. (x,y)  a cubic Bezier curve — use this for any smooth curve that isn't a circle/ellipse/arc (an organic loop, a wavy path, a rounded blob)
- arc (startAngle:endAngle:radius)  a circular arc starting at the CURRENT point, angles in degrees
- circle (radius)  a standalone circle centered at the current point
- ellipse (rx and ry)  a standalone ellipse centered at the current point
- An optional [style options] block right after \\draw is allowed but IGNORED (only geometry is read) — feel free to include it or omit it.
- Put a "% short label" comment on its own line directly above EACH \\draw statement naming that specific component (e.g. "% base space X", "% basepoint x0", "% connecting path", "% first cell") — one comment per \\draw, every \\draw gets one.
No \\node, no \\fill, no \\shade, no \\foreach, no other TikZ commands or libraries — only \\draw statements built from the primitives above.`;

const WORKED_EXAMPLE = `Worked example — a small figure with a base loop, a marked point on it, and a separate wavy connecting path:
% base loop
\\draw (0,0) circle (3);
% marked point
\\draw (3,0) circle (0.08);
% connecting path
\\draw (3,0) .. controls (5,2) and (7,-1) .. (9,0);
% second cell
\\draw (9,1) ellipse (1.2 and 1.6);`;

export const DIAGRAM_TIKZ_SYSTEM_PROMPT = `You are an expert at translating a mathematical diagram into TikZ, exactly the way a math professor sketches it on a board while lecturing — a clean, schematic, LOW-FIDELITY version that captures the figure's real structure (how many distinct pieces, how they connect, crossings, branch points), not a literal pixel-for-pixel trace of the source image's exact proportions or styling.

You will be shown an image of ONE diagram or figure from a math textbook, paper, or lecture notes. First identify its distinct components — the separate named parts a person would point to one at a time (a base space, a marked point, a connecting path, one cell, a second cell, a strip joining them, ...) — then write one \\draw statement per component (a component needing more than one disconnected piece can use more than one \\draw). If the image has NO real geometric structure to sketch (plain text, a bar chart, an unstructured photo), set "recognized" to false and explain why in "reason" — do not force a fit.

${TIKZ_SUBSET_SPEC}

${WORKED_EXAMPLE}

Ignore printed text labels, arrowheads-as-annotations, shading, and hatching texture — only the core geometric curves matter.`;

function buildResponseSchema() {
  return {
    type: 'object',
    properties: {
      recognized: { type: 'boolean' },
      reason: { type: 'string', description: 'why this was (or was not) recognized as having sketchable geometric structure' },
      tikzCode: { type: 'string', description: 'the \\draw statements only, per the system instructions — no tikzpicture wrapper' },
    },
    required: ['recognized', 'tikzCode'],
  };
}

/**
 * Asks Gemini for a TikZ sketch of an image, parses it (tikz-path-
 * parser.js — geometry only, never runs LaTeX), samples every stroke into
 * native points, and registers the flattened result under `label` on
 * success.
 *
 * @param {{ apiKey: string, imageBase64: string, imageMimeType: string,
 *   label: string, hint?: string, signal?: AbortSignal, scale?: number,
 *   model?: string, thinkingConfig?: object }} opts
 *   scale converts TikZ units to native render units (buildGlyphSegments
 *   rescales into the actual target box itself — this only needs to be a
 *   reasonable, non-tiny working scale, not exact). model/thinkingConfig
 *   default to DEFAULT_DIAGRAM_MODEL/DEFAULT_DIAGRAM_THINKING_CONFIG above.
 * @returns {Promise<{ ok: boolean, recognized: boolean, tikzCode: string|null,
 *   reason: string|null, raw: string|null, parseErrors: string[] }>}
 *   ok=false with recognized=true means every \\draw statement failed to
 *   parse (see parseErrors); ok=false with recognized=false means the
 *   model itself reported no sketchable structure (see reason).
 */
export async function generateTikzDiagramFromImage({ apiKey, imageBase64, imageMimeType, label, hint, signal, scale = 60, model = DEFAULT_DIAGRAM_MODEL, thinkingConfig = DEFAULT_DIAGRAM_THINKING_CONFIG }) {
  if (!apiKey) throw new Error('Missing Gemini API key.');
  if (!imageBase64) throw new Error('Missing image.');

  const hintLine = hint ? `\n\nContext from the surrounding text: ${hint}` : '';
  let plan;
  try {
    plan = await generateStructured(apiKey, {
      systemPrompt: DIAGRAM_TIKZ_SYSTEM_PROMPT,
      userContent: `Sketch this diagram as TikZ, per the system instructions.${hintLine}`,
      responseSchema: buildResponseSchema(),
      imageBase64,
      imageMimeType,
      thinkingConfig,
    }, { signal, model });
  } catch (e) {
    if (e instanceof LlmError) throw new Error(`Diagram TikZ generation failed: ${e.message}`);
    throw e;
  }

  if (!plan.recognized || !plan.tikzCode || !plan.tikzCode.trim()) {
    return { ok: false, recognized: false, tikzCode: plan.tikzCode || null, reason: plan.reason || null, raw: null, parseErrors: [] };
  }

  const { strokes, errors: parseErrors } = parseTikzToStrokes(plan.tikzCode);
  if (strokes.length === 0) {
    return { ok: false, recognized: true, tikzCode: plan.tikzCode, reason: plan.reason || null, raw: null, parseErrors };
  }

  const raw = strokesToTranscriptXml(strokes, label, { scale });
  const ok = registerGeneratedTranscript(label, raw);
  return { ok, recognized: true, tikzCode: plan.tikzCode, reason: plan.reason || null, raw, parseErrors };
}
