/**
 * Real latency of the voice turn, measured on the phone (nothing here is estimated).
 *   hear  = clip ready -> transcript   (speech recognition, over the network)
 *   think = question sent -> reply text (model routing + model + tools)
 *   speak = reply text -> speech finished (TTS; includes the time the words take to say)
 *   total = clip ready (or question sent) -> speech finished
 * The last 30 turns are kept in memory only; Settings > System > Voice speed shows them.
 */
export interface Turn {
  hearMs: number | null;
  thinkMs: number;
  speakMs: number;
  totalMs: number;
  at: number;
}

const KEEP = 30;
const turns: Turn[] = [];
let heard: { ms: number; at: number } | null = null;
let cur: { t0: number; replied?: number } | null = null;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Speech recognition finished: [ms] from the clip being ready to the transcript. */
export function noteHeard(ms: number): void {
  heard = { ms, at: now() };
}

/** The question goes to the brain. */
export function turnStart(): void {
  cur = { t0: now() };
}

/** The reply text is ready. */
export function turnReplied(): void {
  if (cur) cur.replied = now();
}

/** Speech finished (or there was none). */
export function turnEnd(spoke: boolean): void {
  if (!cur) return;
  const end = now();
  const replied = cur.replied ?? end;
  // A transcript older than 60 s belongs to some other turn (typed or tapped question).
  const hearMs = heard && cur.t0 - heard.at < 60_000 ? heard.ms : null;
  const turn: Turn = {
    hearMs,
    thinkMs: Math.round(replied - cur.t0),
    speakMs: spoke ? Math.round(end - replied) : 0,
    totalMs: Math.round(end - cur.t0 + (hearMs ?? 0)),
    at: Date.now(),
  };
  turns.push(turn);
  if (turns.length > KEEP) turns.shift();
  cur = null;
  heard = null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

export function latencySummary() {
  return {
    count: turns.length,
    hearMs: median(turns.map((t) => t.hearMs).filter((x): x is number => x !== null)),
    thinkMs: median(turns.map((t) => t.thinkMs)),
    speakMs: median(turns.filter((t) => t.speakMs > 0).map((t) => t.speakMs)),
    totalMs: median(turns.map((t) => t.totalMs)),
    last: turns.length ? turns[turns.length - 1] : null,
  };
}

export function resetLatency(): void {
  turns.length = 0;
  heard = null;
  cur = null;
}
