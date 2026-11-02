import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_FLUSH_MS, LiveSpeaker, MAX_PIECE, takeSentences } from "./sarvamSpeaker";

describe("takeSentences", () => {
  it("keeps an unfinished tail and returns whole sentences", () => {
    const r = takeSentences("नमस्ते। आप कैसे हैं? मैं ठी", false);
    expect(r.say).toEqual(["नमस्ते।", "आप कैसे हैं?"]);
    expect(r.rest).toBe("मैं ठी");
  });
  it("does not split inside a decimal number", () => {
    expect(takeSentences("Temperature is 3.5 degrees and rising", false).say).toEqual([]);
  });
  it("a final call speaks the tail", () => {
    expect(takeSentences("बस इतना ही", true)).toEqual({ say: ["बस इतना ही"], rest: "" });
  });
  it("a sentence end at the very end waits for the next chunk (or the final flush)", () => {
    expect(takeSentences("Done.", false)).toEqual({ say: [], rest: "Done." });
    expect(takeSentences("Done.", true).say).toEqual(["Done."]);
  });
  it("cuts a very long run-on at a comma so the voice can start", () => {
    const long = "word, ".repeat(60);
    const r = takeSentences(long, false);
    expect(r.say.length).toBeGreaterThan(0);
    expect(r.say.every((s) => s.length <= MAX_PIECE)).toBe(true);
  });
});

describe("LiveSpeaker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const spoken: string[] = [];
    let release: (() => void) | null = null;
    const stopNow = vi.fn(() => release?.());
    const sp = new LiveSpeaker({
      speak: (t) =>
        new Promise<void>((res) => {
          spoken.push(t);
          release = res;
        }),
      stopNow,
    });
    return { sp, spoken, stopNow, finish: () => release?.() };
  };

  it("speaks sentences in order and never overlaps", async () => {
    const { sp, spoken, finish } = make();
    sp.feed("पहला वाक्य। दूसरा वाक्य। ");
    expect(spoken).toEqual(["पहला वाक्य। दूसरा वाक्य।"]);
    sp.feed("तीसरा। चौथा। ");
    expect(spoken.length).toBe(1); // still playing the first request
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(spoken[1]).toBe("तीसरा। चौथा।");
  });

  it("flushes a trailing sentence when no more text arrives", async () => {
    const { sp, spoken } = make();
    sp.feed("बस एक वाक्य।");
    expect(spoken).toEqual([]);
    await vi.advanceTimersByTimeAsync(IDLE_FLUSH_MS + 5);
    expect(spoken).toEqual(["बस एक वाक्य।"]);
  });

  it("endTurn speaks the tail at once", () => {
    const { sp, spoken } = make();
    sp.feed("अधूरा");
    sp.endTurn();
    expect(spoken).toEqual(["अधूरा"]);
  });

  it("stop cuts playback, clears the queue and the buffer", async () => {
    const { sp, spoken, stopNow } = make();
    sp.feed("एक। दो। ");
    sp.feed("तीन। चार। ");
    expect(sp.busy).toBe(true);
    sp.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(stopNow).toHaveBeenCalled();
    expect(sp.busy).toBe(false);
    expect(spoken.length).toBe(1);
  });

  it("works again after a stop", async () => {
    const { sp, spoken } = make();
    sp.feed("पुराना। ठीक। ");
    sp.stop();
    sp.feed("नया। वाक्य। ");
    expect(spoken[spoken.length - 1]).toBe("नया। वाक्य।");
  });
});
