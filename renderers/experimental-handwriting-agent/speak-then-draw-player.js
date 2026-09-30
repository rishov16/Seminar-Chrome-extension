// Reusable "speak, then draw" sequencer — narrates each step's text via
// real Gemini Live audio (same model/voice/verbatim system prompt as
// orchestration/live-narration-controller.js), waits for playback to
// actually finish (not just generation — see speak() below), then draws
// that step's content (a TikZ diagram component or a LaTeX equation) via
// the same stroke engine every other board element uses, waits for the
// drawing to finish, then moves to the next step.
//
// Factored out of an earlier standalone demo (originally a
// single hand-authored height-and-distance script) once a second demo
// needed the exact same
// orchestration driven by a DIFFERENT, LLM-generated step script instead —
// extracting this avoids two independently-maintained copies of the
// Gemini-Live-session/board-rendering logic drifting apart. Neither page
// needed any change to its actual rendering behavior; this is the same
// code, moved.
//
// A step is { phase: 'speak'|'diagram'|'equation', narration: string,
//   tikz?: string (required for phase:'diagram'),
//   latex?: string (required for phase:'equation'),
//   label?: string (transcript registration key for a diagram step —
//   generated if omitted) }.
import { registerGeneratedTranscript, buildGlyphSegments, startAgentWriting, computeStrokeTiming } from './handwriting-agent.js?v=25';
import { parseTikzToStrokes, strokesToTranscriptXml } from './tikz-path-parser.js?v=1';
import { renderMathTokenAgent } from '../agent-chalkboard/agent-math-token.js';
import { connectLiveSession } from '../../lib/live-narration/gemini-live-client.js';
import { createLivePcmPlayer } from '../../lib/live-narration/live-audio-player.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Exactly what orchestration/live-narration-controller.js uses in
// production — same model, voice, and verbatim system prompt — so "speak,
// then draw" here is driven by the real narration path, not a stand-in.
// See that file's own header comment for why this specific
// systemInstruction wording matters (measured at perfect verbatim
// fidelity during development).
const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
const LIVE_VOICE_NAME = 'Charon';
const LIVE_SYSTEM_INSTRUCTION = 'You narrate one piece of text per request. Speak the given text aloud, exactly as written, verbatim — no additions, no paraphrasing, no omissions.';

/**
 * @param {{ boardEl: HTMLElement, stepListEl: HTMLElement,
 *   captionBar: HTMLElement, apiKeyInput: HTMLInputElement,
 *   muteCheck: HTMLInputElement, speedRange: HTMLInputElement,
 *   setStatus?: (text: string, kind?: string) => void,
 *   diagramTarget?: {x:number,y:number,width:number,height:number} }} opts
 *   The caller owns playBtn/pauseBtn enable-state around play()/pause() —
 *   this module only touches boardEl/stepListEl/captionBar, so it makes
 *   no assumption about what buttons (if any) a given page uses.
 * @returns {{ setSteps: (steps: object[]) => void, play: () => Promise<void>,
 *   pause: () => void, replay: () => void }}
 */
