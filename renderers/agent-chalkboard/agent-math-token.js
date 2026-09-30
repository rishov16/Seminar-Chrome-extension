// Thin adapter between renderMathLineAgent (the existing, unmodified math
// pipeline in renderers/experimental-handwriting-agent/) and the
// progress-driven reveal contract (renderers/renderer-interface.js's
// setMathProgress) a real slide token needs. Precomputes the progress
// timeline once per render, caches it on the span, so repeated
// setMathProgress calls during narration don't rebuild it every tick.
import { renderMathLineAgent } from '../experimental-handwriting-agent/handwriting-agent.js?v=25';
import { buildProgressTimeline, setAgentProgress } from './progress-timeline.js?v=1';

/**
 * Renders one equation token's ink into spanElement and precomputes its
 * progress timeline, cached as spanElement._agentProgressTimeline.
 *
 * @param {string} latex - raw LaTeX (not yet wrapped)
 * @param {HTMLElement} spanElement
 * @param {{ color?: string, strokeWidthScale?: number }} [opts]
 * @returns {Promise<{ svg: SVGElement|null, unsupported: boolean, error?: boolean, errorMessage?: string }>}
 *   same return shape as renderMathLineAgent — callers that only care
 *   about the svg/unsupported/error fields don't need to change at all
 */
export async function renderMathTokenAgent(latex, spanElement, opts = {}) {
  const result = await renderMathLineAgent(latex, spanElement, opts);
  spanElement._agentProgressTimeline = result.svg ? buildProgressTimeline(spanElement) : null;
  return result;
}

/**
 * Reveals spanElement's equation up to `progress` (0..1), bidirectional.
 * A no-op if the token has no progress timeline (e.g. render failed, or
 * fell back to the unsupported/error path with nothing drawn).
 */
export function setMathTokenProgress(spanElement, progress) {
  setAgentProgress(spanElement._agentProgressTimeline, progress);
}
