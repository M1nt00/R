/** WebAudio 효과음·배경음 — 대부분 즉석 합성, art/sfx/에 녹음 파일이 있는 소리(SAMPLES)는 그걸 재생 */
import breathWav from '../../art/sfx/breath.wav?url';

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

// ───────────────── 녹음된 효과음 (art/sfx/) ─────────────────
// 디코드가 끝나면 같은 이름의 합성음 대신 재생한다. 파일이 없거나 디코드에 실패하면 합성음이 그대로 난다.
// gain: 합성음과 크기를 맞추는 값 (마스터 0.2를 거친 뒤 기준), vary: 재생 속도(음높이)를 매번 ±몇 %씩 흔들지
const SAMPLES: Record<string, { url: string; gain: number; vary: number }> = {
  // Soundza "Mouth Blow Hiss": 원본은 폭발음(kaboom)만큼 커서, 1.5초마다 쓰는 기본 공격에 맞게 낮춤
  breath: { url: breathWav, gain: 0.25, vary: 0.05 },
};
const sampleBufs = new Map<string, AudioBuffer>();

/** 부팅 때 한 번: 사용자 입력 전이라 실제 AudioContext 대신 OfflineAudioContext로 미리 디코드 */
export function loadSamples(): void {
  const OAC =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OAC) return;
  const dec = new OAC(1, 1, 44100);
  for (const [name, s] of Object.entries(SAMPLES)) {
    fetch(s.url)
      .then((r) => r.arrayBuffer())
      .then((b) => dec.decodeAudioData(b))
      .then((buf) => sampleBufs.set(name, buf))
      .catch(() => console.warn(`[sfx] ${name}: 녹음 파일을 못 불러와 합성음 사용`));
  }
}

function playSample(c: AudioContext, name: string): boolean {
  const buf = sampleBufs.get(name);
  const s = SAMPLES[name];
  if (!buf || !s) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * s.vary; // 연달아 써도 똑같이 들리지 않게
  const g = c.createGain();
  g.gain.value = s.gain;
  src.connect(g);
  g.connect(master!);
  src.start();
  return true;
}

export function playSfx(name: string): void {
  if (muted) return;
  const now = performance.now();
  if (now - (last.get(name) ?? -1000) < 45) return;
  last.set(name, now);
  const c = audio();
  if (!c) return;
  if (playSample(c, name)) return;
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
    case 'heal':
      tone(c, 520, 780, 0.15, 'sine', 0.12);
      tone(c, 780, 1170, 0.2, 'sine', 0.1, 0.08);
      break;
    case 'block':
      tone(c, 1200, 900, 0.06, 'square', 0.08);
      noise(c, 0.05, 0.3, 4000, 2000, 2, 'highpass');
      break;
    case 'throw':
      noise(c, 0.12, 0.22, 700, 2200, 1.2);
      break;
    case 'glass':
      tone(c, 3400, 2600, 0.07, 'triangle', 0.1);
      tone(c, 4300, 3800, 0.06, 'sine', 0.07, 0.03);
      noise(c, 0.09, 0.22, 7000, 4500, 2, 'highpass');
      break;
    case 'gas':
      noise(c, 0.28, 0.22, 500, 260, 0.8);
      break;
    case 'fizz':
      noise(c, 0.7, 0.35, 6500, 2500, 1, 'highpass');
      tone(c, 900, 1400, 0.6, 'triangle', 0.04);
      break;
    case 'breath':
      // 녹음 파일(art/sfx/breath.wav)이 없을 때만 쓰는 대체음: 낮은 굉음 + 쉬익 하고 빠지는 바람
      noise(c, 0.5, 0.5, 1600, 220, 0.7, 'lowpass');
      noise(c, 0.22, 0.14, 4200, 1800, 1, 'highpass', 0.02);
      tone(c, 130, 60, 0.4, 'sawtooth', 0.05);
      break;
    case 'photo':
      tone(c, 520, 780, 0.25, 'sine', 0.08);
      tone(c, 780, 1170, 0.3, 'sine', 0.06, 0.1);
      break;
    case 'ignite':
      noise(c, 0.3, 0.5, 250, 1400, 0.8);
      break;
    case 'tick':
      tone(c, 880, 880, 0.035, 'square', 0.04);
      break;
    case 'formula':
      tone(c, 660, 990, 0.1, 'triangle', 0.09);
      tone(c, 990, 1480, 0.16, 'triangle', 0.07, 0.07);
      break;
    case 'kaboom':
      noise(c, 0.7, 0.9, 1400, 50, 0.7, 'lowpass');
      tone(c, 95, 30, 0.55, 'sine', 0.55);
      noise(c, 0.25, 0.4, 5000, 1500, 1, 'highpass', 0.02);
      break;
    case 'shatter':
      noise(c, 0.4, 0.6, 6000, 800, 1, 'highpass');
      tone(c, 2000, 400, 0.3, 'triangle', 0.15);
      break;
    case 'coin':
      tone(c, 1320, 1320, 0.05, 'square', 0.05);
      tone(c, 1760, 1760, 0.08, 'square', 0.05, 0.04);
      break;
    case 'pickup':
      tone(c, 660, 1320, 0.18, 'triangle', 0.14);
      break;
    case 'door':
      noise(c, 0.35, 0.3, 300, 120, 0.8, 'lowpass');
      tone(c, 220, 440, 0.3, 'triangle', 0.08, 0.1);
      break;
    case 'roar':
      noise(c, 0.9, 0.7, 500, 60, 0.6, 'lowpass');
      tone(c, 90, 45, 0.9, 'sawtooth', 0.2);
      break;
    case 'slam':
      noise(c, 0.45, 0.8, 600, 50, 0.6, 'lowpass');
      tone(c, 80, 30, 0.4, 'sine', 0.5);
      break;
    case 'shield':
      tone(c, 300, 600, 0.3, 'triangle', 0.1);
      tone(c, 450, 900, 0.3, 'sine', 0.08, 0.05);
      break;
    case 'select':
      tone(c, 880, 1320, 0.12, 'triangle', 0.14);
      tone(c, 1320, 1760, 0.15, 'sine', 0.1, 0.06);
      break;
    case 'buy':
      tone(c, 990, 990, 0.06, 'square', 0.06);
      tone(c, 1480, 1480, 0.12, 'square', 0.06, 0.06);
      break;
    case 'deny':
      tone(c, 200, 160, 0.15, 'square', 0.08);
      break;
    case 'portal':
      tone(c, 200, 1600, 0.8, 'sine', 0.12);
      noise(c, 0.8, 0.3, 500, 4000, 1.5);
      break;
    case 'hover':
      tone(c, 1200, 1200, 0.03, 'triangle', 0.04);
      break;
    case 'secondary':
      tone(c, 440, 1760, 0.25, 'sawtooth', 0.08);
      noise(c, 0.3, 0.35, 3000, 500, 1);
      break;
  }
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.2, ctx.currentTime, 0.05);
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

