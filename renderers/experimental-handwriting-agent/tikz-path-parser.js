// Parses a small, constrained subset of TikZ `\draw` path syntax into
// sampled (x,y) point arrays — NOT a general TikZ/LaTeX interpreter, and
// nothing here ever runs LaTeX/pdflatex/dvisvgm. TikZ is used purely as a
// structured, LLM-friendly INTERMEDIATE representation (see
// diagram-tikz-generator.js): the model writes TikZ because it's seen
// enormous amounts of exactly this kind of math-diagram TikZ in training
// data, we parse the handful of path primitives that matter for geometry,
// and everything downstream is the same deterministic
// sample-then-Catmull-Rom pipeline every other motif in this directory
// uses. Coordinates carry literal numbers in the source text — the model
// is never trusted to guess pixels directly — with a rich curve
// vocabulary (arbitrary cubic Beziers, arcs, circles, ellipses), not
// limited to closed-form sin/cos-expressible curves the way an earlier,
// since-removed parametric-formula experiment was.
//
// Supported per \draw statement, chained in any order:
//   (x,y)                          absolute coordinate
//   ++(dx,dy)                      relative coordinate (offset from current point)
//   (angle:radius)                 polar coordinate, relative to the origin
//   -- (x,y)                       straight line to a coordinate
//   -- cycle                       straight line back to the path's start
//   .. controls (c1) and (c2) .. (x,y)   cubic Bezier curve
//   to[out=deg,in=deg] (x,y)       Hobby-spline shorthand — approximated as a
//                                  cubic Bezier whose control points sit 1/3
//                                  of the chord length out along the given
//                                  tangent directions (TikZ's own default
//                                  "looseness=1" heuristic); either angle may
//                                  be omitted, defaulting to the straight-line
//                                  direction, so bare `to (x,y)` also works
//   arc (startAngle:endAngle:radius)          circular arc from the current point
//   arc (startAngle:endAngle:rx and ry)       elliptical arc from the current point
//   circle (radius)                a standalone circle centered at the current point
//   ellipse (rx and ry)            a standalone ellipse centered at the current point
// An optional `[...]` style-options block right after \draw is otherwise
// skipped entirely (only geometry is parsed, never color/line-width/arrow
// semantics) — with ONE exception: a bare `dashed` or `dotted` keyword in
// it is honored, by literally chopping the sampled stroke into shorter
// pieces with real gaps (splitIntoDashes below) rather than one continuous
// line, since there's no lower-level "line style" concept downstream of
// this file to carry a dasharray through on (see handwriting-agent.js:
// each stroke is just a plain point array with its own reveal timing). A
// `%comment` on its own line directly before a \draw is captured as that
// stroke's label, for traceability back to the model's own component
// naming, expressed the idiomatic TikZ way.
//
// \begin{scope}[shift={(dx,dy)}] ... \end{scope} wrapping a group of \draw
// statements is also tracked (nesting sums the offsets) — common in
// multi-panel figures (e.g. several sub-diagrams laid out side by side) —
// so every coordinate inside picks up the panel's shift; everything else in
// a scope's options (rotate, scale, colors, ...) is ignored, and content
// outside any \draw (\node text labels, \tikzset, \documentclass/\usepackage
// preamble, \begin{tikzpicture} itself) is simply never matched, not an
// error — this still isn't a general TikZ interpreter, so a full document
// can be pasted directly and only its \draw geometry (correctly shifted)
// is extracted from it.

