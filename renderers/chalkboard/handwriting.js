// Verbatim port of the handwriting rendering engine (old sidepanel.js:458-706):
// STROKE_MAP, wobble, waypointsToPath, defaultStrokes, renderHandwritingWord,
// setTokenDrawn. Decomposes the Kalam-Regular.ttf font into per-glyph SVG
// stroke paths animated with stroke-dasharray/stroke-dashoffset. Adapted only
// to accept `speed` as a parameter instead of reading a DOM slider directly,
// so this module has no dependency on any particular page layout.

let kalamFont = null;
let hwMaskCounter = 0;

export function loadKalamFont(fontUrl) {
  return new Promise((resolve) => {
    if (typeof opentype === 'undefined') { resolve(null); return; }
    opentype.load(fontUrl, (err, f) => {
      if (!err) kalamFont = f;
      else console.warn('Could not load Kalam font:', err);
      resolve(kalamFont);
    });
  });
}

export function isFontReady() {
  return !!kalamFont;
}

const STROKE_MAP = {
  // Lowercase
  'a': [[[0.85,0.15],[0.5,0.0],[0.1,0.25],[0.05,0.65],[0.3,1.0],[0.7,0.95],[0.9,0.6]], [[0.85,0.1],[0.88,0.55],[0.85,1.0]]],
  'b': [[[0.15,0.0],[0.12,0.5],[0.15,1.0]], [[0.15,0.4],[0.3,0.25],[0.7,0.25],[0.95,0.5],[0.85,0.85],[0.5,1.0],[0.15,0.9]]],
  'c': [[[0.9,0.15],[0.55,0.0],[0.15,0.25],[0.05,0.55],[0.15,0.85],[0.5,1.0],[0.85,0.9]]],
  'd': [[[0.85,0.0],[0.88,0.5],[0.85,1.0]], [[0.85,0.4],[0.6,0.2],[0.25,0.25],[0.05,0.55],[0.15,0.85],[0.5,1.0],[0.85,0.95]]],
  'e': [[[0.1,0.5],[0.9,0.45],[0.85,0.15],[0.5,0.0],[0.1,0.2],[0.05,0.6],[0.2,0.9],[0.6,1.0],[0.9,0.85]]],
  'f': [[[0.85,0.05],[0.6,0.0],[0.4,0.1],[0.35,0.5],[0.35,1.0]], [[0.15,0.35],[0.55,0.32],[0.85,0.35]]],
  'g': [[[0.85,0.1],[0.55,0.0],[0.15,0.15],[0.05,0.4],[0.2,0.65],[0.6,0.65],[0.9,0.45]], [[0.9,0.1],[0.88,0.5],[0.85,0.85],[0.6,1.0],[0.3,0.95]]],
  'h': [[[0.12,0.0],[0.15,0.5],[0.15,1.0]], [[0.15,0.4],[0.4,0.2],[0.7,0.25],[0.88,0.45],[0.85,0.75],[0.85,1.0]]],
  'i': [[[0.5,0.0],[0.52,0.08]], [[0.45,0.3],[0.48,0.65],[0.5,1.0]]],
  'j': [[[0.6,0.0],[0.62,0.08]], [[0.55,0.3],[0.58,0.65],[0.55,0.9],[0.35,1.0],[0.2,0.92]]],
  'k': [[[0.12,0.0],[0.15,0.5],[0.15,1.0]], [[0.8,0.2],[0.5,0.45],[0.2,0.55]], [[0.4,0.5],[0.65,0.75],[0.9,1.0]]],
  'l': [[[0.45,0.0],[0.48,0.5],[0.5,0.95],[0.55,1.0]]],
  'm': [[[0.05,1.0],[0.08,0.5],[0.05,0.2]], [[0.05,0.3],[0.2,0.15],[0.35,0.25],[0.42,0.5],[0.45,1.0]], [[0.45,0.3],[0.6,0.15],[0.78,0.25],[0.85,0.5],[0.9,1.0]]],
  'n': [[[0.1,1.0],[0.12,0.5],[0.1,0.2]], [[0.1,0.35],[0.35,0.15],[0.65,0.2],[0.85,0.4],[0.88,0.7],[0.85,1.0]]],
  'o': [[[0.5,0.0],[0.15,0.15],[0.05,0.5],[0.15,0.85],[0.5,1.0],[0.85,0.85],[0.95,0.5],[0.85,0.15],[0.5,0.0]]],
  'p': [[[0.15,0.2],[0.12,0.6],[0.15,1.0]], [[0.15,0.25],[0.4,0.1],[0.75,0.1],[0.95,0.35],[0.85,0.6],[0.5,0.7],[0.15,0.6]]],
  'q': [[[0.85,0.2],[0.55,0.05],[0.2,0.15],[0.05,0.4],[0.15,0.65],[0.5,0.7],[0.85,0.55]], [[0.85,0.2],[0.88,0.6],[0.85,1.0]]],
  'r': [[[0.15,1.0],[0.15,0.5],[0.12,0.2]], [[0.15,0.35],[0.35,0.15],[0.6,0.1],[0.85,0.2]]],
  's': [[[0.8,0.1],[0.5,0.0],[0.2,0.1],[0.1,0.25],[0.25,0.45],[0.7,0.55],[0.9,0.75],[0.75,0.95],[0.45,1.0],[0.15,0.9]]],
  't': [[[0.4,0.0],[0.42,0.35],[0.45,0.7],[0.5,0.95],[0.65,1.0]], [[0.15,0.25],[0.5,0.22],[0.8,0.25]]],
  'u': [[[0.1,0.2],[0.12,0.55],[0.2,0.85],[0.5,1.0],[0.75,0.85],[0.85,0.55]], [[0.85,0.2],[0.88,0.55],[0.85,1.0]]],
  'v': [[[0.1,0.2],[0.3,0.6],[0.5,1.0]], [[0.5,1.0],[0.7,0.6],[0.9,0.2]]],
  'w': [[[0.05,0.2],[0.15,0.6],[0.25,1.0]], [[0.25,1.0],[0.38,0.5],[0.5,0.25]], [[0.5,0.25],[0.62,0.6],[0.75,1.0]], [[0.75,1.0],[0.85,0.6],[0.95,0.2]]],
  'x': [[[0.1,0.2],[0.5,0.55],[0.9,1.0]], [[0.9,0.2],[0.5,0.55],[0.1,1.0]]],
  'y': [[[0.1,0.2],[0.3,0.55],[0.5,0.7]], [[0.9,0.2],[0.6,0.55],[0.4,0.85],[0.25,1.0],[0.15,0.95]]],
  'z': [[[0.1,0.2],[0.5,0.2],[0.9,0.2]], [[0.9,0.2],[0.5,0.6],[0.1,1.0]], [[0.1,1.0],[0.5,1.0],[0.9,1.0]]],

  // Uppercase
  'A': [[[0.0,1.0],[0.3,0.4],[0.5,0.0]], [[0.5,0.0],[0.7,0.4],[1.0,1.0]], [[0.2,0.6],[0.5,0.55],[0.8,0.6]]],
  'B': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,0.0],[0.5,0.0],[0.8,0.1],[0.9,0.25],[0.8,0.45],[0.5,0.5],[0.1,0.5]], [[0.1,0.5],[0.55,0.5],[0.85,0.6],[0.95,0.75],[0.85,0.92],[0.5,1.0],[0.1,1.0]]],
  'C': [[[0.9,0.15],[0.6,0.0],[0.25,0.05],[0.05,0.25],[0.0,0.5],[0.05,0.75],[0.25,0.95],[0.6,1.0],[0.9,0.85]]],
  'D': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,0.0],[0.5,0.0],[0.8,0.15],[0.95,0.5],[0.8,0.85],[0.5,1.0],[0.1,1.0]]],
  'E': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,0.0],[0.5,0.0],[0.9,0.0]], [[0.1,0.5],[0.45,0.5],[0.75,0.5]], [[0.1,1.0],[0.5,1.0],[0.9,1.0]]],
  'F': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,0.0],[0.5,0.0],[0.9,0.0]], [[0.1,0.45],[0.4,0.45],[0.7,0.45]]],
  'G': [[[0.9,0.15],[0.6,0.0],[0.25,0.05],[0.05,0.25],[0.0,0.5],[0.05,0.75],[0.25,0.95],[0.6,1.0],[0.9,0.85],[0.9,0.55]], [[0.55,0.55],[0.9,0.55]]],
  'H': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.9,0.0],[0.9,0.5],[0.9,1.0]], [[0.1,0.5],[0.5,0.48],[0.9,0.5]]],
  'I': [[[0.3,0.0],[0.5,0.0],[0.7,0.0]], [[0.5,0.0],[0.5,0.5],[0.5,1.0]], [[0.3,1.0],[0.5,1.0],[0.7,1.0]]],
  'J': [[[0.4,0.0],[0.6,0.0],[0.8,0.0]], [[0.7,0.0],[0.7,0.5],[0.65,0.85],[0.45,1.0],[0.2,0.9]]],
  'K': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.85,0.0],[0.5,0.35],[0.15,0.5]], [[0.35,0.45],[0.6,0.7],[0.9,1.0]]],
  'L': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,1.0],[0.5,1.0],[0.9,1.0]]],
  'M': [[[0.05,1.0],[0.05,0.5],[0.05,0.0]], [[0.05,0.0],[0.3,0.5],[0.5,0.85]], [[0.5,0.85],[0.7,0.5],[0.95,0.0]], [[0.95,0.0],[0.95,0.5],[0.95,1.0]]],
  'N': [[[0.1,1.0],[0.1,0.5],[0.1,0.0]], [[0.1,0.0],[0.5,0.5],[0.9,1.0]], [[0.9,1.0],[0.9,0.5],[0.9,0.0]]],
  'O': [[[0.5,0.0],[0.2,0.05],[0.05,0.25],[0.0,0.5],[0.05,0.75],[0.2,0.95],[0.5,1.0],[0.8,0.95],[0.95,0.75],[1.0,0.5],[0.95,0.25],[0.8,0.05],[0.5,0.0]]],
  'P': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,0.0],[0.5,0.0],[0.85,0.1],[0.95,0.25],[0.85,0.42],[0.5,0.5],[0.1,0.5]]],
  'Q': [[[0.5,0.0],[0.2,0.05],[0.05,0.25],[0.0,0.5],[0.05,0.75],[0.2,0.95],[0.5,1.0],[0.8,0.95],[0.95,0.75],[1.0,0.5],[0.95,0.25],[0.8,0.05],[0.5,0.0]], [[0.65,0.75],[0.85,0.95],[1.0,1.05]]],
  'R': [[[0.1,0.0],[0.1,0.5],[0.1,1.0]], [[0.1,0.0],[0.5,0.0],[0.85,0.1],[0.9,0.25],[0.8,0.42],[0.5,0.5],[0.1,0.5]], [[0.5,0.5],[0.7,0.7],[0.9,1.0]]],
  'S': [[[0.8,0.1],[0.55,0.0],[0.25,0.05],[0.1,0.2],[0.15,0.38],[0.4,0.48],[0.65,0.55],[0.85,0.7],[0.8,0.9],[0.55,1.0],[0.25,0.95],[0.1,0.85]]],
  'T': [[[0.05,0.0],[0.5,0.0],[0.95,0.0]], [[0.5,0.0],[0.5,0.5],[0.5,1.0]]],
  'U': [[[0.1,0.0],[0.1,0.4],[0.1,0.7],[0.25,0.92],[0.5,1.0],[0.75,0.92],[0.9,0.7],[0.9,0.4],[0.9,0.0]]],
  'V': [[[0.05,0.0],[0.3,0.5],[0.5,1.0]], [[0.5,1.0],[0.7,0.5],[0.95,0.0]]],
  'W': [[[0.0,0.0],[0.12,0.5],[0.25,1.0]], [[0.25,1.0],[0.38,0.45],[0.5,0.15]], [[0.5,0.15],[0.62,0.5],[0.75,1.0]], [[0.75,1.0],[0.88,0.5],[1.0,0.0]]],
  'X': [[[0.05,0.0],[0.5,0.5],[0.95,1.0]], [[0.95,0.0],[0.5,0.5],[0.05,1.0]]],
  'Y': [[[0.05,0.0],[0.3,0.3],[0.5,0.5]], [[0.95,0.0],[0.7,0.3],[0.5,0.5]], [[0.5,0.5],[0.5,0.75],[0.5,1.0]]],
  'Z': [[[0.1,0.0],[0.5,0.0],[0.9,0.0]], [[0.9,0.0],[0.5,0.5],[0.1,1.0]], [[0.1,1.0],[0.5,1.0],[0.9,1.0]]],

  // Punctuation
  '.': [[[0.4,0.85],[0.5,0.95],[0.6,0.85]]],
  ',': [[[0.5,0.8],[0.48,0.9],[0.4,1.05]]],
  '(': [[[0.7,0.0],[0.4,0.2],[0.25,0.5],[0.4,0.8],[0.7,1.0]]],
  ')': [[[0.3,0.0],[0.6,0.2],[0.75,0.5],[0.6,0.8],[0.3,1.0]]],
  "'": [[[0.5,0.0],[0.48,0.15]]],
  '-': [[[0.15,0.5],[0.5,0.48],[0.85,0.5]]],
};

