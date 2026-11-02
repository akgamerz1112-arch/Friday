import { describe, expect, it } from "vitest";
import { KeyRing, allOutMessage, classifyClose, rotationNote } from "./keyring";
import { LiveSession, type SessionState, type SocketLike } from "./session";

describe("classifyClose", () => {
  it("sees quota texts reported by the Live server", () => {
    expect(classifyClose(1011, "You exceeded your current quota, please check your plan and billing details.")).toBe("quota");
    expect(classifyClose(1011, "Resource has been exhausted (e.g. check quota).")).toBe("quota");
  });
  it("sees a bad or expired key", () => {
    expect(classifyClose(1008, "API key not valid. Please pass a valid API key.")).toBe("badkey");
    expect(classifyClose(1008, "API key expired")).toBe("badkey");
  });
  it("does not treat other closes as a key problem", () => {
    expect(classifyClose(1011, "Internal error encountered.")).toBe("other");
    expect(classifyClose(1008, "Operation is not implemented, or supported, or enabled.")).toBe("other");
    expect(classifyClose(1006, "")).toBe("other");
    expect(classifyClose(undefined, undefined)).toBe("other");
  });
});

describe("KeyRing", () => {
  it("drops blanks and duplicates, keeps order", () => {
    const r = new KeyRing([" A ", "", "B", "A", "C"]);
    expect(r.keys).toEqual(["A", "B", "C"]);
    expect(r.current).toBe("A");
    expect(r.position).toBe(1);
  });
  it("rotates through every key once, then gives up", () => {
    const r = new KeyRing(["A", "B", "C"]);
    expect(r.rotate()).toEqual({ key: "B", position: 2 });
    expect(r.rotate()).toEqual({ key: "C", position: 3 });
    expect(r.rotate()).toBeNull();
  });
  it("a single key has nowhere to go", () => {
    expect(new KeyRing(["A"]).rotate()).toBeNull();
    expect(new KeyRing([]).rotate()).toBeNull();
  });
  it("messages say what happened and never name another provider switch", () => {
    expect(rotationNote(1, 2, 4, "quota")).toBe("Key 1 ka limit khatam — key 2/4 try kar raha hoon");
    expect(allOutMessage(1)).toContain("Gemini key ka limit");
    expect(allOutMessage(5)).toContain("sabhi 5 Gemini keys");
    expect(allOutMessage(5)).toContain("nahi jaata");
  });
});

class FakeWS implements SocketLike {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  push(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}
const tick = () => new Promise((r) => setTimeout(r, 5));

function make(keys: string[]) {
  FakeWS.all = [];
  const ring = new KeyRing(keys);
  const states: string[] = [];
  const s = new LiveSession({
    apiKey: ring.current,
    setup: { systemInstruction: "x" },
    SocketCtor: FakeWS as any,
    onEvent: () => {},
    onState: (st: SessionState, d) => states.push(d ? `${st}:${d}` : st),
    onKeyRefused: (verdict) => {
      const from = ring.position;
      const n = ring.rotate();
      return n ? { key: n.key, note: rotationNote(from, n.position, ring.size, verdict) } : null;
    },
    backoffMs: [1, 1, 1],
  });
  return { s, states };
}

describe("LiveSession key rotation", () => {
  it("connect: key 1 out of quota -> key 2 is used and the connect succeeds", async () => {
    const { s, states } = make(["K1", "K2"]);
    const p = s.connect();
    FakeWS.all[0].open();
    FakeWS.all[0].close(1011, "You exceeded your current quota");
    await tick();
    expect(FakeWS.all).toHaveLength(2);
    expect(FakeWS.all[1].url).toContain("key=K2");
    expect(states.some((x) => x.startsWith("reconnecting:Key 1 ka limit khatam"))).toBe(true);
    FakeWS.all[1].open();
    FakeWS.all[1].push({ setupComplete: {} });
    await p;
    expect(s.current).toBe("ready");
  });

  it("connect: every key refused -> rejects, no endless loop", async () => {
    const { s } = make(["K1", "K2"]);
    const p = s.connect();
    let failed = "";
    p.catch((e) => (failed = String(e.message)));
    FakeWS.all[0].open();
    FakeWS.all[0].close(1011, "quota exceeded");
    await tick();
    FakeWS.all[1].open();
    FakeWS.all[1].close(1011, "quota exceeded");
    await tick();
    expect(FakeWS.all).toHaveLength(2);
    expect(failed).toContain("quota");
    expect(s.current).toBe("closed");
  });

  it("mid-conversation quota -> next key, a plain internal error keeps the same key", async () => {
    const { s } = make(["K1", "K2"]);
    const p = s.connect();
    FakeWS.all[0].open();
    FakeWS.all[0].push({ setupComplete: {} });
    await p;
    FakeWS.all[0].close(1011, "Internal error encountered.");
    await tick();
    await tick();
    expect(FakeWS.all[1].url).toContain("key=K1");
    FakeWS.all[1].open();
    FakeWS.all[1].push({ setupComplete: {} });
    await tick();
    FakeWS.all[1].close(1011, "Resource has been exhausted (e.g. check quota).");
    await tick();
    await tick();
    expect(FakeWS.all[2].url).toContain("key=K2");
  });
});
