/** Plays the model's 24 kHz PCM as it arrives, and can cut it off instantly. Browser-only. */
import { pcm16ToFloat } from "./pcm";

const LEAD_S = 0.06; // small cushion so chunks that arrive unevenly still play smoothly

export class Player {
  private readonly ctx: AudioContext;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  enqueue(pcm: Int16Array, rate = 24_000): void {
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, rate);
    buf.getChannelData(0).set(pcm16ToFloat(pcm));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + LEAD_S, this.next);
    src.start(at);
    this.next = at + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** True while queued audio is still to be heard. */
  get playing(): boolean {
    return this.sources.size > 0 && this.next > this.ctx.currentTime;
  }

  /** The user cut in (or the server said "interrupted"): drop everything queued, right now. */
  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started yet */
      }
    }
    this.sources.clear();
    this.next = 0;
  }
}
