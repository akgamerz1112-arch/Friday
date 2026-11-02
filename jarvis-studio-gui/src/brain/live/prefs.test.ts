import { afterEach, describe, expect, it } from "vitest";
import { getLiveOnLaunch, setLiveOnLaunch } from "./prefs";

const g = globalThis as any;
afterEach(() => {
  delete g.localStorage;
});

describe("live on launch", () => {
  it("defaults to on, also when storage is missing", () => {
    expect(getLiveOnLaunch()).toBe(true);
    g.localStorage = { getItem: () => null, setItem: () => {} };
    expect(getLiveOnLaunch()).toBe(true);
  });
  it("remembers off and on", () => {
    const m = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
    setLiveOnLaunch(false);
    expect(getLiveOnLaunch()).toBe(false);
    setLiveOnLaunch(true);
    expect(getLiveOnLaunch()).toBe(true);
  });
  it("does not throw when storage throws", () => {
    g.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(getLiveOnLaunch()).toBe(true);
    setLiveOnLaunch(false);
  });
});
