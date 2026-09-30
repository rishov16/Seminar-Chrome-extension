// Captures microphone audio and delivers 16kHz/16-bit/mono PCM chunks,
// base64-encoded, for Gemini Live's realtimeInput.audio (see
// gemini-live-client.js's sendRealtimeAudio). Mirrors live-audio-player.js's
// shape but for input instead of output — this repo's first microphone
// capture code (confirmed via repo-wide search: no existing getUserMedia/
// AudioWorklet/MediaRecorder precedent anywhere).
//
// Uses ScriptProcessorNode, not AudioWorkletNode: this extension is
// Chrome-only, ScriptProcessorNode is fully supported there despite being
// deprecated upstream, and it avoids registering a separate worklet module
// file via audioWorklet.addModule() from an extension context. Simplicity
// chosen deliberately for a v1 push-to-talk feature with a single mic
// session active at a time, not a design meant to scale.

function floatTo16BitPCM(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Linear (no anti-alias filtering) downsample from the AudioContext's native
// rate (typically 48000/44100) to Gemini Live's required 16000 — adequate
// for speech-band input at this ratio, matching the simplicity level of
// live-audio-player.js's own PCM handling (which also does no filtering).
function downsampleTo16k(float32, inputRate) {
  if (inputRate === 16000) return float32;
  const ratio = inputRate / 16000;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) out[i] = float32[Math.floor(i * ratio)];
  return out;
}

/**
 * @param {{ onChunk: (base64Pcm16: string) => void }} opts
 * @returns {Promise<{ stop: () => void }>}
 */
export async function createMicCapture({ onChunk }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16k(input, ctx.sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    onChunk(int16ToBase64(pcm16));
  };

  source.connect(processor);
  // ScriptProcessorNode only fires onaudioprocess while connected through to
  // a destination in some browsers, even though its own output is unused —
  // route through a zero-gain node so nothing is actually heard back.
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(ctx.destination);

  return {
    stop() {
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
