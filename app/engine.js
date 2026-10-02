// 症状の入力文から、探査して見つめる箇所と毒素の流れを組み立て、
// 探査結果（熱・固結・圧痛）から施術の優先順位と時間配分を出す（アプリ内で完結。外部送信なし）。

// 全角半角・カタカナひらがな・空白の違いを吸収する
export function normalize(s) {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s、。，．・,.!?！？「」『』（）()]/g, '');
}

const NEGATION = /^(は|が|も)?(ない|無い|なし|無し|ありません)|^くない|^く(は|も)?ありません/;

function rangesOf(text, terms) {
  const out = [];
  for (const t of terms) {
    if (!t) continue;
    let i = text.indexOf(t);
    while (i !== -1) {
      out.push([i, i + t.length]);
      i = text.indexOf(t, i + 1);
    }
  }
  return out;
}

// keywords の一致箇所を返す。exclude と重なる一致・直後が否定（「〜はない」）の一致は除く
export function findHits(text, keywords, exclude = []) {
  const blocked = rangesOf(text, exclude);
  const hits = [];
  for (const kw of keywords) {
    if (!kw) continue;
    let i = text.indexOf(kw);
    while (i !== -1) {
      const end = i + kw.length;
      const overlapped = blocked.some(([a, b]) => i < b && a < end);
      const negated = NEGATION.test(text.slice(end, end + 6));
      if (!overlapped && !negated) {
        hits.push({ kw, index: i });
        break;
      }
      i = text.indexOf(kw, i + 1);
    }
  }
  return hits;
}

// JSON を読み込んだ直後に一度だけ呼ぶ
export function prepare(raw) {
  const pointList = [];
  for (const region of raw.points.regions) {
    for (const p of region.points) {
      pointList.push({ ...p, region: region.id, regionName: region.name, selfProbe: !!region.self_probe });
    }
  }
  const pointById = Object.fromEntries(pointList.map((p) => [p.id, p]));
  const flowById = Object.fromEntries(raw.flows.flows.map((f) => [f.id, f]));
  const routeByNo = Object.fromEntries(raw.routes.routes.map((r) => [r.no, r]));
  const categories = raw.symptoms.categories.map((c) => ({
    ...c,
    _kw: c.keywords.map(normalize),
    _ex: (c.exclude || []).map(normalize),
  }));
  const safetyRules = raw.safety.rules.map((r) => ({
    ...r,
    _kw: r.keywords.map(normalize),
    _ex: (r.exclude || []).map(normalize),
  }));
  const knowledge = raw.knowledge || { principles: [], kakuron: [] };
  const principleById = Object.fromEntries(knowledge.principles.map((k) => [k.id, k]));
  // 経路名 → 探査部位（places.json の stations に無い名前は、部位名・別名でも引く）
  const stationNames = { ...(raw.places?.stations || {}) };
  for (const p of pointList) {
    for (const n of [p.name, ...(p.aliases || [])]) if (!stationNames[n]) stationNames[n] = [p.id];
  }
  return { raw, pointList, pointById, flowById, routeByNo, categories, safetyRules, knowledge, principleById, stationNames };
}

// ---- 毒素の流れ（経路） ----

// 経路名の配列（元→舞台）を、探査部位の駅（stations）と経由地（place）に変える
function toStations(db, names) {
  return (names || []).map((name) => {
    const ids = db.stationNames[name];
    return ids ? { name, points: ids.filter((id) => db.pointById[id]) } : { name, place: name };
  });
}

function stationLevel(levels, st) {
  if (!st.points) return null;
  const ls = st.points.map((id) => levels[id]).filter((l) => l !== undefined);
  return ls.length ? Math.min(...ls) : null;
}

function fillStation(db, ids) {
  const pts = ids.filter((id) => db.pointById[id]);
  return { name: pts.map((id) => db.pointById[id].name).join('・'), points: pts, via: true };
}

