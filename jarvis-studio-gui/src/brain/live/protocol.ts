/**
 * Gemini Live API (raw WebSocket) — message building and parsing. Pure functions, no I/O.
 *
 * Checked against the official docs on 2026-11-01 (ai.google.dev: "Live API capabilities guide"
 * updated 2026-10-29, "WebSockets API reference" updated 2026-10-09):
 *  - endpoint .../v1beta.GenerativeService.BidiGenerateContent?key=KEY
 *  - first client message is `setup`; wait for `setupComplete` before sending anything else
 *  - audio in: raw 16-bit little-endian PCM, mime "audio/pcm;rate=16000"; audio out: 24 kHz PCM16
 *  - `serverContent.interrupted` = stop playback and drop the queue
 *  - model ids move fast (3.8-live is the recommended one today, 3.1-flash-live-preview is "legacy"),
 *    so the model id is a setting, never hard-wired in the session code.
 *  - `gemini-3.8-live` must NOT get a `thinkingLevel` in setup.
 * Preview API: field names may change. If the server rejects the setup, the close reason is shown to the user.
 */

export const LIVE_MODEL_DEFAULT = "gemini-3.8-live";
export const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;

export function liveWsUrl(apiKey: string): string {
  return `${LIVE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
}

export interface LiveSetupOptions {
  model?: string;
  systemInstruction: string;
  /** One of the prebuilt voice names (e.g. "Kore"). Unknown names are rejected by the server. */
  voiceName?: string;
  /** Silence the server waits before it decides you finished (docs: 500–800 ms balances quality and speed). */
  silenceDurationMs?: number;
  /** Handle from an earlier session so a reconnect continues the same conversation. */
  resumptionHandle?: string;
  /** Gemini `functionDeclarations` the model may call (omit = talk only). */
  tools?: Record<string, unknown>[];
}

export interface LiveCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface LiveCallResult {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

export function buildSetup(opts: LiveSetupOptions): Record<string, unknown> {
  const model = (opts.model || LIVE_MODEL_DEFAULT).replace(/^models\//, "");
  const generationConfig: Record<string, unknown> = { responseModalities: ["AUDIO"] };
  if (opts.voiceName) {
    generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } } };
  }
  const setup: Record<string, unknown> = {
    model: `models/${model}`,
    generationConfig,
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    realtimeInputConfig: {
      automaticActivityDetection: { silenceDurationMs: opts.silenceDurationMs ?? 700 },
    },
    // Text of both sides, so the screen can show what was said and the app can remember it.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Lets a dropped connection continue, and keeps a long chat from filling the context window.
    sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
  };
  if (opts.tools?.length) {
    // gemini-3.8-live runs tools asynchronously by default: the model keeps talking and may say "done" before
    // our result arrives. BLOCKING makes it wait for the real result first. (Older Live models don't know the field.)
    const blocking = /3\.8/.test(model);
    setup.tools = [
      { functionDeclarations: opts.tools.map((t) => (blocking ? { ...t, behavior: "BLOCKING" } : t)) },
    ];
  }
  return { setup };
}

/** Our answer to the model's function call(s). Ids must be echoed back exactly. */
export const toolResponseMessage = (results: LiveCallResult[]) => ({
  toolResponse: {
    functionResponses: results.map((r) => ({ id: r.id, name: r.name, response: r.response })),
  },
});

export const audioMessage = (base64Pcm16k: string) => ({
  realtimeInput: { audio: { data: base64Pcm16k, mimeType: `audio/pcm;rate=${INPUT_RATE}` } },
});
/** Tell the server the mic stopped (flushes cached audio). Only valid while automatic VAD is on. */
export const audioStreamEndMessage = () => ({ realtimeInput: { audioStreamEnd: true } });
export const textMessage = (text: string) => ({ realtimeInput: { text } });
export const contextTurnsMessage = (turns: { role: "user" | "model"; text: string }[], turnComplete = false) => ({
  clientContent: {
    turns: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    turnComplete,
  },
});

export type LiveEvent =
  | { type: "setupComplete" }
  | { type: "audio"; data: string; rate: number }
  | { type: "inputText"; text: string }
  | { type: "outputText"; text: string }
  | { type: "interrupted" }
  | { type: "generationComplete" }
  | { type: "turnComplete" }
  | { type: "goAway"; timeLeftMs: number | null }
  | { type: "resumption"; handle: string | null; resumable: boolean }
  | { type: "toolCall"; names: string[]; calls: LiveCall[] }
  | { type: "usage"; totalTokens: number };

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null;

function durationMs(d: unknown): number | null {
  if (typeof d === "string") {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
    return m ? Math.round(parseFloat(m[1]!) * 1000) : null;
  }
  if (isObj(d) && typeof d.seconds !== "undefined") {
    return Math.round((Number(d.seconds) || 0) * 1000 + (Number(d.nanos) || 0) / 1e6);
  }
  return null;
}

/** One server message can carry several things at once (audio + transcript + flags); return them all, in order. */
export function parseServerMessage(raw: unknown): LiveEvent[] {
  let msg: unknown = raw;
  if (typeof raw === "string") {
    try {
      msg = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!isObj(msg)) return [];
  const out: LiveEvent[] = [];
  if (isObj(msg.setupComplete)) out.push({ type: "setupComplete" });

  const sc = msg.serverContent;
  if (isObj(sc)) {
    // Interruption first: audio that arrives in the same message belongs to the new turn.
    if (sc.interrupted === true) out.push({ type: "interrupted" });
    const parts = isObj(sc.modelTurn) && Array.isArray(sc.modelTurn.parts) ? sc.modelTurn.parts : [];
    for (const p of parts) {
      const d = isObj(p) && isObj(p.inlineData) ? p.inlineData : null;
      if (d && typeof d.data === "string" && /^audio\//i.test(String(d.mimeType ?? "audio/pcm"))) {
        const rate = /rate=(\d+)/.exec(String(d.mimeType ?? ""))?.[1];
        out.push({ type: "audio", data: d.data, rate: rate ? parseInt(rate, 10) : OUTPUT_RATE });
      }
    }
    if (isObj(sc.inputTranscription) && typeof sc.inputTranscription.text === "string") {
      out.push({ type: "inputText", text: sc.inputTranscription.text });
    }
    if (isObj(sc.outputTranscription) && typeof sc.outputTranscription.text === "string") {
      out.push({ type: "outputText", text: sc.outputTranscription.text });
    }
    if (sc.generationComplete === true) out.push({ type: "generationComplete" });
    if (sc.turnComplete === true) out.push({ type: "turnComplete" });
  }
  if (isObj(msg.toolCall)) {
    const calls = Array.isArray(msg.toolCall.functionCalls) ? msg.toolCall.functionCalls : [];
    const named = calls.filter((c: any) => isObj(c) && typeof c.name === "string" && c.name);
    out.push({
      type: "toolCall",
      names: named.map((c: any) => String(c.name)),
      calls: named.map((c: any) => ({
        id: String(c.id ?? ""),
        name: String(c.name),
        args: isObj(c.args) ? c.args : {},
      })),
    });
  }
  if (isObj(msg.goAway)) out.push({ type: "goAway", timeLeftMs: durationMs(msg.goAway.timeLeft) });
  const sr = msg.sessionResumptionUpdate;
  if (isObj(sr)) {
    const handle = typeof sr.newHandle === "string" && sr.newHandle ? sr.newHandle : null;
    out.push({ type: "resumption", handle, resumable: sr.resumable === true });
  }
  if (isObj(msg.usageMetadata) && typeof msg.usageMetadata.totalTokenCount === "number") {
    out.push({ type: "usage", totalTokens: msg.usageMetadata.totalTokenCount });
  }
  return out;
}