const SEGMENT_STEPS = 24;
const LINE_STEPS = 6;

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && text[i + 1] === '-') { tokens.push({ type: '--' }); i += 2; continue; }
    if (c === '.' && text[i + 1] === '.') { tokens.push({ type: '..' }); i += 2; continue; }
    if (c === '+' && text[i + 1] === '+') { tokens.push({ type: '++' }); i += 2; continue; }
    if ('(),:'.includes(c)) { tokens.push({ type: c }); i++; continue; }
    if (c === '-' || /[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i + (c === '-' ? 1 : 0);
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      const raw = text.slice(i, j);
      if (raw === '-' || raw === '') { i++; continue; } // stray minus, not a number
      tokens.push({ type: 'number', value: parseFloat(raw) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
      tokens.push({ type: 'ident', value: text.slice(i, j) });
      i = j;
      continue;
    }
    i++; // lenient: skip anything unrecognized (units like "cm", stray punctuation)
  }
  return tokens;
}

function parsePath(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    if (!peek() || peek().type !== type) throw new Error(`expected "${type}", got ${peek() ? JSON.stringify(peek()) : 'end of path'}`);
    return next();
  };
  const expectIdent = (value) => {
    const t = expect('ident');
    if (t.value !== value) throw new Error(`expected "${value}", got "${t.value}"`);
  };

  let current = null;
  const commands = [];

  function parseNumber() { return expect('number').value; }

  function parseCoord() {
    if (peek() && peek().type === '++') {
      next();
      expect('(');
      const dx = parseNumber();
      expect(',');
      const dy = parseNumber();
      expect(')');
      if (!current) throw new Error('relative coordinate (++...) with no current point yet');
      return { x: current.x + dx, y: current.y + dy };
    }
    expect('(');
    const a = parseNumber();
    if (!peek() || (peek().type !== ',' && peek().type !== ':')) throw new Error('expected "," or ":" in coordinate');
    const sep = next().type;
    const b = parseNumber();
    expect(')');
    if (sep === ',') return { x: a, y: b };
    const rad = (a * Math.PI) / 180; // polar: (angle:radius), relative to the origin
    return { x: b * Math.cos(rad), y: b * Math.sin(rad) };
  }

  current = parseCoord();
  commands.push({ type: 'moveto', point: current });

  while (pos < tokens.length) {
    const t = peek();
    if (t.type === '--') {
      next();
      if (peek() && peek().type === 'ident' && peek().value === 'cycle') {
        next();
        commands.push({ type: 'closepath' });
        current = commands[0].point;
        continue;
      }
      const p = parseCoord();
      commands.push({ type: 'lineto', point: p });
      current = p;
      continue;
    }
    if (t.type === '..') {
      next();
      expectIdent('controls');
      const c1 = parseCoord();
      expectIdent('and');
      const c2 = parseCoord();
      expect('..');
      const p = parseCoord();
      commands.push({ type: 'curveto', c1, c2, point: p });
      current = p;
      continue;
    }
    if (t.type === 'ident' && t.value === 'to') {
      next();
      // The tokenizer already drops '[', ']', '=' as unrecognized
      // characters (see tokenize's lenient fallback), so `[out=90,in=90]`
      // has already reduced to the flat token run: ident("out") number ","
      // ident("in") number — read whichever of out/in are present, in
      // either order, before the destination coordinate.
      let outAngle = null;
      let inAngle = null;
      while (peek() && ((peek().type === 'ident' && (peek().value === 'out' || peek().value === 'in')) || peek().type === ',')) {
        if (peek().type === ',') { next(); continue; }
        const key = next().value;
        const val = parseNumber();
        if (key === 'out') outAngle = val; else inAngle = val;
      }
      const p = parseCoord();
      commands.push({ type: 'to', from: current, outAngle, inAngle, point: p });
      current = p;
      continue;
    }
    if (t.type === 'ident' && t.value === 'arc') {
      next();
      expect('(');
      const startAngle = parseNumber();
      expect(':');
      const endAngle = parseNumber();
      expect(':');
      const radius = parseNumber();
      let radiusY = radius;
      if (peek() && peek().type === 'ident' && peek().value === 'and') {
        next();
        radiusY = parseNumber();
      }
      expect(')');
      commands.push({ type: 'arc', from: current, startAngle, endAngle, radius, radiusY });
      const startRad = (startAngle * Math.PI) / 180;
      const centerX = current.x - radius * Math.cos(startRad);
      const centerY = current.y - radiusY * Math.sin(startRad);
      const endRad = (endAngle * Math.PI) / 180;
      current = { x: centerX + radius * Math.cos(endRad), y: centerY + radiusY * Math.sin(endRad) };
      continue;
    }
    if (t.type === 'ident' && t.value === 'circle') {
      next();
      expect('(');
      const radius = parseNumber();
      expect(')');
      commands.push({ type: 'circle', center: current, radius });
      continue;
    }
    if (t.type === 'ident' && t.value === 'ellipse') {
      next();
      expect('(');
      const rx = parseNumber();
      expectIdent('and');
      const ry = parseNumber();
      expect(')');
      commands.push({ type: 'ellipse', center: current, rx, ry });
      continue;
    }
    break; // lenient: stop on anything unrecognized rather than throwing
  }

  return commands;
}

