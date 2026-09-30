// Minimal WAV container writer — no npm dependency needed for a 44-byte
// PCM header. Gemini's TTS endpoint returns raw headerless PCM
// (see synthesizeSpeech in tts-client.mjs: "audio/l16; rate=24000;
// channels=1"), and wrapping it in a standard WAV container is the safest,
// most universally-accepted way to hand that audio back to Gemini for
// transcription (audio/wav is unambiguous; the raw audio/l16 mimeType's
// acceptance as generateContent *input* wasn't confirmed, so this sidesteps
// the question entirely).
export function wrapPcmAsWav(pcmBuffer, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // audio format: 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}
