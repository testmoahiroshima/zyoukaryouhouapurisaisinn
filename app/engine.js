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
  const kenkai = (raw.kenkai?.entries || []).map((e) => ({
    ...e,
    _kw: e.keywords.map(normalize),
    _ex: (e.exclude || []).map(normalize),
  }));
  return { raw, pointList, pointById, flowById, routeByNo, categories, safetyRules, knowledge, principleById, stationNames, kenkai };
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
const OUTLET_POINTS = ['youkotsu', 'biteikotsu', 'sokeibu', 'choukotsu', 'senchou', 'chikotsu'];
export { OUTLET_POINTS };
const PELVIC_KENKAI = new Set(['hie', 'ashi', 'ashiura', 'oshiri', 'koshi', 'ji', 'fujin', 'seki', 'darui', 'mukumi', 'geri', 'benpi']);
const KIDNEY = ['haimen_jinzo', 'jinzo_kahou', 'jinzo_kahou_side'];
// 一まとまりで見る重要施術部位（頭部は前頭部・頭頂部・こめかみ部・後頭部のすべて）
const HEAD = ['zentoubu', 'touchoubu', 'sokutoubu', 'koutoubu'];
const KEY_GROUPS = [HEAD, ['kata', 'maekata'], KIDNEY];
// 頭部が特に大事と読み取れる症状（頭部の時間を長めにしてよい）
const HEAD_CATS = new Set(['headache', 'occipital', 'frontal', 'top', 'temple', 'head_use', 'head_warm', 'head_area', 'dizziness', 'insomnia']);
export { HEAD };

// 症状別・病気別の見解（kenkai.json）を引く。selected に 'k:id' があれば、その見解を選んだものとする。
// 病名の見解を先に引き、病名に含まれる語（例：「糖尿病」の「尿」）は症状の見解に使わない
export function findKenkai(db, text, selected = [], blockWords = []) {
  const norm = normalize(text);
  const pick = (entries, extraEx) => {
    const out = [];
    for (const e of entries) {
      const hits = norm ? findHits(norm, e._kw, [...e._ex, ...extraEx]) : [];
      const chosen = selected.includes(`k:${e.id}`);
      if (!hits.length && !chosen) continue;
      out.push({ ...e, words: hits.sort((a, b) => a.index - b.index).map((h) => h.kw), firstIndex: hits.length ? Math.min(...hits.map((h) => h.index)) : -1 });
    }
    return out;
  };
  const diseases = pick(db.kenkai.filter((e) => e.disease), blockWords);
  const diseaseWords = diseases.flatMap((e) => e.words);
  const symptoms = pick(db.kenkai.filter((e) => !e.disease), [...blockWords, ...diseaseWords]);
  let out = [...diseases, ...symptoms];
  // 「痛み（全般）」のような広い見解は、ほかに当てはまる見解が無い時だけ出す
  const specific = out.filter((e) => !e.fallback_only);
  if (specific.length) out = specific;
  return out.sort((a, b) => (a.firstIndex < 0) - (b.firstIndex < 0) || a.firstIndex - b.firstIndex);
}

