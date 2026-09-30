// SVG shape renderer for diagramSpec (box/arrow/line/label/highlight-region/
// custom-svg). Shared by Present mode and the diagram-form-editor's inline
// preview — one renderer, not two. Uses the same stroke-dasharray reveal
// technique already used for handwriting (renderers/chalkboard/handwriting.js).
import { RENDER_MODES } from '../renderer-interface.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function shapeCenter(shape) {
  if (shape.type === 'box') return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
  if (shape.type === 'label') return { x: shape.x, y: shape.y };
  return { x: 0, y: 0 };
}

function makeRevealable(pathEl, mode) {
  let len = 0;
  try { len = pathEl.getTotalLength(); } catch (e) { len = 0; }
  if (len > 0) {
    pathEl.style.strokeDasharray = len;
    pathEl.style.strokeDashoffset = mode === RENDER_MODES.STATIC ? 0 : len;
  }
  return len;
}

/**
 * @param {SVGSVGElement} svgEl - an <svg> overlay positioned over the board area
 * @param {import('../../lib/seminar-json-schema.js').DiagramSpec} diagramSpec
 * @param {{ mode?: 'animated'|'static', boardContainerEl?: HTMLElement }} opts
 */
export function renderDiagram(svgEl, diagramSpec, { mode = RENDER_MODES.ANIMATED, boardContainerEl } = {}) {
  svgEl.innerHTML = '';
  svgEl.setAttribute('viewBox', `0 0 ${diagramSpec.canvas.width} ${diagramSpec.canvas.height}`);

  const defs = el('defs');
  const marker = el('marker', { id: 'seminar-arrowhead', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'currentColor' }));
  defs.appendChild(marker);
  svgEl.appendChild(defs);

  const shapeById = new Map(diagramSpec.shapes.map((s) => [s.id, s]));
  const domById = new Map();

  diagramSpec.shapes.forEach((shape) => {
    let node;
    if (shape.type === 'box') {
      node = el('g');
      const rect = el('rect', { x: shape.x, y: shape.y, width: shape.w, height: shape.h, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, rx: 4 });
      node.appendChild(rect);
      makeRevealable(rect, mode);
      if (shape.label) {
        const label = el('text', { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: 'currentColor' });
        label.textContent = shape.label;
        node.appendChild(label);
      }
    } else if (shape.type === 'arrow') {
      const from = typeof shape.from === 'string' && shapeById.has(shape.from) ? shapeCenter(shapeById.get(shape.from)) : { x: shape.x1 ?? 0, y: shape.y1 ?? 0 };
      const to = typeof shape.to === 'string' && shapeById.has(shape.to) ? shapeCenter(shapeById.get(shape.to)) : { x: shape.x2 ?? 0, y: shape.y2 ?? 0 };
      node = el('path', {
        d: `M${from.x},${from.y} L${to.x},${to.y}`,
        stroke: 'currentColor', 'stroke-width': 2, fill: 'none',
        'marker-end': 'url(#seminar-arrowhead)',
        'stroke-dasharray': shape.style === 'dashed' ? '6,4' : undefined,
      });
      makeRevealable(node, mode);
    } else if (shape.type === 'line') {
      node = el('line', {
        x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2,
        stroke: 'currentColor', 'stroke-width': shape.style === 'underline' ? 3 : 2,
        'stroke-dasharray': shape.style === 'dashed' ? '6,4' : undefined,
      });
      makeRevealable(node, mode);
    } else if (shape.type === 'label') {
      node = el('text', { x: shape.x, y: shape.y, 'text-anchor': shape.anchor || 'start', fill: 'currentColor' });
      node.textContent = shape.text;
      node.style.opacity = mode === RENDER_MODES.STATIC ? 1 : 0;
      node.style.transition = 'opacity 0.4s ease-in';
    } else if (shape.type === 'highlight-region') {
      node = el('rect', { fill: 'currentColor', opacity: 0.15, rx: 4 });
      node.style.opacity = mode === RENDER_MODES.STATIC ? 0.15 : 0;
      node.style.transition = 'opacity 0.3s ease-in';
      if (boardContainerEl) {
        const targetEl = boardContainerEl.querySelector(`[data-block-id="${shape.targetBlockId}"]`) || document.getElementById(`token-${shape.targetBlockId}`);
        if (targetEl) {
          const tb = targetEl.getBoundingClientRect();
          const cb = boardContainerEl.getBoundingClientRect();
          const pad = shape.padding || 6;
          node.setAttribute('x', tb.left - cb.left - pad);
          node.setAttribute('y', tb.top - cb.top - pad);
          node.setAttribute('width', tb.width + pad * 2);
          node.setAttribute('height', tb.height + pad * 2);
        }
      }
    } else if (shape.type === 'custom-svg') {
      const wrapper = el('g');
      wrapper.innerHTML = shape.raw;
      node = wrapper;
    }

    if (node) { domById.set(shape.id, node); svgEl.appendChild(node); }
  });

  const revealByStep = new Map((diagramSpec.revealWithSteps || []).map((r) => [r.step, r.showShapeIds]));

  return {
    revealUpTo(step) {
      if (mode === RENDER_MODES.STATIC) return; // static mode shows everything immediately
      const visibleShapeIds = new Set();
      for (const [s, ids] of revealByStep.entries()) {
        if (s <= step) ids.forEach((id) => visibleShapeIds.add(id));
      }
      domById.forEach((node, id) => {
        const visible = visibleShapeIds.size === 0 || visibleShapeIds.has(id);
        const pathEl = node.tagName === 'g' ? node.querySelector('rect,path') : node;
        if (pathEl && pathEl.style.strokeDasharray) pathEl.style.strokeDashoffset = visible ? 0 : pathEl.style.strokeDasharray;
        if (node.tagName === 'text' || node.tagName === 'rect') node.style.opacity = visible ? (node.dataset.baseOpacity || 1) : 0;
      });
    },
  };
}

export function clearDiagram(svgEl) {
  svgEl.innerHTML = '';
}
