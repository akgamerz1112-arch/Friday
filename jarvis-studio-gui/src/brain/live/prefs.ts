/** "Open straight into Live voice when the app starts" — one on/off switch, default ON, kept on the phone. */
const KEY = "jarvis.liveOnLaunch";

export function getLiveOnLaunch(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setLiveOnLaunch(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the switch just won't persist */
  }
}

/**
 * "Live only": the app is the Live voice agent; the old text chat is hidden (no Chat button, Back leaves the app
 * when no conversation is running). Default ON. Turn it off in the Live screen's Options to get the classic chat button back.
 */
const KEY_ONLY = "jarvis.liveOnly";

export function getLiveOnly(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY_ONLY) !== "0";
  } catch {
    return true;
  }
}

export function setLiveOnly(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY_ONLY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
