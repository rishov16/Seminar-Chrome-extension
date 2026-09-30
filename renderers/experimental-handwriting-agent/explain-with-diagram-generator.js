// Asks Gemini to turn a screenshot of a math definition/lemma/proof into a
// step-by-step "speak, then draw" teaching script — narration-only steps
// alternating with equation steps (LaTeX), matching how a professor
// actually presents material one piece at a time rather than narrating
// everything first. Gemini is deliberately NEVER asked to author the
// diagram's geometry: earlier versions of this generator also asked for
// "diagram" steps with model-authored TikZ (see git history / this
// experiment's own iteration log), but that TikZ was unreliable often
// enough (wrong curve syntax, superimposed/misplaced components, missing
// line styles) that the diagram's GEOMETRY is now sourced EXCLUSIVELY from
// whatever the user pastes into the "Supply your own TikZ" section — see
// splitTikzIntoStages (tikz-path-parser.js).
//
// What Gemini IS asked to do with the diagram (when the caller has one
// staged via splitTikzIntoStages) is decide its PACING alongside the rest
// of the narration: which of its components get their own spoken beat,
// which get silently grouped into a neighbor's beat, and how to phrase
// what it does say — exactly the judgment call a professor makes live
// (nobody narrates "here is the outer boundary; here is the inner
// boundary; here is the left handle" one mechanical sentence per stroke).
// Gemini only ever sees the components' LABELS, in order, never their
// geometry — it decides "parts per beat" and narration text, and this
// file maps that back onto the real, already-known-good tikz per stage.
//
// The output steps feed directly into
// renderers/experimental-handwriting-agent/speak-then-draw-player.js
// (same { phase, narration, tikz?, latex?, label? } shape that module
// already consumes for the hand-authored height-and-distance script) — no
// new playback code, only a new source of steps.
import { generateStructured, LlmError } from '../../lib/llm-client.js';
import { DEFAULT_DIAGRAM_MODEL, DEFAULT_DIAGRAM_THINKING_CONFIG } from './diagram-tikz-generator.js';

const BASE_SYSTEM_PROMPT = `You are an experienced math professor explaining a definition, lemma, theorem, or proof to a student, using a chalkboard. You will be shown a screenshot from a textbook, paper, or lecture notes containing mathematical text (it may also show a diagram or figure, purely for your own context).

Your job is to break the explanation down into a sequence of teaching STEPS, exactly the way a professor actually presents material: speak a short piece of explanation, THEN write the thing just introduced, one step at a time — never all the narration up front followed by everything written at once, and never so many tiny steps that one idea gets fragmented into meaningless pieces.

Each step has a "phase":
- "speak": narration only, nothing written (an introduction, a transition, a concluding remark).
- "equation": narration introducing one displayed formula, followed by that formula written as LaTeX.

If the image has NO real mathematical content to explain (not a definition/lemma/proof/theorem), set "recognized" to false and explain why in "reason" — do not force a fit.

For "equation" steps, "latex" is exactly ONE displayed LaTeX expression (no surrounding $ delimiters, no \\[ \\]) — a definition's formula, an equality in a proof, a conclusion. Keep each equation step to one displayed expression, the way a professor writes one line at a time, not a whole derivation crammed onto a single line.

Narration for every step must be a short, natural sentence a professor would actually SAY ALOUD — describe the mathematical MEANING, never read LaTeX syntax literally (say "the limit of f of x as x approaches a equals L", not "f open paren x close paren equals L").`;

const NO_DIAGRAM_TAIL = `

Do NOT produce any diagram/figure step — none is available for this explanation. If the source material centers on a figure, describe what it shows and why it matters using "speak" steps only, in words, never as drawing code.

Typical structure: a "speak" step introducing the concept, then alternating "speak"/"equation" steps building the explanation component by component, optionally ending with a short "speak" step. Produce as many steps as the actual content genuinely needs — a simple definition might be 3-5 steps, a longer proof might be 8-12.`;

function buildDiagramTail(diagramStages) {
  const list = diagramStages.map((s, i) => `${i + 1}. ${s.label || '(unlabeled part)'}`).join('; ');
  return `

The image's diagram has already been broken into these ${diagramStages.length} components, in a fixed drawing order — you never see or author their actual geometry, only these short labels: ${list}.

Weave the diagram into your steps using phase "diagram", the same way you'd weave in an "equation" step, but pace it the way a professor ACTUALLY draws a figure while lecturing — not one narrated sentence per component. A "diagram" step has:
- "narration": what to say while this batch is drawn, in your own words — or "" (empty) for a purely mechanical/repetitive component you'd just draw in silence while still talking about something else, or while the previous sentence is still landing.
- "parts": how many of the NEXT not-yet-revealed components (from the ordered list above, in order) this one step reveals. Usually 1, but group several minor/repetitive components together under a single "diagram" step (with one narrated sentence, or "") whenever that's how a professor would actually pace it — e.g. three near-identical decorative marks might all be "parts": 3 under one quick unnarrated step, while a component that's actually the point of the explanation gets its own "parts": 1 step with real narration.

Every component in the list above must be revealed by exactly one "diagram" step's "parts", in the given order, summing to exactly ${diagramStages.length} across all your "diagram" steps combined — do not skip any, do not reveal one twice.

Typical structure: a "speak" step introducing the concept, then "diagram"/"equation"/"speak" steps interleaved however the actual explanation calls for it, optionally ending with a short "speak" step. Produce as many steps as the actual content genuinely needs.`;
}

