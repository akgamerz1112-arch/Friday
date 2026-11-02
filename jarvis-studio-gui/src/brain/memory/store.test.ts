import { describe, expect, it } from "vitest";
import { PersistentStore, keywordRank } from "./store";

describe("keywordRank", () => {
  const facts = [
    "User's favorite coffee is a flat white",
    "User works as a software engineer",
    "User has a dog named Biscuit",
    "User lives in Mumbai",
    "User prefers dark mode everywhere",
  ];

  it("ranks facts sharing keywords with the query above unrelated ones", () => {
    const top = keywordRank("what coffee do I like", facts, 2);
    expect(top[0]).toBe(facts[0]);
  });

  it("returns all facts unranked when nothing overlaps at all", () => {
    const top = keywordRank("xyzzy quux plugh", facts, 2);
    expect(top).toEqual(facts);
  });

  it("returns all facts unranked when the query has no non-stopword tokens", () => {
    const top = keywordRank("what is the", facts, 2);
    expect(top).toEqual(facts);
  });

  it("respects the k limit", () => {
    const top = keywordRank("user", facts, 2);
    expect(top.length).toBe(2);
  });
});

describe("PersistentStore facts()", () => {
  it("remembers and returns facts unranked below the ranking threshold", async () => {
    const store = new PersistentStore();
    await store.remember("User likes tea");
    await store.remember("User owns a bicycle");
    const facts = await store.facts("tea");
    // Below the 5-fact threshold — always returns everything, unranked.
    expect(facts).toEqual(["User likes tea", "User owns a bicycle"]);
  });

  it("keyword-ranks once there are enough facts and no Vertex creds are given", async () => {
    const store = new PersistentStore();
    await store.remember("User's favorite coffee is a flat white");
    await store.remember("User works as a software engineer");
    await store.remember("User has a dog named Biscuit");
    await store.remember("User lives in Mumbai");
    await store.remember("User prefers dark mode everywhere");
    const facts = await store.facts("what coffee do I like");
    expect(facts[0]).toBe("User's favorite coffee is a flat white");
  });

  it("forget('everything') clears all facts", async () => {
    const store = new PersistentStore();
    await store.remember("fact one");
    await store.remember("fact two");
    await store.forget("everything");
    expect(await store.facts()).toEqual([]);
  });

  it("forget matches case-insensitively by substring", async () => {
    const store = new PersistentStore();
    await store.remember("User's favorite coffee is a flat white");
    await store.remember("User owns a bicycle");
    await store.forget("COFFEE");
    expect(await store.facts()).toEqual(["User owns a bicycle"]);
  });
});

describe("memory quality", () => {
  it("ranks Hindi facts (Devanagari words used to give no keywords at all)", () => {
    const facts = ["मुझे चाय पसंद है", "मेरा कुत्ता बिस्किट है", "मैं मुंबई में रहता हूँ", "मेरी मीटिंग रोज़ 5 बजे होती है", "मैं सुबह दौड़ने जाता हूँ"];
    expect(keywordRank("चाय कौन सी अच्छी है", facts, 2)[0]).toBe(facts[0]);
  });

  it("updates a near-identical fact instead of storing a twin", async () => {
    const store = new PersistentStore();
    await store.forget("everything");
    await store.remember("User prefers dark mode everywhere on the phone");
    await store.remember("User prefers dark mode everywhere on the phone now");
    expect((await store.listFacts()).length).toBe(1);
  });

  it("refuses to store a secret", async () => {
    const store = new PersistentStore();
    await store.forget("everything");
    const r = await store.remember("my gmail password is hunter22");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("secret");
    expect((await store.listFacts()).length).toBe(0);
  });
});