export function createSpeakThenDrawPlayer({
  boardEl, stepListEl, captionBar, apiKeyInput, muteCheck, speedRange,
  setStatus = () => {}, diagramTarget = { x: 0, y: 0, width: 260, height: 190 },
}) {
  let STEPS = [];
  let cancelled = false;
  let resumeIndex = 0;

  // One Gemini Live session + audio player, opened lazily on first speak()
  // and reused across every step's turn (exactly how
  // orchestration/live-narration-controller.js reuses one session across a
  // whole slide's units) — systemInstruction/generationConfig are fixed
  // for a session's lifetime (gemini-live-client.js), so reconnecting per
  // step would be both wasteful and pointless.
  let liveSession = null;
  let livePlayer = null;
  const turnCompletions = []; // resolvers, popped one-per-onTurnComplete — same queue shape live-narration-controller.js uses

  function setSteps(steps) {
    STEPS = steps || [];
    resumeIndex = 0;
    groupSvgs = new Map();
    groupRevealedCounts = new Map();
    // Partition 'diagram' steps into FIGURE groups. By
    // explain-with-diagram-generator.js's cumulative-superset prompt rule,
    // a 'diagram' step that continues the SAME figure repeats every earlier
    // step's \draw statements verbatim (in order) and appends its own new
    // one(s) at the end — so checking whether a step's tikz starts with the
    // previous diagram step's tikz (in the same group) tells us whether
    // it's a further stage of that figure or the start of a brand-new,
    // separate one. This is a self-verifying check on the actual tikz text,
    // not a label the model has to get right — a step whose tikz does NOT
    // continue the current group always starts a fresh group, even if nothing
    // upstream explicitly said "new figure". Each group's LAST step's tikz is
    // its most-complete/final tikz (same reasoning the old single-figure
    // code used) — drawDiagramStep below builds that group's on-board svg
    // from THIS ONCE (stable auto-fit) and, per step, reveals only the
    // strokes newly introduced since that step's own previous stage.
    diagramStepGroup = new Map();
    diagramGroupFinalTikz = [];
    let lastGroupTikz = null;
    let currentGroup = -1;
    STEPS.forEach((step) => {
      if (step.phase !== 'diagram') return;
      const tikz = step.tikz || '';
      const continuesGroup = currentGroup >= 0 && lastGroupTikz && tikz.trim().startsWith(lastGroupTikz.trim());
      if (!continuesGroup) currentGroup++;
      diagramStepGroup.set(step, currentGroup);
      diagramGroupFinalTikz[currentGroup] = tikz;
      lastGroupTikz = tikz;
    });
    stepListEl.innerHTML = '';
    STEPS.forEach((step, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      const phaseEl = document.createElement('div');
      phaseEl.className = 'step-phase';
      phaseEl.textContent = step.phase;
      const textEl = document.createElement('div');
      textEl.textContent = step.narration;
      li.appendChild(phaseEl);
      li.appendChild(textEl);
      stepListEl.appendChild(li);
    });
    boardEl.innerHTML = '';
    captionBar.textContent = 'Press Play to begin.';
    captionBar.classList.remove('speaking');
  }

  function markStepState(index, state) {
    const li = stepListEl.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    li.classList.remove('current', 'done');
    if (state) li.classList.add(state);
  }

  // Accumulates the CURRENT turn's server-pushed transcript, reset at the
  // start of each speak() call — used to detect a turn that ended with
  // noticeably less spoken than was asked for (see speak() below). Same
  // delta-vs-cumulative self-detection orchestration/live-narration-controller.js
  // uses (that file's own comment: observed as deltas, not a documented
  // guarantee, so check per-message rather than assume).
  let accumulatedTranscript = '';

  function normalizeWords(text) {
    return (text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  }

  async function ensureLiveSession(apiKey) {
    if (liveSession) return liveSession;
    livePlayer = createLivePcmPlayer();
    liveSession = await connectLiveSession({
      apiKey,
      model: LIVE_MODEL,
      systemInstruction: LIVE_SYSTEM_INSTRUCTION,
      generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME } } } },
      onAudioChunk: (base64) => livePlayer.enqueue(base64),
      onOutputTranscript: (chunk) => {
        accumulatedTranscript = (accumulatedTranscript === '' || chunk.startsWith(accumulatedTranscript))
          ? chunk
          : accumulatedTranscript + chunk;
      },
      onTurnComplete: () => { turnCompletions.shift()?.(); },
      onError: (err) => console.error('[speak-then-draw-player] Gemini Live error:', err.message),
    });
    return liveSession;
  }

  function closeLiveSession() {
    liveSession?.close();
    liveSession = null;
    livePlayer?.stop();
    livePlayer = null;
    turnCompletions.length = 0;
  }

  // "Finished speaking" means the audio has actually finished PLAYING
  // (livePlayer.whenDrained()), not just that generation completed
  // (onTurnComplete) — Gemini Live streams audio faster than real time, so
  // those are genuinely different moments; using only onTurnComplete here
  // would start drawing before the user has actually heard the narration,
  // exactly the race this whole player exists to avoid. Falls back to a
  // reading-time estimate (~2.5 words/sec, a deliberately unhurried
  // lecture pace) when muted, no API key is set, or the Live call itself
  // fails — covers headless/automated verification and keeps the demo
  // usable without a key.
  async function speak(text, { allowRetry = true } = {}) {
    const estimateMs = Math.max(600, (text.split(/\s+/).length / 2.5) * 1000);
    const apiKey = apiKeyInput.value.trim();
    if (muteCheck.checked || !apiKey) {
      await new Promise((resolve) => setTimeout(resolve, estimateMs));
      return;
    }
    try {
      await ensureLiveSession(apiKey);
      accumulatedTranscript = ''; // reset — this turn's own transcript only
      setStatus('Speaking (Gemini Live)…');
      liveSession.sendTurn(`Speak the following verbatim, exactly as written:\n\n${text}`);
      await new Promise((resolve) => turnCompletions.push(resolve));
      await livePlayer.whenDrained();

      // Detects a turn that ended with noticeably less spoken than was
      // asked for — a real failure mode reported live (words audibly cut
      // off mid-narration) that isn't a client-side playback-timing bug
      // (whenDrained above already waits for every enqueued chunk to
      // finish playing, confirmed directly against a controlled test) —
      // this looks like Gemini Live's own generation ending a turn early
      // for a specific utterance. There's no way to prevent that from the
      // client, but the server's own outputAudioTranscription tells us
      // exactly when it happened, so retry once with the same text rather
      // than silently moving on with a half-spoken sentence.
      const expectedWordCount = normalizeWords(text).length;
      const heardWordCount = normalizeWords(accumulatedTranscript).length;
      if (allowRetry && expectedWordCount > 0 && heardWordCount < expectedWordCount * 0.7) {
        console.warn(`[speak-then-draw-player] narration sounded cut short (heard ~${heardWordCount}/${expectedWordCount} words) — retrying once: "${text}"`);
        setStatus('Narration sounded cut short — retrying…');
        await speak(text, { allowRetry: false });
      }
    } catch (e) {
      console.error('[speak-then-draw-player] Gemini Live narration failed, falling back to timing only:', e);
      setStatus(`Gemini Live failed (${e.message}) — falling back to timing-only for this step.`);
      closeLiveSession(); // don't keep retrying a broken/stale connection for later steps
      await new Promise((resolve) => setTimeout(resolve, estimateMs));
    }
  }

  function makeToken(className, viewBoxW, viewBoxH) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', `0 0 ${viewBoxW} ${viewBoxH}`);
    svg.setAttribute('width', viewBoxW + 'px');
    svg.setAttribute('height', viewBoxH + 'px');
    return svg;
  }

  // Waits for a stroke-animation to visually finish using the exact same
  // timing function the engine itself uses internally (computeStrokeTiming)
  // — not a guessed delay — so this genuinely waits for the ink to finish,
  // whatever the current speed setting is.
  function waitForWriting(spanOrSvg, speed) {
    const total = computeStrokeTiming(spanOrSvg._agentSegments, speed).total;
    startAgentWriting(spanOrSvg, speed);
    return new Promise((resolve) => setTimeout(resolve, total + 80));
  }

  let anonLabelCounter = 0;

  // A script can contain more than one FIGURE — e.g. "first consider this
  // circle... now separately, this triangle" — not just multiple stages of
  // one cumulative figure. diagramStepGroup/diagramGroupFinalTikz (built
  // once in setSteps, see there for the grouping rule) partition 'diagram'
  // steps into groups; groupSvgs/groupRevealedCounts then track ONE
  // persistent on-board token PER GROUP (not one shared token for the
  // whole script), so separate figures render as separate tokens laid out
  // side by side on the board, while stages of the SAME figure still grow
  // incrementally in place without re-animating already-drawn strokes.
  let diagramStepGroup = new Map(); // step object -> group index
  let diagramGroupFinalTikz = []; // group index -> that group's most-complete tikz
  let groupSvgs = new Map(); // group index -> on-board svg token
  let groupRevealedCounts = new Map(); // group index -> strokes already revealed

  // Reveals only strokes[fromIndex, toIndex) of spanElement._agentSegments
  // — everything outside that range is left exactly as it is (already
  // visible strokes stay visible with no re-animation; not-yet-reached
  // strokes stay hidden). This is startAgentWriting's own reveal algorithm
  // (handwriting-agent.js), narrowed to a slice instead of resetting and
  // replaying every segment — handwriting-agent.js itself is never
  // modified (see this project's established convention), so this is a
  // small, self-contained adaptation living here instead, built only from
  // its already-exported computeStrokeTiming.
  function startAgentWritingRange(spanElement, fromIndex, toIndex, speed) {
    const allStrokes = spanElement._agentSegments;
    if (!allStrokes || !allStrokes.length) return Promise.resolve();
    const rangeStrokes = allStrokes.slice(fromIndex, toIndex);
    if (rangeStrokes.length === 0) return Promise.resolve();

    if (spanElement._agentRafId) cancelAnimationFrame(spanElement._agentRafId);
    rangeStrokes.forEach((segs) => segs.forEach(({ el }) => { el.style.transition = 'none'; el.style.opacity = '0'; }));

    const { durations, starts } = computeStrokeTiming(rangeStrokes, speed);

    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now) => {
        const elapsed = now - t0;
        let done = true;
        rangeStrokes.forEach((segs, si) => {
          const local = (elapsed - starts[si]) / durations[si];
          if (local < 1) done = false;
          segs.forEach(({ el, t }) => {
            if (local >= t) {
              if (el.dataset.hwFade) el.style.transition = 'opacity 200ms ease-in';
              el.style.opacity = '1';
            }
          });
        });
        if (!done) { spanElement._agentRafId = requestAnimationFrame(tick); }
        else { spanElement._agentRafId = null; resolve(); }
      };
      spanElement._agentRafId = requestAnimationFrame(tick);
    });
  }

  async function drawDiagramStep(step, speed) {
    const groupIndex = diagramStepGroup.get(step);
    // Lazily build the ONE persistent svg for THIS FIGURE (group), from
    // the group's FINAL/most-complete step's tikz — not this step's own
    // (likely partial) content — so buildGlyphSegments' auto-fit is
    // computed once, from the complete figure, and never recomputed (and
    // never shifts already-drawn strokes) as more components get revealed.
    // A different group gets its own separate token appended to the board,
    // so two unrelated figures never share one svg/bounding box.
    let svg = groupSvgs.get(groupIndex);
    if (!svg) {
      const finalTikz = diagramGroupFinalTikz[groupIndex];
      const { strokes: finalStrokes, errors: finalErrors } = parseTikzToStrokes(finalTikz);
      if (finalErrors.length) console.warn('[speak-then-draw-player] TikZ parse errors:', finalErrors);
      if (finalStrokes.length === 0) {
        const fallback = document.createElement('div');
        fallback.textContent = step.narration;
        boardEl.appendChild(fallback);
        return;
      }
      const label = step.label || `diagram:anon-${anonLabelCounter++}`;
      const xml = strokesToTranscriptXml(finalStrokes, label, {});
      registerGeneratedTranscript(label, xml);
      svg = makeToken('hw-diagram-agent', diagramTarget.width, diagramTarget.height);
      boardEl.appendChild(svg);
      const segments = buildGlyphSegments(svg, label, diagramTarget, { color: '#dff5e3', strokeWidthScale: 1 });
      if (!segments) return;
      segments.forEach((segs) => segs.forEach(({ el }) => { el.style.opacity = '0'; })); // nothing revealed yet — steps reveal incrementally below
      svg._agentSegments = segments;
      groupSvgs.set(groupIndex, svg);
      groupRevealedCounts.set(groupIndex, 0);
    }

    // This step's OWN tikz is only used to count how many of its group's
    // strokes should be visible by the end of it (the cumulative-superset
    // rule makes that count directly comparable to the final svg's own
    // stroke order) — its geometry itself is never re-parsed into new
    // elements.
    const { strokes: stepStrokes } = parseTikzToStrokes(step.tikz);
    const targetCount = stepStrokes.length;
    const revealedCount = groupRevealedCounts.get(groupIndex) || 0;
    if (targetCount <= revealedCount) {
      console.warn('[speak-then-draw-player] diagram step introduced no new strokes relative to the previous step in its figure — check the generated tikz follows the cumulative-superset rule.');
      return;
    }
    await startAgentWritingRange(svg, revealedCount, targetCount, speed);
    groupRevealedCounts.set(groupIndex, targetCount);
  }

  async function drawEquationStep(step, speed) {
    const span = document.createElement('span');
    boardEl.appendChild(span);
    const result = await renderMathTokenAgent(step.latex, span, {});
    if (!result.svg) {
      span.textContent = step.latex;
      return;
    }
    // renderMathTokenAgent builds the SVG but does NOT append it — the
    // caller does (confirmed by reading agent-chalkboard-renderer.js's own
    // renderEquationInto, which does `span.appendChild(result.svg)`
    // itself).
    span.appendChild(result.svg);
    await waitForWriting(span, speed);
  }

  async function playFrom(startIndex) {
    cancelled = false;
    for (let i = startIndex; i < STEPS.length; i++) {
      if (cancelled) return i;
      const step = STEPS[i];
      markStepState(i, 'current');
      stepListEl.querySelector(`li[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
      captionBar.textContent = step.narration;
      captionBar.classList.add('speaking');
      setStatus(`Step ${i + 1}/${STEPS.length} — speaking…`);

      await speak(step.narration);
      if (cancelled) { markStepState(i, null); return i; }
      captionBar.classList.remove('speaking');

      const speed = Number(speedRange.value);
      if (step.phase === 'diagram') {
        setStatus(`Step ${i + 1}/${STEPS.length} — drawing…`);
        await drawDiagramStep(step, speed);
      } else if (step.phase === 'equation') {
        setStatus(`Step ${i + 1}/${STEPS.length} — writing…`);
        await drawEquationStep(step, speed);
      }
      markStepState(i, 'done');
    }
    setStatus('Done — every step spoken, then drawn, in order.', 'ok');
    return STEPS.length;
  }

  async function play() {
    resumeIndex = await playFrom(resumeIndex);
  }

  function pause() {
    // Stops the sequence before its NEXT step — a currently in-flight
    // speak()/draw() await still runs to completion first. This doesn't
    // replicate live-narration-controller.js's full pause-gating
    // (player.pause() + a resume gate mid-turn); scope here is the
    // speak-then-draw ordering, not production-grade pause responsiveness.
    cancelled = true;
    setStatus('Paused (finishing the current step first).');
  }

  function replay() {
    cancelled = true;
    closeLiveSession(); // force a fresh connection on next Play, not a stale/half-used one
    boardEl.innerHTML = '';
    groupSvgs = new Map(); // boardEl.innerHTML = '' already detached them, but drop the stale references too
    groupRevealedCounts = new Map();
    stepListEl.querySelectorAll('li').forEach((li) => li.classList.remove('current', 'done'));
    captionBar.textContent = 'Press Play to begin.';
    captionBar.classList.remove('speaking');
    resumeIndex = 0;
    setStatus('');
  }

  return { setSteps, play, pause, replay };
}
