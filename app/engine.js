// 症状の入力文から、探査して見つめる箇所を組み立てる（アプリ内で完結。外部送信なし）
// data: { points, flows, routes, symptoms, safety } を受け取る純粋関数群。

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

// JSON を読み込んだ直後に一度だけ呼ぶ。照合用に正規化した語を持たせる
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
  return { raw, pointList, pointById, flowById, routeByNo, categories, safetyRules };
}

function categoryPoints(db, cat) {
  const ids = [];
  for (const fid of cat.flows || []) ids.push(...(db.flowById[fid]?.look_points || []));
  for (const no of cat.routes || []) ids.push(...(db.routeByNo[no]?.look_points || []));
  ids.push(...(cat.extra_points || []));
  return [...new Set(ids)].filter((id) => db.pointById[id]);
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

  // 病名として検出した語は症状の照合に使わない（例：「糖尿病」の「尿」）
  const blockWords = safety.filter((s) => s.blockSymptoms).flatMap((s) => s.words);

  const matched = [];
  for (const cat of db.categories) {
    const hits = norm ? findHits(norm, cat._kw, [...cat._ex, ...blockWords]) : [];
    const chosen = selected.includes(cat.id);
    if (!hits.length && !chosen) continue;
    matched.push({
      id: cat.id,
      label: cat.label,
      group: cat.group,
      words: hits.sort((a, b) => a.index - b.index).map((h) => h.kw),
      chosen,
      firstIndex: hits.length ? Math.min(...hits.map((h) => h.index)) : -1,
      flows: (cat.flows || []).map((id) => db.flowById[id]).filter(Boolean),
      routes: (cat.routes || []).map((no) => db.routeByNo[no]).filter(Boolean),
      basis: cat.basis || null,
      textbook: cat.textbook || null,
      points: categoryPoints(db, cat),
    });
  }
  // 入力文に出てきた順（候補ボタンのみの選択は後ろ）
  matched.sort((a, b) => (a.firstIndex < 0) - (b.firstIndex < 0) || a.firstIndex - b.firstIndex);

  const fallback = matched.length === 0;
  const score = {};
  const from = {};
  if (fallback) {
    for (const p of db.pointList) if (!p.selfProbe) score[p.id] = 1;
  } else {
    for (const m of matched) {
      for (const id of m.points) {
        score[id] = (score[id] || 0) + 1;
        (from[id] ||= []).push(m.id);
      }
    }
  }
  const maxScore = Math.max(0, ...Object.values(score));
  const points = Object.keys(score)
    .map((id) => {
      const p = db.pointById[id];
      return {
        id,
        no: p.no,
        name: p.name,
        region: p.region,
        regionName: p.regionName,
        selfProbe: p.selfProbe,
        score: score[id],
        key: !fallback && matched.length > 1 && score[id] === maxScore && maxScore > 1,
        from: from[id] || [],
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
    urgent: safety.some((s) => s.level === 'urgent'),
  };
}
