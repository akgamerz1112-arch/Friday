import { describe, expect, it } from "vitest";
import { buildLivePrompt } from "./persona";

describe("buildLivePrompt", () => {
  it("names the assistant by voice and says what the tools are for", () => {
    expect(buildLivePrompt({ male: false, facts: [] })).toContain("You are ZENRO");
    expect(buildLivePrompt({ male: true, facts: [] })).toContain("You are ZENRO");
    expect(buildLivePrompt({ male: false, facts: [] })).toContain("call the right tool at once");
    expect(buildLivePrompt({ male: false, facts: [] })).toContain("Never say remembering is blocked");
  });
  it("adds only the last 25 facts, cleaned and capped", () => {
    const facts = Array.from({ length: 40 }, (_, i) => `fact ${i}  \n with   spaces`);
    const p = buildLivePrompt({ male: false, facts });
    expect(p).toContain("- fact 39 with spaces");
    expect(p).not.toContain("fact 14 ");
    expect(p.split("\n").filter((l) => l.startsWith("- fact")).length).toBe(25);
  });
  it("has no facts section when there are none", () => {
    expect(buildLivePrompt({ male: false, facts: ["  "] })).not.toContain("THINGS THE USER TOLD YOU");
  });
});
