/**
 * Instant commands: a few unambiguous phone switches are recognised by pattern and run
 * straight on the phone, with no AI call (so no network wait and no quota used).
 * Anything unclear returns null and goes to the normal model path. Hindi, Hinglish, English.
 * To add one, add a branch in `matchFastCommand` (and a case in fastCommands.test.ts).
 */
export type PersonaName = "friday" | "jarvis";

export type FastCommand =
  | { type: "device"; action: string; value: number; say: string }
  | { type: "say"; say: string }
  /** Rename: Friday = the female FRIDAY, Jarvis = the male JARVIS (voice, wording and wake name). */
  | { type: "persona"; name: PersonaName; say: string };

const WAKE_PREFIX = /^(?:(?:hey\s+)?(?:jarvis|friday)[,.:]?\s+)/i;

const ON = /(\bon\b|chalu|chaalu|jala|jalao|\bkhol|start|चालू|जला|ऑन)/i;
const OFF = /(\boff\b|\bband\b|bandh|bujha|बंद|बुझा|ऑफ)/i;
const UP = /(badha|badhao|zyada|jyada|increase|\bup\b|louder|बढ़ा|ज्यादा|ज़्यादा|तेज़|तेज)/i;
const DOWN = /(\bkam\b|ghata|ghatao|decrease|\bdown\b|lower|कम|घटा|धीमा|dheema)/i;

const hindiTime = (d: Date) => {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return m === 0 ? `अभी ${h} बज रहे हैं।` : `अभी ${h} बजकर ${m} मिनट हुए हैं।`;
};

/** "screen par kya hai", "ye padho", "what's on the screen" — answered from the live screen text. */
export function isReadScreenRequest(raw: string): boolean {
  const t = raw.trim().replace(WAKE_PREFIX, "").replace(/[?!.,\s]+$/g, "").toLowerCase();
  if (!t || t.length > 80) return false;
  return /(screen (par|pe|pr|me|mein)? ?(kya|likha|padh|dekh)|screen (padh|read)|(ye|yeh|isme|ismein|isme) (kya )?(likha|hai)|read (the |this |my )?screen|what'?s on (the |my )?screen|स्क्रीन (पर|पे|में)? ?(क्या|पढ़|पढ|देख)|इसमें क्या|ये क्या लिखा)/i.test(t);
}

const N = "(friday|फ्राइडे|फ्राईडे|फ्रायडे|jarvis|जार्विस|जारविस|जर्विस)";
const GO = "(?:ban\\s*ja\\w*|बन\\s*जा\\w*|ho\\s*ja\\w*|हो\\s*जा\\w*|set\\s*kar\\w*|सेट\\s*कर\\w*|rakh\\w*|रख\\w*|mode|मोड)";
const AB = "(?:ab\\s*se\\s+|अब\\s*से\\s+|ab\\s+|from now on\\s+)";
const PERSONA = [
  new RegExp(`^${N}$`, "i"), // just the name, tapped or typed
  new RegExp(`(?:naam|name|नाम)\\s+${AB}?${N}`, "i"), // naam Jarvis rakh do / tumhara naam Friday hai
  new RegExp(`^(?:tum|tu|aap|तुम|आप)\\s+${AB}?${N}\\s+(?:ho|ban|हो|बन)`, "i"), // tum Jarvis ho
  new RegExp(`^${AB}${N}(?:\\s+${GO})?$`, "i"), // ab se Jarvis
  new RegExp(`^${N}\\s+${GO}`, "i"), // Jarvis ban jao / Friday set karo
  new RegExp(`^(?:set|switch to|be|become|call yourself|your name is|you are|you're|change (?:your name )?to)\\s+${N}$`, "i"),
];

/** "Jarvis ban jao", "naam Friday rakh do", "tum Jarvis ho", or just the name: the persona to switch to. */
export function matchPersona(raw: string): PersonaName | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:hey|ok(?:ay)?|hi)\s+/, "")
    .replace(/[!.,।\s]+$/g, "");
  if (!t || t.length > 50) return null;
  if (/[?]|\b(?:ya|or|kya|kaun)\b|या\b|क्या|कौन/.test(t)) return null; // a question, not an order
  for (const rx of PERSONA) {
    const m = rx.exec(t);
    if (m) return /jarvis|जार|जर्/.test(m[1]) ? "jarvis" : "friday";
  }
  return null;
}

