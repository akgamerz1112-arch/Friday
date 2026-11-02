/* Sarvam AI "Bulbul" text-to-speech — FRIDAY's natural Hindi voice.
 *
 * API: POST https://api.sarvam.ai/text-to-speech, header `api-subscription-key`,
 * JSON body { text, language_code, speaker, model, pace, speech_sample_rate }, reply
 * { request_id, audios: [base64 WAV] } (docs.sarvam.ai/api-reference/text-to-speech/convert,
 * read 2026-10-31). Models: `bulbul:v4-flash` (persona ids like `simran_hi_assistant`)
 * and `bulbul:v3` (short ids like `priya`). Max 2500 characters per request.
 *
 * Design rules (webspeech.ts is the only caller):
 *  - This module NEVER speaks through Android TTS itself. It returns what it could not
 *    say ({done:false, remaining}) and webspeech.ts speaks that with the native engine,
 *    so a Sarvam failure degrades to the old voice instead of silence.
 *  - Calls are the exception, not the rule: no key / switched off / offline / cooling
 *    down / reply too long → no request at all. Short repeated phrases come from a small
 *    in-memory cache. A bad key or spent quota pauses all calls for 30 minutes.
 *  - The key arrives through setSarvamSettings() from the Keystore-backed config and is
 *    only ever put in the request header. It is never logged and never in an error text.
 */

import { resilientFetch, isOffline } from "../tools/httpClient";

export const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

export type SarvamModel = "bulbul:v4-flash" | "bulbul:v3";

export interface SarvamVoice {
  id: string;
  label: string;
  model: SarvamModel;
  /** Absent = female. Voice gender only changes how the voice sounds, not the assistant identity. */
  gender?: "m";
}

/**
 * Female Hindi voices first, then male ones (v3). v4-flash personas are `<name>_<language>_<style>` and must
 * match the model; v3 uses short names. Names are from Sarvam's own female list
 * (ritu, priya, simran, shreya, kavya, roopa, suhani…) — pick by ear in Settings ▸ Voice.
 */
export const SARVAM_VOICES: readonly SarvamVoice[] = [
  { id: "simran_hi_assistant", label: "Simran — assistant", model: "bulbul:v4-flash" },
  { id: "simran_hi_conversation", label: "Simran — conversation", model: "bulbul:v4-flash" },
  { id: "ritu_hi_conversation", label: "Ritu — conversation", model: "bulbul:v4-flash" },
  { id: "shreya_hi_conversational", label: "Shreya — conversational", model: "bulbul:v4-flash" },
  { id: "kavya_hi_conversational", label: "Kavya — conversational", model: "bulbul:v4-flash" },
  { id: "roopa_hi_conversational", label: "Roopa — conversational", model: "bulbul:v4-flash" },
  { id: "priya", label: "Priya — Bulbul v3", model: "bulbul:v3" },
  { id: "suhani", label: "Suhani — Bulbul v3", model: "bulbul:v3" },
  // Male (Bulbul v3, names from Sarvam's voice list; shubh is their best male voice for Hindi).
  { id: "shubh", label: "Shubh — male (best Hindi, default)", model: "bulbul:v3", gender: "m" },
  { id: "rahul", label: "Rahul — male, deep and authoritative", model: "bulbul:v3", gender: "m" },
  { id: "aditya", label: "Aditya — male, modern and crisp", model: "bulbul:v3", gender: "m" },
  { id: "rohan", label: "Rohan — male, confident", model: "bulbul:v3", gender: "m" },
  { id: "amit", label: "Amit — male", model: "bulbul:v3", gender: "m" },
  { id: "anand", label: "Anand — male, professional", model: "bulbul:v3", gender: "m" },
];
export const DEFAULT_VOICE = "shubh";
/** Used once, automatically, if the selected v4 voice is refused (bad model/speaker). */
const V3_FALLBACK_VOICE: SarvamVoice = { id: "priya", label: "Priya", model: "bulbul:v3" };

export const MIN_PACE = 0.6;
export const MAX_PACE = 1.6;
export const MIN_VOLUME = 0.3;
/** Replies longer than this go to the phone's own voice: it bounds cost and latency. */
export const MAX_SPOKEN_CHARS = 1400;

