import { describe, expect, it } from "vitest";
import { matchMemoryCommand, runMemoryCommand } from "./quickMemory";
import { PersistentStore } from "./store";

describe("matchMemoryCommand", () => {
  it("remember, in Hinglish, Hindi and English", () => {
    expect(matchMemoryCommand("yaad rakhna ki mujhe chai pasand hai")).toEqual({ type: "remember", fact: "mujhe chai pasand hai" });
    expect(matchMemoryCommand("Hey Jarvis, remember that my sister is Riya")).toEqual({ type: "remember", fact: "my sister is Riya" });
    expect(matchMemoryCommand("मेरी मीटिंग रोज़ 5 बजे होती है याद रखना")).toEqual({ type: "remember", fact: "मेरी मीटिंग रोज़ 5 बजे होती है" });
  });
  it("forget and recall", () => {
    expect(matchMemoryCommand("bhool jao chai wali baat")).toEqual({ type: "forget", what: "chai wali baat" });
    expect(matchMemoryCommand("mere bare me kya yaad hai")).toEqual({ type: "recall" });
  });
  it("ignores everything else", () => {
    expect(matchMemoryCommand("torch on karo")).toBeNull();
    expect(matchMemoryCommand("yaad")).toBeNull();
  });
});

describe("runMemoryCommand", () => {
  it("saves, recalls, refuses secrets, forgets", async () => {
    const store = new PersistentStore();
    await store.forget("everything");
    expect(await runMemoryCommand({ type: "remember", fact: "mujhe chai pasand hai" }, store)).toContain("याद रख लिया");
    expect(await runMemoryCommand({ type: "remember", fact: "wifi password hunter22" }, store)).toContain("नहीं रखूँगा");
    expect(await runMemoryCommand({ type: "recall" }, store)).toContain("mujhe chai pasand hai");
    expect(await runMemoryCommand({ type: "forget", what: "chai" }, store)).toContain("हटा दिया");
    expect(await runMemoryCommand({ type: "recall" }, store)).toContain("कुछ सेव नहीं");
  });
  it("never wipes everything by voice", async () => {
    const store = new PersistentStore();
    await store.remember("keep me");
    await runMemoryCommand({ type: "forget", what: "sab kuch" }, store);
    expect((await store.listFacts()).length).toBe(1);
  });
});
