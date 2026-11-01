/* Wake phrase matching — pure (no imports) so it is cheap to unit-test.
 *
 * The on-device model only SCORES sound; a clip counts as a wake only if the speech
 * recogniser also heard the phrase in it. FRIDAY answers to "Hey Friday" and to the old
 * "Hey Jarvis". Whisper writes the name many ways (Fri day, Fry day, Jervis, Travis,
 * Devanagari फ्राइडे …), so the patterns are loose on spelling and strict on the greeting:
 * a bare "Friday" is also a weekday ("see you Friday"), so in Latin script it only counts
 * as the very first word of the clip ("Friday, torch on"). */

/** "Hey Jarvis": a greeting, then the name. Whisper also spells the name Jervis, Javis or
 *  Travis, and hears "Hey" as "Kay" or "A." (live 2026-09-27). A bare "Jarvis" doesn't
 *  count — "my Jarvis app" is someone talking ABOUT JARVIS (false wake 2026-09-26). */
export const JARVIS_PHRASE =
  /(?:\b(?:hey|hi|hay|hei|ay|eh|kay|ok(?:ay)?|hello|yo)\b[\s,.!-]*|\ba[.,!]\s*)(?:j|ch|tr)[ae]r?v[aeiu]s\b/i;

const GREET = String.raw`(?:hey|hi|hay|hei|ay|eh|kay|ok(?:ay)?|hello|yo|arre?|sunno?)`;
const FRI = String.raw`fr[iy]\s?-?d(?:ay|ey|ae|e)`;
// \b is ASCII-only in JS, so Devanagari uses explicit separators instead.
const SEP = String.raw`(?:^|[\s,.!?।-])`;
const DEV_GREET = String.raw`(?:हे|हेय|हाय|हैलो|हेलो|है|ओके|ओ\s?के|अरे|सुनो|ए)`;
const DEV_FRI = String.raw`फ्रा[इईय]डे`;

const DEV_JARVIS = String.raw`जा?र्?व[िी][सश]`;
/** Hindi recognition writes "Hey Jarvis" in Devanagari. A greeting is required, as in Latin. */
export const JARVIS_DEVANAGARI = new RegExp(String.raw`${SEP}${DEV_GREET}[\s,.!?।-]*${DEV_JARVIS}`);

/** "Jarvis, torch chalu karo": the name as the first word of the clip (the model already fired, and
 *  the clip starts at the pre-roll, so this is the wake itself). Latin and Devanagari. */
export const JARVIS_FIRST = new RegExp(
  String.raw`^[\s,.!?-]*(?:(?:j|ch|tr)[ae]r?v[aeiu]s\b|${DEV_JARVIS})(?=[\s,.!?।-]|$)`,
  "i",
);

/** "Hey Friday" in Latin script. */
export const FRIDAY_GREETED = new RegExp(String.raw`\b${GREET}\b[\s,.!-]*${FRI}\b`, "i");
/** Devanagari: "फ्राइडे" is rarely the weekday in Hindi speech (that is शुक्रवार), so the
 *  name alone counts, with or without a greeting. */
export const FRIDAY_DEVANAGARI = new RegExp(String.raw`(?:${SEP}${DEV_GREET}[\s,.!?।-]*)?${DEV_FRI}`);
/** "Friday, torch on": the name as the first word of the clip. */
export const FRIDAY_FIRST = new RegExp(String.raw`^[\s,.!?-]*${FRI}\b(?=[\s,.!?-]|$)`, "i");

export type WakeName = "friday" | "jarvis";
const BOTH: readonly WakeName[] = ["friday", "jarvis"];
const SETS: Record<WakeName, RegExp[]> = {
  jarvis: [JARVIS_PHRASE, JARVIS_DEVANAGARI, JARVIS_FIRST],
  friday: [FRIDAY_GREETED, FRIDAY_DEVANAGARI, FRIDAY_FIRST],
};
const patternsFor = (names: readonly WakeName[]) => names.flatMap((n) => SETS[n]);

/** The names a wake may be spoken with, given the name the user chose and the model the phone
 *  loaded. The chosen name always counts; the model's own name counts too (a phone with only
 *  the "Hey Jarvis" model can only ever wake on that sound, even when the name is Friday). */
export function acceptedNames(chosen: WakeName, loadedModel: string): WakeName[] {
  const fromModel: WakeName = loadedModel.includes("friday") ? "friday" : "jarvis";
  return chosen === fromModel ? [chosen] : [chosen, fromModel];
}

export function heardWakePhrase(text: string, names: readonly WakeName[] = BOTH): boolean {
  return patternsFor(names).some((r) => r.test(text));
}

/** Where the LAST wake phrase in [text] ends (-1 = none). */
export function lastWakeEnd(text: string, names: readonly WakeName[] = BOTH): number {
  let end = -1;
  for (const r of patternsFor(names)) {
    for (const m of text.matchAll(new RegExp(r.source, r.flags.includes("g") ? r.flags : r.flags + "g"))) {
      end = Math.max(end, m.index + m[0].length);
    }
  }
  return end;
}
