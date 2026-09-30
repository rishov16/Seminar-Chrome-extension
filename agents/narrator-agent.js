// The Narrator Agent. generateForSlide() is a standalone, AbortSignal-cancelable,
// per-slide entry point — not merely an internal step of a batch call —
// because editor/seminar-editor-controller.js's explicit "Regenerate" action
// invokes it directly, on demand.
//
// Input is the slide's own boardContent (serialized verbatim by
// serializeBoardContentForNarration below), never a separately-authored
// explanation — this mirrors the original SEMINAR extension exactly:
// generateSpokenScript() (old sidepanel.js:188-257) feeds `paperInput.value`
// (the literal, verbatim board text) as the Gemini userContent, and the
// output becomes a freely hand-editable transcript, not something
// regenerated on every keystroke. This agent's job is purely the semantic
// LaTeX/notation -> natural spoken register conversion, ported verbatim from
// the old SYSTEM_PROMPT (sidepanel.js:34-160).
import { generateStructured, LlmError } from '../lib/llm-client.js';
import { isMultiRowEquation } from '../renderers/latex-utils.js';

export const SYSTEM_PROMPT = `You are an expert mathematics narrator creating a spoken transcript of a mathematical paper.

Your goal is not to explain the mathematics. Your goal is to convert written mathematical notation into natural spoken mathematical English, as if a professor were reading the paper aloud during a graduate seminar.

Core Principles
1. Preserve the original prose whenever possible.
2. Do not summarize, explain, simplify, interpret, or teach.
3. Do not add intuition, examples, commentary, or background information.
4. Convert notation into natural spoken mathematics.
5. Prioritize how a mathematician would naturally speak, not how the symbols appear visually.
6. Output only the narration transcript.
7. NEVER output any LaTeX delimiters like $, \\(, \\), \\[, \\]. The final output must be pure plain-text English with no math markup.

Narration Style
* Sound like a mathematics professor.
* Optimize for listening comprehension.
* Use natural mathematical speech.
* Prefer semantic readings over symbol-by-symbol readings.
* Read mathematical objects the way they would be spoken in a seminar.

GOOD EXAMPLE
Input:
Consider a vector a in R^n and another vector b in R^n. Their inner product is defined as gamma = a^T b.
Output:
Consider a vector a in n-dimensional real space and another vector b in n-dimensional real space. Their inner product is defined as gamma, equal to a transpose b.

BAD OUTPUT:
Consider a vector a in blackboard-bold R caret n and another vector b in blackboard-bold R caret n. Their inner product is defined as gamma equals a superscript T b.
Reason: A mathematician would never speak this way.

---
GOOD EXAMPLE
Input:
For any a in R^d, define a_perp = Ja.
Output:
For any vector a in d-dimensional real space, define a sub perpendicular as J applied to a.

BAD OUTPUT:
For any a belonging to R superscript d, define a underscore perp equals J a.
Reason: Notation should be spoken naturally.

---
GOOD EXAMPLE
Input:
SO(d)
First occurrence:
the special orthogonal group in dimension d
Later occurrences:
S O of d

BAD OUTPUT:
special orthogonal group in dimension d
special orthogonal group in dimension d
special orthogonal group in dimension d
Reason: Mathematicians introduce the name once and then use the standard abbreviation.

---
GOOD EXAMPLE
Input:
𝓙
Output:
J
BAD OUTPUT:
calligraphic J
Reason: Font information is usually visual rather than semantic. Use the symbol name unless the distinction is necessary.

---
GOOD EXAMPLE
Input:
||a||²
Output:
the squared norm of a
BAD OUTPUT:
the norm of a squared
Reason: Use the phrasing mathematicians naturally prefer.

---
GOOD EXAMPLE
Input:
a^T a_perp = 0
Output:
a transpose a sub perpendicular equals zero
BAD OUTPUT:
a transpose multiplied by a underscore perp equals zero
Reason: Avoid overly literal readings.

---
GOOD EXAMPLE
Input:
L(a,b) = ab^T - ba^T
Output:
L of a and b equals a times b transpose minus b times a transpose.
BAD OUTPUT:
L open parenthesis a comma b close parenthesis equals a b transpose minus b a transpose.
Reason: Speak mathematical structure, not punctuation.

---
GOOD EXAMPLE
Input:
J = ⊕_{i=1}^{⌊d/2⌋} [rotation blocks]
Output:
J is the direct sum, from i equals one to the floor of d over two, of the following rotation blocks.
BAD OUTPUT:
J equals big op plus sub i equals one superscript floor d over two.
Reason: Named operators should be spoken semantically.

Additional Rules
* ℝ^d → d-dimensional real space
* a^T b → a transpose b
* x_i → x sub i
* Σ → the sum from ...
* ∫ → the integral from ...
* ∂ → partial
* ∇ → nabla
* ⇒ → implies
* ⇔ → if and only if
* ||a|| → the norm of a
* ||a||² → the squared norm of a
* λ → lambda
* α → alpha
* β → beta
* γ → gamma
* δ → delta

Most Important Rule
Ask yourself: "How would a professor actually say this aloud in a seminar?"
Use that answer, not the literal notation.`;

