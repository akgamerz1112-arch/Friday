import { useEffect, useRef, useState, useCallback } from "react";
import { LiveController } from "../brain/live/controller";
import { buildLivePrompt, LIVE_VOICES, DEFAULT_VOICE_FEMALE, DEFAULT_VOICE_MALE } from "../brain/live/persona";
import { LIVE_MODEL_DEFAULT } from "../brain/live/protocol";
import { isMaleVoice } from "../brain/platform/sarvamTts";
import { useAndroidBack } from "../hooks/useAndroidBack";

// Live voice (beta): talk to FRIDAY through Gemini Live — audio goes straight to the model and back,
// no separate listening / thinking / speaking steps. Conversation only (no phone tools yet).

const LS = { voice: "jarvis.liveVoice", model: "jarvis.liveModel", interrupt: "jarvis.liveInterrupt" };
const read = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const STATE_TEXT = {
  idle: "Ready",
  connecting: "Connecting…",
  ready: "Listening — just talk",
  reconnecting: "Reconnecting…",
  closed: "Ended",
};

export default function LivePanel({ getContext, saveTurn, onClose }) {
  const male = isMaleVoice();
  const [voice, setVoice] = useState(() => read(LS.voice, male ? DEFAULT_VOICE_MALE : DEFAULT_VOICE_FEMALE));
  const [model, setModel] = useState(() => read(LS.model, LIVE_MODEL_DEFAULT));
  const [interrupt, setInterrupt] = useState(() => read(LS.interrupt, "1") === "1");
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);
  const [level, setLevel] = useState(0);
  const [delays, setDelays] = useState([]);
  const [dropped, setDropped] = useState(0);
  const ctl = useRef(null);
  const endRef = useRef(null);
  const live = state === "connecting" || state === "ready" || state === "reconnecting";

  const stop = useCallback(async () => {
    const c = ctl.current;
    ctl.current = null;
    if (c) {
      setDropped(c.dropped);
      await c.stop();
    }
    setLevel(0);
  }, []);

  useAndroidBack(true, () => {
    void stop();
    onClose();
  });
  useEffect(() => () => void stop(), [stop]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const start = async () => {
    setError("");
    setLines([]);
    setDelays([]);
    setDropped(0);
    try {
      const { apiKey, facts } = await getContext();
      if (!apiKey) {
        setError("Live voice needs a Gemini key. Add one in Settings ▸ Models.");
        return;
      }
      write(LS.voice, voice);
      write(LS.model, model);
      const c = new LiveController({
        apiKey,
        model: model.trim() || LIVE_MODEL_DEFAULT,
        voiceName: voice,
        allowInterrupt: interrupt,
        systemInstruction: buildLivePrompt({ male, facts }),
        onState: (s, d) => {
          setState(s);
          setDetail(d || "");
        },
        onTurn: (t) => {
          setLines((l) => [...l.slice(-30), t]);
          void saveTurn?.(t.role, t.text);
        },
        onLevel: (v) => setLevel(v),
        onFirstAudio: (ms) => setDelays((d) => [...d.slice(-9), ms]),
      });
      ctl.current = c;
      await c.start();
    } catch (e) {
      const msg = e && e.name === "NotAllowedError"
        ? "Microphone permission was not given. Allow Microphone for FRIDAY in phone Settings ▸ Apps."
        : String((e && e.message) || e);
      setError(msg);
      await stop();
      setState("closed");
    }
  };

  const toggleInterrupt = (v) => {
    setInterrupt(v);
    write(LS.interrupt, v ? "1" : "0");
    ctl.current?.setAllowInterrupt(v);
  };

  const last = delays.length ? delays[delays.length - 1] : null;
  const med = median(delays);
  const sec = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const orb = state === "ready" ? "#38e1ff" : state === "reconnecting" || state === "connecting" ? "#ffb347" : "#506070";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#0b1218", color: "#dff6ff", display: "flex", flexDirection: "column", padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 18 }}>Live voice (beta)</strong>
        <button type="button" onClick={async () => { await stop(); onClose(); }} style={{ background: "none", border: "1px solid #345", color: "inherit", borderRadius: 8, padding: "6px 12px" }}>Close</button>
      </div>

      <div style={{ textAlign: "center", margin: "18px 0 8px" }}>
        <div style={{ width: 96, height: 96, margin: "0 auto", borderRadius: "50%", background: orb, opacity: 0.25 + Math.min(0.75, level * 8), boxShadow: `0 0 ${12 + level * 200}px ${orb}`, transition: "opacity 80ms" }} />
        <div style={{ marginTop: 10, fontSize: 15 }}>{STATE_TEXT[state]}{detail && state !== "ready" ? ` (${detail})` : ""}</div>
      </div>

      {error && <div style={{ background: "#3a1418", border: "1px solid #7a2a33", borderRadius: 8, padding: 10, margin: "6px 0", fontSize: 14 }}>{error}</div>}

      <div style={{ flex: 1, overflowY: "auto", margin: "8px 0", fontSize: 15, lineHeight: 1.45 }}>
        {lines.length === 0 && !error && <div style={{ opacity: 0.6 }}>{live ? "Say something…" : "Tap Start, then talk like you would to a friend. Headphones work best."}</div>}
        {lines.map((t, i) => (
          <div key={i} style={{ margin: "6px 0", textAlign: t.role === "user" ? "right" : "left", color: t.role === "user" ? "#9fb4c0" : "#dff6ff" }}>{t.text}</div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
        Reply delay: last {sec(last)} · typical {sec(med)} <span style={{ opacity: 0.7 }}>(from your last word to her first sound; includes the end-of-speech wait)</span>
        {dropped > 0 && <div>Audio lost while reconnecting: {dropped} chunks</div>}
      </div>

      {!live && (
        <div style={{ display: "grid", gap: 8, marginBottom: 10, fontSize: 14 }}>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>Voice
            <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ background: "#13202b", color: "inherit", border: "1px solid #345", borderRadius: 6, padding: 6 }}>
              {LIVE_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>Model
            <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} style={{ flex: 1, background: "#13202b", color: "inherit", border: "1px solid #345", borderRadius: 6, padding: 6 }} />
          </label>
        </div>
      )}
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginBottom: 12 }}>
        <span>I can interrupt her<br /><span style={{ opacity: 0.65, fontSize: 12 }}>Turn off if she keeps cutting herself on loudspeaker</span></span>
        <input type="checkbox" checked={interrupt} onChange={(e) => toggleInterrupt(e.target.checked)} style={{ width: 22, height: 22 }} />
      </label>

      <button type="button" onClick={live ? stop : start} style={{ background: live ? "#7a2a33" : "#0f8fa8", color: "#fff", border: "none", borderRadius: 12, padding: "14px 0", fontSize: 17, fontWeight: 600 }}>
        {live ? "End" : "Start"}
      </button>
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8, textAlign: "center" }}>Beta: talk only — no phone control here. Audio is sent to Google. Uses your Gemini key and its quota.</div>
    </div>
  );
}