// このアプリでは見解を載せない病気（受診の案内だけにする）
export function findSpiritual(db, text) {
  const sp = db.raw.kenkai?.spiritual;
  if (!sp) return [];
  return findHits(normalize(text), sp.keywords.map(normalize), (sp.exclude || []).map(normalize)).map((h) => h.kw);
}

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
  // 病名・急を要する語は症状カテゴリの照合に使わない（例：「糖尿病」の「尿」）
  const blockWords = safety.filter((s) => s.blockSymptoms).flatMap((s) => s.words);
  const urgentWords = safety.filter((s) => s.level === 'urgent').flatMap((s) => s.words);
  const spiritual = findSpiritual(db, text);

  const matched = [];
  for (const cat of spiritual.length ? [] : db.categories) {
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
  // 症状別の見解：つながる症状カテゴリがあればそこに添え、無ければ見解そのものを一つの症状として扱う
  // 見解を載せない病名を含む時は、見解・探査箇所を出さず受診の案内だけにする
  const kenkai = spiritual.length ? [] : findKenkai(db, text, selected, urgentWords);
  for (const m of matched) {
    m.kenkai = kenkai.filter((e) => e.categories.includes(m.id));
    if (m.chosen && !m.words.length && !m.kenkai.length) m.kenkai = db.kenkai.filter((e) => e.categories[0] === m.id);
  }
  for (const e of kenkai) {
    if (matched.some((m) => m.kenkai.includes(e))) continue;
    matched.push({
      id: `k:${e.id}`,
      label: e.label,
      group: e.group,
      words: e.words,
      chosen: e.firstIndex < 0,
      firstIndex: e.firstIndex,
      flows: [],
      routes: [],
      kakuron: [],
      kenkai: [e],
      pelvic: PELVIC_KENKAI.has(e.id),
      basis: null,
      textbook: e.textbook || null,
      extra: [],
      fromKenkai: true,
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
      for (const e of m.kenkai) for (const id of e.points) add(id, 'kakuron', m.id);
      // 見解に施術箇所の記述が無い症状は、重要施術部位の腎臓部（施術の第一）を見る
      if (m.fromKenkai && !m.kenkai.some((e) => e.points.length)) for (const id of KIDNEY) add(id, 'look', m.id);
      for (const id of m.extra) add(id, 'extra', m.id);
      if (m.pelvic) for (const id of OUTLET_POINTS) add(id, 'outlet', m.id);
    }
  }
  // 頭部・肩・腎臓部は、それぞれ一まとまりの重要施術部位：一部だけが出たら全体を出し、一部が重点なら全体を重点にする
  if (!fallback) {
    for (const g of KEY_GROUPS) {
      const present = g.filter((id) => acc[id]);
      if (!present.length) continue;
      const from = [...new Set(present.flatMap((id) => [...acc[id].from]))];
      for (const id of g) if (!acc[id]) for (const c of from) add(id, 'look', c);
    }
  }
  const ranked = Object.entries(acc).sort((a, b) => b[1].score - a[1].score);
  const keyIds = new Set(
    fallback ? [] : ranked.filter(([, a]) => a.score >= 1.5).slice(0, 3).map(([id]) => id),
  );
  for (const g of KEY_GROUPS) if (g.some((id) => keyIds.has(id))) for (const id of g) keyIds.add(id);
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
    kenkai: matched.flatMap((m) => m.kenkai).filter((e, i, a) => a.indexOf(e) === i),
    points,
    side: detectSide(norm),
    fallback,
    pelvic: matched.some((m) => m.pelvic),
    urgent: safety.some((s) => s.level === 'urgent'),
    spiritual,
    disease: kenkai.some((e) => e.disease) || safety.some((s) => s.id === 'disease') || spiritual.length > 0,
  };
}

// ---- 施術の優先順位と時間配分 ----
// findings: { pointId: { heat, kouketsu, atsutsuu } }（各 0〜5）
// total: 全体の分数、analysis: analyze() の結果（無くてもよい）

const REGION_FACTOR = {
  kidney: { f: 1.3, why: '重要施術部位：腎臓部は第一（全身の浄化作用を強める）', ref: 'jinzo_first' },
  back: { f: 1.15, why: '背部・肩甲骨部は第二の順位（前面の症状は背部から）', ref: 'senaka_main' },
  head: { f: 1.2, why: '重要施術部位：頭は四肢五体の根元', ref: 'atama_first' },
  shoulder: { f: 1.2, why: '重要施術部位：肩（肩の硬軟は健康の目安）', ref: 'kata_gauge' },
};

// 重要施術部位（頭・肩・腎臓部）は、探査で所見がなくても必ず少しでも施術に入れる。
// 所見のある箇所が無い時に入れる箇所（本日の症状で見つめる箇所があればそちらを先に）
// 頭は、前頭部・頭頂部・後頭部を外さない（所見が無くても1分でも施術する）。肩・腎臓部は、その部位で一番の箇所を
const REQUIRED = [
  { id: 'zentoubu', name: '頭（前頭部）', head: true },
  { id: 'touchoubu', name: '頭（頭頂部）', head: true },
  { id: 'koutoubu', name: '頭（後頭部・頭部の毒素の出入り口）', head: true },
  { region: 'shoulder', name: '肩', def: 'kata' },
  { region: 'kidney', name: '腎臓部', def: 'haimen_jinzo' },
];

