import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SPOKEN_CHARS,
  __resetSarvam,
  __setSarvamIO,
  chunkForSpeech,
  classifySarvamError,
  groupBigNumbers,
  normalizeSarvamSettings,
  onSarvamCooldown,
  prepareForSarvam,
  sarvamStatus,
  setSarvamSettings,
  speakWithSarvam,
  stopSarvam,
  testSarvamVoice,
} from "./sarvamTts";

const KEY = "sk_test_key_123";

function ok(audio = "QUJD"): Response {
  return new Response(JSON.stringify({ request_id: "r", audios: [audio] }), { status: 200 });
}
function fail(status: number, code: string, message = "nope"): Response {
  return new Response(JSON.stringify({ error: { code, message, request_id: "r" } }), { status });
}

function fakePlayer() {
  const played: string[] = [];
  return {
    played,
    play: vi.fn(async (b64: string) => {
      played.push(b64);
    }),
    stop: vi.fn(),
  };
}

beforeEach(() => {
  __resetSarvam();
  __setSarvamIO();
  setSarvamSettings({ enabled: true, apiKey: KEY });
});

describe("text preparation", () => {
  it("groups 5–9 digit numbers but not years or phone numbers", () => {
    expect(groupBigNumbers("बैलेंस 12500 रुपये")).toBe("बैलेंस 12,500 रुपये");
    expect(groupBigNumbers("साल 2026")).toBe("साल 2026");
    expect(groupBigNumbers("call 9876543210")).toBe("call 9876543210");
    expect(groupBigNumbers("1,200 and 3.14159")).toBe("1,200 and 3.14159");
  });

  it("returns nothing for emoji-only or link-only text", () => {
    expect(prepareForSarvam("🤖👍")).toBe("");
    expect(prepareForSarvam("https://example.com/x")).toBe("");
    expect(prepareForSarvam("ठीक है 👍")).toBe("ठीक है");
  });

  it("chunks on sentences with a short first chunk", () => {
    const text = "पहला वाक्य है। दूसरा वाक्य यहाँ है। " + "तीसरा ".repeat(100) + "अंत।";
    const chunks = chunkForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(160);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(380);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("अंत।");
  });
});

describe("settings", () => {
  it("clamps pace and volume and rejects unknown voices", () => {
    const s = normalizeSarvamSettings({ pace: 9, volume: 0, voice: "bogus", apiKey: " k " });
    expect(s.pace).toBe(1.6);
    expect(s.volume).toBe(0.3);
    expect(s.voice).toBe("simran_hi_assistant");
    expect(s.apiKey).toBe("k");
  });
});

describe("error classification", () => {
  it("separates auth, quota and rate limits", () => {
    expect(classifySarvamError(403, null)).toBe("auth");
    expect(classifySarvamError(429, { error: { code: "insufficient_quota_error" } })).toBe("quota");
    expect(classifySarvamError(429, { error: { code: "rate_limit_exceeded_error" } })).toBe("rate");
    expect(classifySarvamError(422, null)).toBe("bad_request");
    expect(classifySarvamError(503, null)).toBe("server");
  });
});

