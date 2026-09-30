// Drives renderers/agent-chalkboard/agent-chalkboard-renderer.js's existing
// RenderedSlideHandle contract (tokensForSync/setTokenDrawn) from Gemini
// Live's audio stream — the production version of a validated experimental
// spike. Replaces lib/sync-engine.js's character-weight
// reveal heuristic (and the Web Speech/Sarvam TTS engines) entirely.
//
// TWO reveal-timing mechanisms, chosen per unit, not one uniform rule:
//
// PROSE/BULLET units (agents/narrator-agent.js's getNarrationUnits, one per
// prose/equation block or bullet-list item): ONE TURN PER UNIT, sending the
// unit's whole narrationText in one natural, uninterrupted turn — for
// fluency. This used to be one turn per FRAGMENT instead (a unit with
// narrationFragments got several small, separately-generated turns) —
// reverted after real use showed each fragment-turn got its own turn-
// initial/turn-final prosody and real round-trip latency, so a natural
// sentence delivered as 3-4 separate turns didn't flow like one sentence,
// and (worse) the short, grammatically-incomplete fragment text sometimes
// confused the model into repeating itself. Fragment-level reveal
// granularity is instead achieved via Gemini Live's server-PUSHED
// outputAudioTranscription stream (gemini-live-client.js's
// onOutputTranscript), matching the accumulating transcript text against
// each fragment's own `spoken` text, word-count-wise — no model action
// required (unlike a tool call, confirmed in GEMINI_LIVE_NARRATION.md to
// end a turn's generation outright), so a whole unit can be spoken as one
// continuous turn while the client still gets sub-turn reveal timing.
// Empirically verified safe for ordinary prose before this was relied on,
// not assumed: a standalone timing test found
// audio consistently already scheduled AHEAD of where a transcript-
// confirmed fragment boundary expects it to be (20/20 samples).
//
// EQUATION units with more than one fragment: back to ONE TURN PER
// FRAGMENT, deliberately NOT the transcript-matching approach above. Real
// production use (not a hypothetical) showed transcript-matching, only
// ever validated against ordinary prose phrasing, doesn't reliably fire in
// time for a long, technical mathematical utterance — narrated terminology
// ("Laplacian," "gradient," Greek letter names) and multi-clause phrasing
// apparently diverges from the scripted wording, or updates too slowly,
// often enough that fragments ended up revealed only once the WHOLE turn
// completed (the very "long silent wait" this whole feature exists to
// avoid). This isn't a cost for equations the way it was for prose:
// equation fragments are already short, clause-like phrases with natural
// pauses between them (a professor writes "the gradient of p," pauses,
// writes the next term) rather than one flowing sentence that needs
// uninterrupted delivery — confirmed sounding and looking right in a
// standalone experiment before
// being relied on here.
//
// A unit's LAST fragment is deliberately never transcript-confirmed (the
// prose/bullet path) — it always falls through to the turnComplete
// fallback below. Cheap, and it defuses two real failure modes: word-count
// overshoot from the model inserting filler words ("now,", "so,")
// inflating the transcript's word count relative to the script, and the
// most narratively jarring outcome (a unit's final clause popping onto the
// board early). The majority of units (which have no narrationFragments at
// all, i.e. one implicit fragment — the unit's entire text) never engage
// either fragment mechanism: this is a strict no-op for the common case,
// unchanged from "reveal once at the end of the turn."
//
// Three fixes carried over from the original investigation, unchanged in
// substance, now applied per confirmed-fragment rather than per tool call —
// shared by BOTH mechanisms above via the same paintUnit/scheduleReveal:
//   1. The visual reveal is gated on live-audio-player.js's own playback
//      clock (getScheduledEndTime/scheduleAt) at the MOMENT a fragment is
//      confirmed (by transcript match, or by the end-of-turn fallback) —
//      never fired immediately, since Gemini Live can generate audio
//      faster than real time.
//   2. Any fragment not confirmed via transcript matching by the time the
//      turn completes is force-revealed then — the turn's real script was
//      fully sent as its content, so narration is done regardless of
//      whether every fragment boundary was individually detected.
//   3. The next unit's turn isn't sent until whenWritingIdle() resolves AND
//      this unit's last fragment's gated reveal has actually fired
//      (awaiting its revealedPromise first) — otherwise whenWritingIdle()
//      can report "idle" before a still-pending gated reveal has enqueued
//      anything, letting consecutive units' audio overlap the pen.
import { getNarrationUnits } from '../agents/narrator-agent.js';
import { connectLiveSession } from '../lib/live-narration/gemini-live-client.js';
import { createLivePcmPlayer } from '../lib/live-narration/live-audio-player.js';
import { createMicCapture } from '../lib/live-narration/mic-capture.js';

