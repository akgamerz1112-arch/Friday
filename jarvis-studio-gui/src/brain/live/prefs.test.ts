import { afterEach, describe, expect, it } from "vitest";
import {
  getLiveOnLaunch,
  getLiveOnly,
  getLiveSarvam,
  getWakeLive,
  setLiveOnLaunch,
  setLiveOnly,
  setLiveSarvam,
  setWakeLive,
} from "./prefs";

const g = globalThis as any;
afterEach(() => {
  delete g.localStorage;
});

describe("live on launch", () => {
  it("defaults to off, also when storage is missing", () => {
    expect(getLiveOnLaunch()).toBe(false);
    g.localStorage = { getItem: () => null, setItem: () => {} };
    expect(getLiveOnLaunch()).toBe(false);
  });
  it("remembers off and on", () => {
    const m = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
    setLiveOnLaunch(false);
    expect(getLiveOnLaunch()).toBe(false);
    setLiveOnLaunch(true);
    expect(getLiveOnLaunch()).toBe(true);
  });
  it("ignores the old jarvis.liveOnLaunch key (stays off until switched on again)", () => {
    const m = new Map<string, string>([["jarvis.liveOnLaunch", "1"]]);
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
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
    expect(getLiveOnLaunch()).toBe(false);
    setLiveOnLaunch(false);
  });
});

describe("live only", () => {
  it("defaults to on and remembers off", () => {
    expect(getLiveOnly()).toBe(true);
    const m = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
    expect(getLiveOnly()).toBe(true);
    setLiveOnly(false);
    expect(getLiveOnly()).toBe(false);
    expect(getLiveOnLaunch()).toBe(false); // independent switches
  });
});

describe("Sarvam voice in Live and wake-opens-Live", () => {
  it("both default to on, also when storage is missing", () => {
    expect(getLiveSarvam()).toBe(true);
    expect(getWakeLive()).toBe(true);
  });
  it("remember off and on", () => {
    const m = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
    setLiveSarvam(false);
    setWakeLive(false);
    expect(getLiveSarvam()).toBe(false);
    expect(getWakeLive()).toBe(false);
    setLiveSarvam(true);
    setWakeLive(true);
    expect(getLiveSarvam()).toBe(true);
    expect(getWakeLive()).toBe(true);
  });
});