function sampleLine(p0, p1, steps = LINE_STEPS) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
  }
  return pts;
}

function sampleCubicBezier(p0, c1, c2, p1, steps = SEGMENT_STEPS) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y;
    pts.push({ x, y });
  }
  return pts;
}

function sampleArc(fromPoint, startAngleDeg, endAngleDeg, radius, radiusY = radius, steps = SEGMENT_STEPS) {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const centerX = fromPoint.x - radius * Math.cos(startRad);
  const centerY = fromPoint.y - radiusY * Math.sin(startRad);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = ((startAngleDeg + (endAngleDeg - startAngleDeg) * t) * Math.PI) / 180;
    pts.push({ x: centerX + radius * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) });
  }
  return pts;
}

function sampleCircle(center, radius, steps = SEGMENT_STEPS) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    pts.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return pts;
}

function sampleEllipse(center, rx, ry, steps = SEGMENT_STEPS) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    pts.push({ x: center.x + rx * Math.cos(angle), y: center.y + ry * Math.sin(angle) });
  }
  return pts;
}

/** Appends samples to an in-progress stroke, skipping the duplicate joint point. */
function appendSampled(activePoints, newPoints) {
  newPoints.slice(1).forEach((p) => activePoints.push(p));
}

/**
 * Converts a parsed command list into one or more strokes (point arrays).
 * A `circle`/`ellipse` command always starts its OWN independent closed
 * stroke (matching real TikZ semantics — `(0,0) circle (1)` draws a
 * circle centered at (0,0), not a line to it), flushing whatever
 * line/curve path was accumulated so far first.
 */
function commandsToStrokes(commands) {
  const strokes = [];
  let activePoints = [];
  let pathStart = null;

  function flush() {
    if (activePoints.length >= 2) strokes.push(activePoints);
    activePoints = [];
  }

  commands.forEach((cmd) => {
    if (cmd.type === 'moveto') {
      flush();
      activePoints = [cmd.point];
      pathStart = cmd.point;
    } else if (cmd.type === 'lineto') {
      appendSampled(activePoints, sampleLine(activePoints[activePoints.length - 1], cmd.point));
    } else if (cmd.type === 'curveto') {
      appendSampled(activePoints, sampleCubicBezier(activePoints[activePoints.length - 1], cmd.c1, cmd.c2, cmd.point));
    } else if (cmd.type === 'to') {
      // No prescribed tangent works out to a straight line (bare `to`);
      // otherwise approximate TikZ's Hobby-spline `to[out=..,in=..]` as a
      // cubic Bezier with control points 1/3 of the chord length out along
      // each prescribed direction — TikZ's own default "looseness=1" shape,
      // close enough for a hand-drawn chalk rendering. TikZ defines `in`
      // the SAME way as `out`: both control points are placed by moving
      // from their OWN endpoint in the stated absolute direction — c2 is
      // NOT the direction of travel arriving at p1 (that would need the
      // angle negated); e.g. out=90,in=90 between two points at the same
      // height bulges the curve upward at BOTH ends, the two endpoints of
      // a lens/handle shape whose other half is out=270,in=270 (bulging
      // down) — get this backward and both halves twist into an S shape
      // instead of a closed lens.
      const p0 = activePoints[activePoints.length - 1];
      const p1 = cmd.point;
      const straightAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const outRad = cmd.outAngle != null ? (cmd.outAngle * Math.PI) / 180 : straightAngle;
      const inRad = cmd.inAngle != null ? (cmd.inAngle * Math.PI) / 180 : (straightAngle + Math.PI);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const c1 = { x: p0.x + (dist / 3) * Math.cos(outRad), y: p0.y + (dist / 3) * Math.sin(outRad) };
      const c2 = { x: p1.x + (dist / 3) * Math.cos(inRad), y: p1.y + (dist / 3) * Math.sin(inRad) };
      appendSampled(activePoints, sampleCubicBezier(p0, c1, c2, p1));
    } else if (cmd.type === 'arc') {
      appendSampled(activePoints, sampleArc(cmd.from, cmd.startAngle, cmd.endAngle, cmd.radius, cmd.radiusY));
    } else if (cmd.type === 'closepath') {
      if (pathStart) appendSampled(activePoints, sampleLine(activePoints[activePoints.length - 1], pathStart));
    } else if (cmd.type === 'circle') {
      flush();
      strokes.push(sampleCircle(cmd.center, cmd.radius));
    } else if (cmd.type === 'ellipse') {
      flush();
      strokes.push(sampleEllipse(cmd.center, cmd.rx, cmd.ry));
    }
  });
  flush();
  return strokes;
}

