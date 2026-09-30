// Reproduces the exact stroke geometry our production renderer draws for a
// character, so this eval compares against what actually ships — not a
// re-derived approximation of it.
//
// This is a deliberate PORT, not an import, of
// renderers/experimental-handwriting-agent/handwriting-agent.js's
// parseTranscript/catmullRom/resampleStroke: that file can't be loaded
// under plain Node (parseTranscript itself uses browser-only DOMParser, and
// its sibling imports — mathjax-queue.js, mathjax-layout.js — touch
// document/MathJax globals that don't exist here). The XML shape being
// parsed is simple and fixed (see handwriting-agent-transcripts.js), so
// parseTranscript's DOMParser+querySelectorAll is replaced with plain regex
// below; catmullRom/resampleStroke are copied verbatim (pure math, no DOM)
// since those directly determine the on-screen ink shape and must not drift
// from production. If the production spline/resample logic ever changes,
// re-sync this file by hand — there is no way to import it directly.
import { TRANSCRIPTS, CHAR_ALIASES } from '../../renderers/experimental-handwriting-agent/handwriting-agent-transcripts.js';

function canonicalChar(char) {
  return Object.prototype.hasOwnProperty.call(CHAR_ALIASES, char) ? CHAR_ALIASES[char] : char;
}

/** Regex port of handwriting-agent.js's parseTranscript — same XML shape,
 * no DOMParser. Returns { strokes: [{pts:[[x,y,t],...]}], bbox }. */
function parseTranscript(char, transcript) {
  const answerMatch = transcript.match(/<answer>[\s\S]*<\/answer>/);
  if (!answerMatch) throw new Error(`[glyph-geometry] transcript for ${JSON.stringify(char)} has no <answer> block`);
  const answer = answerMatch[0];

  const strokes = [];
  const strokeRe = /<s\d+>([\s\S]*?)<\/s\d+>/gi;
  let strokeMatch;
  while ((strokeMatch = strokeRe.exec(answer))) {
    const strokeXml = strokeMatch[1];
    const pointsMatch = strokeXml.match(/<points>([\s\S]*?)<\/points>/i);
    const tMatch = strokeXml.match(/<t_values>([\s\S]*?)<\/t_values>/i);
    const pointsText = pointsMatch ? pointsMatch[1] : '';
    const tText = tMatch ? tMatch[1] : '';
    const xy = pointsText.trim().split(/\s+/).filter(Boolean).map((pair) => pair.split(',').map(Number));
    const ts = tText.trim().split(/\s+/).filter(Boolean).map(Number);
    if (xy.length < 2 || xy.length !== ts.length) {
      throw new Error(`[glyph-geometry] malformed stroke in ${JSON.stringify(char)}: ${xy.length} points vs ${ts.length} t_values`);
    }
    strokes.push({ pts: xy.map(([x, y], i) => [x, y, ts[i]]) });
  }
  if (!strokes.length) throw new Error(`[glyph-geometry] no strokes in transcript for ${JSON.stringify(char)}`);

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  strokes.forEach(({ pts }) => pts.forEach(([x, y]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }));
  return { strokes, bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

// --- Verbatim from handwriting-agent.js (catmullRom + resampleStroke) ---

function catmullRom(p0, p1, p2, p3, u) {
  const alpha = 0.5;
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-6;
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const t = t1 + u * (t2 - t1);
  const lerp = (pa, pb, ta, tb) => {
    const w = (t - ta) / (tb - ta || 1e-6);
    return [pa[0] + (pb[0] - pa[0]) * w, pa[1] + (pb[1] - pa[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function resampleStroke(pts) {
  const samples = [];
  if (pts.length === 2) {
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const w = i / n;
      samples.push({
        x: pts[0][0] + (pts[1][0] - pts[0][0]) * w,
        y: pts[0][1] + (pts[1][1] - pts[0][1]) * w,
        t: pts[0][2] + (pts[1][2] - pts[0][2]) * w,
      });
    }
  } else {
    const per = 6;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < per; k++) {
        const u = k / per;
        const [x, y] = catmullRom(p0, p1, p2, p3, u);
        samples.push({ x, y, t: p1[2] + (p2[2] - p1[2]) * u });
      }
    }
    const last = pts[pts.length - 1];
    samples.push({ x: last[0], y: last[1], t: last[2] });
  }
  return samples;
}

/** Our own rendered ink for one character, as an ordered array of (x,y)
 * points — every stroke's resampled samples concatenated in draw order
 * (matches agent-chalkboard's one-shared-pen draw order).
 * Returns null if this character has no transcript in the bank. */
export function getOurGlyphPoints(char) {
  const key = canonicalChar(char);
  const transcript = TRANSCRIPTS[key];
  if (!transcript) return null;
  const { strokes } = parseTranscript(key, transcript);
  const points = [];
  strokes.forEach(({ pts }) => resampleStroke(pts).forEach((s) => points.push([s.x, s.y])));
  return points;
}
