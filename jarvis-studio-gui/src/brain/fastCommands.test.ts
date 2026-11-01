import { describe, expect, it } from "vitest";
import { isReadScreenRequest, matchFastCommand, matchPersona } from "./fastCommands";

const act = (s: string) => {
  const r = matchFastCommand(s);
  return r && r.type === "device" ? r.action : r?.type ?? null;
};

describe("fast commands", () => {
  it("flashlight in Hindi, Hinglish and English", () => {
    expect(act("torch on karo")).toBe("flashlight_on");
    expect(act("टॉर्च बंद करो")).toBe("flashlight_off");
    expect(act("Hey Friday, flashlight chalu")).toBe("flashlight_on");
    expect(act("flashlight")).toBeNull();
  });
  it("volume and mute", () => {
    expect(act("volume badhao")).toBe("volume_up");
    expect(act("आवाज़ कम करो")).toBe("volume_down");
    expect(act("mute")).toBe("mute");
  });
  it("answers the time locally", () => {
    expect(matchFastCommand("time kya hai", new Date(2026, 0, 1, 15, 5))).toEqual({
      type: "say",
      say: "अभी 3 बजकर 5 मिनट हुए हैं।",
    });
  });
  it("pauses app control for payments", () => {
    expect(act("accessibility band karo")).toBe("accessibility_off");
  });
  it("leaves real sentences to the model", () => {
    expect(act("kal subah volume badha dena aur mujhe yaad dilana ki mummy ko call karna hai")).toBeNull();
    expect(act("play some music by Arijit")).toBeNull();
  });
});

describe("read screen", () => {
  it("recognises the ways people ask", () => {
    expect(isReadScreenRequest("Hey Jarvis, screen par kya hai")).toBe(true);
    expect(isReadScreenRequest("screen padho")).toBe(true);
    expect(isReadScreenRequest("what's on the screen")).toBe(true);
    expect(isReadScreenRequest("स्क्रीन पर क्या लिखा है")).toBe(true);
  });
  it("ignores everything else", () => {
    expect(isReadScreenRequest("open the screen brightness settings and make it dim")).toBe(false);
    expect(isReadScreenRequest("weather kya hai")).toBe(false);
  });
});

describe("persona switch", () => {
  it("switches on a name order", () => {
    for (const [t, n] of [
      ["Jarvis ban jao", "jarvis"],
      ["Friday ban jao", "friday"],
      ["naam Jarvis rakh do", "jarvis"],
      ["tumhara naam Friday hai", "friday"],
      ["tum Jarvis ho", "jarvis"],
      ["ab se Jarvis", "jarvis"],
      ["call yourself Friday", "friday"],
      ["जार्विस बन जाओ", "jarvis"],
    ] as const) {
      expect(matchPersona(t), t).toBe(n);
    }
    expect(matchFastCommand("Jarvis ban jao")).toMatchObject({ type: "persona", name: "jarvis" });
  });
  it("leaves questions and ordinary talk alone", () => {
    for (const t of ["set an alarm for Friday", "friday ko meeting hai", "tum jarvis ho ya friday", "are you jarvis?", "jarvis kaun hai"]) {
      expect(matchPersona(t), t).toBeNull();
    }
  });
});

describe("open an app instantly", () => {
  const open = (s: string) => {
    const r = matchFastCommand(s);
    return r && r.type === "app" ? r.name : null;
  };
  it("Hindi, Hinglish and English", () => {
    expect(open("youtube kholo")).toBe("youtube");
    expect(open("Hey Jarvis, YouTube kholo")).toBe("youtube");
    expect(open("यूट्यूब खोलो")).toBe("youtube");
    expect(open("open whatsapp")).toBe("whatsapp");
    expect(open("व्हाट्सएप खोल दो")).toBe("whatsapp");
    expect(open("camera open karo")).toBe("camera");
    expect(open("zomato kholo")).toBe("zomato");
  });
  it("leaves other things alone", () => {
    expect(open("google search kholo")).toBeNull();
    expect(open("kholo")).toBeNull();
    expect(open("torch on karo")).toBeNull();
    expect(open("website kholo")).toBeNull();
  });
  it("brightness, DND and lock", () => {
    const a = (s: string) => {
      const r = matchFastCommand(s);
      return r && r.type === "device" ? `${r.action}:${r.value}` : null;
    };
    expect(a("brightness 50 karo")).toBe("brightness:50");
    expect(a("brightness full")).toBe("brightness:100");
    expect(a("brightness auto")).toBe("brightness:-1");
    expect(a("dnd on karo")).toBe("dnd_on:0");
    expect(a("phone lock karo")).toBe("lock_screen:0");
  });
});
