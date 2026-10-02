// 癒しの音楽（その場で生成する音）・手持ちの音楽ファイル・合図の鐘・音声アドバイス
// 音楽ファイルは端末内（IndexedDB）にだけ保存し、外部へ送らない。

export const TRACKS = [
  { id: 'drone', name: '静かな倍音' },
  { id: 'bowl', name: 'シンギングボウル' },
  { id: 'suikin', name: '水琴窟' },
  { id: 'arpeggio', name: 'ゆらぎの調べ' },
  { id: 'rain', name: 'やさしい雨音' },
  { id: 'stream', name: 'せせらぎ' },
];

let ctx = null;
let master = null;
let musicBus = null;
let reverb = null;
let volume = 0.6;

export function audioReady() { return !!ctx; }

// 音はユーザーの操作の中で初めて鳴らせる（ブラウザの決まり）
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    reverb = makeReverb(3.2);
    reverb.connect(musicBus);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
}

function makeReverb(seconds) {
  const conv = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  conv.buffer = buf;
  return conv;
}

function noiseBuffer(seconds = 4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // ピンクノイズ（柔らかいザー音）
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029591;
    b1 = 0.985 * b1 + w * 0.032534;
    b2 = 0.95 * b2 + w * 0.048056;
    d[i] = (b0 + b1 + b2 + w * 0.05) * 0.6;
  }
  return buf;
}

// 一音（倍音つき・減衰）
function pluck(dest, freq, { t = ctx.currentTime, dur = 3, gain = 0.15, type = 'sine', partials = [1], detune = 0 } = {}) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  const oscs = partials.map((m, i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * m;
    o.detune.value = detune * (i % 2 ? 1 : -1);
    const pg = ctx.createGain();
    pg.gain.value = 1 / (i + 1.2);
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + dur + 0.1);
    return o;
  });
  return oscs;
}

// 生成音楽：start(dest) で鳴らし始め、stop() で止める
function makeTrack(id) {
  const out = ctx.createGain();
  out.gain.value = 0;
  const timers = [];
  const nodes = [];
  const every = (fn, minMs, maxMs) => {
    const loop = () => { fn(); timers.push(setTimeout(loop, minMs + Math.random() * (maxMs - minMs))); };
    timers.push(setTimeout(loop, 200));
  };
  // 音源 → out（音量の出し入れ）→ 素の音 dry と 残響 wet に分ける
  const send = out;
  const dry = ctx.createGain();
  dry.gain.value = 0.7;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  out.connect(dry);
  out.connect(wet);
  wet.connect(reverb);

  if (id === 'drone') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(send);
    [[110, 0.22], [165, 0.12], [220, 0.1], [277.2, 0.05], [330, 0.05]].forEach(([f, gv], i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gv;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lg = ctx.createGain();
      lg.gain.value = gv * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(lp);
      o.start();
      lfo.start();
      nodes.push(o, lfo);
    });
  } else if (id === 'bowl') {
    every(() => {
      const f = [196, 220, 261.6, 293.7][Math.floor(Math.random() * 4)];
      pluck(send, f, { dur: 9, gain: 0.18, partials: [1, 2.76, 5.4, 8.93], detune: 4 });
    }, 7000, 12000);
  } else if (id === 'suikin') {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    delay.connect(fb).connect(delay);
    delay.connect(send);
    const notes = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
    every(() => {
      const f = notes[Math.floor(Math.random() * notes.length)];
      pluck(delay, f, { dur: 2.5, gain: 0.08, partials: [1, 2.01, 3.9] });
      pluck(send, f, { dur: 2.5, gain: 0.06, partials: [1, 2.01] });
    }, 1400, 4200);
  } else if (id === 'arpeggio') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(send);
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
    let i = 0;
    every(() => {
      i = Math.max(0, Math.min(scale.length - 1, i + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]));
      pluck(lp, scale[i], { dur: 4, gain: 0.09, type: 'triangle', partials: [1, 2] });
      if (Math.random() < 0.25) pluck(lp, scale[i] / 2, { dur: 6, gain: 0.07, type: 'sine' });
    }, 1100, 2600);
  } else if (id === 'rain' || id === 'stream') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(6);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = id === 'rain' ? 'lowpass' : 'bandpass';
    bp.frequency.value = id === 'rain' ? 2400 : 900;
    bp.Q.value = id === 'rain' ? 0.5 : 0.8;
    const g = ctx.createGain();
    g.gain.value = id === 'rain' ? 0.5 : 0.7;
    src.connect(bp).connect(g).connect(out);
    src.start();
    nodes.push(src);
    if (id === 'stream') {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.15;
      const lg = ctx.createGain();
      lg.gain.value = 400;
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
      nodes.push(lfo);
      every(() => pluck(send, 600 + Math.random() * 900, { dur: 0.25, gain: 0.03 }), 300, 1200);
    } else {
      every(() => pluck(send, 2200 + Math.random() * 2400, { dur: 0.12, gain: 0.025 }), 120, 600);
    }
  }

  return {
    start(dest, fade = 3) {
      dry.connect(dest);
      out.gain.setValueAtTime(0, ctx.currentTime);
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + fade);
    },
    stop(fade = 3) {
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      setTimeout(() => {
        timers.forEach(clearTimeout);
        nodes.forEach((n) => { try { n.stop(); } catch { /* 停止済み */ } });
        try { out.disconnect(); dry.disconnect(); wet.disconnect(); } catch { /* 切断済み */ }
      }, fade * 1000 + 200);
    },
  };
}

