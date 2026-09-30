// Thin adapter between handwriting-agent.js's existing, unmodified stroke
// engine (buildGlyphSegments, driven here by a transcript key the caller
// has already registered — a TikZ-parsed diagram block's own id, see
// renderers/agent-chalkboard/agent-chalkboard-renderer.js's addDiagramToken
// — instead of a single character or MathJax-derived equation glyph) and
// the progress-driven reveal contract (renderers/renderer-interface.js's
// setMathProgress) a real slide token needs — the exact same pattern
// agent-math-token.js already establishes for equations. Generic over
// what "motifKey" actually is — this file has no opinion on where the
// transcript came from, only that something already registered it.
import { buildGlyphSegments } from '../experimental-handwriting-agent/handwriting-agent.js?v=25';
import { buildProgressTimeline, setAgentProgress } from './progress-timeline.js?v=1';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Renders one diagram's ink into a freshly created <svg> appended inside
 * spanElement, and precomputes its progress timeline, cached as
 * spanElement._agentProgressTimeline — same caching convention
 * agent-math-token.js uses for equations.
 *
 * @param {string} motifKey - a transcript key already registered via
 *   registerGeneratedTranscript (handwriting-agent.js) by the caller — an
 *   unknown/unregistered key here just means buildGlyphSegments finds no
 *   transcript and this returns { svg: null }, the same degrade-gracefully
 *   shape renderMathLineAgent uses for unsupported content.
 * @param {HTMLElement} spanElement
 * @param {{ color?: string, strokeWidthScale?: number,
 *   targetBBox?: {x:number,y:number,width:number,height:number} }} [opts]
 * @returns {{ svg: SVGElement|null }}
 */
export function renderDiagramTokenAgent(motifKey, spanElement, opts = {}) {
  const { color, strokeWidthScale, targetBBox = { x: 0, y: 0, width: 220, height: 160 } } = opts;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'hw-diagram-agent');
  svg.setAttribute('viewBox', `${targetBBox.x} ${targetBBox.y} ${targetBBox.width} ${targetBBox.height}`);
  svg.setAttribute('width', Math.ceil(targetBBox.width) + 'px');
  svg.setAttribute('height', Math.ceil(targetBBox.height) + 'px');

  const segments = buildGlyphSegments(svg, motifKey, targetBBox, { color, strokeWidthScale });
  if (!segments) return { svg: null };

  spanElement.appendChild(svg);
  spanElement._agentSegments = segments;
  spanElement._agentProgressTimeline = buildProgressTimeline(spanElement);
  return { svg };
}

/**
 * Reveals spanElement's diagram up to `progress` (0..1), bidirectional —
 * identical contract to agent-math-token.js's setMathTokenProgress.
 */
export function setDiagramTokenProgress(spanElement, progress) {
  setAgentProgress(spanElement._agentProgressTimeline, progress);
}
