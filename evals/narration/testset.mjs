// Hand-picked slide fixtures for the narration eval (see ../README.md).
//
// Each fixture is the minimal Slide shape agents/narrator-agent.js actually
// reads (lib/seminar-json-schema.js's full Slide has more fields — order,
// revealSequence, diagramSpec, etc. — none of which
// serializeBoardContentForNarration/getNarrationUnits/applyNarrationSegments
// touch, so they're omitted here rather than faked).
//
// Chosen to exercise the specific edge cases
// agents/narrator-agent.js's own prompt call out as load-bearing: plain
// prose, an equation with transpose/subscript notation, a bullet list (one
// narration unit per item), a multi-row \begin{aligned} derivation (must
// never be fragment-split), bare set-builder braces that must render as
// escaped \{ \} on the board but be *spoken* naturally, a named-group
// abbreviation, and a norm/nabla-heavy line.

export const testSlides = [
  {
    slideId: 'test-prose-inner-product',
    title: 'Inner product of two vectors',
    boardContent: [
      {
        id: 'blk-1',
        type: 'prose',
        text: 'Consider a vector $a$ in $\\mathbb{R}^n$ and another vector $b$ in $\\mathbb{R}^n$. Their inner product is defined as $\\gamma = a^T b$.',
        narrationText: '',
      },
    ],
  },
  {
    slideId: 'test-equation-transpose-perp',
    title: 'Orthogonality condition',
    boardContent: [
      {
        id: 'blk-1',
        type: 'equation',
        latex: 'a^T a_\\perp = 0',
        narrationText: '',
      },
    ],
  },
  {
    slideId: 'test-bullet-axioms',
    title: 'Axioms of probability',
    boardContent: [
      {
        id: 'blk-1',
        type: 'prose',
        text: 'Consider an experiment with sample space $S$. For each event $E \\subseteq S$, we define a function $P(E)$ satisfying the following axioms:',
        narrationText: '',
      },
      {
        id: 'blk-2',
        type: 'bullet-list',
        items: [
          { id: 'item-1', text: '$0 \\le P(E) \\le 1$', narrationText: '' },
          { id: 'item-2', text: '$P(S) = 1$', narrationText: '' },
        ],
      },
    ],
  },
  {
    slideId: 'test-multirow-derivation',
    title: 'Expanding a quadratic form',
    boardContent: [
      {
        id: 'blk-1',
        type: 'equation',
        // Bare & / \\ row-alignment syntax with no explicit \begin{...} of
        // its own — the exact shape narrator-agent.js calls out as
        // needing auto-wrap on render and mandatory single-fragment
        // narration (never split a multi-row derivation).
        latex: '(a+b)^2 &= (a+b)(a+b) \\\\ &= a^2 + 2ab + b^2',
        narrationText: '',
      },
    ],
  },
  {
    slideId: 'test-set-builder-braces',
    title: 'Set-builder probability notation',
    boardContent: [
      {
        id: 'blk-1',
        type: 'prose',
        // Literal curly braces meant as notation must be escaped \{ \} in
        // boardText, but should
        // still be *spoken* as ordinary set-builder notation, not as
        // "backslash brace".
        text: 'The probability mass function satisfies $P\\{X = x\\} = \\frac{1}{n}$ for each $x$ in the sample space.',
        narrationText: '',
      },
    ],
  },
  {
    slideId: 'test-named-group-abbreviation',
    title: 'The special orthogonal group',
    boardContent: [
      {
        id: 'blk-1',
        type: 'prose',
        text: 'Let $SO(d)$ denote the special orthogonal group in dimension $d$. Every element of $SO(d)$ can be written as a product of rotations.',
        narrationText: '',
      },
    ],
  },
  {
    slideId: 'test-norm-nabla-calligraphic',
    title: 'Gradient norm bound',
    boardContent: [
      {
        id: 'blk-1',
        type: 'equation',
        latex: '\\|\\nabla f(x)\\|^2 \\le L \\cdot (f(x) - f^*)',
        narrationText: '',
      },
    ],
  },
  {
    slideId: 'test-diagram-caption',
    title: 'Contracting disk',
    boardContent: [
      {
        id: 'blk-1',
        type: 'diagram',
        caption: 'a disk with a smaller subdisk removed, the subdisk shrinking continuously to a single point',
        narrationText: '',
      },
    ],
  },
];