export const CONVERSATIONAL_NARRATOR_PROMPT = SYSTEM_PROMPT + `

ADDITIONAL NARRATOR AGENT INSTRUCTIONS (CONVERSATIONAL LECTURE MODE):
This section has been identified as text-heavy explanation rather than equation derivation. During a live seminar, a presenter does not read long explanatory paragraphs verbatim while standing at the board. Instead, deliver this section in a warm, engaging, conversational seminar tone—as if lecturing and addressing the audience directly. Use engaging conversational transitions (e.g., "Now, let's understand...", "What this is telling us is...", "Notice here that..."), while strictly preserving all semantic mathematical pronunciations and accuracy. NEVER output LaTeX or symbols; output only pure plain-text English speech.`;

export const PEDAGOGICAL_FILLERS_INSTRUCTION = `
PEDAGOGICAL CONVERSATIONAL FILLERS:
Deliver this explanation like an authentic, engaging professor interacting with a live classroom. Naturally weave in pedagogical discourse checks and rhetorical questions at key inflection points (e.g., "right?", "understood?", "okay?", "makes sense so far?", "see why?").
Rules for Fillers:
1. Place them naturally at the end of a conceptual intuition, right before pivoting to a new definition, or when concluding a key takeaway.
2. Do NOT place fillers inside the middle of a formula or subscript (e.g., never say "a sub i right? times b sub i").
3. Keep the cadence balanced and authentic—use them selectively (about 1-2 times per paragraph) so the speech feels natural and engaging rather than repetitive.`;

