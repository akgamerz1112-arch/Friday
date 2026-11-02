/**
 * Which tools Gemini Live may call, and how a call is run safely.
 *
 * Live used to be talk-only (so it said it "can't" do anything, including remembering). It now gets the SAME
 * one-step tools as the chat brain, through the same dispatcher (Brain.runTool), but only this short list:
 * nothing that drives other apps screen by screen (phone_task) and nothing destructive.
 */
import type { LiveCall, LiveCallResult } from "./protocol";

export const LIVE_TOOLS: ReadonlySet<string> = new Set([
  "device_control",
  "set_volume",
  "set_alarm",
  "set_timer",
  "set_reminder",
  "manage_clock",
  "play_media",
  "open_app",
  "open_website",
  "navigate_to",
  "get_time",
  "get_day",
  "get_weather",
  "web_search",
  "read_notifications",
  "remember_fact",
  "forget_fact",
  "call_contact",
  "send_message",
]);

/** Reaches another person: the first call only asks the model to confirm out loud. */
export const NEEDS_CONFIRM: ReadonlySet<string> = new Set(["call_contact", "send_message"]);

const CONFIRM_WINDOW_MS = 60_000;
/** A second identical call this soon came from the model itself, not from the user saying "yes". */
const MIN_THINK_MS = 3_000;

export type RunTool = (name: string, args?: Record<string, unknown>) => Promise<{ ok: boolean; summary: string }>;

const keyOf = (c: LiveCall) => `${c.name}:${JSON.stringify(c.args, Object.keys(c.args).sort())}`;

export function createToolRunner(run: RunTool, now: () => number = Date.now) {
  const asked = new Map<string, number>();
  return async (calls: LiveCall[]): Promise<LiveCallResult[]> => {
    const out: LiveCallResult[] = [];
    for (const c of calls) {
      let response: Record<string, unknown>;
      if (!LIVE_TOOLS.has(c.name)) {
        response = { ok: false, error: "That is not available in live voice." };
      } else if (NEEDS_CONFIRM.has(c.name) && !confirmedNow(asked, keyOf(c), now())) {
        response = {
          ok: false,
          done: false,
          error:
            "NOT DONE. Ask the user out loud to confirm, wait for a clear yes, then call this tool again with the same arguments.",
        };
      } else {
        try {
          const r = await run(c.name, c.args);
          response = { ok: r.ok, result: r.summary.slice(0, 400) };
        } catch (e) {
          response = { ok: false, error: String((e as Error)?.message || e).slice(0, 200) };
        }
      }
      out.push({ id: c.id, name: c.name, response });
    }
    return out;
  };
}

/** First sight of this exact call -> remember it and refuse; a repeat after 3 s..60 s -> allowed once. */
function confirmedNow(asked: Map<string, number>, key: string, t: number): boolean {
  const at = asked.get(key);
  if (at === undefined || t - at > CONFIRM_WINDOW_MS) {
    asked.set(key, t);
    return false;
  }
  if (t - at < MIN_THINK_MS) return false;
  asked.delete(key);
  return true;
}