function wobble(v, amount) { return v + (Math.random() - 0.5) * amount; }

function waypointsToPath(pts, bb) {
  const w = bb.x2 - bb.x1 || 1, h = bb.y2 - bb.y1 || 1;
  const jX = w * 0.02, jY = h * 0.02;
  const scaled = pts.map(([nx, ny]) => [
    bb.x1 + wobble(nx, 0.015) * w,
    bb.y1 + wobble(ny, 0.015) * h
  ]);
  if (scaled.length < 2) return '';
  let d = 'M' + scaled[0][0].toFixed(1) + ',' + scaled[0][1].toFixed(1);
  if (scaled.length === 2) {
    d += ' L' + scaled[1][0].toFixed(1) + ',' + scaled[1][1].toFixed(1);
  } else {
    for (let i = 0; i < scaled.length - 1; i++) {
      const p0 = scaled[Math.max(0, i - 1)];
      const p1 = scaled[i];
      const p2 = scaled[Math.min(scaled.length - 1, i + 1)];
      const p3 = scaled[Math.min(scaled.length - 1, i + 2)];
      const tension = 0.35;
      const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
      const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
      const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
      const cp2y = p2[1] - (p3[1] - p1[1]) * tension;
      d += ' C' + wobble(cp1x, jX).toFixed(1) + ',' + wobble(cp1y, jY).toFixed(1) +
           ' '  + wobble(cp2x, jX).toFixed(1) + ',' + wobble(cp2y, jY).toFixed(1) +
           ' '  + scaled[i+1][0].toFixed(1) + ',' + scaled[i+1][1].toFixed(1);
    }
  }
  return d;
}