// Re-verify this is still current before relying on it — Live preview
// model names/availability shifted at least once during this project's
// own research.
const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';

// Without an explicit voiceConfig, the Live API picks its own default per
// session — since a new session is opened per slide (see run() below), that
// made the narrator's voice audibly change from slide to slide. Pinning one
// keeps it consistent across the whole seminar. One of ~30 prebuilt voices
// (ai.google.dev/gemini-api/docs/speech-generation#voices); "Charon" is
// labeled "Informative", a reasonable fit for lecture narration.
const LIVE_VOICE_NAME = 'Charon';

// Matches the old Web Speech dead-reckoning estimate (lib/tts/web-speech-tts.js,
// since removed) — cosmetic only. sidepanel.html's #progressBar is
// `disabled` (display-only; no seeking is actually wired up in the UI), so
// unlike that engine's unused seekToTime(), nothing here needs to support
// seeking — this estimate only feeds the progress bar's width/time-display text.
const CHARS_PER_SECOND_ESTIMATE = 14;

// Grounding context for the ask-a-question feature (see createQuestionSystemInstruction
// below) — plain-text join of the current slide's own board content, deliberately
// NOT run through agents/narrator-agent.js's narration pipeline (that module
// converts notation to spoken prose for verbatim narration; this is just
// reference text for a differently-scoped Q&A prompt, a separate concept
// despite the similar-sounding purpose).
function serializeBoardContentForQuestion(slide) {
  return (slide.boardContent || [])
    .map((block) => {
      if (block.type === 'bullet-list') return (block.items || []).map((it) => it.text).join('\n');
      return block.type === 'equation' ? (block.latex || '') : (block.text || '');
    })
    .filter(Boolean)
    .join('\n');
}

function createQuestionSystemInstruction(slide) {
  return `You are a helpful assistant answering a student's spoken question during a math seminar. The student is currently looking at this board content:\n\n${serializeBoardContentForQuestion(slide)}\n\nAnswer their question directly and concisely, using this content as your primary reference.`;
}

function unitKey(blockId, itemId) { return `${blockId}:${itemId || ''}`; }

