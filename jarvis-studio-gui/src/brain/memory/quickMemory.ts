/**
 * "Yaad rakhna ..." / "bhool jao ..." / "mere bare me kya yaad hai": answered on the phone with no
 * model call (instant, works offline). Only clear, explicit phrases match; everything else
 * goes to the model, which can also save facts through its remember_fact / forget_fact tools.
 */
import type { MemoryStore } from "./store";

export type MemoryCommand =
  | { type: "remember"; fact: string }
  | { type: "forget"; what: string }
  | { type: "recall" };

const WAKE = /^(?:(?:hey\s+)?(?:jarvis|friday)[,.:]?\s+)/i;

const REMEMBER_BEFORE =
  /^(?:please\s+)?(?:yaad rakh(?:na|o|iye|ein)?|याद रख(?:ना|ो|िए|ें)?|remember(?: that)?)\s*(?:ki|कि|that|:)?\s+(.+)$/i;
const REMEMBER_AFTER = /^(.+?)\s+(?:yaad rakhna|yaad rakho|yaad rakh lo|याद रखना|याद रखो|याद रख लो)$/i;
const FORGET = /^(?:please\s+)?(?:bhool ja(?:o|na)|bhul jao|भूल जाओ|भूल जा|forget(?: that| about)?)\s+(.+)$/i;
const RECALL =
  /^(?:mere bare me (?:kya|kuch) (?:yaad|pata)(?: hai)?|tumhe (?:mere bare me )?kya yaad hai|what do you (?:remember|know) about me|मेरे बारे में क्या (?:याद|पता) है|तुम्हें क्या याद है)$/i;
const EVERYTHING = /^(everything|all|sab kuch|sab|सब कुछ|सब)$/i;

export function matchMemoryCommand(raw: string): MemoryCommand | null {
  const t = raw.trim().replace(WAKE, "").replace(/[?!.,\s।]+$/g, "");
  if (!t || t.length > 320) return null;
  if (RECALL.test(t)) return { type: "recall" };
  const f = FORGET.exec(t);
  if (f) return { type: "forget", what: f[1].trim() };
  const m = REMEMBER_BEFORE.exec(t) ?? REMEMBER_AFTER.exec(t);
  if (m) {
    const fact = m[1].trim();
    if (fact.length >= 3) return { type: "remember", fact };
  }
  return null;
}

/** Runs the command; the returned sentence is exactly what happened, nothing more. */
export async function runMemoryCommand(
  cmd: MemoryCommand,
  memory: MemoryStore,
  saJson?: string,
): Promise<string> {
  if (cmd.type === "remember") {
    const r = await memory.remember(cmd.fact, saJson);
    if (r.ok) return "ठीक है, याद रख लिया।";
    if (r.error === "secret")
      return "ये पासवर्ड, कुंजी या निजी नंबर जैसा लगता है, इसलिए मैं इसे याद नहीं रखूँगा।";
    if (r.error === "storage_full") return "मेरी मेमोरी भर गई है, अभी ये सेव नहीं हो पाया।";
    return "ये सेव नहीं हो पाया।";
  }
  if (cmd.type === "forget") {
    if (EVERYTHING.test(cmd.what))
      return "सब कुछ मिटाने के लिए Memory स्क्रीन से करें, आवाज़ से नहीं।";
    const r = await memory.forget(cmd.what);
    return r.ok ? "ठीक है, हटा दिया।" : "ऐसा कुछ मेरे पास नहीं मिला।";
  }
  const facts = (await memory.listFacts()).slice(-5).reverse();
  if (facts.length === 0) return "अभी मेरे पास आपके बारे में कुछ सेव नहीं है।";
  return `मुझे आपके बारे में ये याद है: ${facts.map((f) => f.text).join("; ")}।`;
}