// Splits the leading `[...]` style-options block (if any) off a \draw
// statement's body, same as the old stripOptions did, but also reports
// whether it contains the bare `dashed`/`dotted` keyword — the ONE piece
// of style information this otherwise geometry-only parser acts on (see
// splitIntoDashes below for why: a hand-drawn dashed/dotted line needs a
// real gap in its geometry, there's no "line style" concept downstream of
// this file to hang a dasharray off of). Word-bounded so it doesn't
// false-positive on some other option that merely contains the substring.
function extractLineStyle(body) {
  const trimmed = body.trimStart();
  if (trimmed[0] !== '[') return { style: null, rest: trimmed };
  const closeIdx = trimmed.indexOf(']');
  if (closeIdx === -1) return { style: null, rest: trimmed };
  const optionsText = trimmed.slice(1, closeIdx);
  let style = null;
  if (/\bdotted\b/.test(optionsText)) style = 'dotted';
  else if (/\bdashed\b/.test(optionsText)) style = 'dashed';
  return { style, rest: trimmed.slice(closeIdx + 1) };
}

/**
 * Chops an already-sampled, continuous point array into shorter dash
 * segments with real gaps between them, by point count rather than
 * absolute distance — every sampled primitive (line/bezier/arc/circle/
 * ellipse) uses a fixed step count regardless of its size (SEGMENT_STEPS/
 * LINE_STEPS above), so a fixed dash/gap point-count already produces a
 * proportionally consistent-looking dash pattern per shape, with no need
 * to reason about arc length. Each returned chunk becomes its own
 * independent stroke — cheap and correct given every consumer downstream
 * (buildGlyphSegments et al.) already treats "one stroke" as just "one
 * point array with its own reveal timing," with no other meaning attached.
 */
function splitIntoDashes(points, dashLen, gapLen) {
  const chunks = [];
  let i = 0;
  while (i < points.length - 1) {
    const end = Math.min(i + dashLen, points.length - 1);
    if (end > i) chunks.push(points.slice(i, end + 1));
    i = end + gapLen;
  }
  return chunks;
}

/**
 * Finds every `\draw ... ;` statement in a block of TikZ source, along
 * with the nearest preceding `%comment` line (if any, on its own line
 * directly before that \draw) to use as a human-readable label, and the
 * total `\begin{scope}[shift={(dx,dy)}]` offset in effect at that point
 * (nested scopes sum) — a `\draw` inside one or more shifted scopes needs
 * that offset applied to every coordinate it produces, or a multi-panel
 * figure built from several scope+shift sub-pictures would render every
 * panel on top of the others at the origin instead of laid out apart.
 */