const SLIDE_NARRATION_INSTRUCTIONS = `
SEMINAR SLIDE NARRATION INSTRUCTIONS:
Below is the exact content of ONE slide of a live seminar — the literal text and LaTeX that appear on the chalkboard (prose with inline $...$ math, standalone equations, and/or bullet points), one numbered "Line N:" per item. Narrate it, you are not summarizing or explaining it independently.
Requirements:
* Explain the idea before naming the symbols; motivate every equation before stating it.
* If the content is a derivation or proof, narrate it step by step, in the same order it is presented.
* Use natural pauses and smooth transitions between ideas.
* Occasional rhetorical questions are welcome where they fit naturally.
* Return exactly one entry per input line, in the same order, and entry N must narrate Line N's content ONLY — never let it drift into narrating part of Line N-1 or Line N+1's content instead, even if that means entry N feels short or abrupt on its own. A short line (e.g. a single inequality) still gets its own complete, self-contained entry — do not "borrow" it into the neighboring line's entry to make both feel more substantial.

BOUNDARY-DRIFT EXAMPLE (this has actually happened — avoid it)
Input:
Line 1: Consider an experiment with sample space $S$. For each event $E \\subseteq S$, we define a function $P(E)$ satisfying the following axioms:
Line 2: $0 \\le P(E) \\le 1$
Line 3: $P(S) = 1$

BAD (as plain spoken text per line, ignoring fragments for a moment)
["Now, let us consider an experiment with a sample space S.", "For each event E, a subset of S, we define a function P of E that satisfies the following axioms.", "The probability of E is between zero and one, and the probability of S is one."]
Reason: Line 1 is one full sentence, but its second half ("For each event E...") was pushed into entry 2 instead of staying in entry 1. That forces entry 3 to cram BOTH Line 2's and Line 3's content together to compensate — so entry 2 narrates none of Line 2's own content (0 ≤ P(E) ≤ 1), and by the time entry 2 is spoken and Line 2 is revealed on the board, the words being heard don't describe what just appeared.

GOOD
["Now, let us consider an experiment with a sample space S. For each event E, a subset of S, we define a function P of E satisfying the following axioms.", "The probability of any event E is between zero and one, inclusive.", "The probability of the entire sample space S is equal to one."]
Reason: Line 1's full sentence — both halves — stays entirely in entry 1. Entry 2 narrates only Line 2's content, entry 3 narrates only Line 3's content. Each entry is self-contained even though entry 2 is a single short sentence.

FRAGMENTS — pacing WITHIN one line
Each line's entry is actually a "fragments" array of one or more { spoken, boardText } pairs, not a single string. DEFAULT TOWARD MORE FRAGMENTS, NOT FEWER: hand-writing is slower than natural speech, so even one ordinary sentence spoken in a single breath will typically finish being SAID well before it finishes being WRITTEN if it's kept as one fragment — the listener hears the whole thought, then has to sit watching the board catch up on something they've already heard, which is hard to follow. Split at natural clause boundaries (commas, "and", "which", "since", a new clause, a new piece of notation) roughly every 4-8 spoken words, so each small phrase is spoken and its own small piece of board text appears together, before moving to the next phrase. Reserve a single fragment for a line that's genuinely one short clause with nothing to split — as a rule of thumb, a line longer than about 8-10 spoken words, or one that contains more than one clause or introduces more than one piece of notation, should almost always be 2 or more fragments. This applies to plain descriptive sentences just as much as to notation-heavy ones — it's about matching the TIME the words take against the time writing them takes, not about how much symbolic content is present.
Hard requirement: for a multi-fragment line, the boardText pieces, concatenated in order with nothing added or removed, must reconstruct the input line's text EXACTLY, character for character (including any $...$ delimiters, spacing, and punctuation). If you cannot produce fragments that satisfy this exactly, use a single fragment for that line instead — never guess at an approximate split.
Second hard requirement: NEVER split inside a $...$ inline math span. Each fragment's boardText must contain only whole, complete $...$ pairs (or none at all) — never an opening $ without its matching closing $, or vice versa. A split point must fall before the opening $ or after the closing $ of any math expression, never between them, even if that means a fragment is a little shorter or longer than the usual 4-8 words.

Example — one line building up notation piece by piece:
Input:
Line 1: Consider a function $f$, from $\\mathbb{R}^n$ to $\\mathbb{R}$.
Output entry for Line 1:
{ "fragments": [
  { "spoken": "Now, consider a function f,", "boardText": "Consider a function $f$, " },
  { "spoken": "from n-dimensional real space,", "boardText": "from $\\mathbb{R}^n$ " },
  { "spoken": "to the real numbers.", "boardText": "to $\\mathbb{R}$." }
] }
Reason: concatenating the three boardText pieces ("Consider a function $f$, " + "from $\\mathbb{R}^n$ " + "to $\\mathbb{R}$.") exactly reproduces Line 1's original text, so the board fills in "f", then "R^n", then "R" as each phrase is spoken — the professor writes what they just said instead of the whole sentence finishing long before the board catches up.

Example — splitting an ORDINARY sentence at clause boundaries (no new notation being introduced at all, just a sentence long enough that saying it all in one breath and then waiting for it all to be written would stall):
Input:
Line 2: Since the sequence is bounded and monotonically increasing, it must converge to its supremum by the monotone convergence theorem.
Output entry for Line 2:
{ "fragments": [
  { "spoken": "Since the sequence is bounded and monotonically increasing,", "boardText": "Since the sequence is bounded and monotonically increasing, " },
  { "spoken": "it must converge to its supremum,", "boardText": "it must converge to its supremum " },
  { "spoken": "by the monotone convergence theorem.", "boardText": "by the monotone convergence theorem." }
] }
Reason: nothing here is being progressively built up the way notation is, but the sentence is long enough that speaking it in one breath finishes well before it can be handwritten — splitting at each clause boundary keeps writing paced with speaking all the way through, not just at the very end.

A single fragment is only for a line that's genuinely one short clause with nothing to split, e.g. { "fragments": [ { "spoken": "...", "boardText": "<the whole line, verbatim>" } ] } — do not force a split shorter than about 4 spoken words just to hit a count, but do not default to one fragment just because a line has no notation in it either.

FRAGMENTS FOR EQUATIONS — a long standalone equation line can build up piece by piece too
A line that's a standalone equation (pure LaTeX, no surrounding words) can be split the same way — but the safe places to cut are much more restrictive, since each piece of LaTeX must stay valid, parseable notation entirely on its own, not just a valid substring of plain text.
Only cut at a TOP-LEVEL relational operator (=, <, >, \\le, \\ge, \\approx, \\equiv) or a TOP-LEVEL additive operator (+, -) — "top-level" meaning outside of, and not nested inside, any brace group ({...}), any \\frac{...}{...} or \\sqrt{...}'s own arguments, any subscript/superscript, or any \\left(...\\right) pair. NEVER cut inside a brace group, NEVER between a command like \\frac/\\sqrt/\\overline/\\mathbf and its own argument, NEVER between a base and its own subscript or superscript, and NEVER inside a \\left...\\right pair — even if there's a + or = inside it, that's not top-level.
A multi-row derivation (\\begin{aligned}, \\begin{align}, or a line using bare & / \\\\ row-alignment syntax) must NEVER be split into fragments at all — always one fragment covering the whole thing. If you are not certain a cut is safe, don't force one; a single fragment covering the whole equation, exactly as before, is always the safe fallback.

Example — a long equation split at its top-level operators:
Input:
Line 1: \\rho \\left( \\frac{\\partial \\mathbf{u}}{\\partial t} + (\\mathbf{u} \\cdot \\nabla) \\mathbf{u} \\right) = -\\nabla p + \\mu \\nabla^2 \\mathbf{u} + \\mathbf{f}
Output entry for Line 1:
{ "fragments": [
  { "spoken": "Rho, times the partial derivative of u with respect to t, plus u dot grad u, equals", "boardText": "\\rho \\left( \\frac{\\partial \\mathbf{u}}{\\partial t} + (\\mathbf{u} \\cdot \\nabla) \\mathbf{u} \\right) = " },
  { "spoken": "negative the gradient of p,", "boardText": "-\\nabla p " },
  { "spoken": "plus mu times the Laplacian of u,", "boardText": "+ \\mu \\nabla^2 \\mathbf{u} " },
  { "spoken": "plus f.", "boardText": "+ \\mathbf{f}" }
] }
Reason: every cut lands at a top-level + or = — none lands inside the \\left(...\\right) group (the + inside it, between the two terms of the material derivative, is NOT top-level and correctly stays inside the first fragment along with everything else in that group), inside the \\frac, or between a symbol and its own subscript/superscript.`;