// 基本経路（腎臓部→肩甲間部→肩→頸部→頭／腎臓部→腎臓下方部→腰部）で、抜けている段を補う
export function completeStations(db, stations) {
  const lv = db.raw.places?.levels;
  if (!lv || !stations.length) return stations;
  let out = stations.slice();
  for (const axis of ['up', 'down']) {
    const levels = lv[axis];
    const fill = lv[`${axis}_fill`];
    const next = [];
    // 途中の段の補完
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      next.push(a);
      const b = out[i + 1];
      if (!b) break;
      const la = stationLevel(levels, a);
      const lb = stationLevel(levels, b);
      if (la !== null && lb !== null && lb - la > 1) {
        for (let l = la + 1; l < lb; l++) if (fill[l]) next.push(fillStation(db, fill[l]));
      }
    }
    out = next;
    // 先頭が肩・頸部（上昇）または腰部（下降）から始まる時は、元の腎臓部側を補う
    const first = out.find((s) => s.points);
    const l0 = first ? stationLevel(levels, first) : null;
    const startFrom = axis === 'up' ? [2, 3] : [2];
    if (first === out[0] && l0 !== null && startFrom.includes(l0)) {
      const present = new Set(out.flatMap((s) => s.points || []));
      const pre = [];
      for (let l = 0; l < l0; l++) {
        if (fill[l] && !fill[l].every((id) => present.has(id))) pre.push(fillStation(db, fill[l]));
      }
      out = [...pre, ...out];
    }
  }
  return out;
}

// 駅ごとの役割：最初＝楽屋、最後の探査部位（その後に経由地が無い時）＝舞台、他＝経路
function stationRoles(stations) {
  const lastPointIdx = stations.length - 1 >= 0 && stations[stations.length - 1].points ? stations.length - 1 : -1;
  return stations.map((s, i) => {
    if (!s.points) return null;
    if (i === 0 && stations.length > 1) return 'rakuya';
    if (i === lastPointIdx) return 'butai';
    return 'keiro';
  });
}

export function buildFlow(db, src, kind) {
  const names = kind === 'flow' ? src.route : src.route;
  const stations = completeStations(db, toStations(db, names));
  const roles = stationRoles(stations);
  return { kind, src, stations: stations.map((s, i) => ({ ...s, role: roles[i] })) };
}

// ---- 症状の読み取りと、探査して見つめる箇所 ----

const ROLE_WEIGHT = { rakuya: 1.0, keiro: 0.8, butai: 0.9, look: 0.8, kakuron: 1.0, outlet: 0.6, extra: 0.9 };
const PELVIC_CATS = new Set(['legs', 'breath', 'lowback', 'abdomen', 'urinary', 'women', 'anus', 'lungs', 'fatigue']);
const OUTLET_POINTS = ['youkotsu', 'biteikotsu', 'sokeibu'];