function extractDrawStatements(source) {
  const results = [];
  const eventRe = /\\begin\{scope\}(\[[^\]]*\])?|\\end\{scope\}|\\draw/g;
  const offsetStack = [{ x: 0, y: 0 }];
  let match;
  let searchFrom = 0;
  while ((match = eventRe.exec(source)) !== null) {
    if (match[0].startsWith('\\begin{scope}')) {
      const opts = match[1] || '';
      const shiftMatch = opts.match(/shift\s*=\s*\{?\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
      const top = offsetStack[offsetStack.length - 1];
      const dx = shiftMatch ? parseFloat(shiftMatch[1]) : 0;
      const dy = shiftMatch ? parseFloat(shiftMatch[2]) : 0;
      offsetStack.push({ x: top.x + dx, y: top.y + dy });
      continue;
    }
    if (match[0] === '\\end{scope}') {
      if (offsetStack.length > 1) offsetStack.pop();
      continue;
    }
    // \draw
    const start = match.index;
    const semiIdx = source.indexOf(';', start);
    if (semiIdx === -1) break;
    const body = source.slice(start + 5, semiIdx);
    const between = source.slice(searchFrom, start);
    const commentMatch = between.match(/%([^\n]*)\s*$/);
    const label = commentMatch ? commentMatch[1].trim() : null;
    results.push({ label, body, offset: offsetStack[offsetStack.length - 1] });
    searchFrom = semiIdx + 1;
    eventRe.lastIndex = semiIdx + 1;
  }
  return results;
}

/**
 * Splits a block of TikZ source into ordered, CUMULATIVE stages, one per
 * distinct `%comment` group of consecutive \draw statements — unlike
 * extractDrawStatements' per-statement "nearest immediately preceding
 * comment" (used there just to label individual strokes), this tracks a
 * PERSISTENT current comment across statements, so several \draw lines
 * under one `%comment` (a common pattern: one comment introducing several
 * strokes of the same logical part) land in the SAME stage rather than
 * each starting a new one. A run of \draw statements with no comment at
 * all groups together too (its own anonymous stage per contiguous run).
 * `\begin{scope}[shift=...]` is tracked the same way extractDrawStatements
 * does; each statement's already-resolved absolute offset is re-expressed
 * as its own small wrapper scope in the returned tikz, rather than trying
 * to reconstruct the original (possibly deeply nested) scope structure, so
 * every stage's tikz is independently, correctly re-parseable on its own.
 *
 * Used to give a directly-pasted diagram the same per-component,
 * speak-a-part-then-draw-it staging a Gemini-generated script gets from
 * explain-with-diagram-generator.js, instead of dumping the whole thing
 * into a single step with one generic narration line.
 *
 * @param {string} tikzSource
 * @returns {{ label: string|null, tikz: string }[]} one entry per stage,
 *   in order, each already cumulative (a strict textual superset of the
 *   one before) — empty if the source has no \draw statements at all.
 */
export function splitTikzIntoStages(tikzSource) {
  const eventRe = /\\begin\{scope\}(\[[^\]]*\])?|\\end\{scope\}|\\draw|%([^\n]*)/g;
  const offsetStack = [{ x: 0, y: 0 }];
  let currentLabel = null;
  const groups = []; // { label: string|null, statements: string[] }
  let match;
  while ((match = eventRe.exec(tikzSource)) !== null) {
    if (match[0].startsWith('\\begin{scope}')) {
      const opts = match[1] || '';
      const shiftMatch = opts.match(/shift\s*=\s*\{?\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
      const top = offsetStack[offsetStack.length - 1];
      const dx = shiftMatch ? parseFloat(shiftMatch[1]) : 0;
      const dy = shiftMatch ? parseFloat(shiftMatch[2]) : 0;
      offsetStack.push({ x: top.x + dx, y: top.y + dy });
      continue;
    }
    if (match[0] === '\\end{scope}') {
      if (offsetStack.length > 1) offsetStack.pop();
      continue;
    }
    if (match[0][0] === '%') {
      // Decorative divider lines (`% ---...`, `% ===...`, or blank) are
      // common right above AND below a real section header comment in
      // hand-authored TikZ — ignore ones with no actual word in them so
      // the trailing divider after a header doesn't overwrite it as the
      // label by the time the section's \draw statements are reached.
      const text = (match[2] || '').trim();
      if (/[A-Za-z0-9]/.test(text)) currentLabel = text;
      continue;
    }
    // \draw
    const start = match.index;
    const semiIdx = tikzSource.indexOf(';', start);
    if (semiIdx === -1) break;
    const statement = tikzSource.slice(start, semiIdx + 1);
    const offset = offsetStack[offsetStack.length - 1];
    const wrapped = (offset.x || offset.y)
      ? `\\begin{scope}[shift={(${offset.x},${offset.y})}]\n${statement}\n\\end{scope}`
      : statement;
    const last = groups[groups.length - 1];
    if (last && last.label === currentLabel) {
      last.statements.push(wrapped);
    } else {
      groups.push({ label: currentLabel, statements: [wrapped] });
    }
    eventRe.lastIndex = semiIdx + 1;
  }

  const stages = [];
  let cumulative = [];
  groups.forEach((g) => {
    cumulative = cumulative.concat(g.statements);
    stages.push({ label: g.label, tikz: cumulative.join('\n') });
  });
  return stages;
}

/**
 * Parses a block of TikZ source (one or more `\draw ...;` statements,
 * optionally preceded by `%label` comments — no `\begin{tikzpicture}`
 * wrapper expected) into named, sampled strokes.
 *
 * @param {string} tikzSource
 * @returns {{ strokes: { points: {x:number,y:number}[], label: string }[],
 *   errors: string[] }} a stroke per successfully-parsed sub-path;
 *   errors holds one message per \draw statement that failed to parse
 *   (that statement is simply dropped, not fatal to the rest).
 */
export function parseTikzToStrokes(tikzSource) {
  const statements = extractDrawStatements(tikzSource);
  const strokes = [];
  const errors = [];
  statements.forEach(({ label, body, offset }, idx) => {
    const fallbackLabel = label || `draw ${idx + 1}`;
    try {
      const { style, rest } = extractLineStyle(body);
      const tokens = tokenize(rest);
      const commands = parsePath(tokens);
      let sub = commandsToStrokes(commands);
      if (sub.length === 0) throw new Error('produced no drawable points');
      if (offset && (offset.x || offset.y)) {
        sub = sub.map((points) => points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })));
      }
      if (style === 'dashed') sub = sub.flatMap((points) => splitIntoDashes(points, 2, 2));
      else if (style === 'dotted') sub = sub.flatMap((points) => splitIntoDashes(points, 1, 2));
      sub.forEach((points, i) => {
        strokes.push({ points, label: sub.length > 1 ? `${fallbackLabel} (${i + 1})` : fallbackLabel });
      });
    } catch (e) {
      errors.push(`${fallbackLabel}: ${e.message}`);
    }
  });
  return { strokes, errors };
}

