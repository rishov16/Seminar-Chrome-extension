// Thin wrapper around chrome.storage.local, dedupes the ad hoc get/set calls
// scattered through the original sidepanel.js (geminiApiKey, etc).
// sarvamApiKey/sarvamSpeaker/voiceEngine were removed along with the
// Web Speech/Sarvam TTS engines they configured — Gemini Live (the sole
// narration engine now) reuses geminiApiKey and has no speaking-rate
// control to expose as a "speed" setting. handwritingSpeed is a different
// thing: a pen-animation-only multiplier (renderers/agent-chalkboard/
// agent-chalkboard-renderer.js's renderSlide `speed` option), independent of
// narration audio — reintroduced after the original TTS "speed" setting
// was removed, scoped to just the pen this time.

export async function getSettings() {
  const defaults = {
    geminiApiKey: '',
    includeFillers: true,
    handwritingSpeed: 1,
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  return { ...defaults, ...stored };
}

export async function setSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function getLocal(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return key in result ? result[key] : fallback;
}

export async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSession(key, fallback = null) {
  const result = await chrome.storage.session.get(key);
  return key in result ? result[key] : fallback;
}

export async function removeSession(key) {
  await chrome.storage.session.remove(key);
}