function buildResponseSchema(hasDiagram) {
  const properties = {
    phase: { type: 'string', enum: hasDiagram ? ['speak', 'diagram', 'equation'] : ['speak', 'equation'] },
    narration: { type: 'string' },
    latex: { type: 'string', description: 'only for phase "equation" — one displayed LaTeX expression, no $ delimiters' },
  };
  if (hasDiagram) {
    properties.parts = { type: 'integer', description: 'only for phase "diagram" — how many of the next not-yet-revealed diagram components this step reveals' };
  }
  return {
    type: 'object',
    properties: {
      recognized: { type: 'boolean' },
      reason: { type: 'string', description: 'why this was (or was not) recognized as an explicable concept' },
      concept: { type: 'string', description: 'short name of the concept being explained, e.g. "Definition of a limit"' },
      steps: {
        type: 'array',
        items: { type: 'object', properties, required: ['phase', 'narration'] },
      },
    },
    required: ['recognized', 'steps'],
  };
}

/**
 * Maps Gemini's {phase:'diagram', narration, parts} steps onto real tikz,
 * consuming diagramStages in order — each output step's tikz is the
 * CUMULATIVE stage tikz through the last part it consumes (already a
 * strict superset per splitTikzIntoStages), matching what
 * speak-then-draw-player.js expects. Clamped/defensive rather than
 * trusting the model's bookkeeping exactly: a non-positive or oversized
 * "parts" is treated as 1 (or "whatever's left"), and any stages the model
 * never got around to consuming are appended as one final silent step —
 * every component the user supplied always ends up on the board, even if
 * Gemini's own count drifts.
 */
function resolveDiagramSteps(planSteps, diagramStages) {
  let cursor = 0; // index of the next not-yet-revealed stage
  const resolved = [];
  planSteps.forEach((step) => {
    if (step.phase !== 'diagram') {
      resolved.push({ phase: step.phase, narration: step.narration || '', latex: step.latex || undefined });
      return;
    }
    if (cursor >= diagramStages.length) return; // nothing left to reveal; drop a stray extra "diagram" step
    const requested = Number.isFinite(step.parts) ? Math.trunc(step.parts) : 1;
    const parts = Math.min(Math.max(requested, 1), diagramStages.length - cursor);
    cursor += parts;
    resolved.push({ phase: 'diagram', narration: step.narration || '', tikz: diagramStages[cursor - 1].tikz, label: 'diagram:explain' });
  });
  if (cursor < diagramStages.length) {
    resolved.push({ phase: 'diagram', narration: '', tikz: diagramStages[diagramStages.length - 1].tikz, label: 'diagram:explain' });
  }
  return resolved;
}

/**
 * Asks Gemini to break a screenshot's definition/lemma/proof into a
 * step-by-step speak-then-draw script, optionally weaving in a diagram
 * whose geometry the caller already has staged (splitTikzIntoStages) —
 * Gemini decides pacing/narration for it, never its geometry.
 *
 * @param {{ apiKey: string, imageBase64: string, imageMimeType: string,
 *   hint?: string, diagramStages?: {label: string|null, tikz: string}[],
 *   signal?: AbortSignal, model?: string, thinkingConfig?: object }} opts
 * @returns {Promise<{ ok: boolean, recognized: boolean, concept: string|null,
 *   reason: string|null, steps: object[] }>} steps are already in
 *   speak-then-draw-player.js's { phase, narration, tikz?, latex?, label? }
 *   shape, ready to pass straight to player.setSteps(). ok=false means
 *   either the model reported nothing recognizable (recognized=false) or
 *   returned zero usable steps.
 */
export async function generateExplanationScript({ apiKey, imageBase64, imageMimeType, hint, diagramStages = [], signal, model = DEFAULT_DIAGRAM_MODEL, thinkingConfig = DEFAULT_DIAGRAM_THINKING_CONFIG }) {
  if (!apiKey) throw new Error('Missing Gemini API key.');
  if (!imageBase64) throw new Error('Missing image.');

  const hasDiagram = diagramStages.length > 0;
  const systemPrompt = BASE_SYSTEM_PROMPT + (hasDiagram ? buildDiagramTail(diagramStages) : NO_DIAGRAM_TAIL);
  const hintLine = hint ? `\n\nContext from the surrounding text: ${hint}` : '';
  let plan;
  try {
    plan = await generateStructured(apiKey, {
      systemPrompt,
      userContent: `Break this down into a step-by-step spoken explanation with drawing, per the system instructions.${hintLine}`,
      responseSchema: buildResponseSchema(hasDiagram),
      imageBase64,
      imageMimeType,
      thinkingConfig,
    }, { signal, model });
  } catch (e) {
    if (e instanceof LlmError) throw new Error(`Explanation generation failed: ${e.message}`);
    throw e;
  }

  if (!plan.recognized || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, recognized: false, concept: plan.concept || null, reason: plan.reason || null, steps: [] };
  }

  const steps = hasDiagram
    ? resolveDiagramSteps(plan.steps, diagramStages)
    : plan.steps.map((step) => ({ phase: step.phase, narration: step.narration || '', latex: step.latex || undefined }));

  return { ok: true, recognized: true, concept: plan.concept || null, reason: plan.reason || null, steps };
}
