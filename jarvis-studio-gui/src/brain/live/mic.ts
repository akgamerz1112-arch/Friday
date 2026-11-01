/** Microphone -> 16 kHz PCM16 chunks. Browser-only (WebView); not unit-testable here. */
import { floatToPcm16 } from "./pcm";

export interface Mic {
  stop(): void;
}

/**
 * Uses ScriptProcessorNode on purpose: it works in every Android WebView without loading a worklet file
 * (which the app's content-security rules could block). ~43 ms chunks at 48 kHz.
 * Echo cancellation / noise suppression are requested from the browser; whether they are enough on the
 * loudspeaker is something only a real phone test can show.
 */
export async function startMic(ctx: AudioContext, onChunk: (pcm: Int16Array) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // keeps the node running without playing the mic back
  proc.onaudioprocess = (ev) => {
    const input = ev.inputBuffer.getChannelData(0);
    onChunk(floatToPcm16(new Float32Array(input), ctx.sampleRate, 16_000));
  };
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  return {
    stop() {
      proc.onaudioprocess = null;
      try {
        src.disconnect();
        proc.disconnect();
        mute.disconnect();
      } catch {
        /* already gone */
      }
      for (const t of stream.getTracks()) t.stop();
    },
  };
}