function defaultStrokes(bb) {
  const w = bb.x2 - bb.x1, h = bb.y2 - bb.y1;
  return [
    'M' + bb.x1.toFixed(1) + ',' + (bb.y1 + h*0.1).toFixed(1) +
    ' Q' + (bb.x1 + w*0.5).toFixed(1) + ',' + (bb.y1 + h*0.5).toFixed(1) +
    ' '  + (bb.x1 + w*0.3).toFixed(1) + ',' + (bb.y2 - h*0.05).toFixed(1),
    'M' + (bb.x1 - w*0.05).toFixed(1) + ',' + (bb.y1 + h*0.45).toFixed(1) +
    ' Q' + (bb.x1 + w*0.5).toFixed(1) + ',' + (bb.y1 + h*0.4).toFixed(1) +
    ' '  + (bb.x2 + w*0.05).toFixed(1) + ',' + (bb.y1 + h*0.5).toFixed(1)
  ];
}

export function renderHandwritingWord(text, spanElement) {
  if (!kalamFont) return null;
  const FONT_SIZE = 38;
  const CHALK_COLOR = '#dff5e3';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'hw-word');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);

  let cursorX = 0;
  const baseY = FONT_SIZE * 0.85;
  const maskPathsList = [];

  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci];
    const glyph = kalamFont.charToGlyph(ch);
    const advW = (glyph.advanceWidth / kalamFont.unitsPerEm) * FONT_SIZE;
    if (ch === ' ' || ch === '\t') { cursorX += advW; continue; }

    const charPath = kalamFont.getPath(ch, cursorX, baseY, FONT_SIZE);
    const pathData = charPath.toPathData(3);
    const bb = charPath.getBoundingBox();
    const maskId = 'hwmk-' + (hwMaskCounter++);

    const strokeDefs = STROKE_MAP[ch];
    let maskPaths;
    if (strokeDefs) maskPaths = strokeDefs.map(pts => waypointsToPath(pts, bb));
    else maskPaths = defaultStrokes(bb);

    const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.setAttribute('id', maskId);
    const sw = Math.max(bb.y2 - bb.y1, bb.x2 - bb.x1) * 0.65;

    maskPaths.forEach(d => {
      if (!d) return;
      const mp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      mp.setAttribute('d', d);
      mp.setAttribute('fill', 'none');
      mp.setAttribute('stroke', 'white');
      mp.setAttribute('stroke-width', sw);
      mp.setAttribute('stroke-linecap', 'round');
      mp.setAttribute('stroke-linejoin', 'round');

      spanElement.appendChild(mp);
      let len; try { len = mp.getTotalLength(); } catch(e) { len = 200; }
      spanElement.removeChild(mp);

      mp.style.strokeDasharray = len;
      mp.style.strokeDashoffset = len;
      maskPathsList.push({ pathEl: mp, len });
      mask.appendChild(mp);
    });

    defs.appendChild(mask);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('mask', 'url(#' + maskId + ')');
    g.setAttribute('filter', 'url(#chalkTexture)');

    const glyphEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glyphEl.setAttribute('d', pathData);
    glyphEl.setAttribute('fill', CHALK_COLOR);
    glyphEl.setAttribute('opacity', '0.92');
    g.appendChild(glyphEl);
    svg.appendChild(g);

    cursorX += advW;
  }

  if (cursorX === 0) return null;
  const totalW = Math.ceil(cursorX + 4);
  const totalH = Math.ceil(FONT_SIZE * 1.3);
  svg.setAttribute('viewBox', '0 0 ' + totalW + ' ' + totalH);
  svg.setAttribute('width', totalW + 'px');
  svg.setAttribute('height', totalH + 'px');
  spanElement._hwMasks = maskPathsList;
  spanElement._hwAnimated = false;
  return svg;
}