// ───────────────── 배경음: 절차적 앰비언트 (저음 드론 + 화음 패드 + 드문 아르페지오) ─────────────────

type Mood = 'hub' | 'run' | 'boss' | 'none';
let mood: Mood = 'none';
let musicGain: GainNode | null = null;
let timer: number | null = null;
let step = 0;

const SCALES: Record<Exclude<Mood, 'none'>, { root: number; chords: number[][]; tempo: number; arp: number }> = {
  hub: { root: 55, chords: [[0, 7, 12, 16], [5, 12, 17, 21], [3, 10, 15, 19], [7, 14, 19, 22]], tempo: 0.42, arp: 0.35 },
  run: { root: 49, chords: [[0, 7, 12, 15], [-2, 5, 10, 14], [3, 10, 15, 19], [-4, 3, 8, 12]], tempo: 0.3, arp: 0.5 },
  boss: { root: 46, chords: [[0, 7, 12, 13], [1, 8, 13, 16], [0, 7, 12, 15], [-2, 5, 10, 13]], tempo: 0.2, arp: 0.75 },
};

const hz = (root: number, semi: number) => root * Math.pow(2, semi / 12);

function note(c: AudioContext, f: number, t0: number, dur: number, type: OscillatorType, vol: number, cutoff = 1800) {
  const o = c.createOscillator();
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.4, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(lp);
  lp.connect(g);
  g.connect(musicGain!);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function tick() {
  // 첫 클릭 전(멈춘 상태)엔 시계가 0에 멈춰 있어 예약한 음이 한 시각에 쌓였다가 한꺼번에 터짐
  if (!ctx || ctx.state !== 'running' || mood === 'none' || !musicGain) return;
  const sc = SCALES[mood];
  const beat = sc.tempo;
  const now = ctx.currentTime + 0.05;
  const bar = Math.floor(step / 8) % sc.chords.length;
  const chord = sc.chords[bar];
  if (step % 8 === 0) {
    note(ctx, hz(sc.root, chord[0]) / 2, now, beat * 8.5, 'sine', 0.22, 400);
    for (const n of chord.slice(1)) note(ctx, hz(sc.root * 2, n), now, beat * 8.2, 'triangle', 0.035, 1200);
  }
  if (mood === 'boss' && step % 2 === 0) note(ctx, hz(sc.root, chord[0]) / 2, now, beat * 0.9, 'sawtooth', 0.05, 300);
  if (Math.random() < sc.arp && step % 2 === 0) {
    const n = chord[Math.floor(Math.random() * chord.length)] + 12 * (1 + Math.floor(Math.random() * 2));
    note(ctx, hz(sc.root * 2, n), now, beat * 3, 'triangle', 0.05, 2600);
  }
  step++;
}

export function playMusic(next: Mood): void {
  if (next === mood) return;
  mood = next;
  const c = audio();
  if (!c) return;
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = 0.5;
    musicGain.connect(master!);
  }
  step = 0;
  if (timer !== null) window.clearInterval(timer);
  if (next === 'none') return;
  timer = window.setInterval(tick, SCALES[next].tempo * 1000);
}