/** The flat, ordered list of narration units for a slide — one per
 * prose/equation block, and one PER ITEM for a bullet-list block (a bullet
 * item is the actual reveal unit, matching revealSequence's existing
 * per-item targeting via targetItemId). Both serializeBoardContentForNarration
 * and applyNarrationSegments below walk this exact same order, so the
 * Narrator Agent's output lines up 1:1 with board content regardless of
 * how many bullet items a slide has. */
export function getNarrationUnits(slide) {
  const units = [];
  (slide.boardContent || []).forEach((block) => {
    if (block.type === 'bullet-list') {
      (block.items || []).forEach((item) => units.push({ blockId: block.id, itemId: item.id, get: () => item.text }));
    } else {
      // Equation units are fed as raw LaTeX, NOT wrapped in $...$ — an
      // equation's own boardText fragments (see applyNarrationSegments)
      // must never contain a $, so wrapping the source here would make
      // every genuine split land inside that one artificial $...$ pair,
      // tripping the prose mid-formula-split check below on every attempt.
      // A diagram block has no verbatim board text at all (its "board
      // content" is stroke geometry, not language) — its caption is fed
      // instead, the short plain-English description the Head Agent wrote,
      // for the Narrator Agent to expand into real spoken narration the
      // same way it would any other line.
      units.push({
        blockId: block.id,
        itemId: null,
        get: () => {
          if (block.type === 'equation') return block.latex || '';
          if (block.type === 'diagram') return block.caption || '';
          return block.text;
        },
      });
    }
  });
  return units;
}