// ---- 手持ちの音楽ファイル（端末内に保存） ----
const DB_NAME = 'joka-audio';
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function listFiles() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const req = db.transaction('files').objectStore('files').getAll();
      req.onsuccess = () => resolve(req.result.map(({ id, name }) => ({ id, name })));
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}
export async function addFiles(fileList) {
  const added = [];
  try {
    const db = await openDB();
    for (const f of fileList) {
      const rec = { id: `file:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, name: f.name.replace(/\.[^.]+$/, ''), blob: f };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      added.push({ id: rec.id, name: rec.name });
    }
  } catch { /* 保存できない環境では、この画面を開いている間だけ使う */
    for (const f of fileList) {
      const id = `mem:${Math.random().toString(36).slice(2, 9)}`;
      memFiles[id] = f;
      added.push({ id, name: f.name.replace(/\.[^.]+$/, ''), temp: true });
    }
  }
  return added;
}
export async function removeFile(id) {
  delete memFiles[id];
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch { /* 何もしない */ }
}
const memFiles = {};
async function getBlob(id) {
  if (memFiles[id]) return memFiles[id];
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('files').objectStore('files').get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => resolve(null);
  });
}

function makeFileTrack(id, onEnded) {
  const out = ctx.createGain();
  out.gain.value = 0;
  const el = new Audio();
  el.preload = 'auto';
  let url = null;
  let srcNode = null;
  return {
    async start(dest, fade = 2) {
      const blob = await getBlob(id).catch(() => null);
      if (!blob) { onEnded?.(); return; }
      url = URL.createObjectURL(blob);
      el.src = url;
      srcNode = ctx.createMediaElementSource(el);
      srcNode.connect(out);
      out.connect(dest);
      el.onended = () => onEnded?.();
      out.gain.setValueAtTime(0, ctx.currentTime);
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + fade);
      el.play().catch(() => onEnded?.());
    },
    stop(fade = 2) {
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      setTimeout(() => {
        el.pause();
        try { srcNode?.disconnect(); out.disconnect(); } catch { /* 切断済み */ }
        if (url) URL.revokeObjectURL(url);
      }, fade * 1000 + 100);
    },
  };
}

// ---- 再生リスト（複数選曲。順に切り替え、最後まで行けば最初に戻る） ----
export class Player {
  constructor() {
    this.list = [];
    this.index = 0;
    this.current = null;
    this.timer = null;
    this.minutes = 5;
    this.onChange = null;
  }
  get playing() { return !!this.current; }
  get currentName() {
    const id = this.list[this.index];
    return TRACKS.find((t) => t.id === id)?.name || this.names?.[id] || '';
  }
  setList(ids, names = {}) {
    this.list = ids.slice();
    this.names = names;
    if (this.index >= this.list.length) this.index = 0;
  }
  play(startIndex = this.index) {
    if (!unlockAudio() || !this.list.length) return;
    this.stop(1.5);
    this.index = startIndex % this.list.length;
    const id = this.list[this.index];
    const isFile = id.startsWith('file:') || id.startsWith('mem:');
    const tr = isFile ? makeFileTrack(id, () => this.next()) : makeTrack(id);
    this.current = tr;
    tr.start(musicBus, 3);
    clearTimeout(this.timer);
    // 生成音楽は一定時間で次の曲へ。ファイルは曲の終わりで次へ
    if (!isFile && this.list.length > 1) this.timer = setTimeout(() => this.next(), this.minutes * 60000);
    this.onChange?.();
  }
  next() { if (this.list.length) this.play(this.index + 1); }
  stop(fade = 2.5) {
    clearTimeout(this.timer);
    if (this.current) this.current.stop(fade);
    this.current = null;
    this.onChange?.();
  }
}

// ---- 合図の鐘 ----
export function chime() {
  if (!unlockAudio()) return;
  pluck(master, 659.3, { dur: 3, gain: 0.25, partials: [1, 2.76, 5.4] });
  pluck(master, 987.8, { t: ctx.currentTime + 0.35, dur: 3, gain: 0.18, partials: [1, 2.76] });
}

// ---- 音声アドバイス ----
let jaVoice = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices?.() || [];
  jaVoice = vs.find((v) => v.lang === 'ja-JP') || vs.find((v) => v.lang?.startsWith('ja')) || null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}
export function canSpeak() { return typeof window !== 'undefined' && !!window.speechSynthesis; }
export function speak(text, { rate = 0.95 } = {}) {
  if (!canSpeak() || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  u.rate = rate;
  // 話している間は音楽を少し下げる
  if (musicBus) {
    musicBus.gain.setTargetAtTime(0.35, ctx.currentTime, 0.2);
    u.onend = u.onerror = () => musicBus.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
  }
  window.speechSynthesis.speak(u);
}
export function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch { /* 何もしない */ } }
