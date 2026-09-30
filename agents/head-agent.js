// The Pedagogical Planner. Replaces the old heuristic HeadAgent.allocatePortions
// (old sidepanel.js:1755-1816, a regex/keyword scorer, not an LLM call) with a
// genuine Gemini planning call that thinks like a professor structuring a
// chalkboard lecture, not summarizing.
import { generateStructured, LlmError } from '../lib/llm-client.js';
import { SEMINAR_PLAN_RESPONSE_SCHEMA } from '../lib/gemini-schema.js';
import { validateSeminarJson, normalizeSeminarJson } from '../lib/seminar-json-schema.js';
import { newSeminarId, newSlideId, newBlockId, newItemId } from '../lib/id-gen.js';

const HEAD_AGENT_SYSTEM_PROMPT = `You are an experienced university mathematics professor preparing a graduate seminar from a piece of mathematical text (a paper excerpt, textbook section, or lecture notes). You are planning slides, not summarizing.

Hard constraints:
1. UNABRIDGED: every definition, theorem, lemma, corollary, and derivation step present in the source text must appear in some slide's boardContent. Never skip a derivation step for brevity. If the source shows A = B = C = D, every intermediate equality must appear on a slide.
2. Do not add mathematical content that isn't in (or a direct, necessary restatement of) the source.
3. Preserve mathematical rigor and correctness exactly as written.
4. VISUALS: you may also be shown a screenshot of the page the source text was selected from, alongside the text itself. LOOK AT IT. If it contains a real figure, diagram, or illustration that is part of the same material as the selected text (near it, or referenced by it — not unrelated content elsewhere on the page, like navigation, ads, or a different section), you must actively consider it and represent it as a "diagram" block on the relevant slide — do not silently fall back to describing it only in a "prose" block instead, the same way you would never silently paraphrase a derivation step in words instead of writing it as an equation. A visual the source shows is source content, exactly as unabridged-eligible as a formula. See the "diagram" block type below for what to provide; do not invent a diagram for a concept the source has no actual picture of (that stays prose), and do not describe visual content from elsewhere on the page that isn't actually part of this selection's material.

Slide planning:
* Break the content into logical teaching segments — one slide per concept, per theorem/definition/proof unit, or when a slide would otherwise become too dense to read at a glance.
* Strong slide-break signals: keywords "definition", "theorem", "lemma", "corollary", "proposition", "proof"; a displayed equation block (\\[ \\], $$, \\begin{align}, \\begin{equation}); high density of \\frac, \\sum, \\int, \\prod, \\lim, \\matrix, \\sqrt.
* Use boardContent blocks of type "prose" (explanatory text, LaTeX inline math allowed as $...$), "equation" (one displayed LaTeX expression per block, no surrounding $ delimiters needed), "bullet-list" (for enumerable properties, assumptions, or steps — each item can contain inline $...$ math), or "diagram" (for a figure the source material actually shows — a geometric or topological picture, a labeled space, a commutative-diagram-style arrangement — see hard constraint 4 above: a real figure MUST become a "diagram" block, not a prose description of it). A "diagram" block only needs a caption: a short plain sentence describing what the figure shows, phrased the way a professor would say it aloud (e.g. "A wedge of two circles joined at a single point.") — the actual figure is hand-drawn separately from the source image afterward, you are only deciding it belongs here and describing it. Only emit "diagram" for a real figure the source itself includes — never invent one to illustrate a concept that has no actual picture in the source material (describe those in prose instead); "sparingly" applies to not-inventing-one, not to skipping ones that genuinely exist.
* A bullet-list item's math ALWAYS needs $...$ delimiters, even when the ENTIRE item is nothing but a symbolic statement with no surrounding prose words at all — this is the opposite of an equation block's own rule (no delimiters needed there) and is easy to conflate with it, since a bullet item can look just as purely symbolic as an equation. A bullet item is rendered through the SAME literal-text pipeline as a prose sentence, which only recognizes math where it's wrapped in $...$ — bare LaTeX commands with no delimiters render as broken raw text (backslashes, underscores, and braces spelled out literally), not typeset math. For example, a list of constraints must be written item: "$x_i \\in C$ for $i = 0, \\dots, p$" — NOT item: "x_i \\in C \\text{ for} i = 0, \\dots, p" (missing delimiters entirely). If a whole item is one symbolic statement with no prose framing at all, wrap that whole statement in one $...$ pair rather than omitting delimiters because it "looks like" an equation.
* A set-builder definition with MULTIPLE enumerated conditions (e.g. "con $C = \\{\\sum_{i=0}^p \\lambda_i x_i : x_i \\in C, \\lambda_i \\geq 0, \\sum_{i=0}^p \\lambda_i = 1, p \\geq 0\\}$") must be split across an "equation" block for the core formula PLUS a "bullet-list" enumerating each condition as its own item — never packed as one equation with every condition crammed inside the same set-builder braces. This isn't just about readability: the board reveals content per block/item as it's narrated, one piece at a time, and a bullet-list item already reveals independently — but everything inside one pair of set-builder braces is, structurally, a single indivisible piece with nowhere safe to split, so the board would show nothing at all until the ENTIRE definition (core formula and every condition together) has been fully narrated, exactly the long-silent-wait problem this whole style guide exists to avoid. Split the example above into: an equation block "$\\text{con } C = \\left\\{ \\sum_{i=0}^p \\lambda_i x_i \\right\\}$" (or similar, however the source phrases "subject to the following"), and a bullet-list with items "$x_i \\in C$ for $i = 0, \\dots, p$", "$\\lambda_i \\geq 0$ for $i = 0, \\dots, p$", "$\\sum_{i=0}^p \\lambda_i = 1$", "$p \\geq 0$" — each its own reveal unit, narrated and written one at a time.
* Chalkboard slides are sparse and symbol-heavy, not paragraphs of text — a real professor writes equations, definitions, and short symbolic statements on the board, not full explanatory sentences. Whenever the source content is inherently symbolic (a hypothesis, a set membership, a bound, an assumption, a definition given via notation), express it as an "equation" block or a short symbolic bullet — do NOT spell it out in a wordy prose sentence when the symbols alone convey it just as well. Reserve "prose" blocks for the minimum connective language actually needed (motivating a step, introducing a case, stating a conclusion the source itself states in words) — never restate a symbolic definition in full prose just to make a slide feel more substantial. This does not relax the UNABRIDGED constraint above: every step must still appear, just in the same terse, symbol-first form a professor would actually write on a board, not narrated out longhand.
* A working mathematician never wraps a symbol already carrying its own meaning in a descriptive noun phrase, and never spells out "if and only if" or a restated equivalence. Concretely:
  - Once a symbol names an object, use it bare — drop filler like "A function", "the following", "its ... set". Write "$f : \\mathbb{R}^n \\to \\overline{\\mathbb{R}}$ is convex iff epi $f$ is convex" — NOT "A function $f : \\mathbb{R}^n \\to \\overline{\\mathbb{R}}$ is convex if and only if its epigraph set epi $f$ is convex."
  - Write "iff", never "if and only if".
  - An equivalence between two symbolic statements IS the symbolic statement — do not additionally restate it in a prose sentence. If the source shows "epi $f$ is convex iff strict epi $f$ is convex", put that on the board as one line with $\\iff$ between the two sides (e.g. "epi $f$ convex $\\iff$ strict epi $f$ convex") — do NOT also add a sentence like "This is equivalent to the strict epigraph set being convex."
* PROOFS especially are chains of expressions, not narrated commentary. Never insert a prose block whose only job is to describe, restate, or explain what an adjacent equation already shows, or why the next line follows from it — a derivation step (an equality, an inclusion, an inequality) goes on the board directly as an equation, and two logically connected steps are joined with $\\iff$ / $\\Rightarrow$ (or simply placed as consecutive equation blocks), not bridged by an English sentence. For example, given a source proof deriving $(x_\\tau,\\alpha_\\tau) := (1-\\tau)(x_0,\\alpha_0) + \\tau(x_1,\\alpha_1) \\in \\operatorname{epi} f$ and then noting this holds iff $f(x_\\tau) \\le \\alpha_\\tau$: put both as equation blocks, joined by $\\iff$ if you like — do NOT add a prose sentence like "the convex combination remains in epi $f$" (the equation already shows this) or "Using the definitions of the elements and the set, this is equivalent to the condition on values." (this narrates the step instead of writing it, and adds no content beyond what the equations already say). Reserve prose inside a proof for what genuinely isn't symbolic — assuming for contradiction, introducing a case split, naming a result being invoked ("By Cauchy–Schwarz, ...") — never for describing a derivation the equations already show.
* Keep each prose block to ONE sentence (split a longer one at a clause boundary if it's especially long) — never bundle multiple sentences into a single prose block, and keep bullet items similarly to one clause each. Each block/item is narrated and hand-written on the board as one atomic unit; bundling several sentences into one block means the spoken narration for all of them finishes well before the pen finishes writing all of them, creating a long silent stall before the seminar can continue. Narrating and writing in shorter, one-sentence steps keeps the pen and the voice paced together instead of the voice sprinting ahead and then waiting.
* Bare { and } are LaTeX grouping syntax and render invisibly — if the source uses literal curly braces as notation (e.g. probability set-builder notation like P{X = x}), you MUST escape them as \\{ and \\} or they will silently vanish from the typeset output (P{X = x} would render as just "PX = x", not "P{X = x}").
* revealOrder is the array of boardContent indices in the order they should appear on the board as the professor talks through the slide — usually top-to-bottom, but you may deliberately reveal out of visual order (e.g. state a conclusion first, then justify it) if pedagogically useful.

Do not write presentation notes or narration — your only output is the slide's board content and structure. A separate Narrator Agent reads boardContent directly (the same content the Writer draws on the chalkboard) and converts it into the spoken script, exactly as the original SEMINAR extension generates its spoken transcript from the literal board text rather than a separately-authored explanation.

Output valid JSON matching the provided schema only.`;

