// 施術の終わりの3D人体図（熱・固結・圧痛の塗り）を、記録ごとに端末の中（IndexedDB）に残す。外へは送らない。
// 次の施術で「前回の終わりの図から始める」ために使う。塗った頂点だけを、段階（0〜20）を10倍した整数で持つ。
import { LAYERS } from './paint.js';

const DB_NAME = 'joka-maps';
const STORE = 'maps';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

// Body3D の塗り（values: { 層: Float32Array }, top: Uint8Array）を、塗った頂点だけに縮める
export function encodeMap(b3) {
  const layers = {};
  for (const l of LAYERS) {
    const v = b3.values[l.id];
    const idx = [];
    const val = [];
    for (let i = 0; i < v.length; i++) if (v[i] >= 0.5) { idx.push(i); val.push(Math.min(200, Math.round(v[i] * 10))); }
    layers[l.id] = { idx: Uint32Array.from(idx), val: Uint8Array.from(val) };
  }
  const tIdx = [];
  const tVal = [];
  for (let i = 0; i < b3.top.length; i++) if (b3.top[i]) { tIdx.push(i); tVal.push(b3.top[i]); }
  return { nv: b3.nv, layers, top: { idx: Uint32Array.from(tIdx), val: Uint8Array.from(tVal) } };
}

// 縮めた塗りを、Body3D.copyFrom に渡せる形（values・top）に戻す
export function decodeMap(m) {
  const values = Object.fromEntries(LAYERS.map((l) => [l.id, new Float32Array(m.nv)]));
  for (const l of LAYERS) {
    const x = m.layers?.[l.id];
    if (!x) continue;
    for (let k = 0; k < x.idx.length; k++) values[l.id][x.idx[k]] = x.val[k] / 10;
  }
  const top = new Uint8Array(m.nv);
  for (let k = 0; k < (m.top?.idx.length || 0); k++) top[m.top.idx[k]] = m.top.val[k];
  return { values, top };
}

export async function saveMap(id, receiver, date, b3) {
  try {
    await tx('readwrite', (s) => s.put({ id, receiver, date, saved: Date.now(), map: encodeMap(b3) }));
    return true;
  } catch {
    return false;
  }
}

export async function loadMap(id) {
  try {
    const rec = await tx('readonly', (s) => s.get(id));
    return rec?.map ? decodeMap(rec.map) : null;
  } catch {
    return null;
  }
}

export async function hasMap(id) {
  try {
    return !!(await tx('readonly', (s) => s.getKey(id)));
  } catch {
    return false;
  }
}

export async function deleteMap(id) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch { /* 無ければそのまま */ }
}