describe("speakWithSarvam", () => {
  it("makes no request without a key, when off, or for too-long replies", async () => {
    const transport = vi.fn(async () => ok());
    __setSarvamIO({ transport, player: fakePlayer() });

    setSarvamSettings({ enabled: true, apiKey: "" });
    expect((await speakWithSarvam("नमस्ते")).done).toBe(false);
    setSarvamSettings({ enabled: false, apiKey: KEY });
    expect((await speakWithSarvam("नमस्ते")).done).toBe(false);
    setSarvamSettings({ enabled: true, apiKey: KEY });
    const long = "यह एक लंबा वाक्य है। ".repeat(Math.ceil(MAX_SPOKEN_CHARS / 10));
    const res = await speakWithSarvam(long);
    expect(res.done).toBe(false);
    expect(res.remaining).toBe(long);
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends the key only as a header, with model, speaker and pace", async () => {
    const transport = vi.fn(async (_u: string, _i: RequestInit, _t: number) => ok());
    const player = fakePlayer();
    __setSarvamIO({ transport, player });
    setSarvamSettings({ enabled: true, apiKey: KEY, pace: 1.2 });

    const res = await speakWithSarvam("नमस्ते सर।");
    expect(res).toEqual({ done: true, remaining: "" });
    expect(player.played).toEqual(["QUJD"]);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://api.sarvam.ai/text-to-speech");
    expect((init.headers as Record<string, string>)["api-subscription-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      text: "नमस्ते सर।",
      language_code: "hi-IN",
      speaker: "simran_hi_assistant",
      model: "bulbul:v4-flash",
      pace: 1.2,
    });
    expect(init.body as string).not.toContain(KEY);
  });

  it("serves a repeated short phrase from the cache", async () => {
    const transport = vi.fn(async () => ok());
    __setSarvamIO({ transport, player: fakePlayer() });
    await speakWithSarvam("ठीक है।");
    await speakWithSarvam("ठीक है।");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("hands the unspoken rest to the phone voice when a later chunk fails", async () => {
    let n = 0;
    const transport = vi.fn(async () => (++n === 1 ? ok() : fail(500, "internal_server_error")));
    __setSarvamIO({ transport, player: fakePlayer() });
    const text = "पहला वाक्य। " + "दूसरा वाक्य यहाँ है, काफ़ी लंबा। ".repeat(12);
    const res = await speakWithSarvam(text);
    expect(res.done).toBe(false);
    expect(res.remaining.length).toBeGreaterThan(0);
    expect(res.remaining).not.toContain("पहला वाक्य।");
  });

  it("pauses itself on a rejected key and stops calling", async () => {
    const transport = vi.fn(async () => fail(403, "invalid_api_key_error", "bad key"));
    __setSarvamIO({ transport, player: fakePlayer() });
    const seen: string[] = [];
    onSarvamCooldown((e) => seen.push(e.reason));

    const first = await speakWithSarvam("नमस्ते");
    expect(first).toEqual({ done: false, remaining: "नमस्ते" });
    expect(sarvamStatus().coolingDown).toBe(true);
    expect(seen).toHaveLength(1);

    await speakWithSarvam("फिर से");
    expect(transport).toHaveBeenCalledTimes(1); // no second request while paused

    setSarvamSettings({ enabled: true, apiKey: "new_key" }); // a new key clears the pause
    expect(sarvamStatus().coolingDown).toBe(false);
  });

  it("pauses after three transport failures in a row", async () => {
    const transport = vi.fn(async () => {
      throw new Error("connection reset");
    });
    __setSarvamIO({ transport, player: fakePlayer() });
    for (const t of ["एक", "दो", "तीन"]) await speakWithSarvam(t);
    expect(sarvamStatus().coolingDown).toBe(true);
  });

  it("falls back when audio cannot play", async () => {
    const player = {
      play: vi.fn(async () => {
        throw new Error("audio did not start");
      }),
      stop: vi.fn(),
    };
    __setSarvamIO({ transport: vi.fn(async () => ok()), player });
    const res = await speakWithSarvam("नमस्ते");
    expect(res).toEqual({ done: false, remaining: "नमस्ते" });
  });

  it("retries once with the other spelling of the language field", async () => {
    const bodies: Record<string, unknown>[] = [];
    const transport = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      return "language_code" in b ? fail(422, "unprocessable_entity_error", "language_code unknown") : ok();
    });
    __setSarvamIO({ transport, player: fakePlayer() });
    expect((await speakWithSarvam("नमस्ते")).done).toBe(true);
    expect(bodies[1]).toHaveProperty("target_language_code", "hi-IN");
  });

  it("drops to Bulbul v3 once when the v4 voice is refused", async () => {
    const models: string[] = [];
    const transport = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      models.push(`${b.model}/${b.speaker}`);
      return b.model === "bulbul:v4-flash" ? fail(400, "invalid_request_error", "speaker invalid") : ok();
    });
    __setSarvamIO({ transport, player: fakePlayer() });
    expect((await speakWithSarvam("नमस्ते")).done).toBe(true);
    expect(models).toEqual(["bulbul:v4-flash/simran_hi_assistant", "bulbul:v3/priya"]);
  });

  it("stop() ends playback without handing text to the phone voice", async () => {
    let release: () => void = () => {};
    const player = {
      play: vi.fn(() => new Promise<void>((r) => (release = r))),
      stop: vi.fn(() => release()),
    };
    __setSarvamIO({ transport: vi.fn(async () => ok()), player });
    const pending = speakWithSarvam("नमस्ते सर।");
    await new Promise((r) => setTimeout(r, 10));
    stopSarvam();
    expect(await pending).toEqual({ done: true, remaining: "" });
  });
});

describe("testSarvamVoice", () => {
  it("asks for a key first and never calls the network without one", async () => {
    const transport = vi.fn(async () => ok());
    __setSarvamIO({ transport, player: fakePlayer() });
    setSarvamSettings({ enabled: true, apiKey: "" });
    const res = await testSarvamVoice();
    expect(res.ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("reports a rejected key in plain words, without echoing the key", async () => {
    __setSarvamIO({ transport: vi.fn(async () => fail(403, "invalid_api_key_error")), player: fakePlayer() });
    const res = await testSarvamVoice({ apiKey: "typed_key_999" });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("did not accept");
    expect(res.message).not.toContain("typed_key_999");
  });

  it("plays the sample and clears an earlier pause on success", async () => {
    const player = fakePlayer();
    __setSarvamIO({ transport: vi.fn(async () => ok()), player });
    const res = await testSarvamVoice();
    expect(res.ok).toBe(true);
    expect(player.played).toHaveLength(1);
  });
});
