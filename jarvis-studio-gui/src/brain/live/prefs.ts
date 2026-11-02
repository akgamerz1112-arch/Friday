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

/**
 * "Sarvam voice in Live": FRIDAY speaks with her own Sarvam voice instead of Gemini's audio (the model's text is
 * spoken). Default ON; it only takes effect when a Sarvam key is saved and the voice is switched on in Settings.
 */
const KEY_SARVAM = "jarvis.liveSarvam";

export function getLiveSarvam(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY_SARVAM) !== "0";
  } catch {
    return true;
  }
}

export function setLiveSarvam(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY_SARVAM, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/**
 * "Jarvis bolne par Live khule": saying the wake word opens Live (instead of a text answer). Instant phone
 * commands (torch, volume, open app…) still run at once without opening Live. Default ON.
 */
const KEY_WAKE_LIVE = "jarvis.wakeOpensLive";

export function getWakeLive(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY_WAKE_LIVE) !== "0";
  } catch {
    return true;
  }
}

export function setWakeLive(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY_WAKE_LIVE, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