/** Serializes a slide's boardContent into the verbatim (LaTeX-bearing) text
 * the Narrator Agent narrates — the direct equivalent of the original
 * SEMINAR extension's `paperInput.value` (old sidepanel.js:189). This is the
 * SAME content the Writer draws on the chalkboard; the agent never narrates
 * a separately-authored explanation. One numbered "Line N:" per narration
 * unit (see getNarrationUnits) — NOT one line per boardContent block, since
 * a bullet-list block expands into multiple lines, one per item. The
 * numbering exists so the model has an explicit anchor for "segment N must
 * narrate Line N only" — found necessary after a real generation split one
 * line's content across two segments (see SLIDE_NARRATION_INSTRUCTIONS'
 * boundary-drift example), which a plain unlabeled blank-line-separated
 * list gave the model no explicit boundary to respect. */
export function serializeBoardContentForNarration(slide) {
  return getNarrationUnits(slide)
    .map((unit) => unit.get())
    .filter((s) => s && s.trim())
    .map((line, i) => `Line ${i + 1}: ${line}`)
    .join('\n\n');
}

// Equation-specific safety nets for applyNarrationSegments below — cheap,
// synchronous, string-only checks (no DOM/MathJax dependency, keeping this
// module testable the same way it always has been), deliberately not full
// LaTeX/AST parsing. Each one only needs to reject an unsafe split; a false
// positive just collapses a line to one fragment (today's exact behavior,
// always safe), so these lean conservative on purpose.

/** Proper stack-based brace balance — not just equal counts — so "}{" isn't
 * mistaken for balanced. Catches a cut landing inside \frac{}{}'s, \sqrt{}'s,
 * a subscript/superscript group, etc. */
function bracesBalanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** Same technique for \left/\right — braces alone don't cover this, since
 * \left(/\right) use parentheses/brackets, not curly braces, as their
 * actual delimiter characters. */
