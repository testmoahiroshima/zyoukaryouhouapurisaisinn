// 施術記録：端末内（localStorage）に保存し、JSON/CSV で書き出し・読み込みする。氏名は保存しない。
// 1件の形は data/session_schema.json に合わせる（探査の値は塗りから読み取った 0〜5）。

const KEY = 'joka.records';

export function loadRecords() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveRecords(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function addRecord(rec) {
  const list = loadRecords();
  list.push(rec);
  return saveRecords(list);
}

export function updateRecord(id, patch) {
  const list = loadRecords();
  const r = list.find((x) => x.session_id === id);
  if (!r) return false;
  Object.assign(r, patch);
  return saveRecords(list);
}

export function deleteRecord(id) {
  return saveRecords(loadRecords().filter((x) => x.session_id !== id));
}

export function newId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 読み込み：同じ session_id は上書きせず、新しいものだけ足す
export function importRecords(json) {
  const incoming = Array.isArray(json) ? json : json?.records;
  if (!Array.isArray(incoming)) throw new Error('記録の形が違います');
  const list = loadRecords();
  const ids = new Set(list.map((r) => r.session_id));
  let added = 0;
  for (const r of incoming) {
    if (!r || typeof r !== 'object' || !r.session_id || !r.date || !r.receiver_code) continue;
    if (ids.has(r.session_id)) continue;
    list.push(r);
    ids.add(r.session_id);
    added++;
  }
  saveRecords(list);
  return added;
}

export function exportJSON(list) {
  return JSON.stringify({ app: '浄化療法 実践サポート', exported_at: new Date().toISOString(), records: list }, null, 1);
}

// CSV：1行＝1回の施術の1箇所（探査の前後と施術分数）
export function exportCSV(list, pointName) {
  const head = ['記録ID', '日付', '受け手コード', '症状', 'つらさ（前）', 'つらさ（後）', '箇所', '施術分', '熱（前）', '固結（前）', '圧痛（前）', '熱（後）', '固結（後）', '圧痛（後）', '変化', 'メモ', '翌日以降の変化'];
  const q = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [head];
  for (const r of list) {
    const fb = Object.fromEntries((r.findings || []).map((f) => [f.point_id, f]));
    const fa = Object.fromEntries((r.findings_after || []).map((f) => [f.point_id, f]));
    const tm = Object.fromEntries((r.treatments || []).map((t) => [t.point_id, t.minutes]));
    const ids = [...new Set([...(r.treatments || []).map((t) => t.point_id), ...Object.keys(fb), ...Object.keys(fa)])];
    const base = [r.session_id, r.date, r.receiver_code, (r.complaints || []).join(' / '), r.self_rating_before?.つらさ ?? '', r.self_rating_after?.つらさ ?? ''];
    const tail = [(r.changes_observed || []).join(' / '), r.memo || '', r.follow_up || ''];
    if (!ids.length) rows.push([...base, '', '', '', '', '', '', '', '', ...tail]);
    for (const id of ids) {
      rows.push([...base, pointName(id), tm[id] ?? '', fb[id]?.heat ?? '', fb[id]?.kouketsu ?? '', fb[id]?.atsutsuu ?? '', fa[id]?.heat ?? '', fa[id]?.kouketsu ?? '', fa[id]?.atsutsuu ?? '', ...tail]);
    }
  }
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}

export function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---- 集計 ----
export function summarize(list) {
  const minutes = {};
  const change = {};
  let total = 0;
  let deltaSum = 0;
  let deltaN = 0;
  for (const r of list) {
    for (const t of r.treatments || []) {
      minutes[t.point_id] = (minutes[t.point_id] || 0) + (t.minutes || 0);
      total += t.minutes || 0;
    }
    const b = r.self_rating_before?.つらさ;
    const a = r.self_rating_after?.つらさ;
    if (Number.isFinite(b) && Number.isFinite(a)) { deltaSum += a - b; deltaN++; }
    const fa = Object.fromEntries((r.findings_after || []).map((f) => [f.point_id, f]));
    for (const f of r.findings || []) {
      const af = fa[f.point_id];
      if (!af) continue;
      const c = (change[f.point_id] ||= { n: 0, heatB: 0, heatA: 0, kouB: 0, kouA: 0 });
      c.n++;
      c.heatB += f.heat || 0;
      c.heatA += af.heat || 0;
      c.kouB += f.kouketsu || 0;
      c.kouA += af.kouketsu || 0;
    }
  }
  return { count: list.length, total, avgDelta: deltaN ? deltaSum / deltaN : null, minutes, change };
}
