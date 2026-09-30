// Thin protocol wrapper around Gemini's Live API (BidiGenerateContent over a
// raw WebSocket) — no board/audio-rendering knowledge here, just the
// connect/setup/send/receive envelope. Driven by
// orchestration/live-narration-controller.js.
//
// Endpoint, message shapes, and the two constraints below were confirmed
// against Gemini's own Live API docs during development, not assumed:
// - Tools/generationConfig are fixed for the whole session — set once in the
//   initial `setup` message, no mid-session changes.
// - Function calls are SYNCHRONOUS/blocking by default: the model pauses
//   narrating until a toolResponse arrives. Callers that don't want an
//   audible stutter on every reveal must declare the tool with
//   `behavior: "NON_BLOCKING"` and reply with `scheduling: "SILENT"` — this
//   module doesn't enforce that (it's a tool-declaration/response choice
//   made by the caller), it just relays whatever's asked for.
const LIVE_ENDPOINT_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * @param {{ apiKey: string, model: string, systemInstruction: string,
 *   tools?: object[], generationConfig?: object,
 *   onSetupComplete?: () => void,
 *   onAudioChunk?: (base64Pcm16: string) => void,
 *   onToolCall?: (call: {id: string, name: string, args: object}) => void,
 *   onOutputTranscript?: (text: string) => void,
 *   onTurnComplete?: () => void,
 *   onError?: (err: Error) => void,
 *   onClose?: (event: CloseEvent) => void,
 *   onRawMessage?: (msg: object) => void }} opts
 * @returns {Promise<{ sendTurn: (text: string) => void,
 *   sendToolResponse: (id: string, response: object, opts?: {scheduling?: string}) => void,
 *   sendRealtimeAudio: (base64Pcm16: string) => void,
 *   sendAudioStreamEnd: () => void,
 *   close: () => void }>} resolves once BidiGenerateContentSetupComplete is received
 */
export function connectLiveSession({
  apiKey, model, systemInstruction, tools = [], generationConfig = {},
  onSetupComplete, onAudioChunk, onToolCall, onOutputTranscript, onTurnComplete, onError, onClose, onRawMessage,
}) {
  const ws = new WebSocket(`${LIVE_ENDPOINT_BASE}?key=${encodeURIComponent(apiKey)}`);

  const api = {
    sendTurn(text) {
      ws.send(JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
      }));
    },
    sendToolResponse(id, response, { scheduling } = {}) {
      const functionResponse = { id, response };
      if (scheduling) functionResponse.scheduling = scheduling;
      ws.send(JSON.stringify({ toolResponse: { functionResponses: [functionResponse] } }));
    },
    // User microphone input — 16kHz/16-bit/mono PCM per the Live API docs,
    // distinct from the 24kHz output stream live-audio-player.js plays back.
    // Sent as realtimeInput (not clientContent), per BidiGenerateContentRealtimeInput.
    sendRealtimeAudio(base64Pcm16) {
      ws.send(JSON.stringify({
        realtimeInput: { audio: { data: base64Pcm16, mimeType: 'audio/pcm;rate=16000' } },
      }));
    },
    // Explicit end-of-turn signal for realtimeInput, sent once mic capture
    // stops (push-to-talk release) — lets the caller end the user's turn
    // deterministically instead of waiting on server-side voice-activity
    // silence detection, per BidiGenerateContentRealtimeInput.audioStreamEnd.
    sendAudioStreamEnd() {
      ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    },
    close() { ws.close(); },
  };

  return new Promise((resolve, reject) => {
    let settled = false;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
          generationConfig: { responseModalities: ['AUDIO'], ...generationConfig },
          // A sibling of generationConfig in BidiGenerateContentSetup, not
          // nested inside it — the server rejects the nested form with
          // "Unknown name 'outputAudioTranscription' at
          // 'setup.generation_config'" (found live during development).
          outputAudioTranscription: {},
        },
      }));
    });

    ws.addEventListener('message', async (event) => {
      // The Live API sends JSON text frames, except when a Blob is delivered
      // by the browser's WebSocket implementation for binary-typed frames —
      // handle both since which one arrives isn't controlled by this client.
      const raw = typeof event.data === 'string' ? event.data : await event.data.text();
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        onError?.(new Error(`[gemini-live-client] non-JSON message: ${e.message}`));
        return;
      }

      onRawMessage?.(msg); // optional diagnostic hook — no-op unless a caller supplies one

      if (msg.setupComplete) {
        settled = true;
        onSetupComplete?.();
        resolve(api);
        return;
      }

      if (msg.toolCall?.functionCalls) {
        msg.toolCall.functionCalls.forEach((call) => onToolCall?.(call));
      }

      const serverContent = msg.serverContent;
      if (serverContent?.modelTurn?.parts) {
        serverContent.modelTurn.parts.forEach((part) => {
          if (part.inlineData?.data) onAudioChunk?.(part.inlineData.data);
        });
      }
      if (serverContent?.outputTranscription?.text) {
        onOutputTranscript?.(serverContent.outputTranscription.text);
      }
      if (serverContent?.turnComplete) onTurnComplete?.();
    });

    ws.addEventListener('error', () => {
      // The WebSocket spec deliberately strips all detail from 'error'
      // events (no code/reason/message) — the close event that immediately
      // follows is where the actual diagnostic (auth failure, bad model
      // name, quota) shows up, so this only rejects if 'close' hasn't
      // already done so.
      const err = new Error('[gemini-live-client] WebSocket error (see the close event for the actual reason, if any)');
      onError?.(err);
      if (!settled) { settled = true; reject(err); }
    });

    ws.addEventListener('close', (event) => {
      onClose?.(event);
      // A close before setupComplete ever arrived means the connection
      // attempt itself failed (bad key/model/quota/etc.) — without this,
      // the returned promise never resolves or rejects, and callers hang
      // on "connecting" forever with no error surfaced.
      if (!settled) {
        settled = true;
        reject(new Error(`[gemini-live-client] connection closed before setup completed (code ${event.code}${event.reason ? `: ${event.reason}` : ', no reason given by server'})`));
      }
    });
  });
}
