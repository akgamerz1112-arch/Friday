import { describe, expect, it } from "vitest";
import { audioMessage, buildSetup, parseServerMessage, LIVE_MODEL_DEFAULT } from "./protocol";
import { base64ToPcm16, floatToPcm16, pcm16ToBase64, pcm16ToFloat, rms } from "./pcm";
import { LiveSession, type SessionState, type SocketLike } from "./session";
import type { LiveEvent } from "./protocol";

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

const tick = () => new Promise((r) => setTimeout(r, 0));

function make(extra: Record<string, unknown> = {}) {
  FakeWS.all = [];
  const states: string[] = [];
  const events: LiveEvent[] = [];
  const turns: any[] = [];
  const firsts: number[] = [];
  let t = 1000;
  const s = new LiveSession({
    apiKey: "K",
    setup: { systemInstruction: "be nice" },
    SocketCtor: FakeWS as any,
    onEvent: (e) => events.push(e),
    onState: (st: SessionState, d) => states.push(d ? `${st}:${d}` : st),
    onTurn: (x) => turns.push(x),
    onFirstAudio: (ms) => firsts.push(ms),
    now: () => t,
    backoffMs: [1, 1, 1],
    ...extra,
  });
  return { s, states, events, turns, firsts, advance: (ms: number) => (t += ms) };
}

