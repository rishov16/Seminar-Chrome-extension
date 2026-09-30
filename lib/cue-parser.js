// Parses the [[...]] speaking-cue markers a user can insert into presentationNotes.
// Only [[pause:ms]] has a guaranteed literal audio effect (see lib/tts/*).
// [[emphasis]]/[[tone:...]] are visual + prompt-authoring intent, not TTS directives.
// [[cue:point-at-<blockId>]] is a presentation-engine pointer directive only.

const CUE_RE = /\[\[(\/?)(pause:(\d+)|emphasis|tone:(\w+)|cue:point-at-([\w-]+))\]\]/g;

/**
 * @returns {{ plainText: string, spans: Array<{type:string, start:number, end:number, value?:string}>, pauses: Array<{afterChar:number, ms:number}> }}
 */
export function parseCues(notesText) {
  const spans = [];
  const pauses = [];
  const openStack = []; // { type, value, plainStart }
  let plainText = '';
  let lastIndex = 0;
  let match;

  CUE_RE.lastIndex = 0;
  while ((match = CUE_RE.exec(notesText)) !== null) {
    plainText += notesText.slice(lastIndex, match.index);
    lastIndex = CUE_RE.lastIndex;

    const isClose = match[1] === '/';
    if (match[3] !== undefined) {
      // self-closing [[pause:ms]]
      pauses.push({ afterChar: plainText.length, ms: parseInt(match[3], 10) });
    } else if (match[5] !== undefined) {
      // self-closing [[cue:point-at-blockId]]
      spans.push({ type: 'point-at', start: plainText.length, end: plainText.length, value: match[5] });
    } else if (match[4] !== undefined && !isClose) {
      openStack.push({ type: 'tone', value: match[4], plainStart: plainText.length });
    } else if (match[2] === 'emphasis' && !isClose) {
      openStack.push({ type: 'emphasis', plainStart: plainText.length });
    } else if (isClose) {
      const open = openStack.pop();
      if (open) spans.push({ type: open.type, value: open.value, start: open.plainStart, end: plainText.length });
    }
  }
  plainText += notesText.slice(lastIndex);

  return { plainText, spans, pauses };
}

export const CUE_TOOLBAR_SNIPPETS = [
  { label: 'Pause', insert: '[[pause:500]]' },
  { label: 'Emphasis', insert: '[[emphasis]]…[[/emphasis]]' },
  { label: 'Encouraging tone', insert: '[[tone:encouraging]]…[[/tone]]' },
  { label: 'Point at block…', insertTemplate: (blockId) => `[[cue:point-at-${blockId}]]` },
];