// 鼠蹊部・恥骨部（腰部・骨盤周辺の自己探査）は、張り・痛み・熱があれば、時間が短くても必ず施術に入れる。
// 排泄の出口であり（腸骨内側〜鼠蹊部の凝りは恥骨へ続く）、所見の強い箇所に押し出されて外れやすいため
// 骨盤まわりの自己探査（腰骨部・尾てい骨部・鼠蹊部・腸骨の内側・仙腸関節付近・恥骨部）も、張り・痛みがはっきりしていれば入れる
// （鼠蹊部・恥骨部は 1 以上、ほかは 2 以上。強い順に3か所まで。排泄経路が詰まっていて入れた出口もこの数に含める）
export const PELVIC_MUST = ['sokeibu', 'chikotsu'];
const PELVIC_SELF = ['youkotsu', 'biteikotsu', 'sokeibu', 'choukotsu', 'senchou', 'chikotsu'];
const PELVIC_MIN = 1; // 熱・固結・圧痛のどれかがこの値（0〜5）以上なら入れる（鼠蹊部・恥骨部）
const PELVIC_MIN_OTHER = 2; // ほかの骨盤まわりの所
const PELVIC_MAX = 3;

// 探査の値は 0〜5（塗りの濃さ）。熱を最も重く、固結（張り）・圧痛を加え、重なる所（急所）をさらに重くする
export function findingScore(f) {
  if (!f) return 0;
  const h = (f.heat || 0) * 0.6;
  const k = (f.kouketsu || 0) * 0.6;
  const a = (f.atsutsuu || 0) * 0.6;
  return 1.5 * h + k + a + (h && k ? 1 : 0) + (h && k && a ? 1 : 0);
}