const FIRST_CHUNK_CHARS = 160; // small first piece → audio starts sooner
const CHUNK_CHARS = 380;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_MAX_ENTRIES = 24;
const CACHE_MAX_TEXT = 160;
const COOLDOWN_AUTH_MS = 30 * 60_000;
const COOLDOWN_QUOTA_MS = 30 * 60_000;
const COOLDOWN_RATE_MS = 90_000;
const COOLDOWN_FLAKY_MS = 5 * 60_000;
const FLAKY_AFTER = 3;

export interface SarvamSettings {
  enabled: boolean;
  apiKey: string;
  voice: string;
  pace: number;
  volume: number;
}

const DEFAULTS: SarvamSettings = {
  enabled: true,
  apiKey: "",
  voice: DEFAULT_VOICE,
  pace: 1,
  volume: 1,
};

export function normalizeSarvamSettings(s: Partial<SarvamSettings> | undefined): SarvamSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const voice = SARVAM_VOICES.some((v) => v.id === s?.voice) ? (s!.voice as string) : DEFAULT_VOICE;
  return {
    enabled: s?.enabled !== false,
    apiKey: typeof s?.apiKey === "string" ? s.apiKey.trim() : "",
    voice,
    pace: num(s?.pace, MIN_PACE, MAX_PACE, 1),
    volume: num(s?.volume, MIN_VOLUME, 1, 1),
  };
}

/** True when the selected voice is a male one (used only for masculine Hindi grammar, never for identity). */
export function isMaleVoice(): boolean {
  return voiceById(settings.voice).gender === "m";
}

export function voiceById(id: string): SarvamVoice {
  return SARVAM_VOICES.find((v) => v.id === id) ?? SARVAM_VOICES.find((v) => v.id === DEFAULT_VOICE) ?? SARVAM_VOICES[0];
}

// ── Failure handling ────────────────────────────────────────────────────────

export type SarvamErrorKind =
  | "auth"
  | "quota"
  | "rate"
  | "bad_request"
  | "server"
  | "network"
  | "timeout"
  | "empty"
  | "playback";

export class SarvamError extends Error {
  constructor(
    readonly kind: SarvamErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SarvamError";
  }
}

/** Map an HTTP status and Sarvam's error body to a kind. Exported for tests. */
export function classifySarvamError(status: number, body: unknown): SarvamErrorKind {
  const err = (body as { error?: { code?: string } } | null)?.error;
  const code = typeof err?.code === "string" ? err.code : "";
  if (status === 401 || status === 403) return "auth";
  if (code === "invalid_api_key_error" || code === "authentication_error") return "auth";
  if (code === "insufficient_quota_error" || code === "billing_service_unavailable_error")
    return "quota";
  if (status === 429 || code === "rate_limit_exceeded_error") return "rate";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "server";
  return "bad_request";
}

const FRIENDLY: Record<SarvamErrorKind, string> = {
  auth: "Sarvam did not accept the API key",
  quota: "the Sarvam quota is used up",
  rate: "Sarvam is rate-limiting requests",
  bad_request: "Sarvam refused the request",
  server: "Sarvam had a server error",
  network: "no connection to Sarvam",
  timeout: "Sarvam took too long to answer",
  empty: "Sarvam returned no audio",
  playback: "the phone could not play the audio",
};

// ── Module state ────────────────────────────────────────────────────────────

let settings: SarvamSettings = { ...DEFAULTS };
let cooldownUntil = 0;
let cooldownReason = "";
let failStreak = 0;
let lastError = "";
let languageField: "language_code" | "target_language_code" = "language_code";
let v3Downgraded = false;
let run = 0; // bumped by every new speak and by stop(): a stale run quietly ends
let inflight: AbortController | null = null;

const cache = new Map<string, string>();
const listeners = new Set<(ev: { reason: string }) => void>();

export interface SarvamStatus {
  configured: boolean;
  enabled: boolean;
  /** Would the next reply use Sarvam right now? */
  active: boolean;
  coolingDown: boolean;
  cooldownUntil: number;
  reason: string;
  lastError: string;
}

export function sarvamStatus(now = Date.now()): SarvamStatus {
  const configured = Boolean(settings.apiKey);
  const coolingDown = now < cooldownUntil;
  return {
    configured,
    enabled: settings.enabled,
    active: configured && settings.enabled && !coolingDown,
    coolingDown,
    cooldownUntil: coolingDown ? cooldownUntil : 0,
    reason: coolingDown ? cooldownReason : "",
    lastError,
  };
}