/** @param {number} speed - playback speed multiplier (1 = normal); passed by the caller instead of read from a DOM slider. */
export function setTokenDrawn(el, drawn, speed = 1) {
    if (!el) return;
    if (drawn) {
        if (el._mathPaths) {
            el._mathPaths.forEach(p => p.classList.add('revealed'));
        }
        if (!el.classList.contains('drawn')) {
            el.classList.add('drawn');
            if (el._hwMasks && !el._hwAnimated) {
                el._hwAnimated = true;
                let strokeDelay = 0;
                el._hwMasks.forEach(({ pathEl, len }) => {
                    const dur = Math.min(220, Math.max(60, len * 1.1)) / speed;
                    setTimeout(() => {
                        if (!el._hwAnimated) return;
                        pathEl.style.transition = 'stroke-dashoffset ' + dur.toFixed(0) + 'ms ease-out';
                        void pathEl.getBoundingClientRect();
                        pathEl.style.strokeDashoffset = '0';
                    }, strokeDelay);
                    strokeDelay += dur * 0.35;
                });
            }
        }
    } else {
        if (el._mathPaths) {
            el._mathPaths.forEach(p => p.classList.remove('revealed'));
        }
        if (el.classList.contains('drawn')) {
            el.classList.remove('drawn');
            if (el._hwMasks) {
                el._hwAnimated = false;
                el._hwMasks.forEach(({ pathEl, len }) => {
                    pathEl.style.transition = 'none';
                    pathEl.style.strokeDashoffset = len;
                });
            }
        }
    }
}

/** Instantly shows a token at full opacity/reveal with no animation — used by 'static' render mode. */
export function setTokenDrawnInstant(el) {
    if (!el) return;
    el.classList.add('drawn');
    if (el._mathPaths) el._mathPaths.forEach(p => p.classList.add('revealed'));
    if (el._hwMasks) {
        el._hwAnimated = true;
        el._hwMasks.forEach(({ pathEl }) => {
            pathEl.style.transition = 'none';
            pathEl.style.strokeDashoffset = '0';
        });
    }
}