// idText can come from a %comment written by an LLM (untrusted), so it's
// escaped unconditionally rather than trusting every caller to remember to.
function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/**
 * Converts parseTikzToStrokes' output into the same transcript XML format
 * every hand-authored/generated motif in this directory uses, ready for
 * registerGeneratedTranscript (handwriting-agent.js). Shared by both
 * diagram-tikz-generator.js (Gemini-authored TikZ) and
 * agent-diagram-tikz-playground.html (directly pasted TikZ, no LLM
 * involved at all) so the point-scaling and XML-escaping logic exists in
 * exactly one place.
 *
 * @param {{ points: {x:number,y:number}[], label: string }[]} strokes
 * @param {string} label - the transcript's registration key (distinct
 *   from each individual stroke's own label)
 * @param {{ scale?: number }} [opts] - TikZ units -> native render units;
 *   buildGlyphSegments rescales into the actual target box itself, this
 *   only needs to be a reasonable non-tiny working scale, not exact.
 * @returns {string} full `<answer>...</answer>` transcript XML
 */
export function strokesToTranscriptXml(strokes, label, { scale = 60 } = {}) {
  const blocks = strokes.map(({ points, label: strokeLabel }, i) => {
    const nativePts = points.map((p) => [p.x * scale, -p.y * scale]); // TikZ is y-up; SVG/screen is y-down.
    const pointsStr = nativePts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const tValues = nativePts.map((_, j) => (j / (nativePts.length - 1)).toFixed(3)).join(' ');
    const n = i + 1;
    return `<s${n}><points>${pointsStr}</points><t_values>${tValues}</t_values><id>${escapeXml(strokeLabel)}</id></s${n}>`;
  });
  return `<answer><char label="${label}"><strokes>${blocks.join('')}</strokes></char></answer>`;
}