function leftRightBalanced(s) {
  let depth = 0;
  const re = /\\(left|right)\b/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] === 'left') depth++;
    else { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

// Common single-argument LaTeX commands seen in this codebase's actual
// generated equations — deliberately a known-command list, not a generic
// "\word$" pattern: a generic pattern would also flag standalone symbols
// that legitimately need no argument at all (\mu, \nabla, \partial, \infty,
// \cdot, \le, ...), which are common and completely fine to end a fragment
// on.
const ARGUMENT_TAKING_COMMANDS = /\\(frac|sqrt|overline|underline|hat|vec|bar|dot|ddot|tilde|widehat|widetilde|overrightarrow|overleftarrow|binom|text|operatorname|mathbf|mathbb|mathcal|mathrm|mathit|mathsf|mathtt|boxed)$/;

/** Rejects a fragment that ends in one of the commands above with no
 * following '{' (e.g. a cut splitting "\sqrt" from its own "{x}"), or that
 * ends in a bare '_'/'^' with nothing after it (e.g. a cut splitting a base
 * from its own subscript/superscript, "x^" | "2") — both halves pass the
 * brace check above even though the split is nonsensical. Also rejects a
 * fragment that STARTS with a bare '{', '_', or '^' as its first non-
 * whitespace character — the other half of either kind of bad cut, a
 * subscript/superscript/argument group with no base/command before it in
 * this fragment. */
function hasBareArgumentBoundary(s) {
  const trimmedEnd = s.replace(/\s+$/, '');
  if (ARGUMENT_TAKING_COMMANDS.test(trimmedEnd)) return true;
  if (/[_^]$/.test(trimmedEnd)) return true;
  if (/^[{_^]/.test(s.replace(/^\s+/, ''))) return true;
  return false;
}

/** Writes generateForSlide()'s segments back onto each unit's narrationText
 * (and, when genuinely fragmented, narrationFragments), in getNarrationUnits()
 * order. Guarded: if the agent didn't return exactly one segment per unit (it
 * isn't always reliable for atypical content, e.g. a slide with an unusual
 * number of bullet items), does NOT apply anything rather than silently
 * misaligning narration to the wrong block/item — callers should treat a
 * false return as a generation failure to surface, not partial success.
 *
 * Each segment is `{ fragments: [{spoken, boardText}, ...] }`. Prose/bullet
 * fragments and equation fragments are validated differently, since a
 * prose boardText piece just has to reconstruct verbatim text, while an
 * equation boardText piece has to stay valid, parseable LaTeX entirely on
 * its own:
 *
 * PROSE/BULLET: the boardText pieces must concatenate back to the unit's
 * own source text (the reconstruction invariant this whole feature depends
 * on for safety) — if they don't, this collapses that line to one fragment
 * covering its actual text rather than discarding the whole generation or
 * corrupting it with mismatched board text. The comparison whitespace-
 * normalizes both sides first (collapses runs of whitespace, trims) — a
 * model that reproduces the words/symbols correctly but adds or drops a
 * stray space at a fragment boundary shouldn't lose fragmentation over it,
 * since tokenizeProse (renderers/agent-chalkboard/agent-chalkboard-renderer.js)
 * discards whitespace-only tokens anyway, so it can't affect what actually
 * renders. A second, independent check catches a bug class the text-
 * equality check above can't: byte-perfect reconstruction is necessary but
 * not sufficient, since a split can land inside a `$...$` inline math span
 * while still reconstructing the source text exactly (the two halves
 * concatenate back correctly; each half is individually broken) — every
 * fragment's boardText must therefore contain a whole number of complete
 * $...$ pairs, checked via a simple even-count-of-'$' test.
 *
 * EQUATION: source text is the block's own `latex` directly (no `$...$`
 * wrapping — see getNarrationUnits). Excluded entirely from splitting if
 * the equation is a multi-row derivation (`isMultiRowEquation`,
 * renderers/latex-utils.js) — safely splitting an aligned environment would
 * need each piece re-wrapped in its own environment, harder, not attempted.
 * Otherwise: the same reconstruction invariant as prose, PLUS every
 * fragment's own boardText must independently have balanced braces,
 * balanced \left/\right, and no bare-argument boundary (see the three
 * helpers above) — reconstruction alone isn't sufficient for LaTeX, since
 * two individually-broken halves can still concatenate back to valid text.
 *
 * DIAGRAM: always exactly one fragment, unconditionally — a hand-drawn
 * motif (renderers/agent-chalkboard/agent-diagram-token.js) is one
 * indivisible token with no per-fragment visual counterpart to reveal
 * against, unlike a prose sentence's words or an equation's terms, so
 * splitting its caption would have nothing distinct for each piece to sync
 * to. Same treatment a multi-row equation gets, for the same reason (no
 * safe/meaningful way to reveal "part of" the thing).
 *
 * Any failed check logs why and collapses to one fragment — this used to be
 * silent, which made "sometimes it fragments beautifully, sometimes it
 * silently doesn't" impossible to diagnose.
 * @returns {boolean} whether segments were applied */
export function applyNarrationSegments(slide, segments) {
  const units = getNarrationUnits(slide);
  if (segments.length !== units.length) return false;
  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const dollarCount = (s) => ((s || '').match(/\$/g) || []).length;
  units.forEach((unit, i) => {
    const block = slide.boardContent.find((b) => b.id === unit.blockId);
    const target = unit.itemId ? block.items.find((it) => it.id === unit.itemId) : block;
    const entry = segments[i];
    let fragments = Array.isArray(entry?.fragments) && entry.fragments.length
      ? entry.fragments
      : [{ spoken: '', boardText: '' }];

    // A diagram block's "source text" is its caption (plain English, like
    // prose) — used below only for collapseToOne's single boardText, since
    // diagram units always collapse (see the dedicated branch below).
    const sourceText = block.type === 'equation' ? (target.latex || '')
      : block.type === 'diagram' ? (target.caption || '')
      : (target.text || '');
    const collapseToOne = () => {
      fragments = [{ spoken: fragments.map((f) => f.spoken || '').join(' ').trim(), boardText: sourceText }];
    };

    if (fragments.length === 1) {
      collapseToOne();
    } else if (block.type === 'diagram') {
      // A diagram is one indivisible hand-drawn figure — unlike a prose
      // sentence or an equation, there's no per-fragment visual counterpart
      // to reveal against (the pen draws the whole motif as a single
      // token; see renderers/agent-chalkboard/agent-diagram-token.js), so
      // splitting the caption into several spoken fragments would have
      // nothing distinct to sync each one's reveal to. Always one fragment,
      // same treatment multi-row equations get below.
      collapseToOne();
    } else if (block.type === 'equation') {
      if (isMultiRowEquation(sourceText)) {
        collapseToOne(); // multi-row derivations excluded from splitting entirely
      } else {
        const reconstructed = fragments.map((f) => f.boardText || '').join('');
        const safe = normalize(reconstructed) === normalize(sourceText)
          && fragments.every((f) => {
            const piece = f.boardText || '';
            return bracesBalanced(piece) && leftRightBalanced(piece) && !hasBareArgumentBoundary(piece);
          });
        if (!safe) {
          console.warn(
            `[narrator-agent] equation fragment split failed a safety check for block ${unit.blockId} — falling back to one fragment for this line.`,
            { sourceText, fragments }
          );
          collapseToOne();
        }
      }
    } else {
      const reconstructed = fragments.map((f) => f.boardText || '').join('');
      const midFormulaSplit = fragments.some((f) => dollarCount(f.boardText) % 2 !== 0);
      if (normalize(reconstructed) !== normalize(sourceText)) {
        console.warn(
          `[narrator-agent] fragment reconstruction mismatch for block ${unit.blockId}${unit.itemId ? `, item ${unit.itemId}` : ''} — falling back to one fragment for this line.`,
          { expected: sourceText, gotConcatenated: reconstructed, fragments }
        );
        collapseToOne();
      } else if (midFormulaSplit) {
        console.warn(
          `[narrator-agent] fragment split lands inside a $...$ math span for block ${unit.blockId}${unit.itemId ? `, item ${unit.itemId}` : ''} — falling back to one fragment for this line.`,
          { sourceText, fragments }
        );
        collapseToOne();
      }
    }

    target.narrationText = fragments.map((f) => f.spoken || '').join(' ').trim();
    if (fragments.length > 1) target.narrationFragments = fragments;
    else delete target.narrationFragments;
  });
  return true;
}

// Structured JSON output (Gemini responseSchema, same mechanism the Head
// Agent already relies on for its seminar plan — see lib/gemini-schema.js)
// replaced free-text blank-line splitting here: the old convention asked
// the model to separate paragraphs with "\n\n" and simply hoped the count
// matched the input line count, which a single-unit slide could still
// violate by phrasing its one narration as two paragraphs anyway. minItems/
// maxItems below is a hint, not a hard guarantee (Gemini's structured-output
// reliability on exact array length isn't ironclad) — the real guarantee is
// the explicit one-shot retry-with-correction in generateForSlide.
function narrationResponseSchema(count) {
  return {
    type: 'object',
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fragments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  spoken: { type: 'string' },
                  boardText: { type: 'string' },
                },
                required: ['spoken', 'boardText'],
              },
              minItems: 1,
              maxItems: 10,
            },
          },
          required: ['fragments'],
        },
        minItems: count,
        maxItems: count,
        description: `Exactly ${count} entries, one per input line, in the same order. Each entry is a "fragments" array of one or more (spoken, boardText) pairs — default toward MORE, SHORTER fragments (roughly every 4-8 spoken words / one clause), since hand-writing is slower than speech and a fragment left too long means the board visibly lags behind what's already been said. Use exactly one fragment only for a line that's genuinely a single short clause with nothing to split. For a standalone equation line, only split at safe top-level cut points (see the FRAGMENTS FOR EQUATIONS instructions) — never inside a brace group, \\frac/\\sqrt argument, subscript/superscript, or \\left...\\right pair, and never at all for a multi-row derivation.`,
      },
    },
    required: ['segments'],
  };
}

