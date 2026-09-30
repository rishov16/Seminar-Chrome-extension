// Gemini responseSchema (a JSON-Schema subset: objects/arrays/strings/enums/
// booleans/numbers, no oneOf/$ref) for the Head Agent's structured seminar plan.
// Per-block ids are assigned client-side after generation (see
// agents/head-agent.js) rather than trusted from the model, since Gemini JSON
// mode reliability on deeply-nested LaTeX-bearing output is an open risk
// (see plan §"Head Agent: Open risk").
//
// A 'diagram' block only carries a caption here — the model decides a
// figure belongs on this slide and describes what it shows, in plain
// English; it never produces geometry itself in this call. The actual
// hand-drawn figure (TikZ, parsed deterministically) is generated in a
// separate later step from the source screenshot
// (renderers/experimental-handwriting-agent/diagram-tikz-generator.js, called
// from editor/seminar-editor-controller.js's generateAllDiagramsUpfront) —
// this supersedes an earlier motifKey-based mechanism (pick from a small
// fixed bank of pre-authored figures) that proved unreliable at matching
// arbitrary source content.

export const SEMINAR_PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          learningObjective: { type: 'string' },
          boardContent: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['prose', 'equation', 'bullet-list', 'diagram'] },
                text: { type: 'string' },
                latex: { type: 'string' },
                caption: { type: 'string', description: 'only for type "diagram" — a short plain-English description of what the diagram shows, phrased as narration' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      level: { type: 'integer' },
                    },
                    required: ['text'],
                  },
                },
              },
              required: ['type'],
            },
          },
          revealOrder: {
            type: 'array',
            items: { type: 'integer' },
            description: 'boardContent indices in the order they should be revealed on the board',
          },
        },
        required: ['title', 'boardContent'],
      },
    },
  },
  required: ['title', 'slides'],
};