describe("protocol", () => {
  it("builds a setup with the documented fields and no thinkingLevel", () => {
    const m: any = buildSetup({ systemInstruction: "hi", voiceName: "Kore" });
    expect(m.setup.model).toBe(`models/${LIVE_MODEL_DEFAULT}`);
    expect(m.setup.generationConfig.responseModalities[0]).toBe("AUDIO");
    expect(m.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
    expect(m.setup.systemInstruction.parts[0].text).toBe("hi");
    expect(JSON.stringify(m)).not.toContain("thinkingLevel");
    expect(m.setup.sessionResumption).toEqual({});
  });

  it("passes a resumption handle and strips a leading models/", () => {
    const m: any = buildSetup({ systemInstruction: "x", model: "models/foo", resumptionHandle: "H1" });
    expect(m.setup.model).toBe("models/foo");
    expect(m.setup.sessionResumption.handle).toBe("H1");
  });

  it("parses everything in one server message, interruption first", () => {
    const ev = parseServerMessage({
      serverContent: {
        interrupted: true,
        modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAAA" } }, { text: "ignored" }] },
        outputTranscription: { text: "Namaste" },
        turnComplete: true,
      },
    });
    expect(ev.map((e) => e.type)).toEqual(["interrupted", "audio", "outputText", "turnComplete"]);
  });

  it("parses goAway, resumption, tool calls and ignores junk", () => {
    expect(parseServerMessage({ goAway: { timeLeft: "30s" } })[0]).toEqual({ type: "goAway", timeLeftMs: 30000 });
    expect(parseServerMessage({ sessionResumptionUpdate: { newHandle: "h", resumable: true } })[0]).toEqual({
      type: "resumption",
      handle: "h",
      resumable: true,
    });
    expect(parseServerMessage({ toolCall: { functionCalls: [{ name: "x", id: "1" }] } })[0]).toEqual({
      type: "toolCall",
      names: ["x"],
    });
    expect(parseServerMessage("not json")).toEqual([]);
    expect(parseServerMessage(42)).toEqual([]);
  });

  it("audio message carries the 16 kHz mime type", () => {
    expect(audioMessage("QQ==").realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
  });
});

describe("pcm", () => {
  it("round-trips 16-bit samples through base64 (little-endian, negatives kept)", () => {
    const a = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    expect(Array.from(base64ToPcm16(pcm16ToBase64(a)))).toEqual(Array.from(a));
  });

  it("downsamples 48 kHz to 16 kHz (3:1) and clamps", () => {
    const f = new Float32Array(48).fill(0.5);
    f[0] = 2;
    const out = floatToPcm16(f, 48000, 16000);
    expect(out.length).toBe(16);
    expect(out[5]).toBe(16384);
    expect(out[0] <= 32767).toBe(true);
  });

  it("float conversion and loudness", () => {
    expect(pcm16ToFloat(Int16Array.from([32767, -32768]))[0]).toBe(1);
    expect(rms(new Int16Array(10))).toBe(0);
    expect(rms(Int16Array.from([16384, -16384])) > 0.4).toBe(true);
  });
});

describe("session", () => {
  it("sends setup on open and is ready after setupComplete", async () => {
    const { s, states } = make();
    const p = s.connect();
    const ws = FakeWS.all[0]!;
    expect(ws.url).toContain("key=K");
    ws.open();
    expect(ws.sent[0].setup.model).toBe(`models/${LIVE_MODEL_DEFAULT}`);
    ws.push({ setupComplete: {} });
    await p;
    expect(states).toEqual(["connecting", "ready"]);
  });

  it("rejects with the server's reason when the setup is refused (no retry loop)", async () => {
    const { s, states } = make();
    const p = s.connect();
    const ws = FakeWS.all[0]!;
    ws.open();
    ws.close(1007, "Invalid model");
    let msg = "";
    try {
      await p;
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe("Invalid model");
    expect(states[states.length - 1]).toBe("closed:Invalid model");
    expect(FakeWS.all.length).toBe(1);
  });

  it("measures time from the last spoken chunk to the first reply audio, once per turn", async () => {
    const { s, firsts, advance } = make();
    const p = s.connect();
    const ws = FakeWS.all[0]!;
    ws.open();
    ws.push({ setupComplete: {} });
    await p;
    s.sendAudio("AA==", true);
    advance(850);
    s.sendAudio("AA==", false);
    advance(150);
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AA==" } }] } } });
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AA==" } }] } } });
    await tick();
    expect(firsts).toEqual([1000]);
    ws.push({ serverContent: { turnComplete: true } });
    await tick();
    s.sendAudio("AA==", true);
    advance(400);
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AA==" } }] } } });
    await tick();
    expect(firsts).toEqual([1000, 400]);
  });

  it("collects transcripts into turns", async () => {
    const { s, turns } = make();
    const p = s.connect();
    const ws = FakeWS.all[0]!;
    ws.open();
    ws.push({ setupComplete: {} });
    await p;
    ws.push({ serverContent: { inputTranscription: { text: "kya haal " } } });
    ws.push({ serverContent: { inputTranscription: { text: "hai" } } });
    ws.push({ serverContent: { outputTranscription: { text: "Badhiya!" } } });
    ws.push({ serverContent: { turnComplete: true } });
    await tick();
    expect(turns).toEqual([
      { role: "user", text: "kya haal hai" },
      { role: "model", text: "Badhiya!" },
    ]);
  });

  it("reconnects after a drop, resumes with the saved handle, and counts dropped chunks", async () => {
    const { s, states } = make();
    const p = s.connect();
    const ws1 = FakeWS.all[0]!;
    ws1.open();
    ws1.push({ setupComplete: {} });
    ws1.push({ sessionResumptionUpdate: { newHandle: "H9", resumable: true } });
    await p;
    ws1.close(1006, "network");
    expect(states[states.length - 1]).toBe("reconnecting:network");
    s.sendAudio("AA==", true); // link is down
    expect(s.droppedChunks).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    const ws2 = FakeWS.all[1]!;
    ws2.open();
    expect(ws2.sent[0].setup.sessionResumption.handle).toBe("H9");
    ws2.push({ setupComplete: {} });
    await tick();
    expect(states[states.length - 1]).toBe("ready");
  });

  it("without a handle, a reconnect replays the last turns so the chat continues", async () => {
    const { s } = make();
    const p = s.connect();
    const ws1 = FakeWS.all[0]!;
    ws1.open();
    ws1.push({ setupComplete: {} });
    await p;
    ws1.push({ serverContent: { inputTranscription: { text: "mera naam Aman hai" } } });
    ws1.push({ serverContent: { outputTranscription: { text: "Theek hai Aman." } } });
    ws1.push({ serverContent: { turnComplete: true } });
    await tick();
    ws1.close(1006, "x");
    await new Promise((r) => setTimeout(r, 10));
    const ws2 = FakeWS.all[1]!;
    ws2.open();
    ws2.push({ setupComplete: {} });
    await tick();
    const ctx = ws2.sent.find((m) => m.clientContent);
    expect(ctx.clientContent.turns.map((t: any) => t.role)).toEqual(["user", "model"]);
  });

  it("gives up after max reconnects and says so", async () => {
    const { s, states } = make({ maxReconnects: 1 });
    const p = s.connect();
    const ws1 = FakeWS.all[0]!;
    ws1.open();
    ws1.push({ setupComplete: {} });
    await p;
    ws1.close(1006, "a");
    await new Promise((r) => setTimeout(r, 10));
    const ws2 = FakeWS.all[1]!;
    ws2.open();
    ws2.close(1006, "b"); // closes again before setupComplete -> counts as a failed reconnect
    await new Promise((r) => setTimeout(r, 10));
    expect(states[states.length - 1].startsWith("closed")).toBe(true);
  });

  it("goAway moves to a new connection without the user doing anything", async () => {
    const { s } = make();
    const p = s.connect();
    const ws1 = FakeWS.all[0]!;
    ws1.open();
    ws1.push({ setupComplete: {} });
    ws1.push({ sessionResumptionUpdate: { newHandle: "H2", resumable: true } });
    await p;
    ws1.push({ goAway: { timeLeft: "10s" } });
    await tick();
    expect(FakeWS.all.length).toBe(2);
    FakeWS.all[1]!.open();
    expect(FakeWS.all[1]!.sent[0].setup.sessionResumption.handle).toBe("H2");
  });

  it("user close ends cleanly and never reconnects", async () => {
    const { s, states } = make();
    const p = s.connect();
    const ws = FakeWS.all[0]!;
    ws.open();
    ws.push({ setupComplete: {} });
    await p;
    s.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeWS.all.length).toBe(1);
    expect(states[states.length - 1]).toBe("closed:ended");
  });
});
