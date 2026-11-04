/** WebAudio로 즉석 합성하는 효과음 — 에셋 없이 반응마다 고유 소리 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
const last = new Map<string, number>();

function audio(): AudioContext | null {
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.2;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(c: AudioContext, f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master!);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(
  c: AudioContext,
  dur: number,
  vol: number,
  f0: number,
  f1: number,
  q = 1,
  type: BiquadFilterType = 'bandpass',
  delay = 0,
) {
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master!);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export function playSfx(name: string): void {
  if (muted) return;
  const now = performance.now();
  if (now - (last.get(name) ?? -1000) < 45) return;
  last.set(name, now);
  const c = audio();
  if (!c) return;
  switch (name) {
    case 'slash':
      noise(c, 0.09, 0.45, 3000, 800, 0.8);
      break;
    case 'shoot':
      tone(c, 900, 500, 0.08, 'square', 0.08);
      break;
    case 'hit':
      tone(c, 220, 90, 0.07, 'square', 0.14);
      noise(c, 0.05, 0.25, 2000, 600);
      break;
    case 'zap':
      tone(c, 1400, 300, 0.12, 'sawtooth', 0.1);
      noise(c, 0.12, 0.25, 6000, 2000, 2, 'highpass');
      break;
    case 'boom':
      noise(c, 0.35, 0.7, 900, 80, 0.7, 'lowpass');
      tone(c, 120, 40, 0.3, 'sine', 0.4);
      break;
    case 'sizzle':
      noise(c, 0.3, 0.5, 5000, 1500, 1, 'highpass');
      tone(c, 600, 200, 0.2, 'triangle', 0.15);
      break;
    case 'freeze':
      tone(c, 1800, 2400, 0.15, 'triangle', 0.14);
      tone(c, 2400, 3000, 0.2, 'sine', 0.1, 0.06);
      break;
    case 'whoosh':
      noise(c, 0.3, 0.5, 400, 2400, 1.2);
      break;
    case 'vortex':
      noise(c, 0.35, 0.45, 2400, 300, 1.5);
      tone(c, 300, 900, 0.3, 'sawtooth', 0.05);
      break;
    case 'splash':
      noise(c, 0.2, 0.45, 1200, 300, 0.9);
      break;
    case 'switch':
      tone(c, 660, 990, 0.08, 'triangle', 0.13);
      break;
    case 'roll':
      noise(c, 0.12, 0.22, 800, 300, 0.8);
      break;
    case 'perfect':
      tone(c, 880, 1760, 0.12, 'triangle', 0.2);
      tone(c, 1320, 2640, 0.16, 'sine', 0.14, 0.05);
      break;
    case 'hurt':
      tone(c, 300, 80, 0.18, 'sawtooth', 0.2);
      break;
    case 'death':
      noise(c, 0.4, 0.45, 1500, 100, 0.8, 'lowpass');
      break;
    case 'windup':
      tone(c, 200, 420, 0.18, 'square', 0.04);
      break;
    case 'strike':
      noise(c, 0.18, 0.45, 5000, 600, 0.8);
      tone(c, 1600, 200, 0.15, 'sawtooth', 0.08);
      break;
    case 'spawn':
      tone(c, 300, 600, 0.25, 'sine', 0.07);
      break;
    case 'terrain':
      tone(c, 500, 250, 0.15, 'triangle', 0.09);
      break;
    case 'secondary':
      tone(c, 440, 1760, 0.25, 'sawtooth', 0.08);
      noise(c, 0.3, 0.35, 3000, 500, 1);
      break;
  }
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}
