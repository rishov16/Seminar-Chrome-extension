// MathJax's typesetPromise() is not reentrant — calling it again before the
// previous call resolves corrupts/silently drops output. Every renderer in
// this project (renderers/chalkboard/chalkboard-renderer.js,
// renderers/clean-preview/slide-thumbnail-renderer.js) can be invoked many
// times in a tight loop (once per slide, rendering the Slides-tab sidebar)
// or concurrently (a live editor preview re-rendering while the sidebar
// also re-renders), so every call MUST route through this single shared
// queue rather than calling window.MathJax.typesetPromise directly.
let mathJaxQueue = Promise.resolve();

export function queueTypeset(elements) {
  if (!(window.MathJax && typeof window.MathJax.typesetPromise === 'function')) return Promise.resolve();
  const run = () => window.MathJax.typesetPromise(elements);
  mathJaxQueue = mathJaxQueue.then(run, run); // keep the queue alive even if a call rejects
  return mathJaxQueue;
}
