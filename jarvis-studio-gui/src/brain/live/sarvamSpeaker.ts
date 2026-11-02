/**
 * Speaks Gemini Live's reply with FRIDAY's own voice (Sarvam, with the phone's voice as the fallback that
 * webSpeechTTS already has) instead of Gemini's audio.
 *
 * How: Live still produces audio, but the controller drops it. What the model SAID arrives as text
 * (`outputAudioTranscription`); this class cuts that text into sentences as it streams in and speaks them one
 * after another. A newer piece never cuts the one playing (the speak function is awaited), and stop() ends
 * everything at once (the user interrupts, Live ends).
 *
 * Honest cost: the first words come after the model has written a full sentence plus one Sarvam request, so
 * the voice starts a little later than Gemini's own audio would.
 */

/** A sentence longer than this is cut at a comma/space so the voice can start. */
export const MAX_PIECE = 160;
/** No new text for this long = the reply is finished (late transcript chunks must not wait for the next turn). */
export const IDLE_FLUSH_MS = 600;

/**
 * Split streamed reply text into speakable sentences. `rest` is the unfinished tail to keep for the next chunk.
 * `final` = nothing more is coming: speak the tail too.
 */
export function takeSentences(buf: string, final: boolean): { say: string[]; rest: string } {
  const say: string[] = [];
  const re = /[.!?।]+["'”’)\]]*\s+|\n+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    const end = m.index + m[0].length;
    const s = buf.slice(start, end).trim();
    if (s) say.push(s);
    start = end;
  }
  let rest = buf.slice(start);
  while (rest.length > MAX_PIECE) {
    const head = rest.slice(0, MAX_PIECE);
    let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("، "));
    if (cut < 40) cut = head.lastIndexOf(" ");
    if (cut < 20) cut = MAX_PIECE;
    const s = rest.slice(0, cut + 1).trim();
    if (s) say.push(s);
    rest = rest.slice(cut + 1);
  }
  if (final) {
    const s = rest.trim();
    if (s) say.push(s);
    rest = "";
  }
  return { say, rest };
}

export interface LiveSpeakerOptions {
  /** Speak this text and resolve when finished (or cut). Must not reject for a normal stop. */
  speak: (text: string) => Promise<void>;
  /** Cut whatever is playing right now. */
  stopNow: () => void;
  /** Called when speech starts / ends (drives the screen animation). */
  onBusy?: (busy: boolean) => void;
}

export class LiveSpeaker {
  private buf = "";
  private queue: string[] = [];
  private gen = 0;
  private running = false;
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly o: LiveSpeakerOptions) {}

  /** True while something is being spoken or waits to be. */
  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** More of the model's reply text (any chunk size). */
  feed(text: string): void {
    if (!text) return;
    this.buf += text;
    this.take(false);
    this.armIdle();
  }

  /** The model finished its turn: speak what is left. */
  endTurn(): void {
    this.clearIdle();
    this.take(true);
  }

  /** Drop everything and go quiet now. */
  stop(): void {
    this.gen += 1;
    this.clearIdle();
    this.buf = "";
    this.queue = [];
    const was = this.running;
    this.running = false;
    try {
      this.o.stopNow();
    } catch {
      /* nothing playing */
    }
    if (was) this.o.onBusy?.(false);
  }

  private armIdle(): void {
    this.clearIdle();
    if (!this.buf.trim()) return;
    this.idle = setTimeout(() => {
      this.idle = null;
      this.take(true);
    }, IDLE_FLUSH_MS);
  }

  private clearIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  private take(final: boolean): void {
    const { say, rest } = takeSentences(this.buf, final);
    this.buf = rest;
    if (say.length) {
      this.queue.push(...say);
      void this.run();
    }
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const g = this.gen;
    this.o.onBusy?.(true);
    try {
      while (g === this.gen && this.queue.length) {
        // Everything that piled up while the last piece played goes out as one request (fewer gaps).
        const text = this.queue.splice(0).join(" ");
        try {
          await this.o.speak(text);
        } catch {
          /* a failed piece is skipped; the next one still gets its turn */
        }
      }
    } finally {
      if (g === this.gen) {
        this.running = false;
        this.o.onBusy?.(false);
      }
    }
  }
}
