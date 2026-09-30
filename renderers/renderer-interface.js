// Documents the swappable-renderer contract. slide-deck-controller.js (Present
// mode) and slide-content-editor.js (editor live preview) both call only this
// interface — never chalkboard internals — so a future renderer (Beamer,
// interactive whiteboard) can be swapped in without touching the Head Agent
// or the Seminar JSON schema.
//
// A renderer module must export:
//
//   renderSlide(containerEl, slide, { mode }) -> RenderedSlideHandle
//     mode: 'animated' — full handwriting-stroke / symbol-by-symbol reveal
//           animation (used in Present mode).
//           'static'   — every block drawn immediately at full opacity, no
//           animation, no reveal gating (used for editor live preview, so a
//           keystroke doesn't replay the handwriting animation).
//
//   clearSlide(containerEl) -> void
//
// RenderedSlideHandle:
//   revealUpTo(step: number) -> void         — coarse: reveal all tokens belonging to blocks whose
//                                               revealSequence step <= given step (manual next/prev nav)
//   setTokenDrawn(tokenIndex, drawn) -> void — fine-grained: called directly by
//                                               orchestration/live-narration-controller.js as each
//                                               narration unit (block or bullet item) is revealed
//   setMathProgress(tokenIndex, progress) -> void — fine-grained symbol-by-symbol reveal within one
//                                               equation token; part of the general contract, not
//                                               currently called by live-narration-controller.js
//                                               (which reveals a whole unit at once, not fractionally)
//   reset() -> void                          — hide all tokens (animated mode only; no-op in static)
//   tokensForSync() -> {el, text, isMath, blockId, itemId}[]   — consumed by
//                                               orchestration/live-narration-controller.js
//
// OPTIONAL (renderers whose reveal animation runs at its own pace, e.g.
// renderers/agent-chalkboard/'s one-pen write queue, which deliberately
// lags the narration):
//   whenWritingIdle() -> Promise<void>       — resolves when all requested reveals have finished
//                                               animating. live-narration-controller.js awaits it
//                                               (optional-chained) after every unit reveal, before
//                                               sending the next unit's turn, so narration never gets
//                                               ahead of a still-mid-stroke board; the same wait after
//                                               the final unit is what lets slide-deck-controller.js's
//                                               auto-advance never wipe the board mid-stroke either.
//                                               Renderers with instant/CSS-clocked reveals simply omit it.

export const RENDER_MODES = Object.freeze({ ANIMATED: 'animated', STATIC: 'static' });
