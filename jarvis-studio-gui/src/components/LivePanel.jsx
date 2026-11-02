import { useEffect, useRef, useState, useCallback } from "react";
import { LiveController, NEEDS_TAP } from "../brain/live/controller";
import { getLiveOnLaunch, setLiveOnLaunch, getLiveOnly, setLiveOnly } from "../brain/live/prefs";
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

export default function LivePanel({ getContext, saveTurn, onClose, onOpenSettings, autoStart = false, onActive }) {
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
  const [needTap, setNeedTap] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wave, setWave] = useState(() => Array(28).fill(0));
  const [onLaunch, setOnLaunch] = useState(() => getLiveOnLaunch());
  const [liveOnly, setLiveOnlyState] = useState(() => getLiveOnly());
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
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
    setSpeaking(false);
  }, []);

  // Live-only: Back ends a running conversation; with none running it is not intercepted, so Android leaves the app.
  useAndroidBack(!liveOnly || live, () => {
    void stop();
    if (!liveOnly) onClose();
  });
  useEffect(() => () => void stop(), [stop]);
  // While this screen is open the always-listening wake engine is paused, so two microphones never run at once.
  useEffect(() => {
    onActiveRef.current?.(true);
    return () => onActiveRef.current?.(false);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const start = async () => {
    setError("");
    setNeedTap(false);
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
        onLevel: (v) => {
          setLevel(v);
          setWave((w) => [...w.slice(1), v]);
        },
        onSpeaking: setSpeaking,
        onFirstAudio: (ms) => setDelays((d) => [...d.slice(-9), ms]),
      });
      ctl.current = c;
      await c.start();
    } catch (e) {
      if (e && e.message === NEEDS_TAP) {
        ctl.current = null;
        setNeedTap(true);
        setState("idle");
        return;
      }
      const msg = e && e.name === "NotAllowedError"
        ? "Microphone permission was not given. Allow Microphone for FRIDAY in phone Settings ▸ Apps."
        : String((e && e.message) || e);
      setError(msg);
      await stop();
      setState("closed");
    }
  };

  // Opened by the app at launch: begin talking right away (falls back to a "tap Start" hint if the phone insists on a tap).
  useEffect(() => {
    if (autoStart) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleInterrupt = (v) => {
    setInterrupt(v);
    write(LS.interrupt, v ? "1" : "0");
    ctl.current?.setAllowInterrupt(v);
  };

  const last = delays.length ? delays[delays.length - 1] : null;
  const med = median(delays);
  const sec = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const name = male ? "JARVIS" : "FRIDAY";
  const label = needTap && !live ? "Tap to begin" : state === "ready" ? (speaking ? "Speaking" : "Listening") : STATE_TEXT[state];
  const tone = speaking ? "#7dd3fc" : state === "ready" ? "#22d3ee" : state === "reconnecting" || state === "connecting" ? "#fbbf24" : "#64748b";
  const glow = Math.min(1, level * 9);
  const recent = lines.slice(-4);

  return (
    <div className="lv-root">
      <style>{CSS}</style>

      <div className="lv-top">
        <div className="lv-name">{name}</div>
        <div className="lv-chip"><span className="lv-dot" style={{ background: tone, boxShadow: `0 0 8px ${tone}` }} />{label}{detail && state !== "ready" ? ` · ${detail}` : ""}</div>
      </div>

      <div className="lv-stage">
        <div className={`lv-core ${speaking ? "lv-speak" : ""} ${live ? "lv-live" : ""}`} style={{ "--c": tone, "--g": glow }}>
          <svg viewBox="0 0 200 200" className="lv-rings" aria-hidden="true">
            <circle cx="100" cy="100" r="92" className="lv-r1" />
            <circle cx="100" cy="100" r="76" className="lv-r2" />
            <circle cx="100" cy="100" r="60" className="lv-r3" />
          </svg>
          <div className="lv-orb" />
        </div>

        <div className="lv-wave" aria-hidden="true">
          {wave.map((v, i) => (
            <span key={i} style={{ height: `${4 + Math.min(1, v * 10) * 34}px`, opacity: live && !speaking ? 0.9 : 0.25 }} />
          ))}
        </div>
      </div>

      {error && <div className="lv-error">{error}</div>}

      <div className="lv-talk">
        {recent.length === 0 && !error && (
          <div className="lv-hint">{live ? "Bolo, main sun raha hoon…" : needTap ? "Ek baar tap karo, phir baat shuru." : "Start dabao aur dost ki tarah baat karo. Earphones ho to behtar."}</div>
        )}
        {recent.map((t, i) => (
          <div key={i} className={`lv-line ${t.role === "user" ? "lv-user" : "lv-ai"}`} style={{ opacity: 0.45 + (i + 1) / recent.length * 0.55 }}>{t.text}</div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="lv-delay">
        Reply delay: last {sec(last)} · typical {sec(med)}
        {dropped > 0 && ` · lost ${dropped} audio chunks`}
      </div>

      <details className="lv-opts">
        <summary>Options</summary>
        <div className="lv-optrow">
          <span>Voice</span>
          <select value={voice} disabled={live} onChange={(e) => setVoice(e.target.value)}>
            {LIVE_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="lv-optrow">
          <span>Model</span>
          <input value={model} disabled={live} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        </div>
        <label className="lv-optrow">
          <span>I can interrupt her<small>Off if she cuts herself on loudspeaker</small></span>
          <input type="checkbox" checked={interrupt} onChange={(e) => toggleInterrupt(e.target.checked)} />
        </label>
        <label className="lv-optrow">
          <span>Live only<small>Hide the old text chat (Chat button)</small></span>
          <input type="checkbox" checked={liveOnly} onChange={(e) => { setLiveOnlyState(e.target.checked); setLiveOnly(e.target.checked); }} />
        </label>
        <label className="lv-optrow">
          <span>Open Live when the app starts</span>
          <input type="checkbox" checked={onLaunch} onChange={(e) => { setOnLaunch(e.target.checked); setLiveOnLaunch(e.target.checked); }} />
        </label>
      </details>

      <div className="lv-bar">
        {!liveOnly && <button type="button" className="lv-side" onClick={async () => { await stop(); onClose(); }}>Chat</button>}
        <button type="button" className={`lv-main ${live ? "lv-end" : ""}`} onClick={live ? stop : start} aria-label={live ? "End" : "Start"}>
          {live ? "End" : "Start"}
        </button>
        <button type="button" className="lv-side" onClick={async () => { await stop(); (onOpenSettings || onClose)(); }}>Settings</button>
      </div>
      <div className="lv-foot">Beta · sirf baat-cheet, phone control nahi · audio Google ko jaata hai · aapki Gemini key/quota use hota hai</div>
    </div>
  );
}

const CSS = `
.lv-root{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;color:#e6f7ff;
  background:radial-gradient(120% 70% at 50% 18%,#0b2447 0%,#06142b 38%,#02060d 100%);
  padding:max(14px,env(safe-area-inset-top)) 16px max(14px,env(safe-area-inset-bottom));font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.lv-top{display:flex;align-items:center;justify-content:space-between}
.lv-name{font-size:15px;letter-spacing:.42em;font-weight:600;color:#7dd3fc}
.lv-chip{display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(56,225,255,.2);backdrop-filter:blur(8px)}
.lv-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.lv-stage{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;margin-top:22px}
.lv-core{position:relative;width:min(62vw,240px);aspect-ratio:1;display:grid;place-items:center}
.lv-rings{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:var(--c);stroke-width:1.2}
.lv-r1{stroke-dasharray:4 9;opacity:.55;transform-origin:center;animation:lv-spin 40s linear infinite}
.lv-r2{stroke-dasharray:90 30;opacity:.8;transform-origin:center;animation:lv-spin 26s linear infinite reverse}
.lv-r3{stroke-dasharray:2 6;opacity:.6;transform-origin:center;animation:lv-spin 18s linear infinite}
.lv-orb{width:56%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ffffff 0%,var(--c) 28%,#0b4f8a 62%,#03213f 100%);
  box-shadow:0 0 calc(24px + var(--g)*70px) var(--c),0 0 90px rgba(34,211,238,.25) inset;
  transform:scale(calc(1 + var(--g)*.18));transition:transform 90ms linear,box-shadow 90ms linear,background .4s}
.lv-live .lv-orb{animation:lv-breathe 3.2s ease-in-out infinite}
.lv-speak .lv-orb{animation:lv-talk .9s ease-in-out infinite}
.lv-wave{display:flex;align-items:center;justify-content:center;gap:4px;height:42px;margin-top:16px}
.lv-wave span{width:4px;border-radius:3px;background:linear-gradient(#67e8f9,#3b82f6);transition:height 80ms linear}
.lv-error{margin:8px 0;padding:10px 12px;border-radius:10px;background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.5);font-size:14px}
.lv-talk{flex:1;min-height:0;overflow-y:auto;margin:10px 0 4px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;font-size:16px;line-height:1.45}
.lv-hint{text-align:center;opacity:.6;font-size:14px}
.lv-line{padding:9px 13px;border-radius:14px;max-width:88%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);backdrop-filter:blur(6px)}
.lv-user{align-self:flex-end;color:#a5b4c4}
.lv-ai{align-self:flex-start;border-color:rgba(56,225,255,.25)}
.lv-delay{font-size:12px;opacity:.6;text-align:center;margin:4px 0}
.lv-opts{font-size:14px;margin:2px 0 8px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);padding:8px 12px}
.lv-opts summary{cursor:pointer;opacity:.8}
.lv-optrow{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}
.lv-optrow small{display:block;opacity:.6;font-size:11px}
.lv-optrow select,.lv-optrow input[type=text],.lv-optrow input:not([type]){background:#0c1b2e;color:inherit;border:1px solid #27425f;border-radius:8px;padding:6px 8px;min-width:0}
.lv-optrow input:not([type]){flex:1}
.lv-optrow input[type=checkbox]{width:22px;height:22px}
.lv-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:6px}
.lv-side{flex:1;background:rgba(255,255,255,.05);color:#cfeaff;border:1px solid rgba(56,225,255,.2);border-radius:14px;padding:13px 0;font-size:15px}
.lv-main{flex:1.4;background:linear-gradient(135deg,#0891b2,#2563eb);color:#fff;border:none;border-radius:999px;padding:16px 0;font-size:18px;font-weight:700;letter-spacing:.06em;box-shadow:0 0 24px rgba(34,211,238,.35)}
.lv-end{background:linear-gradient(135deg,#be123c,#7f1d1d);box-shadow:0 0 24px rgba(244,63,94,.3)}
.lv-foot{font-size:10.5px;opacity:.45;text-align:center;margin-top:8px}
@keyframes lv-spin{to{transform:rotate(360deg)}}
@keyframes lv-breathe{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
@keyframes lv-talk{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
@media (prefers-reduced-motion:reduce){.lv-r1,.lv-r2,.lv-r3,.lv-live .lv-orb,.lv-speak .lv-orb{animation:none}}
`;