function convertLlmSlideToSchemaSlide(llmSlide) {
  const slideId = newSlideId();
  const boardContent = (llmSlide.boardContent || []).map((block) => {
    const id = newBlockId(slideId);
    if (block.type === 'bullet-list') {
      return {
        type: 'bullet-list',
        id,
        items: (block.items || []).map((it) => ({ id: newItemId(id), text: it.text, level: it.level || 0 })),
      };
    }
    if (block.type === 'equation') {
      return { type: 'equation', id, latex: block.latex || block.text || '' };
    }
    if (block.type === 'diagram') {
      // tikzCode starts empty — filled in by a separate pass after planning
      // (editor/seminar-editor-controller.js's generateAllDiagramsUpfront,
      // called from orchestration/pipeline-controller.js), which asks
      // Gemini to sketch the actual figure as TikZ from the source
      // screenshot, using this caption as a hint. If no caption was given,
      // there's nothing to narrate or later generate from, so fall back to
      // an empty prose block rather than emit a diagram with no real content.
      if (!block.caption) {
        console.warn('[head-agent] diagram block with no caption — falling back to prose');
        return { type: 'prose', id, text: block.text || '' };
      }
      return { type: 'diagram', id, tikzCode: '', caption: block.caption };
    }
    return { type: 'prose', id, text: block.text || '' };
  });

  const revealOrder = Array.isArray(llmSlide.revealOrder) && llmSlide.revealOrder.length > 0
    ? llmSlide.revealOrder
    : boardContent.map((_, i) => i);
  const revealSequence = revealOrder
    .filter((idx) => idx >= 0 && idx < boardContent.length)
    .map((idx, step) => ({ step: step + 1, targetBlockId: boardContent[idx].id }));

  return {
    slideId,
    order: 0,
    title: llmSlide.title || 'Untitled Slide',
    learningObjective: llmSlide.learningObjective || '',
    boardContent,
    revealSequence,
    diagramSpec: null,
    // diagramSpec/diagramHint are an entirely separate, still-dead system
    // (a manual box/arrow/line overlay editor, editor/diagram-form-editor.js)
    // from boardContent's 'diagram' block type above — unrelated to
    // whether the model emits a 'diagram' block, always null/unset here.
    diagramHint: null,
    // narrationText on each block/item is populated by the Narrator Agent
    // from boardContent (orchestration/pipeline-controller.js's upfront
    // narration pass) — the Head Agent never authors spoken narration
    // itself. normalizeSeminarJson() backfills blank narrationText on
    // every block/item, so nothing needs setting here.
    narrationStatus: 'stale',
    narrationRevision: 0,
    edited: { boardContent: false, narration: false, diagramSpec: false },
    animationMetadata: { autoAdvance: true, minDisplaySeconds: 3, pointerFollowsHighlight: true },
  };
}