// 施術の順序。'top'＝体の上から下（背面図での高さ順）、'text'＝テキストの探査順、
// 'outlet'＝出口を先に開ける（頭 → 骨盤まわりの出口 → 腎臓部 → 首・肩・背 → その他。2級テキスト実践編 p100-105 の臥位の手順の例）
const OUTLET_GROUP = (p) => {
  if (p.region === 'head') return 0;
  if (OUTLET_POINTS.includes(p.id)) return 1;
  if (p.region === 'kidney') return 2;
  return 3;
};
// 頭部は、前頭部から始めて 前頭部 → 頭頂部 → こめかみ部・側頭部 → 後頭部（後頭部から首・脊柱の際へ下りる）
const HEAD_ORDER = ['zentoubu', 'touchoubu', 'sokutoubu', 'koutoubu'];
export function orderPoints(db, items, order = 'top') {
  const key = (it) => {
    const p = db.pointById[it.id];
    if (order === 'text') return [p.no, 0, it.side === 'L' ? 1 : 0];
    const a = p.anchor || (p.chart || [[0, 0]])[0];
    const h = HEAD_ORDER.indexOf(p.id);
    const y = h >= 0 ? -1000 + h : a[1];
    if (order === 'outlet') return [OUTLET_GROUP(p), y, p.no];
    return [y, p.no, 0];
  };
  return items.slice().sort((x, y) => {
    const a = key(x);
    const b = key(y);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}

// ---- 左右の違い ----
// f.sides = { L: {...}, R: {...} }（L＝体の左）。どちらかが明らかに強ければ、その側を重点にする
const SIDE_NAME = { L: '左', R: '右' };
export function sideFocus(f) {
  const s = f?.sides;
  if (!s) return null;
  const l = findingScore(s.L);
  const r = findingScore(s.R);
  if (!l && !r) return null;
  if (l && !r) return { side: 'L', strong: l, weak: 0, only: true };
  if (r && !l) return { side: 'R', strong: r, weak: 0, only: true };
  const hi = Math.max(l, r);
  const lo = Math.min(l, r);
  if (hi - lo >= 1 && hi >= lo * 1.3) return { side: l > r ? 'L' : 'R', strong: hi, weak: lo, only: false };
  // 合計の差が小さくても、熱（浄化の中心）にはっきり差があれば、熱の強い側を重点に
  const hl = s.L?.heat || 0;
  const hr = s.R?.heat || 0;
  if (Math.abs(hl - hr) >= 1.5) return { side: hl > hr ? 'L' : 'R', strong: hi, weak: lo, only: false, byHeat: true };
  return { side: null, strong: hi, weak: lo, only: false, both: true };
}
// からだ全体の左右の傾向：左右がある箇所の所見を左右で足し合わせ、訴えの左右（「右の肩が…」）も加える。
// 左右の差がはっきりしない箇所は、この傾向で重点の側を決める（左右どちらかを必ず重点にして時間差をつける）
export function overallSide(findings, analysis = null) {
  let L = 0;
  let R = 0;
  for (const f of Object.values(findings || {})) {
    if (!f?.sides) continue;
    L += findingScore(f.sides.L);
    R += findingScore(f.sides.R);
  }
  const said = analysis?.side === 'left' ? 'L' : analysis?.side === 'right' ? 'R' : null;
  if (said === 'L') L += 3;
  if (said === 'R') R += 3;
  if (Math.abs(L - R) >= 0.5) return { side: L > R ? 'L' : 'R', why: said && Math.abs(L - R) <= 3.01 ? 'said' : 'body', L, R };
  return { side: 'R', why: 'none', L, R };
}

// 骨盤まわり（出口）の左右：腸骨の内側・鼠蹊部・仙腸関節・腎臓下方部の固結の強い側
function pelvicSide(findings) {
  let L = 0;
  let R = 0;
  for (const id of ['choukotsu', 'sokeibu', 'senchou', 'jinzo_kahou', 'jinzo_kahou_side']) {
    const s = findings[id]?.sides;
    if (!s) continue;
    L = Math.max(L, s.L?.kouketsu || 0);
    R = Math.max(R, s.R?.kouketsu || 0);
  }
  if (Math.abs(L - R) < 1) return null;
  return L > R ? 'L' : 'R';
}

// ---- 排泄経路は整っているか ----
// 骨盤まわり（出口）の固結と、排泄の不調の訴えから、出口の詰まり具合をみる
const EXCRETION_KENKAI = new Set(['benpi', 'mukumi', 'hara', 'geri', 'fujin']);
const EXCRETION_CATS = new Set(['abdomen', 'urinary', 'women', 'anus']);
export function excretionCheck(db, findings, analysis = null) {
  const outlet = OUTLET_POINTS.concat(['jinzo_kahou']);
  let max = 0;
  const hard = [];
  for (const id of outlet) {
    const k = findings[id]?.kouketsu || 0;
    max = Math.max(max, k);
    if (k >= 2.5) hard.push(id);
  }
  const signs = [];
  if (analysis && !analysis.fallback) {
    for (const c of analysis.categories || []) if (EXCRETION_CATS.has(c.id)) signs.push(c.label);
    for (const e of analysis.kenkai || []) if (EXCRETION_KENKAI.has(e.id)) signs.push(e.label);
  }
  const nausea = !!analysis && /吐き気|はきけ|むかむか|ムカムカ|胸がむかつ|嘔吐|突き上げ/.test(analysis.input || '');
  let level = 'clear';
  if (max >= 3 || (max >= 2 && signs.length)) level = 'blocked';
  else if (max >= 1.5 || signs.length) level = 'some';
  const painted = outlet.some((id) => findings[id]);
  return { level, max, hard, signs: [...new Set(signs)], nausea, side: pelvicSide(findings), painted };
}

export function planSession(db, findings, total, analysis = null, { order = 'auto' } = {}) {
  const roleOf = Object.fromEntries((analysis?.points || []).map((p) => [p.id, p]));
  const hasAnalysis = !!analysis && !analysis.fallback;
  const ex = excretionCheck(db, findings, analysis);
  const whole = overallSide(findings, analysis);
  const WHY = { body: 'からだ全体では', said: '訴えが', none: '' };
  const pickSide = () => ({
    side: whole.side,
    reason: whole.why === 'none'
      ? { text: `左右の差が見られない：${SIDE_NAME[whole.side]}から先に、${SIDE_NAME[whole.side]}を長めに（よく施術すべき方から先に）`, ref: 'jinzo_yoko' }
      : { text: `左右の差が小さい：${WHY[whole.why]}${SIDE_NAME[whole.side]}が強いので、${SIDE_NAME[whole.side]}を重点に`, ref: 'sayuu' },
  });
  const lowerCongested = ex.level === 'blocked';
  const pSide = ex.side;

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
    if (h && k && a) reasons.push({ text: '熱・固結・圧痛が重なる所（急所）', ref: 'netsu' });
    else if (h && k) reasons.push({ text: '熱と固結が重なる所', ref: 'netsu' });
    else if (h) reasons.push({ text: '熱がある＝溶けて排泄に向かっている（第二浄化作用）', ref: 'netsu' });
    // 1. 重要施術部位
    const rf = REGION_FACTOR[p.region];
    if (rf) { W *= rf.f; reasons.push({ text: rf.why, ref: rf.ref }); }
    // 2. 楽屋と舞台
    const r = roleOf[id];
    if (hasAnalysis) {
      if (r?.roles.includes('rakuya')) {
        W *= 1.3;
        const down = p.region === 'head' && (analysis.categories || []).some((c) => (c.flows || []).some((fl) => fl.src.id === 'head_down'));
        reasons.push(down ? { text: '楽屋：頭の毒が脊柱の際（首・肩・肩甲間部・腎臓部）を下りて腰に溜まる流れの元', ref: 'atama_kudari' } : { text: '楽屋（本日の症状の元）', ref: 'kyuusho' });
      }
      else if (r?.roles.includes('keiro')) { W *= 1.1; reasons.push({ text: '毒素の流れの経路上', ref: 'joushou' }); }
      else if (r?.roles.includes('butai')) { reasons.push({ text: '舞台（症状が出ている所）', ref: 'kyuusho' }); }
      else if (!r) { W *= 0.85; }
    }
    // 頭部の中では、熱のある所を重く（熱は上で重みづけ済み）。後頭部は頭の毒素の出入り口
    if (id === 'koutoubu') { W *= 1.1; reasons.push({ text: '後頭部は頭部の毒素の出入り口（延髄部・首へつながる）', ref: 'atama_first' }); }
    // 3. 毒素集溜と排泄の順序
    if (OUTLET_POINTS.includes(id) || id === 'jinzo_kahou_side') {
      W *= lowerCongested ? 1.3 : 1.15;
      reasons.push({ text: lowerCongested ? '骨盤周辺の固結が強い：出口を開けて排泄の道をつくる' : '排泄の出口（骨盤周辺）', ref: 'kotsuban' });
    }
    // 4. 各論
    if (r?.roles.includes('kakuron')) { W *= 1.25; reasons.push({ text: '各論：本日の症状について説かれた急所', ref: null }); }
    // 5. 左右：強い側を重点に。腎臓部と骨盤の内側が同じ側で強ければ、その側の固結の柱をさらに重く
    const sf = sideFocus(f);
    let side = sf?.side || null;
    if (sf?.side) {
      reasons.push({ text: `${SIDE_NAME[sf.side]}が強い${sf.only ? '（塗られたのは' + SIDE_NAME[sf.side] + 'のみ）' : sf.byHeat ? '（熱が' + SIDE_NAME[sf.side] + 'に強い）' : ''}：${SIDE_NAME[sf.side]}を重点に`, ref: 'sayuu' });
    }
    if (pSide && (p.region === 'kidney' || OUTLET_POINTS.includes(id)) && (!side || side === pSide) && (f.sides?.[pSide])) {
      side = pSide;
      W *= 1.25;
      reasons.push({ text: `${SIDE_NAME[pSide]}の腎臓部から${SIDE_NAME[pSide]}の骨盤の内側へ固結が続いている：${SIDE_NAME[pSide]}の固結の柱を重点に（排泄の道を開く）`, ref: 'kotsuban_naibu' });
    }
    const paired = (p.p3 || []).length > 1;
    if (paired && !side) { const ps = pickSide(); side = ps.side; reasons.push(ps.reason); }
    cands.push({ id, no: p.no, name: p.name, region: p.region, regionName: p.regionName, F, W, P: F * W, reasons, side, paired, sideInfo: sf, finding: { heat: h, kouketsu: k, atsutsuu: a, sides: f.sides } });
  }
  if (!cands.length) return { ok: false, message: '探査で熱・固結・圧痛のあった箇所を入力してください。' };

  cands.sort((x, y) => y.P - x.P);
  const maxN = Math.max(2, Math.min(5, Math.round(total / 8)));
  // 1) 重要施術部位：その部位で一番優先度の高い所見の箇所。所見が無ければ短い時間だけ入れる
  const required = REQUIRED.map((g) => {
    const c = g.id ? cands.find((x) => x.id === g.id) : cands.find((x) => x.region === g.region);
    if (c) return c;
    const fromText = g.id ? null : (analysis?.points || []).find((pt) => db.pointById[pt.id]?.region === g.region);
    const p = db.pointById[g.id || fromText?.id || g.def];
    const rf = REGION_FACTOR[p.region];
    const paired = (p.p3 || []).length > 1;
    const reasons = [{ text: g.head ? `重要施術部位（${g.name}）：外せない所。所見が無くても1分でも施術する` : `重要施術部位（${g.name}）：探査で目立った所見が無くても、少しでも施術する`, ref: rf?.ref || null }];
    let side = null;
    if (paired) { const ps = pickSide(); side = ps.side; reasons.push(ps.reason); }
    return {
      id: p.id, no: p.no, name: p.name, region: p.region, regionName: p.regionName, F: 0, W: 1, P: 0, stub: true, headStub: !!g.head, paired, side,
      reasons,
      finding: { heat: 0, kouketsu: 0, atsutsuu: 0 },
    };
  });
  // 2) 排泄経路が詰まっている時は、骨盤まわりの出口を必ず一つは入れる（排泄を邪魔している凝りの解消を優先）
  if (lowerCongested) {
    const o = cands.find((c) => OUTLET_POINTS.includes(c.id));
    if (o && !required.includes(o)) {
      o.reasons.push({ text: '排泄経路が詰まっている：出口（骨盤まわり）を必ず施術に入れる', ref: 'haisetsu_keiro' });
      o.must = true;
      required.push(o);
    }
  }
  // 頭・肩・腎臓部（重要施術部位）。所見の有無にかかわらず印をつける
  for (const c of required.slice(0, REQUIRED.length)) c.key = true;
  // 3) 骨盤まわり（自己探査）に張り・痛み・熱があれば、幾分かでも必ず入れる（強い順に3か所まで）
  // 鼠蹊部・恥骨部は 1 以上なら必ず。ほかの骨盤まわりは 2 以上を、強い順に（時間が短い時は数を減らす）
  const pelvicIn = required.filter((c) => PELVIC_SELF.includes(c.id)).length;
  const strong = (c) => Math.max(c.finding.heat, c.finding.kouketsu, c.finding.atsutsuu);
  const pelvicFront = cands.filter((c) => PELVIC_MUST.includes(c.id) && !required.includes(c) && strong(c) >= PELVIC_MIN);
  const pelvicOther = cands.filter((c) => PELVIC_SELF.includes(c.id) && !PELVIC_MUST.includes(c.id) && !required.includes(c) && strong(c) >= PELVIC_MIN_OTHER)
    .slice(0, Math.max(0, (total < 30 ? 1 : total < 45 ? 2 : PELVIC_MAX) - pelvicIn - pelvicFront.length));
  const pelvic = [...pelvicFront, ...pelvicOther];
  for (const c of pelvic) {
    c.must = true;
    c.reasons.push({ text: `${c.name}（自己探査）に張り・痛み・熱がある：排泄の出口・骨盤まわりなので、短くても必ず施術に入れる${['sokeibu', 'chikotsu'].includes(c.id) ? '（場所が場所だけに、本人と相談して行う）' : ''}`, ref: 'kotsuban_naibu' });
    required.push(c);
  }
  // 4) 訴えの場所（舞台）に所見があれば、その一番強い所を必ず入れる（例：首がかゆい → 首の所見）
  const stage = hasAnalysis ? cands.find((c) => !required.includes(c) && c.region !== 'head' && roleOf[c.id]?.roles.includes('butai')) : null;
  if (stage) {
    stage.reasons.push({ text: '訴えの場所（舞台）に所見がある：必ず組み入れ', ref: 'kyuusho' });
    required.push(stage);
  }
  // 5) 残りは優先度の高い順に。頭部（前頭部・頭頂部・後頭部は必ず入る）と骨盤まわりの「必ず入れる」所はこの数に入れず、
  //    肩・腎臓部・訴えの場所など、所見から選んだ所と合わせて maxN か所まで
  const realReq = required.filter((c) => !c.stub && !c.must && c.region !== 'head').length;
  const extras = cands.filter((c) => !required.includes(c)).slice(0, Math.max(0, maxN - realReq));

  const probe = Math.max(3, Math.round(total * 0.15));
  const check = Math.max(2, Math.round(total * 0.1));
  const avail = Math.max(0, total - probe - check);
  const stubMin = Math.max(2, Math.round(avail * 0.06));
  // 頭の所見なしの最低時間：60分で3分ほど、短い時は1分
  const headMin = Math.max(1, Math.min(3, Math.round(avail / 15)));
  let realMin = 3;
  let mustMin = 3; // 骨盤まわり（必ず入れる自己探査の所）。時間が足りない時は1分まで縮める
  let headRealMin = 3; // 所見のある頭部
  const minOf = (c) => (c.headStub ? headMin : c.stub ? stubMin : c.must ? mustMin : c.region === 'head' ? headRealMin : realMin);
  const need = () => [...required, ...extras].reduce((s, c) => s + minOf(c), 0);
  // 時間が足りない時は、優先度の低い箇所から外し（必ず入れる所は外さない）、それでも足りなければ最低時間を2分、1分と縮める
  while (extras.length && need() > avail) extras.pop();
  if (need() > avail) { realMin = 2; mustMin = 2; headRealMin = 2; }
  if (need() > avail) { mustMin = 1; headRealMin = 1; }
  if (need() > avail) realMin = 1;
  const chosen = [...required, ...extras];
  for (const c of required) {
    if (!c.stub && !cands.slice(0, maxN).includes(c)) {
      c.reasons.push(c.region === 'kidney'
        ? { text: '腎臓部の固結が溶けると他の局部も溶けやすくなるため組み入れ', ref: 'jinzo_first' }
        : { text: '重要施術部位のため必ず組み入れ', ref: REGION_FACTOR[c.region]?.ref || null });
    }
  }

  const base = chosen.reduce((s, c) => s + minOf(c), 0);
  const treat = Math.max(base, avail);
  const real = chosen.filter((c) => !c.stub);
  const sumP = real.reduce((s, c) => s + c.P, 0) || 1;
  // 最低時間（所見あり3分・所見なしの重要施術部位2〜3分）を確保し、残りを所見のある箇所に優先度で比例配分（端数は大きい順に配る）
  const rest = Math.max(0, treat - base);
  const raw = chosen.map((c) => minOf(c) + (c.stub ? (real.length ? 0 : rest / chosen.length) : (rest * c.P) / sumP));
  const mins = raw.map(Math.floor);
  let left = treat - mins.reduce((s, m) => s + m, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { mins[i]++; left--; } });

  // 頭部は一か所あたり数分まで（頭部が特に大事と読み取れる時だけ長めに）。余った時間はほかの箇所へ
  // 頭部の各所は3分まで。その所に強い熱（4以上）がある時だけ4分、頭痛など頭部の訴えがあって強い熱がある時は残りの1割ほど（60分で5分）まで
  const headSaid = (analysis?.categories || []).some((c) => HEAD_CATS.has(c.id));
  const headCapOf = (c) => {
    const h = c.finding?.heat || 0;
    if (h >= 4) return headSaid ? Math.max(4, Math.round(avail * 0.1)) : 4;
    return 3;
  };
  let surplus = 0;
  chosen.forEach((c, i) => { if (c.region === 'head' && mins[i] > headCapOf(c)) { surplus += mins[i] - headCapOf(c); mins[i] = headCapOf(c); } });
  if (surplus) {
    const others = chosen.map((c, i) => [c, i]).filter(([c]) => c.region !== 'head');
    const real2 = others.filter(([c]) => !c.stub);
    const pool = real2.length ? real2 : others;
    if (!pool.length) {
      // 頭部しか無い時は戻す
      chosen.forEach((c, i) => { if (surplus > 0 && c.region === 'head') { const add = Math.ceil(surplus / chosen.length); mins[i] += add; surplus -= add; } });
    } else {
      const wsum = pool.reduce((t, [c]) => t + (c.P || 1), 0);
      const share = pool.map(([c, i]) => [i, (surplus * (c.P || 1)) / wsum]);
      let left2 = surplus;
      for (const [i, v] of share) { const m = Math.floor(v); mins[i] += m; left2 -= m; }
      share.sort((a, b) => (b[1] % 1) - (a[1] % 1)).forEach(([i]) => { if (left2 > 0) { mins[i]++; left2--; } });
    }
  }

  const items = chosen.map((c, i) => ({ ...c, minutes: mins[i], share: mins[i] / treat, split: splitSides(c, mins[i]) }));
  // 施術の順序：基本は上から下（前頭部から始めて頭を清め、首・肩、背、腎臓部、腰へ）。
  // 出口を先に開ける順序（排泄経路を整えるサブプラン）は、選んだ時だけ
  const used = order === 'auto' ? 'top' : order;
  const ordered = orderPoints(db, items, used);
  const others = cands.filter((c) => !chosen.includes(c));
  const notes = planNotes(ex, ordered, used);
  return { ok: true, order: used, excretion: ex, notes, total: probe + check + ordered.reduce((s, c) => s + c.minutes, 0), probe, check, items: ordered, others };
}

