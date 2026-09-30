// One-time microphone-permission grant page, opened in a normal browser tab by
// ui/main.js when a question is asked but mic permission isn't granted yet. A
// Chrome side panel auto-dismisses the getUserMedia prompt; a top-level tab
// shows it normally, and the resulting per-origin grant applies to every
// extension page (side panel included). See ui/main.js's micPermissionGranted.

const statusEl = document.getElementById('status');
const grantBtn = document.getElementById('grantBtn');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

async function requestMic() {
  setStatus('Requesting microphone access…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Immediately release the mic — we only needed the permission grant, not
    // the stream itself (the side panel opens its own capture later).
    stream.getTracks().forEach((t) => t.stop());
    grantBtn.style.display = 'none';
    setStatus('✓ Microphone access granted. You can close this tab and return to the seminar — press and hold the mic button to ask your question.', 'ok');
  } catch (err) {
    setStatus(`✗ Microphone access was blocked (${err.name}). Click the microphone icon in the address bar — or open Chrome Settings → Privacy and security → Site settings → Microphone — to allow it, then click "Allow microphone" again.`, 'err');
  }
}

grantBtn.addEventListener('click', requestMic);
// Also try immediately — the user opened this page deliberately to grant access.
requestMic();