// Same normalization on both the known fragment `spoken` text (to compute
// thresholds) and the live transcript (to compute confirmed-so-far) is
// what makes word-count matching self-consistent even though this isn't a
// "real" tokenizer — e.g. a hyphen becomes a word boundary on both sides
// equally, so "n-dimensional" always counts as 2 words whether the
// transcript renders it with or without the hyphen.
function normalizeWords(text) {
  return (text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * @param {{ rendererHandle: import('../renderers/renderer-interface.js').RenderedSlideHandle,
 *   slide: import('../lib/seminar-json-schema.js').Slide,
 *   apiKey: string, model?: string,
 *   onStepChange?: (step: number) => void,
 *   onTimeUpdate?: (cur: number, total: number) => void,
 *   onEnded?: () => void }} opts
 * @returns {Promise<{ play: () => void, pause: () => void, stop: () => void, paused: boolean,
 *   startQuestion: () => Promise<void>, stopQuestion: () => Promise<void> }>}
 */
export async function createLiveNarrationController({
  rendererHandle, slide, apiKey, model = DEFAULT_MODEL, onStepChange, onTimeUpdate, onEnded,
}) {
  const player = createLivePcmPlayer();
  const tokens = rendererHandle.tokensForSync();
  const stepByUnit = new Map((slide.revealSequence || []).map((r) => [unitKey(r.targetBlockId, r.targetItemId), r.step]));

  // Most units are one implicit fragment (their whole narrationText) — a
  // unit's own narrationFragments (see agents/narrator-agent.js) only
  // exists when there's more than one. `thresholds[i]` is the cumulative
  // confirmed-word count at which fragment i is considered spoken (used by
  // the prose/bullet transcript-matching path only); `thresholds`
  // intentionally has no entry used for the LAST fragment (see header
  // comment) — the matching loop below excludes it explicitly.
  const units = getNarrationUnits(slide).map((unit) => {
    const block = slide.boardContent.find((b) => b.id === unit.blockId);
    const target = unit.itemId ? block.items.find((it) => it.id === unit.itemId) : block;
    const fragments = Array.isArray(target.narrationFragments) && target.narrationFragments.length > 1
      ? target.narrationFragments.map((f) => ({ spoken: f.spoken || '' }))
      : [{ spoken: target.narrationText || '' }];
    let cumulative = 0;
    const thresholds = fragments.map((f) => { cumulative += normalizeWords(f.spoken).length; return cumulative; });
    return {
      blockId: unit.blockId, itemId: unit.itemId, fragments, thresholds, fullText: fragments.map((f) => f.spoken).join(' ').trim(),
      // See header comment — equations use guaranteed one-turn-per-fragment
      // instead of transcript-matching, which wasn't reliably firing in
      // time for real equation narration.
      usePerFragmentTurns: block.type === 'equation' && fragments.length > 1,
    };
  });
  const unitsByKey = new Map(units.map((u) => [unitKey(u.blockId, u.itemId), u]));

  const perUnit = new Map(units.map((u) => {
    const fragmentStates = u.fragments.map(() => {
      let resolveRevealed;
      const revealedPromise = new Promise((resolve) => { resolveRevealed = resolve; });
      return { revealed: false, resolveRevealed, revealedPromise };
    });
    return [unitKey(u.blockId, u.itemId), { fragmentStates }];
  }));
  const pendingReveals = new Set(); // cancel functions for scheduled-but-not-yet-fired visual reveals
  let lastStep = 0;

  function paintUnit(blockId, itemId, fragmentIndex) {
    const key = unitKey(blockId, itemId);
    const entry = perUnit.get(key);
    const state = entry?.fragmentStates[fragmentIndex];
    if (state) { if (state.revealed) return; state.revealed = true; }
    tokens.forEach((t, i) => {
      if (t.blockId === blockId && (t.itemId || null) === (itemId || null) && (t.fragmentIndex || 0) === fragmentIndex) {
        rendererHandle.setTokenDrawn(i, true);
      }
    });
    if (fragmentIndex === 0) {
      const step = stepByUnit.get(key) ?? lastStep;
      if (step !== lastStep) { lastStep = step; onStepChange?.(step); }
    }
    state?.resolveRevealed();
  }

  // Schedules fragmentIndex's reveal at whatever audio-clock position is
  // current right now (fix #1 above) — called either from transcript
  // matching (mid-turn) or the turnComplete fallback (end-of-turn).
  function scheduleReveal(blockId, itemId, fragmentIndex) {
    const targetTime = player.getScheduledEndTime();
    const cancel = player.scheduleAt(targetTime, () => { pendingReveals.delete(cancel); paintUnit(blockId, itemId, fragmentIndex); });
    pendingReveals.add(cancel);
  }

  // Transcript-matching state for whichever unit's turn is currently in
  // flight — reset per unit in run() below.
  let currentUnitKey = null;
  let accumulatedTranscript = '';
  let confirmedFragmentCount = 0;

  function onOutputTranscript(chunk) {
    if (!currentUnitKey) return;
    // Self-detecting delta-vs-cumulative: Phase A observed this model send
    // deltas (see GEMINI_LIVE_TRANSCRIPT_SYNC.md), but that's an observed
    // behavior, not a documented guarantee — checking per-message instead
    // of hard-coding one assumption costs one substring check.
    accumulatedTranscript = (accumulatedTranscript === '' || chunk.startsWith(accumulatedTranscript))
      ? chunk
      : accumulatedTranscript + chunk;

    const unit = unitsByKey.get(currentUnitKey);
    if (!unit) return;
    const words = normalizeWords(accumulatedTranscript);
    // Drop the last (possibly-partial) token unless the buffer ends in
    // whitespace/punctuation — avoids confirming a fragment on a word
    // that's still mid-transcription.
    const endsClean = /[\s.,;:!?]$/.test(accumulatedTranscript);
    const confirmedWordCount = endsClean ? words.length : Math.max(0, words.length - 1);

    // A `while`, not `if` — a single transcript chunk can plausibly cross
    // more than one short fragment's threshold at once. Never confirms the
    // LAST fragment (see header comment) — that's what `- 1` excludes.
    while (confirmedFragmentCount < unit.fragments.length - 1 && confirmedWordCount >= unit.thresholds[confirmedFragmentCount]) {
      scheduleReveal(unit.blockId, unit.itemId, confirmedFragmentCount);
      confirmedFragmentCount++;
    }
  }

  let session;
  let stopped = false;
  let paused = false;
  const turnCompletions = [];
  const notifyTurnComplete = () => turnCompletions.forEach((r) => r());

  // Pause gate: run()'s loop awaits this before sending each unit's turn,
  // so a paused session doesn't request/receive the next unit's audio
  // until resumed. Coarser now (once per unit, not once per fragment) —
  // confirmed not a pause-responsiveness regression: player.pause() calls
  // ctx.suspend(), which freezes already-playing audio immediately and
  // independently of this gate; resumeGate only ever governed *requesting*
  // the next turn, never the currently-playing one.
  let resumeGate = Promise.resolve();
  let resolveResumeGate = null;

  // Elapsed-time bookkeeping for onTimeUpdate — pausable, real wall-clock,
  // cosmetic only (see CHARS_PER_SECOND_ESTIMATE note above).
  const estimatedTotal = units.reduce((sum, u) => sum + u.fullText.length, 0) / CHARS_PER_SECOND_ESTIMATE;
  let elapsedMs = 0;
  let lastResumeAt = Date.now();
  let elapsedTimer = null;
  function startElapsedTimer() {
    lastResumeAt = Date.now();
    elapsedTimer = setInterval(() => onTimeUpdate?.((elapsedMs + (Date.now() - lastResumeAt)) / 1000, estimatedTotal), 200);
  }
  function stopElapsedTimerAccumulate() {
    if (!elapsedTimer) return;
    elapsedMs += Date.now() - lastResumeAt;
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  // Shared by the returned play()/pause() methods AND startQuestion/
  // stopQuestion below — asking a question pauses the scripted session
  // exactly the same way a manual pause does (freezes player.pause(), holds
  // run()'s loop via resumeGate before its next unit's turn), it's just
  // triggered by the mic button instead of the pause button.
  function pauseScripted() {
    if (paused || stopped) return;
    paused = true;
    player.pause();
    stopElapsedTimerAccumulate();
    resumeGate = new Promise((resolve) => { resolveResumeGate = resolve; });
  }
  function resumeScripted() {
    if (!paused) return;
    paused = false;
    player.resume();
    startElapsedTimer();
    resolveResumeGate?.();
  }

  // Ask-a-question state: a second, short-lived Gemini Live session +
  // player + mic capture, entirely separate from the scripted session
  // above — deliberately not a mode switch on the same session, since
  // systemInstruction is fixed for a session's lifetime (see
  // gemini-live-client.js) and the scripted narrator's own systemInstruction
  // is a hard verbatim-only constraint that a Q&A-answering prompt must not
  // share or dilute. Never more than one of these is active at a time.
  let qnaSession = null;
  let qnaPlayer = null;
  let qnaMic = null;
  let qnaTurnCompletePromise = null;
  let resolveQnaTurnComplete = null;
  let qnaActive = false;        // an exchange is in progress (button press → scripted resume)
  let qnaStopRequested = false; // button released before we were ready to answer (a click, or slow connect)
  let qnaEnding = false;        // guards endQuestionExchange against double-entry

  // Single teardown+resume path, always reached exactly once per exchange.
  // `answered: true` means the user held long enough to actually speak — send
  // the end-of-turn signal and wait for the spoken answer before resuming.
  // `answered: false` aborts without waiting (connect/mic failure, or a press
  // too brief to be a real question — waiting on those would just stall).
  async function endQuestionExchange({ answered }) {
    if (qnaEnding) return;
    qnaEnding = true;
    try {
      if (qnaMic) { qnaMic.stop(); qnaMic = null; }
      if (answered && qnaSession) {
        qnaSession.sendAudioStreamEnd();
        await qnaTurnCompletePromise;
        if (qnaPlayer) await qnaPlayer.whenDrained();
      }
    } catch (err) {
      console.error('[live-narration-controller:qna] end failed', err.message);
    } finally {
      qnaSession?.close();
      qnaSession = null;
      qnaPlayer?.stop();
      qnaPlayer = null;
      qnaTurnCompletePromise = null;
      resolveQnaTurnComplete = null;
      qnaActive = false;
      qnaEnding = false;
      if (!stopped) resumeScripted();
    }
  }

  async function startQuestion() {
    if (stopped || qnaActive) return;
    qnaActive = true;
    qnaStopRequested = false;
    pauseScripted();

    qnaPlayer = createLivePcmPlayer();
    qnaTurnCompletePromise = new Promise((resolve) => { resolveQnaTurnComplete = resolve; });

    try {
      qnaSession = await connectLiveSession({
        apiKey,
        model,
        systemInstruction: createQuestionSystemInstruction(slide),
        generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME } } } },
        onAudioChunk: (base64) => qnaPlayer?.enqueue(base64),
        onTurnComplete: () => resolveQnaTurnComplete?.(),
        onError: (err) => console.error('[live-narration-controller:qna]', err.message),
      });
    } catch (err) {
      console.error('[live-narration-controller:qna] connect failed', err.message);
      await endQuestionExchange({ answered: false });
      return;
    }
    // Released (or the whole controller stopped) while the WebSocket was
    // still connecting — abort without ever opening the mic.
    if (qnaStopRequested || stopped) { await endQuestionExchange({ answered: false }); return; }

    try {
      qnaMic = await createMicCapture({
        onChunk: (base64Pcm16) => qnaSession?.sendRealtimeAudio(base64Pcm16),
      });
    } catch (err) {
      console.error('[live-narration-controller:qna] mic capture failed', err.message);
      await endQuestionExchange({ answered: false });
      return;
    }
    // A press too brief to have captured a real question (released before the
    // mic even finished opening) — abort rather than send a near-empty turn
    // that would just stall waiting on a non-answer.
    if (qnaStopRequested || stopped) { await endQuestionExchange({ answered: false }); return; }
    // Otherwise we're now listening; the spoken answer is requested by
    // stopQuestion() on button release.
  }

  async function stopQuestion() {
    if (!qnaActive) return;
    if (!qnaMic) {
      // Released before mic capture started (a click, or the connect handshake
      // is still in flight) — flag it so startQuestion's own checkpoints abort
      // and resume; there's nothing to end yet here.
      qnaStopRequested = true;
      return;
    }
    await endQuestionExchange({ answered: true });
  }

  session = await connectLiveSession({
    apiKey,
    model,
    // "Verbatim" framing kept deliberately (not loosened along with the
    // fragment-turn-specific caveats that used to sit alongside it) — this
    // is specifically the condition GEMINI_LIVE_NARRATION.md's perfect
    // (1.00) verbatim-fidelity result was measured under, not an
    // incidental detail safe to drop.
    systemInstruction: 'You narrate one piece of text per request. Speak the given text aloud, exactly as written, verbatim — no additions, no paraphrasing, no omissions.',
    generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME } } } },
    onAudioChunk: (base64) => player.enqueue(base64),
    onOutputTranscript: (text) => onOutputTranscript(text),
    onTurnComplete: () => notifyTurnComplete(),
    onError: (err) => console.error('[live-narration-controller]', err.message),
  });

  async function run() {
    for (const unit of units) {
      if (stopped) break;
      if (!unit.fullText) continue;
      await resumeGate;
      if (stopped) break;

      const key = unitKey(unit.blockId, unit.itemId);
      const entry = perUnit.get(key);

      if (unit.usePerFragmentTurns) {
        // Equation path — see header comment. One turn per fragment,
        // guaranteed reveal right after that fragment's own turn
        // completes, no dependency on transcript matching at all.
        for (let i = 0; i < unit.fragments.length; i++) {
          if (stopped) break;
          await resumeGate;
          if (stopped) break;
          const { spoken } = unit.fragments[i];
          if (!spoken) continue;

          session.sendTurn(`Speak the following verbatim, exactly as written, exactly once — do not repeat or restate any part of it:\n\n${spoken}`);
          await new Promise((resolve) => turnCompletions.push(resolve));

          const state = entry?.fragmentStates[i];
          if (state && !state.revealed) scheduleReveal(unit.blockId, unit.itemId, i); // fix #2, per-fragment
          await state?.revealedPromise; // fix #3, per-fragment
        }
      } else {
        // Prose/bullet path — see header comment. One turn for the whole
        // unit, fragments (if any) revealed via transcript matching.
        currentUnitKey = key;
        accumulatedTranscript = '';
        confirmedFragmentCount = 0;

        session.sendTurn(`Speak the following verbatim, exactly as written:\n\n${unit.fullText}`);
        await new Promise((resolve) => turnCompletions.push(resolve));
        currentUnitKey = null;

        // fix #2 — anything not confirmed via transcript matching (always
        // includes the deliberately-excluded last fragment) gets revealed
        // now, at the turn's actual end.
        entry?.fragmentStates.forEach((state, i) => { if (!state.revealed) scheduleReveal(unit.blockId, unit.itemId, i); });
      }

      const lastState = entry?.fragmentStates[entry.fragmentStates.length - 1];
      await lastState?.revealedPromise; // see fix #3 above
      await rendererHandle.whenWritingIdle?.();
    }
  }

  // Close the WebSocket once all turns are sent, regardless of how run()
  // finished — leaving a completed session's connection open would let a
  // second Play (without an intervening Stop) open a new WebSocket while
  // the first was still live, and Gemini Live's concurrency limits could
  // silently degrade or reject the new session.
  const donePromise = run()
    .finally(() => session.close())
    .finally(() => player.whenDrained())
    .finally(() => { stopElapsedTimerAccumulate(); onEnded?.(); });

  startElapsedTimer();

  return {
    play() { resumeScripted(); },
    pause() { pauseScripted(); },
    stop() {
      stopped = true;
      session.close();
      // Unblock any endQuestionExchange currently awaiting the answer — closing
      // the session below means onTurnComplete will never fire on its own.
      qnaStopRequested = true;
      resolveQnaTurnComplete?.();
      qnaMic?.stop();
      qnaMic = null;
      qnaSession?.close();
      qnaSession = null;
      qnaPlayer?.stop();
      qnaPlayer = null;
      qnaActive = false;
      pendingReveals.forEach((cancel) => cancel());
      pendingReveals.clear();
      perUnit.forEach((entry) => entry.fragmentStates.forEach((state) => { if (!state.revealed) state.resolveRevealed(); })); // don't hang run()'s awaits
      resolveResumeGate?.();
      player.stop();
    },
    get paused() { return paused; },
    // Push-to-talk: startQuestion() on button press, stopQuestion() on
    // release. See the ask-a-question state block above for the full
    // design — pauses scripted narration, opens an isolated Q&A session,
    // streams mic audio into it; stopQuestion() waits for the spoken answer
    // to finish playing before resuming scripted narration automatically.
    startQuestion() { return startQuestion(); },
    stopQuestion() { return stopQuestion(); },
  };
}
