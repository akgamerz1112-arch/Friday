/**
 * One Gemini Live conversation over a WebSocket: connect, stream audio both ways, survive a dropped
 * connection, and measure the real delay. No browser audio in here (see mic.ts / player.ts), so it is
 * testable with a fake WebSocket.
 */
import { classifyClose, type CloseVerdict } from "./keyring";
import {
  audioMessage,
  audioStreamEndMessage,
  buildSetup,
  contextTurnsMessage,
  liveWsUrl,
  parseServerMessage,
  textMessage,
  toolResponseMessage,
  type LiveCall,
  type LiveCallResult,
  type LiveEvent,
  type LiveSetupOptions,
} from "./protocol";

export type SessionState = "idle" | "connecting" | "ready" | "reconnecting" | "closed";

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}
export type SocketCtor = new (url: string) => SocketLike;

export interface Turn {
  role: "user" | "model";
  text: string;
}

export interface LiveSessionOptions {
  apiKey: string;
  setup: Omit<LiveSetupOptions, "resumptionHandle">;
  onEvent: (e: LiveEvent) => void;
  onState: (s: SessionState, detail?: string) => void;
  /** Delay between the user's last spoken sound and the model's first audio (includes the server's end-of-speech wait). */
  onFirstAudio?: (ms: number) => void;
  /** A finished piece of the conversation (for the chat log / memory). */
  onTurn?: (t: Turn) => void;
  /** The server refused the current key (quota used up / key invalid). Return the next key to try, or null to give up. */
  /** The model asked to run tools. Return one result per call (same ids); they are sent back for it. */
  onToolCall?: (calls: LiveCall[]) => Promise<LiveCallResult[]>;
  onKeyRefused?: (verdict: Exclude<CloseVerdict, "other">, why: string) => { key: string; note: string } | null;
  SocketCtor?: SocketCtor;
  now?: () => number;
  maxReconnects?: number;
  backoffMs?: number[];
}

const OPEN = 1;

export class LiveSession {
  private ws: SocketLike | null = null;
  private state: SessionState = "idle";
  private handle: string | null = null;
  private userClosed = false;
  private reconnects = 0;
  private lastVoicedAt = 0;
  private awaitingFirstAudio = true;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private turns: Turn[] = [];
  private userBuf = "";
  private modelBuf = "";
  /** Mic chunks thrown away because the link was down (shown to the user, never hidden). */
  droppedChunks = 0;

  private readonly o: LiveSessionOptions;
  private key: string;
  constructor(o: LiveSessionOptions) {
    this.o = o;
    this.key = o.apiKey;
  }

  get current(): SessionState {
    return this.state;
  }

