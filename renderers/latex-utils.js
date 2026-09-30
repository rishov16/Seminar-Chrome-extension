// Shared LaTeX-wrapping logic for equation blocks, used by every renderer
// (renderers/chalkboard/chalkboard-renderer.js,
// renderers/clean-preview/slide-thumbnail-renderer.js) so they never drift
// out of sync with each other on how a slide's math actually gets typeset.

// The Head Agent's schema instructs it to return equation.latex with no
// surrounding delimiters, but LLM output is not fully reliable — strip any
// $...$, $$...$$, \(...\) or \[...\] wrapper it included anyway, so
// wrapEquationLatex() below never re-wraps into a doubled or mismatched
// delimiter pair (e.g. a redundant "$\gamma=a^Tb$" becoming
// "$$\gamma=a^Tb$$", or "\[\gamma=a^Tb\]" becoming "$\[\gamma=a^Tb\]$" —
// both unparseable, leaving the raw LaTeX source visible instead of typeset
// math).
export function normalizeLatex(latex) {
  let s = (latex || '').trim();
  s = s.replace(/^\$\$([\s\S]*)\$\$$/, '$1');
  s = s.replace(/^\$([\s\S]*)\$$/, '$1');
  s = s.replace(/^\\\[([\s\S]*)\\\]$/, '$1');
  s = s.replace(/^\\\(([\s\S]*)\\\)$/, '$1');
  return s.trim();
}

// Bare & and \\ are only valid LaTeX inside an alignment environment
// (align/aligned/gather/cases/matrix/...) — outside one, MathJax fails to
// parse the expression and leaves the raw LaTeX source visible. True ONLY
// for a multi-step derivation written with alignment syntax but no explicit
// \begin{...} of its own — i.e. specifically "does this need
// wrapEquationLatex's auto-wrap," false if it's already properly wrapped
// (nothing more to do). Exported (not just a local in wrapEquationLatex) so
// isMultiRowEquation below can build on it without re-deriving the same
// regex.
export function hasMultiRowAlignment(latexRaw) {
  const latex = normalizeLatex(latexRaw);
  return /(&|\\\\)/.test(latex)
    && !/\\begin\{(align|aligned|gather|gathered|array|cases|matrix|pmatrix|bmatrix|vmatrix|split)\b/.test(latex);
}

// Broader than hasMultiRowAlignment above, and answering a different
// question: is this equation a multi-row/aligned derivation AT ALL, wrapped
// or not — not just "does it still need wrapping." Used by
// agents/narrator-agent.js as the eligibility gate for narration-fragment
// splitting: ANY multi-row derivation (bare &/\\, or already inside an
// explicit \begin{aligned}/\begin{align}/...) is excluded from splitting
// entirely — safely splitting an aligned environment would need each piece
// re-wrapped in its own environment, harder, not attempted yet.
export function isMultiRowEquation(latexRaw) {
  const latex = normalizeLatex(latexRaw);
  return /(&|\\\\)/.test(latex);
}

// The Head Agent's own prompt calls an "equation" block "one displayed
// LaTeX expression" (agents/head-agent.js) — wrap in \[...\] (display math),
// not $...$ (inline). That mismatch used to break the exact case the Head
// Agent's "UNABRIDGED: ... if the source shows A = B = C = D, every
// intermediate equality must appear" instruction actively produces: a
// multi-step derivation written with alignment syntax (&, \\). Auto-wrap in
// \begin{aligned}...\end{aligned} when the content uses & or \\ without
// already being inside a recognized environment, so it parses correctly
// either way.
export function wrapEquationLatex(latexRaw) {
  const latex = normalizeLatex(latexRaw);
  const body = hasMultiRowAlignment(latexRaw) ? `\\begin{aligned}${latex}\\end{aligned}` : latex;
  return `\\[${body}\\]`;
}
