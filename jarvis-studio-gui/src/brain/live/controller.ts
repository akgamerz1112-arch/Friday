/**
 * Glue for one Live voice conversation: mic -> session -> speaker, with interruption.
 * Kept thin; the parts with logic (protocol, session, pcm, persona) are unit-tested.
 */
import { base64ToPcm16, pcm16ToBase64, rms } from "./pcm";
import { startMic, type Mic } from "./mic";
import { Player } from "./player";
import { LiveSession, type SessionState, type Turn } from "./session";
import { LIVE_MODEL_DEFAULT } from "./protocol";

/** Thrown by start() when the phone wants one tap before audio may play (not a real error). */
export const NEEDS_TAP = "NEEDS_TAP";

export interface LiveControllerOptions {
  apiKey: string;
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

  constructor(o: LiveControllerOptions) {
    this.o = o;
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
      const now = this.player?.playing ?? false;
      if (now !== this.wasSpeaking) {
        this.wasSpeaking = now;
        this.o.onSpeaking?.(now);
      }
    }, 120);
    this.session = new LiveSession({
      apiKey: this.o.apiKey,
      setup: {
        model: this.o.model || LIVE_MODEL_DEFAULT,
        systemInstruction: this.o.systemInstruction,
        voiceName: this.o.voiceName,
      },
      onState: this.o.onState,
      onTurn: this.o.onTurn,
      onFirstAudio: this.o.onFirstAudio,
      onEvent: (e) => {
        if (e.type === "audio") this.player?.enqueue(base64ToPcm16(e.data), e.rate);
        else if (e.type === "interrupted") this.player?.stop();
      },
    });
    await this.session.connect(); // throws with the server's reason if refused
    this.mic = await startMic(this.ctx!, (pcm) => {
      const level = rms(pcm);
      this.o.onLevel(level);
      if (!this.allowInterrupt && this.player?.playing) return; // half-duplex: don't listen to ourselves
      this.session?.sendAudio(pcm16ToBase64(pcm), level > 0.015);
    });
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