  /** Resolves when the server accepted the setup; rejects with the server's reason if it did not. */
  connect(): Promise<void> {
    this.userClosed = false;
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.open("connecting");
    });
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private set(s: SessionState, detail?: string) {
    this.state = s;
    this.o.onState(s, detail);
  }

  private open(kind: "connecting" | "reconnecting") {
    this.set(kind);
    const Ctor = this.o.SocketCtor ?? (globalThis as any).WebSocket;
    const ws: SocketLike = new Ctor(liveWsUrl(this.key));
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify(buildSetup({ ...this.o.setup, resumptionHandle: this.handle ?? undefined })));
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      void this.decode(ev.data).then((text) => text !== null && this.handleText(text, ws));
    };
    ws.onerror = () => {
      /* the close event that follows carries the reason */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.onClosed(ev.code, ev.reason);
    };
  }

  private async decode(data: unknown): Promise<string | null> {
    if (typeof data === "string") return data;
    if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    return null;
  }

  private handleText(text: string, ws: SocketLike) {
    if (this.ws !== ws) return;
    for (const e of parseServerMessage(text)) this.handleEvent(e);
  }

  private handleEvent(e: LiveEvent) {
    switch (e.type) {
      case "setupComplete": {
        const wasReconnect = this.state === "reconnecting";
        this.reconnects = 0;
        this.set("ready");
        // No server-side handle to resume from: give the model the last few turns again.
        if (wasReconnect && !this.handle && this.turns.length) {
          this.send(contextTurnsMessage(this.turns.slice(-6), false));
        }
        this.readyResolve?.();
        this.readyResolve = this.readyReject = null;
        break;
      }
      case "audio":
        if (this.awaitingFirstAudio) {
          this.awaitingFirstAudio = false;
          if (this.lastVoicedAt) this.o.onFirstAudio?.(Math.max(0, this.now() - this.lastVoicedAt));
        }
        break;
      case "inputText":
        this.userBuf += e.text;
        break;
      case "outputText":
        this.flushUser();
        this.modelBuf += e.text;
        break;
      case "interrupted":
        this.flushModel();
        this.awaitingFirstAudio = true;
        break;
      case "turnComplete":
        this.flushUser();
        this.flushModel();
        this.awaitingFirstAudio = true;
        break;
      case "resumption":
        if (e.handle) this.handle = e.handle;
        break;
      case "toolCall": {
        const ws = this.ws;
        const run = this.o.onToolCall;
        if (!e.calls.length) break;
        const refuse = (why: string) =>
          e.calls.map((c) => ({ id: c.id, name: c.name, response: { ok: false, error: why } }));
        if (!run) {
          this.send(toolResponseMessage(refuse("No tools are available in this session.")));
          break;
        }
        // The answer goes back on the SAME connection only (a reconnect would not know these ids).
        void run(e.calls)
          .then((res) => {
            if (this.ws === ws) this.send(toolResponseMessage(res));
          })
          .catch((err) => {
            if (this.ws === ws) this.send(toolResponseMessage(refuse(String(err?.message || err))));
          });
        break;
      }
      case "goAway":
        // The server is about to drop us (sessions are time-limited): move to a fresh connection now.
        this.reconnectNow("goAway");
        break;
      default:
        break;
    }
    this.o.onEvent(e);
  }

  private flushUser() {
    const t = this.userBuf.trim();
    this.userBuf = "";
    if (t) this.push({ role: "user", text: t });
  }
  private flushModel() {
    const t = this.modelBuf.trim();
    this.modelBuf = "";
    if (t) this.push({ role: "model", text: t });
  }
  private push(t: Turn) {
    this.turns.push(t);
    if (this.turns.length > 40) this.turns.shift();
    this.o.onTurn?.(t);
  }

  private reconnectNow(why: string) {
    if (this.userClosed || this.state === "reconnecting") return;
    const old = this.ws;
    this.ws = null;
    try {
      old?.close(1000, why);
    } catch {
      /* already closed */
    }
    this.open("reconnecting");
  }

  private onClosed(code?: number, reason?: string) {
    this.ws = null;
    const why = reason || (code ? `code ${code}` : "connection closed");
    if (this.userClosed) {
      this.set("closed", "ended");
      return;
    }
    // The key itself was refused (quota / invalid): try the next Gemini key, same conversation context.
    const verdict = classifyClose(code, reason);
    if (verdict !== "other" && this.o.onKeyRefused) {
      const next = this.o.onKeyRefused(verdict, why);
      if (next) {
        this.key = next.key;
        this.handle = null; // a resumption handle belongs to the old key; recent turns are replayed instead
        this.set("reconnecting", next.note);
        setTimeout(() => {
          if (!this.userClosed && !this.ws) this.open("reconnecting");
        }, 0);
        return;
      }
    }
    // Closed before the setup was accepted = the server said no (bad key, unknown model...). Don't loop.
    if (this.readyReject) {
      this.readyReject(new Error(why));
      this.readyResolve = this.readyReject = null;
      this.set("closed", why);
      return;
    }
    const max = this.o.maxReconnects ?? 3;
    if (this.reconnects >= max) {
      this.set("closed", `lost connection (${why})`);
      return;
    }
    const wait = (this.o.backoffMs ?? [300, 800, 1500])[Math.min(this.reconnects, 2)] ?? 1500;
    this.reconnects++;
    this.set("reconnecting", why);
    setTimeout(() => {
      if (!this.userClosed && !this.ws) this.open("reconnecting");
    }, wait);
  }

  private send(obj: unknown): boolean {
    if (!this.ws || this.ws.readyState !== OPEN || this.state !== "ready") return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  /** `voiced` = this chunk contains speech (used only to time the reply). */
  sendAudio(base64Pcm16k: string, voiced: boolean): void {
    if (voiced) this.lastVoicedAt = this.now();
    if (!this.send(audioMessage(base64Pcm16k))) this.droppedChunks++;
  }
  endAudioStream(): void {
    this.send(audioStreamEndMessage());
  }
  sendText(text: string): void {
    this.send(textMessage(text));
  }

  close(): void {
    this.userClosed = true;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "user ended");
    } catch {
      /* already closed */
    }
    this.readyReject?.(new Error("ended"));
    this.readyResolve = this.readyReject = null;
    this.set("closed", "ended");
  }
}