/** Called once each time Sarvam is paused, so the UI can say why the voice changed. */
export function onSarvamCooldown(cb: (ev: { reason: string }) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setSarvamSettings(next: Partial<SarvamSettings>): void {
  const prev = settings;
  settings = normalizeSarvamSettings(next);
  // A new key, or turning it back on, is the user fixing the cause: forget old blame.
  if (prev.apiKey !== settings.apiKey || (!prev.enabled && settings.enabled)) {
    cooldownUntil = 0;
    cooldownReason = "";
    failStreak = 0;
    v3Downgraded = false;
    lastError = "";
  }
  if (prev.voice !== settings.voice) v3Downgraded = false;
}

function startCooldown(ms: number, reason: string): void {
  cooldownUntil = Date.now() + ms;
  cooldownReason = reason;
  for (const cb of listeners) {
    try {
      cb({ reason });
    } catch {
      /* a listener must never break speech */
    }
  }
}

function noteFailure(err: SarvamError): void {
  lastError = FRIENDLY[err.kind];
  switch (err.kind) {
    case "auth":
      startCooldown(COOLDOWN_AUTH_MS, FRIENDLY.auth);
      return;
    case "quota":
      startCooldown(COOLDOWN_QUOTA_MS, FRIENDLY.quota);
      return;
    case "rate":
      startCooldown(COOLDOWN_RATE_MS, FRIENDLY.rate);
      return;
    case "empty":
      // an empty reply for one text isn't the service being down
      return;
    default:
      failStreak += 1;
      if (failStreak >= FLAKY_AFTER) {
        failStreak = 0;
        startCooldown(COOLDOWN_FLAKY_MS, `${FRIENDLY[err.kind]} (3 times in a row)`);
      }
  }
}

function noteSuccess(): void {
  failStreak = 0;
  lastError = "";
}

/** True when a reply should be sent to Sarvam at all. No request is made otherwise. */
export function sarvamUsable(): boolean {
  return Boolean(settings.apiKey) && settings.enabled && Date.now() >= cooldownUntil && !isOffline();
}

// ── Text preparation ────────────────────────────────────────────────────────

/** Sarvam reads "10000" as digits and "10,000" as a number; group 5–9 digit numbers
 *  (10-digit phone numbers are left alone, so they are not read as one big number). */
export function groupBigNumbers(text: string): string {
  return text.replace(/(?<![\d.,+])([1-9]\d{4,8})(?![\d,]|\.\d)/g, (n) =>
    n.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
}

/** Speakable text, or "" when there is nothing to say (emoji only, a bare link…). */
export function prepareForSarvam(text: string): string {
  const t = groupBigNumbers(
    (text ?? "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim(),
  );
  return /[\p{L}\p{N}]/u.test(t) ? t : "";
}

function splitLong(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf("; ", max));
    if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.4) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Sentence-aligned chunks; the first is short so audio starts quickly. Exported for tests. */
export function chunkForSpeech(text: string, first = FIRST_CHUNK_CHARS, max = CHUNK_CHARS): string[] {
  const sentences = text
    .split(/(?<=[।.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const sentence of sentences) {
    const limit = chunks.length === 0 ? first : max;
    for (const piece of splitLong(sentence, limit)) {
      if (cur && cur.length + 1 + piece.length > limit) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur} ${piece}` : piece;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ── Transport and player (injectable for tests) ─────────────────────────────

export type SarvamTransport = (
  url: string,
  init: RequestInit,
  timeoutMs: number,
) => Promise<Response>;

export interface SarvamPlayer {
  /** Resolves when the clip ends, or when stop() cuts it. Rejects if it cannot play. */
  play(wavBase64: string, volume: number): Promise<void>;
  stop(): void;
}

let transport: SarvamTransport = resilientFetch;

function browserPlayer(): SarvamPlayer {
  let el: HTMLAudioElement | null = null;
  let url: string | null = null;
  let release: (() => void) | null = null;
  const cleanup = () => {
    if (el) {
      el.onended = el.onerror = el.onplaying = null;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    if (url) URL.revokeObjectURL(url);
    el = null;
    url = null;
  };
  return {
    play(b64, volume) {
      return new Promise<void>((resolve, reject) => {
        let started = false;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const finish = (err?: Error) => {
          clearTimeout(watchdog);
          release = null;
          cleanup();
          if (err) reject(err);
          else resolve();
        };
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          el = new Audio(url);
          el.volume = Math.min(1, Math.max(0, volume));
          el.onplaying = () => {
            started = true;
            clearTimeout(watchdog);
          };
          el.onended = () => finish();
          el.onerror = () => finish(new Error("audio element error"));
          release = () => finish();
          // If playback never starts (autoplay blocked, WebView paused) give up fast so
          // the phone's own voice takes over instead of the reply going silent.
          watchdog = setTimeout(() => {
            if (!started) finish(new Error("audio did not start"));
          }, 5000);
          void el.play().catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    stop() {
      if (release) release();
      else cleanup();
    },
  };
}

let player: SarvamPlayer | null = null;
function getPlayer(): SarvamPlayer {
  return (player ??= browserPlayer());
}

/** Test seam: replace the network and audio output. Pass nothing to restore defaults. */
export function __setSarvamIO(io: { transport?: SarvamTransport; player?: SarvamPlayer } = {}): void {
  transport = io.transport ?? resilientFetch;
  player = io.player ?? null;
}

/** Test seam: forget cache, cooldowns and settings. */
export function __resetSarvam(): void {
  settings = { ...DEFAULTS };
  cooldownUntil = 0;
  cooldownReason = "";
  failStreak = 0;
  lastError = "";
  languageField = "language_code";
  v3Downgraded = false;
  run = 0;
  inflight = null;
  cache.clear();
  listeners.clear();
}

// ── Synthesis ───────────────────────────────────────────────────────────────

async function requestAudio(
  text: string,
  voice: SarvamVoice,
  s: SarvamSettings,
  signal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = {
    text,
    [languageField]: "hi-IN",
    speaker: voice.id,
    model: voice.model,
    pace: s.pace,
    speech_sample_rate: 24000,
  };
  let res: Response;
  try {
    res = await transport(
      SARVAM_TTS_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-subscription-key": s.apiKey },
        body: JSON.stringify(body),
        signal,
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch (e) {
    if (signal.aborted) throw new SarvamError("timeout", FRIENDLY.timeout);
    const msg = e instanceof Error ? e.message : "";
    throw new SarvamError(/abort|timed? ?out/i.test(msg) ? "timeout" : "network", FRIENDLY.network);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const kind = classifySarvamError(res.status, json);
    const detail = (json as { error?: { message?: string } } | null)?.error?.message ?? "";
    throw new SarvamError(kind, `${FRIENDLY[kind]}${detail ? `: ${detail}` : ""}`, res.status);
  }
  const audio = (json as { audios?: unknown } | null)?.audios;
  const first = Array.isArray(audio) ? audio.find((a) => typeof a === "string" && a) : undefined;
  if (typeof first !== "string") throw new SarvamError("empty", FRIENDLY.empty);
  return first;
}

async function synthesizeChunk(
  text: string,
  s: SarvamSettings,
  signal: AbortSignal,
): Promise<string> {
  let voice = v3Downgraded ? V3_FALLBACK_VOICE : voiceById(s.voice);
  const key = `${voice.model}|${voice.id}|${s.pace}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit); // most recently used
    return hit;
  }
  let audio: string;
  try {
    audio = await requestAudio(text, voice, s, signal);
  } catch (e) {
    if (!(e instanceof SarvamError) || e.kind !== "bad_request" || signal.aborted) throw e;
    // 400/422 can be the language field's name (docs show both spellings)…
    const other = languageField === "language_code" ? "target_language_code" : "language_code";
    if (/language/i.test(e.message)) {
      languageField = other;
      audio = await requestAudio(text, voice, s, signal);
    } else if (voice.model !== "bulbul:v3") {
      // …or a v4 voice this account can't use: one retry on the stable v3 voice.
      voice = V3_FALLBACK_VOICE;
      audio = await requestAudio(text, voice, s, signal);
      v3Downgraded = true;
    } else {
      throw e;
    }
  }
  if (text.length <= CACHE_MAX_TEXT) {
    cache.set(`${voice.model}|${voice.id}|${s.pace}|${text}`, audio);
    while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  return audio;
}

export interface SarvamSpeakResult {
  /** True when nothing is left for the phone's own voice to say. */
  done: boolean;
  /** What Sarvam did not say (everything, if it was never tried). */
  remaining: string;
}

/**
 * Speak `text` with Sarvam, chunk by chunk, fetching the next chunk while the current one
 * plays. Returns done:true when finished, cut by stop(), or nothing speakable; done:false
 * with the unspoken rest when the caller should hand it to Android TTS.
 */
export async function speakWithSarvam(text: string): Promise<SarvamSpeakResult> {
  if (!sarvamUsable()) return { done: false, remaining: text };
  const prepared = prepareForSarvam(text);
  if (!prepared) return { done: true, remaining: "" };
  if (prepared.length > MAX_SPOKEN_CHARS) return { done: false, remaining: text };

  stopSarvam(); // a newer reply replaces whatever was still playing
  const myRun = ++run;
  const controller = new AbortController();
  inflight = controller;
  const s = settings;
  const chunks = chunkForSpeech(prepared);
  const fetches: Array<Promise<string>> = [];
  const fetchAt = (i: number) => {
    if (i < chunks.length && !fetches[i]) {
      const p = synthesizeChunk(chunks[i], s, controller.signal);
      p.catch(() => {}); // surfaced where it is awaited
      fetches[i] = p;
    }
  };
  const cancelled = () => myRun !== run;

  try {
    fetchAt(0);
    for (let i = 0; i < chunks.length; i++) {
      let audio: string;
      try {
        audio = await fetches[i];
      } catch (e) {
        if (cancelled()) return { done: true, remaining: "" };
        noteFailure(e instanceof SarvamError ? e : new SarvamError("network", FRIENDLY.network));
        return { done: false, remaining: chunks.slice(i).join(" ") };
      }
      if (cancelled()) return { done: true, remaining: "" };
      fetchAt(i + 1);
      try {
        await getPlayer().play(audio, s.volume);
      } catch {
        if (cancelled()) return { done: true, remaining: "" };
        noteFailure(new SarvamError("playback", FRIENDLY.playback));
        return { done: false, remaining: chunks.slice(i).join(" ") };
      }
      if (cancelled()) return { done: true, remaining: "" };
      noteSuccess();
    }
    return { done: true, remaining: "" };
  } finally {
    if (inflight === controller) inflight = null;
  }
}

/** Cut any Sarvam speech now (STOP, mute, the user starts talking). */
export function stopSarvam(): void {
  run += 1;
  if (inflight) {
    inflight.abort();
    inflight = null;
  }
  try {
    getPlayer().stop();
  } catch {
    /* nothing playing */
  }
}

/**
 * The Settings "Test voice" button. Uses the values on screen (even unsaved), bypasses a
 * cooldown because the user asked, and says plainly what happened.
 */
export async function testSarvamVoice(
  override: Partial<SarvamSettings> = {},
  sample = "नमस्ते, मैं FRIDAY हूँ। आपकी आवाज़ सुनकर अच्छा लगा। बताइए, मैं कैसे मदद करूँ?",
): Promise<{ ok: boolean; message: string }> {
  const s = normalizeSarvamSettings({ ...settings, ...override });
  if (!s.apiKey) return { ok: false, message: "Add your Sarvam API key first." };
  if (isOffline()) return { ok: false, message: "You're offline, so Sarvam can't be reached." };
  stopSarvam();
  const myRun = ++run;
  const controller = new AbortController();
  inflight = controller;
  try {
    const audio = await synthesizeChunk(sample, s, controller.signal);
    if (myRun !== run) return { ok: true, message: "Stopped." };
    try {
      await getPlayer().play(audio, s.volume);
    } catch {
      noteFailure(new SarvamError("playback", FRIENDLY.playback));
      return {
        ok: false,
        message:
          "Sarvam answered, but this phone could not play the audio. FRIDAY will use the phone's own voice.",
      };
    }
    // The key works: clear any earlier pause caused by it.
    if (s.apiKey === settings.apiKey) {
      cooldownUntil = 0;
      cooldownReason = "";
    }
    noteSuccess();
    return { ok: true, message: "Voice played. If you heard it, Sarvam is working." };
  } catch (e) {
    if (myRun !== run) return { ok: true, message: "Stopped." };
    const err = e instanceof SarvamError ? e : new SarvamError("network", FRIENDLY.network);
    if (s.apiKey === settings.apiKey) noteFailure(err);
    return { ok: false, message: `Couldn't play the voice: ${err.message}.` };
  } finally {
    if (inflight === controller) inflight = null;
  }
}
