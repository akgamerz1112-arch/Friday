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
