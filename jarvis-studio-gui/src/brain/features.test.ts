import { describe, expect, it } from "vitest";
import { evaluateFeatures, FEATURES, type FeatureContext } from "./features";

const base: FeatureContext = {
  sysInfo: { wake_word: true, has_groq_key: true },
  sarvam: { configured: true, enabled: true, active: true, coolingDown: false, cooldownUntil: 0, reason: "", lastError: "" },
  call: { on: true, access: false },
  accessibility: true,
  speechVoices: 12,
};

describe("feature registry", () => {
  it("has unique ids", () => {
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("warns when call announcing is on without notification access", () => {
    const row = evaluateFeatures(base).find((r) => r.id === "calls.announce");
    expect(row?.state).toBe("warn");
  });
  it("reports off-device as off, not as failing", () => {
    const rows = evaluateFeatures({ ...base, call: null, accessibility: null });
    expect(rows.find((r) => r.id === "phone.control")?.state).toBe("off");
  });
});
