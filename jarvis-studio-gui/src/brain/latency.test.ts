import { beforeEach, describe, expect, it, vi } from "vitest";
import { latencySummary, noteHeard, resetLatency, turnEnd, turnReplied, turnStart } from "./latency";

describe("latency tracker", () => {
  beforeEach(() => {
    resetLatency();
    vi.restoreAllMocks();
  });

  it("splits a turn into think and speak and adds the recognition time", () => {
    const t = vi.spyOn(performance, "now");
    noteHeard(700);
    t.mockReturnValue(1_000);
    turnStart();
    t.mockReturnValue(2_500);
    turnReplied();
    t.mockReturnValue(5_000);
    turnEnd(true);
    const s = latencySummary();
    expect(s.hearMs).toBe(700);
    expect(s.thinkMs).toBe(1_500);
    expect(s.speakMs).toBe(2_500);
    expect(s.totalMs).toBe(4_700);
  });

  it("a typed question has no recognition time and no speech time when muted", () => {
    const t = vi.spyOn(performance, "now");
    t.mockReturnValue(10);
    turnStart();
    t.mockReturnValue(410);
    turnReplied();
    turnEnd(false);
    const s = latencySummary();
    expect(s.hearMs).toBeNull();
    expect(s.thinkMs).toBe(400);
    expect(s.speakMs).toBeNull();
  });
});