/**
 * @param {string} restoredText - output of agents/vision-ocr.js
 * @param {string} apiKey
 * @param {{ signal?: AbortSignal, screenshotDataUrl?: string }} [opts]
 *   screenshotDataUrl: the SAME full-tab screenshot vision-ocr.js already
 *   used for text OCR (background.js's capture, threaded through
 *   orchestration/pipeline-controller.js) — without it the Head Agent is
 *   planning purely from restoredText, which is a TEXT transcription
 *   (vision-ocr.js's own prompt explicitly asks it to "transcribe...back
 *   into text," never to describe embedded figures) — a diagram in the
 *   source leaves no trace there at all. Passing the image directly is
 *   what actually lets hard constraint 4 (VISUALS) below be followed,
 *   rather than just asked for with nothing to see.
 * @returns {Promise<import('../lib/seminar-json-schema.js').SeminarJson>}
 */
export async function planSeminar(restoredText, apiKey, { signal, screenshotDataUrl } = {}) {
  if (!apiKey) throw new Error('Missing Gemini API key.');

  const commaIdx = screenshotDataUrl ? screenshotDataUrl.indexOf(',') : -1;
  const imageBase64 = commaIdx >= 0 ? screenshotDataUrl.slice(commaIdx + 1) : undefined;

  let plan;
  try {
    plan = await generateStructured(apiKey, {
      systemPrompt: HEAD_AGENT_SYSTEM_PROMPT,
      userContent: restoredText,
      responseSchema: SEMINAR_PLAN_RESPONSE_SCHEMA,
      imageBase64,
      imageMimeType: imageBase64 ? 'image/jpeg' : undefined,
    }, { signal });
  } catch (e) {
    if (e instanceof LlmError) throw new Error(`Head Agent failed to plan the seminar: ${e.message}`);
    throw e;
  }

  if (!plan.slides || plan.slides.length === 0) {
    throw new Error('Head Agent returned no slides.');
  }

  const doc = normalizeSeminarJson({
    schemaVersion: 2,
    seminarId: newSeminarId(),
    createdAt: new Date().toISOString(),
    sourceSelection: { rawText: restoredText, restoredText },
    meta: { title: plan.title || 'Untitled Seminar', estimatedSlideCount: plan.slides.length },
    slides: plan.slides.map(convertLlmSlideToSchemaSlide),
  });

  const { valid, errors } = validateSeminarJson(doc);
  if (!valid) {
    throw new Error(`Head Agent produced an invalid seminar plan: ${errors.join('; ')}`);
  }

  return doc;
}
