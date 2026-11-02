/**
 * Gemini key rotation for Live voice. Only Gemini keys are ever used here: when one is refused
 * (free quota used up, or the key is wrong/expired) Live moves to the next Gemini key and says so.
 * It never falls back to another provider, and never to a paid one on its own.
 *
 * How a refusal is recognised: the server closes the socket with a reason text. Forum reports of the
 * quota case show code 1011 with a text like "You exceeded your current quota ..." or "Resource has
 * been exhausted (e.g. check quota)". The exact wording is NOT in the official docs, so the match is
 * on words, not on a code; a plain "Internal error" (also 1011) is NOT treated as a quota problem.
 */

export type CloseVerdict = "quota" | "badkey" | "other";

const QUOTA = /quota|exhaust|rate.?limit|too many requests|\b429\b|billing/i;
const BADKEY = /api key|apikey|key not valid|invalid.{0,20}key|permission.?denied|unauthenticated|expired|\b40[13]\b/i;

export function classifyClose(_code?: number, reason?: string): CloseVerdict {
  const r = reason || "";
  if (QUOTA.test(r)) return "quota";
  if (BADKEY.test(r)) return "badkey";
  return "other";
}

export class KeyRing {
  readonly keys: string[];
  private out = new Set<number>();
  private i = 0;

  constructor(keys: string[]) {
    this.keys = [];
    for (const k of keys) {
      const t = (k || "").trim();
      if (t && !this.keys.includes(t)) this.keys.push(t);
    }
  }

  get size(): number {
    return this.keys.length;
  }
  get current(): string {
    return this.keys[this.i] ?? "";
  }
  /** 1-based, for messages. */
  get position(): number {
    return this.i + 1;
  }

  /** The current key was refused: skip it and move to the next unused one (null = none left). */
  rotate(): { key: string; position: number } | null {
    if (!this.keys.length) return null;
    this.out.add(this.i);
    const n = this.keys.length;
    for (let step = 1; step < n; step++) {
      const j = (this.i + step) % n;
      if (!this.out.has(j)) {
        this.i = j;
        return { key: this.keys[j], position: j + 1 };
      }
    }
    return null;
  }
}

export function rotationNote(from: number, to: number, total: number, verdict: Exclude<CloseVerdict, "other">): string {
  const why = verdict === "quota" ? "ka limit khatam" : "galat ya expire";
  return `Key ${from} ${why} — key ${to}/${total} try kar raha hoon`;
}

export function allOutMessage(total: number): string {
  const who = total === 1 ? "Gemini key" : `sabhi ${total} Gemini keys`;
  return `${who} ka limit khatam ya key galat hai. Thodi der baad dobara try karo ya nayi Gemini key daalo. Live kisi doosre provider par apne aap nahi jaata.`;
}