export function matchFastCommand(raw: string, now: Date = new Date()): FastCommand | null {
  const persona = matchPersona(raw);
  if (persona)
    return {
      type: "persona",
      name: persona,
      say: persona === "jarvis" ? "ठीक है, अब से मैं JARVIS हूँ।" : "ठीक है, अब से मैं FRIDAY हूँ।",
    };
  const t = raw
    .trim()
    .replace(WAKE_PREFIX, "")
    .replace(/^please\s+/i, "")
    .replace(/[?!.,\s]+$/g, "")
    .toLowerCase();
  if (!t || t.length > 60) return null; // long sentences are real requests, not switches

  if (/(kitne baje|time kya|what time|what's the time|समय क्या|टाइम क्या|कितने बजे)/i.test(t))
    return { type: "say", say: hindiTime(now) };

  if (/(accessibility|एक्सेसिबिलिटी|app control|payment mode|pay mode)/i.test(t) && (OFF.test(t) || /payment|pay mode/i.test(t)))
    return {
      type: "device",
      action: "accessibility_off",
      value: 0,
      say: "ऐप कंट्रोल बंद कर दिया है। पेमेंट के बाद Settings, Accessibility में FRIDAY को दोबारा चालू कर लें।",
    };

  if (/(torch|flash ?light|फ्लैश ?लाइट|टॉर्च|टोर्च)/i.test(t)) {
    if (OFF.test(t)) return { type: "device", action: "flashlight_off", value: 0, say: "टॉर्च बंद कर दी।" };
    if (ON.test(t)) return { type: "device", action: "flashlight_on", value: 0, say: "टॉर्च चालू कर दी।" };
    return null;
  }
  if (/(\bmute\b|म्यूट)/i.test(t)) return { type: "device", action: "mute", value: 1, say: "म्यूट कर दिया।" };
  if (/(volume|awaaz|awaz|आवाज़|आवाज|वॉल्यूम)/i.test(t)) {
    if (UP.test(t)) return { type: "device", action: "volume_up", value: 2, say: "आवाज़ बढ़ा दी।" };
    if (DOWN.test(t)) return { type: "device", action: "volume_down", value: 2, say: "आवाज़ कम कर दी।" };
    return null;
  }
  if (/(silent|साइलेंट)/i.test(t) && /(mode|मोड|kar|कर|on|chalu)/i.test(t))
    return { type: "device", action: "ringer_silent", value: 0, say: "फ़ोन साइलेंट कर दिया।" };
  if (/(vibrate|वाइब्रेट)/i.test(t) && /(mode|मोड|kar|कर|on|chalu)/i.test(t))
    return { type: "device", action: "ringer_vibrate", value: 0, say: "फ़ोन वाइब्रेट पर कर दिया।" };

  // Short orders only: "play some music by Arijit" is a request for the model, not a switch.
  if (
    t.split(/\s+/).length <= 4 &&
    (/(music|gaana|gana|song|गाना|गाने|म्यूज़िक|म्यूजिक)/i.test(t) || /^(next|previous|pause|resume)( song| track)?$/.test(t))
  ) {
    if (/(next|agla|अगला)/i.test(t)) return { type: "device", action: "media_next", value: 0, say: "अगला गाना।" };
    if (/(previous|pichla|पिछला)/i.test(t)) return { type: "device", action: "media_previous", value: 0, say: "पिछला गाना।" };
    if (/(pause|roko|ruk|रोको|रुको)/i.test(t)) return { type: "device", action: "media_pause", value: 0, say: "रोक दिया।" };
    if (/(resume|play|chalao|chala|चलाओ|चला)/i.test(t)) return { type: "device", action: "media_play", value: 0, say: "चला दिया।" };
  }
  return null;
}
