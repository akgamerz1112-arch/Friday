/**
 * Glue for one Live voice conversation: mic -> session -> speaker, with interruption.
 * Kept thin; the parts with logic (protocol, session, pcm, persona) are unit-tested.
 */
import { base64ToPcm16, pcm16ToBase64, rms } from "./pcm";
import { startMic, type Mic } from "./mic";
import { Player } from "./player";
import { LiveSession, type SessionState, type Turn } from "./session";
import { LIVE_MODEL_DEFAULT, type LiveCall, type LiveCallResult } from "./protocol";
import { KeyRing, allOutMessage, rotationNote } from "./keyring";

/** Thrown by start() when the phone wants one tap before audio may play (not a real error). */
export const NEEDS_TAP = "NEEDS_TAP";

export interface LiveControllerOptions {
  apiKey: string;
  /** All Gemini keys, in order (the first is the primary). Live moves to the next one when a key is refused. */
  apiKeys?: string[];
  systemInstruction: string;
  voiceName: string;
  model?: string;
  /** false = the mic is not sent while FRIDAY speaks (use on the loudspeaker if she keeps interrupting herself). */
  allowInterrupt: boolean;
  onState: (s: SessionState, detail?: string) => void;
  onTurn: (t: Turn) => void;
  onLevel: (level: number) => void;
  onFirstAudio: (ms: number) => void;
  /** true while her voice is actually playing (drives the animation; nothing is faked). */
  onSpeaking?: (speaking: boolean) => void;
  /** Gemini function declarations the model may call, and the runner for its calls (omit both = talk only). */
  tools?: Record<string, unknown>[];
  onToolCall?: (calls: LiveCall[]) => Promise<LiveCallResult[]>;
  /**
   * When given, Gemini's own audio is NOT played: what the model said (its text transcript) is spoken by this
   * instead (FRIDAY's Sarvam voice). Omit = Gemini's voice.
   */
  speaker?: LiveSpeakerLike;
}

/** What the controller needs from a replacement voice (LiveSpeaker in sarvamSpeaker.ts). */
export interface LiveSpeakerLike {
  feed(text: string): void;
  endTurn(): void;
  stop(): void;
  readonly busy: boolean;
}

export class LiveController {
  private ctx: AudioContext | null = null;
  private player: Player | null = null;
  private mic: Mic | null = null;
  private session: LiveSession | null = null;
  private allowInterrupt: boolean;
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private wasSpeaking = false;
  private readonly o: LiveControllerOptions;
  private readonly ring: KeyRing;
  private allOut = false;

  constructor(o: LiveControllerOptions) {
    this.o = o;
    this.ring = new KeyRing(o.apiKeys?.length ? o.apiKeys : [o.apiKey]);
    this.allowInterrupt = o.allowInterrupt;
  }

  setAllowInterrupt(v: boolean) {
    this.allowInterrupt = v;
  }

  async start(): Promise<void> {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    // A tap on "Start" lets audio run. When the screen opens by itself at app launch the WebView may keep
    // audio suspended until the first tap: say so instead of hanging.
    await Promise.race([this.ctx!.resume(), new Promise((r) => setTimeout(r, 700))]);
    if (this.ctx!.state !== "running") {
      try {
        await this.ctx!.close();
      } catch {
        /* already closed */
      }
      this.ctx = null;
      throw new Error(NEEDS_TAP);
    }
    this.player = new Player(this.ctx!);
    this.speakTimer = setInterval(() => {
      const now = (this.player?.playing ?? false) || (this.o.speaker?.busy ?? false);
      if (now !== this.wasSpeaking) {
        this.wasSpeaking = now;
        this.o.onSpeaking?.(now);
      }
    }, 120);
    this.session = new LiveSession({
      apiKey: this.ring.current,
      onKeyRefused: (verdict) => {
        const from = this.ring.position;
        const next = this.ring.rotate();
        if (!next) {
          this.allOut = true;
          return null;
        }
        return { key: next.key, note: rotationNote(from, next.position, this.ring.size, verdict) };
      },
      setup: {
        model: this.o.model || LIVE_MODEL_DEFAULT,
        systemInstruction: this.o.systemInstruction,
        voiceName: this.o.voiceName,
        tools: this.o.tools,
      },
      onToolCall: this.o.onToolCall,
      onState: (st, detail) => this.o.onState(st, st === "closed" && this.allOut ? allOutMessage(this.ring.size) : detail),
      onTurn: this.o.onTurn,
      onFirstAudio: this.o.onFirstAudio,
      onEvent: (e) => {
        const sp = this.o.speaker;
        if (e.type === "audio") {
          if (!sp) this.player?.enqueue(base64ToPcm16(e.data), e.rate); // with a replacement voice Gemini's audio is dropped
        } else if (e.type === "interrupted") {
          this.player?.stop();
          sp?.stop();
        } else if (sp) {
          if (e.type === "outputText") sp.feed(e.text);
          else if (e.type === "turnComplete" || e.type === "generationComplete") sp.endTurn();
          // The user's own words were recognised while she was speaking: that is a real interruption
          // (the server no longer knows she is "speaking", it finished generating long before the voice ends).
          else if (e.type === "inputText" && this.allowInterrupt && sp.busy) sp.stop();
        }
      },
    });
    try {
      await this.session.connect(); // throws with the server's reason if refused
    } catch (e) {
      if (this.allOut) throw new Error(allOutMessage(this.ring.size));
      throw e;
    }
    this.mic = await startMic(this.ctx!, (pcm) => {
      const level = rms(pcm);
      this.o.onLevel(level);
      if (!this.allowInterrupt && (this.player?.playing || this.o.speaker?.busy)) return; // half-duplex: don't listen to ourselves
      this.session?.sendAudio(pcm16ToBase64(pcm), level > 0.015);
    });
  }

  /** Type something to the model as if the user had said it (used for the command that woke Live). */
  sendText(text: string): void {
    const t = text.trim();
    if (t) this.session?.sendText(t);
  }

  get dropped(): number {
    return this.session?.droppedChunks ?? 0;
  }

  async stop(): Promise<void> {
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.speakTimer = null;
    if (this.wasSpeaking) this.o.onSpeaking?.(false);
    this.wasSpeaking = false;
    this.mic?.stop();
    this.mic = null;
    this.player?.stop();
    this.o.speaker?.stop();
    this.session?.endAudioStream();
    this.session?.close();
    this.session = null;
    try {
      await this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.player = null;
  }
}
