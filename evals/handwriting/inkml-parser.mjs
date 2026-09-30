// Minimal InkML reader for MathWriting's file shape only (not a general
// InkML parser) — see https://github.com/google-research/google-research/
// tree/master/mathwriting and evals/README.md for provenance. Each file has
// flat <annotation type="...">...</annotation> tags and one <trace id="N">
// per stroke, each a comma/space-separated "x y t" point list.
import { readFileSync } from 'node:fs';

/** @returns {{ label: string, normalizedLabel: string, strokes: number[][][] }}
 * strokes[i] is one stroke's ordered [x, y, t] points. */
export function parseInkml(filePath) {
  const xml = readFileSync(filePath, 'utf8');

  const getAnnotation = (type) => {
    const re = new RegExp(`<annotation type="${type}">([^<]*)</annotation>`);
    const m = xml.match(re);
    return m ? m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') : '';
  };

  const strokes = [];
  const traceRe = /<trace id="\d+">([^<]*)<\/trace>/g;
  let m;
  while ((m = traceRe.exec(xml))) {
    const points = m[1].trim().split(',').filter(Boolean).map((triplet) => triplet.trim().split(/\s+/).map(Number));
    strokes.push(points);
  }

  return {
    label: getAnnotation('label'),
    normalizedLabel: getAnnotation('normalizedLabel'),
    strokes,
  };
}
