/** Audio sample conversion for the Live API. Pure functions (the browser pieces live in mic.ts / player.ts). */

/** Float samples (-1..1) at `inRate` -> 16-bit PCM at `outRate`. Averages the samples that fall into each output step. */
export function floatToPcm16(input: Float32Array, inRate: number, outRate = 16_000): Int16Array {
  if (inRate <= 0 || outRate <= 0) return new Int16Array(0);
  const ratio = inRate / outRate;
  const outLen = ratio <= 1 ? input.length : Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  if (ratio <= 1) {
    for (let i = 0; i < outLen; i++) out[i] = clamp16(input[i]!);
    return out;
  }
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const end = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (; pos < end; pos++) {
      sum += input[pos]!;
      n++;
    }
    out[i] = clamp16(n ? sum / n : 0);
  }
  return out;
}

function clamp16(x: number): number {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    bytes[i * 2] = v & 0xff; // little-endian
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToPcm16(b64: string): Int16Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(i * 2);
    const hi = bin.charCodeAt(i * 2 + 1);
    const v = (hi << 8) | lo;
    out[i] = v & 0x8000 ? v - 0x10000 : v;
  }
  return out;
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! / (pcm[i]! < 0 ? 0x8000 : 0x7fff);
  return out;
}

/** Loudness of a chunk (0..1) — used only to tell "the user is talking" for latency timing and the level meter. */
export function rms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += (pcm[i]! / 0x8000) ** 2;
  return Math.sqrt(s / pcm.length);
}