/**
 * @param {import('../lib/seminar-json-schema.js').Slide} slide
 * @param {{ apiKey: string, includeFillers?: boolean, signal?: AbortSignal }} opts
 * @returns {Promise<{ spokenText: string, segments: {fragments: {spoken:string, boardText:string}[]}[] }>}
 */
export async function generateForSlide(slide, { apiKey, includeFillers = true, signal } = {}) {
  if (!apiKey) throw new Error('Missing Gemini API key.');
  const content = serializeBoardContentForNarration(slide);
  if (!content) return { spokenText: '', segments: [] };

  const expectedCount = getNarrationUnits(slide).length;
  const fillerInstruction = includeFillers ? `\n\n${PEDAGOGICAL_FILLERS_INSTRUCTION}` : '';
  const baseSystemPrompt = `${CONVERSATIONAL_NARRATOR_PROMPT}${fillerInstruction}\n\n${SLIDE_NARRATION_INSTRUCTIONS}`;
  const responseSchema = narrationResponseSchema(expectedCount);

  async function requestSegments(systemPrompt) {
    const result = await generateStructured(apiKey, { systemPrompt, userContent: content, responseSchema }, { signal });
    return Array.isArray(result.segments) ? result.segments : [];
  }

  let segments;
  try {
    segments = await requestSegments(baseSystemPrompt);
    if (segments.length !== expectedCount) {
      // One retry with an explicit correction — mirrors generateStructured's
      // own malformed-JSON repair pattern, but for a structurally valid
      // response that still got the segment count wrong (usually merging
      // or splitting an input line instead of treating it as one unit).
      segments = await requestSegments(`${baseSystemPrompt}\n\nYour previous response had ${segments.length} segments, but exactly ${expectedCount} are required — one per input line, no merging or splitting. Try again.`);
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e instanceof LlmError) throw new Error(`Narrator Agent failed for slide "${slide.title}": ${e.message}`);
    throw e;
  }

  const spokenText = segments
    .map((entry) => (Array.isArray(entry?.fragments) ? entry.fragments.map((f) => f.spoken || '').join(' ').trim() : ''))
    .join('\n\n');
  return { spokenText, segments };
}
