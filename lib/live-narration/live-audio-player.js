// Gapless playback of the raw 16-bit PCM audio chunks Gemini Live streams
// back (base64, mono — 24kHz for output per the API docs). No precedent anywhere else in this
// repo for raw PCM playback — the TTS engines this replaced both handed a
// browser/HTML5-audio API a whole utterance/file, never a stream of raw
// sample chunks.
//
// AudioBuffer's own sampleRate can differ from the AudioContext's; the
// browser resamples automatically on playback, so there's no need to force
// the context's rate to match the stream (which isn't reliably honored by
// every browser's AudioContext constructor anyway).
function base64Pcm16ToFloat32(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

/** @returns {{ enqueue: (base64Pcm16: string, sampleRate?: number) => void,
 *   getScheduledEndTime: () => number,
 *   scheduleAt: (targetTime: number, callback: () => void) => (() => void),
 *   pause: () => void, resume: () => void,
 *   stop: () => void, whenDrained: () => Promise<void> }} */
export function createLivePcmPlayer() {
  const ctx = new AudioContext();
  let nextStartTime = 0;
  const pendingSources = new Set();
  let drainResolvers = [];

  // scheduleAt is polled against ctx.currentTime (via requestAnimationFrame)
  // rather than implemented as a plain setTimeout, specifically so pause()
  // works for free: AudioContext.suspend() freezes ctx.currentTime itself,
  // so a poll loop checking `ctx.currentTime >= targetTime` naturally stops
  // advancing too, with no separate per-timer pause/resume bookkeeping
  // needed. A setTimeout-based version would keep counting real wall-clock
  // time regardless of suspend(), firing reveals while audio is paused.
  const pendingSchedules = new Set(); // { targetTime, callback }
  let pollHandle = null;

  function pollSchedules() {
    const now = ctx.currentTime;
    pendingSchedules.forEach((entry) => {
      if (now >= entry.targetTime) {
        pendingSchedules.delete(entry);
        entry.callback();
      }
    });
    pollHandle = pendingSchedules.size ? requestAnimationFrame(pollSchedules) : null;
  }

  function notifyIfDrained() {
    if (pendingSources.size === 0) {
      while (drainResolvers.length) drainResolvers.shift()();
    }
  }

  return {
    enqueue(base64Pcm16, sampleRate = 24000) {
      const samples = base64Pcm16ToFloat32(base64Pcm16);
      if (!samples.length) return;

      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime, nextStartTime);
      source.start(startAt);
      nextStartTime = startAt + buffer.duration;

      pendingSources.add(source);
      source.onended = () => { pendingSources.delete(source); notifyIfDrained(); };
    },

    // The AudioContext time at which every chunk enqueued so far will have
    // finished playing — i.e. "if I call this right now, how far into the
    // future does the audio the user hasn't heard yet extend." Gemini Live
    // generates (and streams back) audio faster than real time, so a tool
    // call arriving right after a unit's last chunk does NOT mean the user
    // has actually heard that unit yet — this is what
    // orchestration/live-narration-controller.js gates the visual reveal
    // on, instead of raw network message-arrival time.
    getScheduledEndTime() { return nextStartTime; },

    // Fires callback once the AudioContext clock reaches targetTime — see
    // the pollSchedules note above for why this is poll-based, not a plain
    // timer. Returns a cancel function so a caller can drop a still-pending
    // reveal if playback is stopped before it fires.
    scheduleAt(targetTime, callback) {
      const entry = { targetTime, callback };
      pendingSchedules.add(entry);
      if (!pollHandle) pollHandle = requestAnimationFrame(pollSchedules);
      return () => pendingSchedules.delete(entry);
    },

    // Suspending/resuming the AudioContext freezes/unfreezes every
    // scheduled source AND ctx.currentTime together — no per-source or
    // per-timer bookkeeping needed, since everything (playback, and the
    // scheduleAt poll above) is driven off the same clock.
    pause() { ctx.suspend(); },
    resume() { ctx.resume(); },

    stop() {
      pendingSources.forEach((source) => { try { source.stop(); } catch { /* already ended */ } });
      pendingSources.clear();
      pendingSchedules.clear();
      if (pollHandle) { cancelAnimationFrame(pollHandle); pollHandle = null; }
      nextStartTime = ctx.currentTime;
      notifyIfDrained();
    },

    whenDrained() {
      return new Promise((resolve) => {
        if (pendingSources.size === 0) resolve();
        else drainResolvers.push(resolve);
      });
    },
  };
}