function detectSide(norm) {
  const left = norm.includes('左') || norm.includes('ひだり');
  const right = norm.includes('右') || norm.includes('みぎ');
  if (left && right) return 'both';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

// text: 自由入力、selected: 候補ボタンで選んだカテゴリ id の配列
export function analyze(db, text, selected = []) {
  const norm = normalize(text);

  const safety = [];
  for (const rule of db.safetyRules) {
    const hits = findHits(norm, rule._kw, rule._ex);
    if (hits.length) safety.push({ id: rule.id, level: rule.level, message: rule.message, words: hits.map((h) => h.kw), blockSymptoms: !!rule.block_symptoms });
  }
  // 病名として検出した語は症状の照合に使わない（例：「糖尿病」の「尿」）
  const blockWords = safety.filter((s) => s.blockSymptoms).flatMap((s) => s.words);

  const matched = [];
  for (const cat of db.categories) {
    const hits = norm ? findHits(norm, cat._kw, [...cat._ex, ...blockWords]) : [];
    const chosen = selected.includes(cat.id);
    if (!hits.length && !chosen) continue;
    const flows = (cat.flows || []).map((id) => db.flowById[id]).filter(Boolean).map((f) => buildFlow(db, f, 'flow'));
    const routes = (cat.routes || []).map((no) => db.routeByNo[no]).filter(Boolean).map((r) => buildFlow(db, r, 'route'));
    const kakuron = db.knowledge.kakuron.filter((k) => k.categories.includes(cat.id));
    matched.push({
      id: cat.id,
      label: cat.label,
      group: cat.group,
      words: hits.sort((a, b) => a.index - b.index).map((h) => h.kw),
      chosen,
      firstIndex: hits.length ? Math.min(...hits.map((h) => h.index)) : -1,
      flows,
      routes,
      kakuron,
      pelvic: PELVIC_CATS.has(cat.id),
      basis: cat.basis || null,
      textbook: cat.textbook || null,
      extra: cat.extra_points || [],
    });
  }
  // 入力文に出てきた順（候補ボタンのみの選択は後ろ）
  matched.sort((a, b) => (a.firstIndex < 0) - (b.firstIndex < 0) || a.firstIndex - b.firstIndex);

  const fallback = matched.length === 0;
  const acc = {};
  const add = (id, role, catId) => {
    if (!db.pointById[id]) return;
    const a = (acc[id] ||= { score: 0, roles: new Set(), from: new Set(), catScore: {} });
    // 同じ症状の中では一番重い役割だけを数える
    const w = ROLE_WEIGHT[role];
    if ((a.catScore[catId] || 0) < w) {
      a.score += w - (a.catScore[catId] || 0);
      a.catScore[catId] = w;
    }
    a.roles.add(role);
    a.from.add(catId);
  };
  if (fallback) {
    for (const p of db.pointList) if (!p.selfProbe) add(p.id, 'look', '_base');
  } else {
    for (const m of matched) {
      for (const fl of [...m.flows, ...m.routes]) {
        for (const st of fl.stations) {
          if (!st.points) continue;
          for (const id of st.points) add(id, st.via ? 'keiro' : st.role, m.id);
        }
        for (const id of fl.src.look_points || []) add(id, 'look', m.id);
      }
      for (const k of m.kakuron) for (const id of k.points) add(id, 'kakuron', m.id);
      for (const id of m.extra) add(id, 'extra', m.id);
      if (m.pelvic) for (const id of OUTLET_POINTS) add(id, 'outlet', m.id);
    }
  }
  const ranked = Object.entries(acc).sort((a, b) => b[1].score - a[1].score);
  const keyIds = new Set(
    fallback ? [] : ranked.filter(([, a]) => a.score >= 1.5).slice(0, 3).map(([id]) => id),
  );
  const points = Object.entries(acc)
    .map(([id, a]) => {
      const p = db.pointById[id];
      return {
        id,
        no: p.no,
        name: p.name,
        region: p.region,
        regionName: p.regionName,
        selfProbe: p.selfProbe,
        score: Math.round(a.score * 10) / 10,
        roles: [...a.roles],
        key: keyIds.has(id),
        from: [...a.from],
      };
    })
    .sort((a, b) => a.no - b.no);

  return {
    input: text,
    safety,
    categories: matched,
    points,
    side: detectSide(norm),
    fallback,
    pelvic: matched.some((m) => m.pelvic),
    urgent: safety.some((s) => s.level === 'urgent'),
  };
}

// ---- 施術の優先順位と時間配分 ----
// findings: { pointId: { heat, kouketsu, atsutsuu } }（各 0〜3）
// total: 全体の分数、analysis: analyze() の結果（無くてもよい）

const REGION_FACTOR = {
  kidney: { f: 1.3, why: '重要施術部位：腎臓部は第一（全身の浄化作用を強める）', ref: 'jinzo_first' },
  back: { f: 1.15, why: '背部・肩甲骨部は第二の順位（前面の症状は背部から）', ref: 'senaka_main' },
  head: { f: 1.2, why: '重要施術部位：頭は四肢五体の根元', ref: 'atama_first' },
  shoulder: { f: 1.2, why: '重要施術部位：肩（肩の硬軟は健康の目安）', ref: 'kata_gauge' },
};

export function findingScore(f) {
  if (!f) return 0;
  const h = f.heat || 0;
  const k = f.kouketsu || 0;
  const a = f.atsutsuu || 0;
  return 1.5 * h + k + a + (h && k && a ? 2 : 0);
}

export function planSession(db, findings, total, analysis = null) {
  const roleOf = Object.fromEntries((analysis?.points || []).map((p) => [p.id, p]));
  const hasAnalysis = !!analysis && !analysis.fallback;
  const lowerCongested = OUTLET_POINTS.concat(['jinzo_kahou', 'jinzo_kahou_side'])
    .some((id) => (findings[id]?.kouketsu || 0) >= 2);

  const cands = [];
  for (const [id, f] of Object.entries(findings)) {
    const p = db.pointById[id];
    const F = findingScore(f);
    if (!p || F <= 0) continue;
    let W = 1;
    const reasons = [];
    const h = f.heat || 0;
    const k = f.kouketsu || 0;
    const a = f.atsutsuu || 0;
    if (h && k && a) reasons.push({ text: '熱・固結・圧痛の一致点（急所）', ref: 'netsu' });
    else if (h) reasons.push({ text: '熱がある＝溶けて排泄に向かっている（第二浄化作用）', ref: 'netsu' });
    // 1. 重要施術部位
    const rf = REGION_FACTOR[p.region];
    if (rf) { W *= rf.f; reasons.push({ text: rf.why, ref: rf.ref }); }
    // 2. 楽屋と舞台
    const r = roleOf[id];
    if (hasAnalysis) {
      if (r?.roles.includes('rakuya')) { W *= 1.3; reasons.push({ text: '楽屋（本日の症状の元）', ref: 'kyuusho' }); }
      else if (r?.roles.includes('keiro')) { W *= 1.1; reasons.push({ text: '毒素の流れの経路上', ref: 'joushou' }); }
      else if (r?.roles.includes('butai')) { reasons.push({ text: '舞台（症状が出ている所）', ref: 'kyuusho' }); }
      else if (!r) { W *= 0.85; }
    }
    // 3. 毒素集溜と排泄の順序
    if (OUTLET_POINTS.includes(id) || id === 'jinzo_kahou_side') {
      W *= lowerCongested ? 1.3 : 1.15;
      reasons.push({ text: lowerCongested ? '骨盤周辺の固結が強い：出口を開けて排泄の道をつくる' : '排泄の出口（骨盤周辺）', ref: 'kotsuban' });
    }
    // 4. 各論
    if (r?.roles.includes('kakuron')) { W *= 1.25; reasons.push({ text: '各論：本日の症状について説かれた急所', ref: null }); }
    cands.push({ id, no: p.no, name: p.name, region: p.region, regionName: p.regionName, F, W, P: F * W, reasons, finding: { heat: h, kouketsu: k, atsutsuu: a } });
  }
  if (!cands.length) return { ok: false, message: '探査で熱・固結・圧痛のあった箇所を入力してください。' };

  cands.sort((x, y) => y.P - x.P);
  const maxN = Math.max(2, Math.min(5, Math.round(total / 8)));
  let chosen = cands.slice(0, Math.min(maxN, cands.length));
  // 腎臓部に所見があれば必ず含める（腎臓部第一）
  const kid = cands.find((c) => c.region === 'kidney');
  if (kid && !chosen.includes(kid)) {
    chosen[chosen.length - 1] = kid;
    kid.reasons.push({ text: '腎臓部の固結が溶けると他の局部も溶けやすくなるため組み入れ', ref: 'jinzo_first' });
  }

  const probe = Math.max(3, Math.round(total * 0.15));
  const check = Math.max(2, Math.round(total * 0.1));
  const treat = Math.max(chosen.length * 3, total - probe - check);
  const sumP = chosen.reduce((s, c) => s + c.P, 0);
  // 最低3分を確保し、残りを優先度で比例配分（端数は大きい順に配る）
  const base = 3 * chosen.length;
  const rest = Math.max(0, treat - base);
  const raw = chosen.map((c) => 3 + (rest * c.P) / sumP);
  const mins = raw.map(Math.floor);
  let left = treat - mins.reduce((s, m) => s + m, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { mins[i]++; left--; } });

  const items = chosen.map((c, i) => ({ ...c, minutes: mins[i], share: c.P / sumP }));
  // 施術の順序：頭→首→肩→背→腎臓→腰（まず頭を清め、首・肩、次に腎臓部）
  const order = items.slice().sort((a, b) => a.no - b.no);
  const others = cands.filter((c) => !chosen.includes(c));
  return { ok: true, total: probe + check + order.reduce((s, c) => s + c.minutes, 0), probe, check, items: order, others };
}
