/**
 * What must never be saved as a "memory": passwords, API keys, PINs/OTPs, card, Aadhaar and PAN numbers.
 * Applied to every save (voice, the model's remember_fact tool, sync). Deliberately blunt: a wrongly
 * refused fact costs one sentence, a saved secret costs far more.
 */
const KEY_PREFIX = /\b(?:gsk_|sk-|sk_|AIza|ghp_|github_pat_|xox[abp]-|AKIA|ya29\.|eyJ[a-zA-Z0-9_-]{10,}|Bearer\s)/;
const LONG_TOKEN = /[A-Za-z0-9_-]{28,}/;
const SECRET_WORD =
  /(password|passwd|passcode|\bpin\b|\botp\b|\bcvv\b|api[ _-]?key|secret|token|पासवर्ड|पासकोड|पिन|ओटीपी|सीवीवी|कुंजी)/i;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/;

/** True for a run of 12-19 digits (Aadhaar 12, cards 13-19), spaces and dashes allowed inside. */
function longDigitRun(text: string): boolean {
  const runs = text.match(/\d(?:[\d -]{10,22}\d)/g) ?? [];
  return runs.some((r) => {
    const n = r.replace(/\D/g, "").length;
    return n >= 12 && n <= 19;
  });
}

export function looksSecret(text: string): boolean {
  if (KEY_PREFIX.test(text) || LONG_TOKEN.test(text) || PAN.test(text) || longDigitRun(text)) return true;
  // "password" alone is fine to remember *about* ("I forget passwords"); a value next to it is not.
  return SECRET_WORD.test(text) && /\d|[A-Za-z0-9]{6,}\s*$/.test(text.replace(SECRET_WORD, ""));
}