// 左右がある箇所の時間の分け方：強い側を先に、長く（約3分の2）。片側だけ塗られていれば、その側を主に、反対側も少し
// 左右がある箇所の時間の分け方：重点の側を先に、必ず長く（左右で時間差をつける）。
// 差がはっきりしている時は約3分の2（反対側に所見が無ければ4分の3）、全体の傾向で決めた時は約6割。2分以下は重点の側だけ
function splitSides(c, minutes) {
  if (!c.paired) return null;
  const p = c.finding?.sides || {};
  const has = (k) => findingScore(p[k]) > 0;
  const first = c.side || (findingScore(p.R) >= findingScore(p.L) ? 'R' : 'L');
  const second = first === 'R' ? 'L' : 'R';
  if (minutes <= 2) return [{ side: first, minutes }];
  const clear = !!c.sideInfo?.side;
  const ratio = clear ? (has(second) ? 0.65 : 0.75) : 0.6;
  const main = Math.min(minutes - 1, Math.max(Math.floor(minutes / 2) + 1, Math.round(minutes * ratio)));
  return [{ side: first, minutes: main }, { side: second, minutes: minutes - main }];
}

// 計画に添える注意（排泄経路・突き上げ・左右）
function planNotes(ex, items, order = 'top') {
  const notes = [];
  if (ex.level === 'blocked') {
    const why = `骨盤まわり（出口）の固結が強い${ex.signs.length ? '、または排泄の不調の訴えがある' : ''}`;
    const risk = '出口が詰まったまま頭や肩を強く施術すると、溶けた毒素が下りきれず、別の所の浄化や吐き気（突き上げ）として出ることがあります。';
    notes.push(order === 'outlet'
      ? { kind: 'warn', title: '排泄経路を整えるプラン（サブプラン）', text: `${why}ため、先に出口（腸骨の内側・鼠蹊部・腎臓下方部）を開けてから、首・肩を施術する順序にしています。${risk}`, ref: 'haisetsu_keiro', subplan: true }
      : { kind: 'warn', title: '排泄経路が詰まっている可能性', text: `${why}ようです。基本の順序（上から下）のままでも出口の箇所は計画に入れてありますが、下の「排泄経路を整える（サブプラン）」に切り替えると、先に出口を開けてから上を施術する順序になります。${risk}`, ref: 'haisetsu_keiro', subplan: true });
  } else if (ex.level === 'some') {
    notes.push({ kind: 'info', title: '排泄経路も見ておきましょう', text: ex.painted ? '骨盤まわりにやや固結があります。施術の後に、お腹の張りや吐き気が出ないか見ておき、出る時は腸骨の内側・鼠蹊部・みぞおちの辺りを施術します。' : '排泄の不調の訴えがあります。腸骨の内側・鼠蹊部・腰（自己探査）も確かめてもらいましょう。', ref: 'kotsuban_naibu' });
  } else if (!ex.painted) {
    notes.push({ kind: 'info', title: '排泄経路は整っていますか？', text: '腸骨の内側・鼠蹊部・仙腸関節付近・恥骨部（自己探査）が塗られていません。腰・脚・お腹・婦人科の訴えがある時は、ここも確かめてもらうと、施術の順序をより合わせられます。', ref: 'haisetsu_keiro' });
  }
  if (ex.nausea) notes.push({ kind: 'warn', title: '突き上げに気をつける', text: '吐き気・胸のむかつきの訴えがあります。下の出口が詰まっていると、溶けた毒素が上へ突き上げてきます。みぞおちの辺りや背中、腸骨の内側・鼠蹊部を施術します。', ref: 'tsukiage' });
  if (ex.side) notes.push({ kind: 'info', title: `${SIDE_NAME[ex.side]}の骨盤まわりが強い`, text: `${SIDE_NAME[ex.side]}の腎臓部〜腸骨の内側の固結の柱を重点にし、${SIDE_NAME[ex.side]}から先に施術します（よく施術すべき方から先に）。`, ref: 'jinzo_yoko' });
  const sided = items.filter((it) => it.side && !OUTLET_POINTS.includes(it.id) && it.region !== 'kidney');
  if (sided.length) notes.push({ kind: 'info', title: '左右の違い', text: sided.map((it) => `${it.name}は${SIDE_NAME[it.side]}が強い`).join('、') + '。強い側から先に、長めに施術します。', ref: 'sayuu' });
  return notes;
}
