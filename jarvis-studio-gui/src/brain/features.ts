/**
 * FRIDAY feature registry + diagnostics.
 *
 * One row per user-visible capability. Settings ▸ System ▸ Feature status renders
 * `evaluateFeatures()`; nothing here changes behaviour. To list a new feature, append a
 * FeatureDef to FEATURES (see docs/FRIDAY.md ▸ "Adding a feature"). `check` is pure: it only
 * reads the context that `gatherFeatureContext()` collected, so it is unit-testable.
 */
import { sarvamStatus } from "./platform/sarvamTts";
import { accessibilityStatus, callAnnounceStatus, wakeSensitivity } from "./platform";
import { inTauri } from "./tools/httpClient";

export type FeatureState = "ok" | "warn" | "off";
export interface FeatureStatus {
  state: FeatureState;
  detail: string;
}

export interface FeatureContext {
  /** The Settings `sysInfo` object (has_* key flags, wake_word, wa_mode …). */
  sysInfo: Record<string, unknown>;
  sarvam: ReturnType<typeof sarvamStatus>;
  /** Null when not on the phone or the native side didn't answer. */
  call: { on?: boolean; access?: boolean } | null;
  accessibility: boolean | null;
  /** Voices the phone's own speech engine reports. */
  speechVoices: number;
  /** The wake model file the phone loaded (hey_jarvis.onnx / hey_friday.onnx); unknown off-phone. */
  wakeModel?: string;
}

export interface FeatureDef {
  id: string;
  group: "Voice" | "Phone" | "Messages" | "AI";
  label: string;
  check(ctx: FeatureContext): FeatureStatus;
}

const ok = (detail: string): FeatureStatus => ({ state: "ok", detail });
const warn = (detail: string): FeatureStatus => ({ state: "warn", detail });
const off = (detail: string): FeatureStatus => ({ state: "off", detail });

export const FEATURES: FeatureDef[] = [
  {
    id: "voice.sarvam",
    group: "Voice",
    label: "Natural Hindi voice (Sarvam)",
    check: ({ sarvam }) =>
      !sarvam.configured
        ? off("No key saved — the phone's own voice is used")
        : !sarvam.enabled
          ? off("Switched off")
          : sarvam.coolingDown
            ? warn(`Paused: ${sarvam.reason || "recent errors"}; the phone's voice covers`)
            : ok("Ready"),
  },
  {
    id: "voice.native",
    group: "Voice",
    label: "Phone's built-in voice",
    check: ({ speechVoices }) =>
      speechVoices > 0
        ? ok(`${speechVoices} voices installed`)
        : warn("No voices reported — install a text-to-speech engine in Android settings"),
  },
  {
    id: "voice.wake",
    group: "Voice",
    label: "Wake word",
    check: ({ sysInfo, wakeModel }) =>
      sysInfo.wake_word === false
        ? off("Off")
        : wakeModel === "hey_friday.onnx"
          ? ok("On — the installed model hears “Hey Friday”")
          : ok("On — the installed model hears “Hey Jarvis”; “Hey Friday” has no model yet"),
  },
  {
    id: "phone.control",
    group: "Phone",
    label: "App control (Accessibility service)",
    check: ({ accessibility }) =>
      accessibility === null
        ? off("Not available here")
        : accessibility
          ? ok("On")
          : warn("Off — needed to operate other apps"),
  },
  {
    id: "phone.notifications",
    group: "Phone",
    label: "Notification access",
    check: ({ call }) =>
      call === null ? off("Not available here") : call.access ? ok("Granted") : warn("Not granted"),
  },
  {
    id: "calls.announce",
    group: "Phone",
    label: "Incoming-call announcements",
    check: ({ call }) =>
      call === null
        ? off("Not available here")
        : !call.on
          ? off("Off")
          : call.access
            ? ok("On")
            : warn("On, but notification access is missing — nothing can be announced"),
  },
  {
    id: "messages.whatsapp",
    group: "Messages",
    label: "WhatsApp commands",
    check: ({ sysInfo }) =>
      !sysInfo.wa_mode || sysInfo.wa_mode === "off"
        ? off("Off")
        : sysInfo.wa_access === false
          ? warn("On, but notification access is missing")
          : ok("On"),
  },
  {
    id: "ai.keys",
    group: "AI",
    label: "AI providers",
    check: ({ sysInfo }) => {
      const names = ["vertex_sa", "groq_key", "gemini_key", "openrouter_key", "nvidia_key", "mistral_key"];
      const n = names.filter((k) => sysInfo[`has_${k}`]).length;
      return n > 0 ? ok(`${n} configured`) : warn("No key saved — add one in API keys");
    },
  },
];

export function evaluateFeatures(ctx: FeatureContext) {
  return FEATURES.map((f) => ({ id: f.id, group: f.group, label: f.label, ...f.check(ctx) }));
}

export async function gatherFeatureContext(sysInfo: Record<string, unknown>): Promise<FeatureContext> {
  let speechVoices = 0;
  try {
    speechVoices = window.speechSynthesis?.getVoices().length ?? 0;
  } catch {
    /* no speech engine */
  }
  const onPhone = inTauri();
  const [call, acc, wake] = onPhone
    ? await Promise.all([callAnnounceStatus(), accessibilityStatus(), wakeSensitivity()])
    : [null, null, null];
  return {
    sysInfo,
    sarvam: sarvamStatus(),
    call,
    accessibility: acc && typeof acc.enabled === "boolean" ? acc.enabled : null,
    speechVoices,
    wakeModel: wake?.model,
  };
}
