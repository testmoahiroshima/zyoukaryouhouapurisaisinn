// 今日の症状に書かれた言葉（現代の病名・症状・言い回し）から、岡田先生の論述（data/ronbun.json）の中で関係のありそうなものを探す。
// 現代の病名と当時の病名は一致しないことがあるので、data/byomei.json の対応表で当時の言い方に置き換えてから探す（アプリ内で完結）。
import { normalize, findHits } from './engine.js';

export function prepareByomei(raw) {
  const entries = (raw?.entries || []).map((e) => ({ ...e, _words: e.words.map(normalize), _ex: (e.exclude || []).map(normalize), _sites: (e.sites || []).map((w) => [w, normalize(w)]) }));
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  // 体の部位 × 感じ方（長い言葉から先に見る）
  const prep = (list) => (list || []).map((x) => ({ ...x, _words: x.words.map((w) => [w, normalize(w)]).filter(([, n]) => n).sort((a, b) => b[1].length - a[1].length) }));
  const parts = prep(raw?.parts);
  const senses = prep(raw?.senses);
  const combos = Object.fromEntries((raw?.combos || []).map((c) => [`${c.part}|${c.sense}`, c.entry]));
  return { entries, byId, cancerWords: (raw?.cancer_words || []).map(normalize), general: entries.find((e) => e.general), parts, senses, combos, partExclude: (raw?.part_exclude || []).map(normalize), senseExclude: (raw?.sense_exclude || []).map(normalize) };
}

const NEG = /^(は|が|も)?(ない|無い|なし|無し|ありません)|^くない|^く(は|も)?ありません|^くな(か|く)/;
function rangesIn(text, words) {
  const out = [];
  for (const w of words) {
    if (!w) continue;
    for (let i = text.indexOf(w); i !== -1; i = text.indexOf(w, i + 1)) out.push([i, i + w.length]);
  }
  return out;
}
// 部位の言葉のすぐ後（12文字まで）に感じ方の言葉があるか。前にある時は「ズキズキする頭」のように、すぐ前（間が「する」「な」など）だけ。
// 「膝は痛くない」のような打ち消しは拾わず、その部位は打ち消した所として返す（部位の言葉だけでの一致も出さないため）。
// 部位の言葉は全部位を通して長い順に見て、一度拾った所（「肩甲骨」）を短い言葉（「肩」）で重ねて拾わない
const BETWEEN = /^(する|した|して|な|い|く|の|)$/;
function partSenseHits(bm, norm) {
  const blocked = rangesIn(norm, bm.partExclude);
  const cands = [];
  for (const part of bm.parts) for (const [word, w] of part._words) cands.push({ part, word, w });
  cands.sort((a, b) => b.w.length - a.w.length);
  // まず部位の言葉の位置を全部決める（長い言葉が先）。感じ方を探す範囲は次の部位の言葉の手前まで
  const taken = [];
  for (const { part, word, w } of cands) {
    for (let i = norm.indexOf(w); i !== -1; i = norm.indexOf(w, i + 1)) {
      const end = i + w.length;
      if (blocked.some(([a, b]) => i < b && a < end)) continue;
      if (taken.some((t) => i < t.end && t.i < end)) continue;
      taken.push({ part, word, i, end });
    }
  }
  taken.sort((a, b) => a.i - b.i);
  const hits = [];
  const negated = [];
  taken.forEach(({ part, word, i, end }, n) => {
    const next = n + 1 < taken.length ? taken[n + 1].i : norm.length;
    const prev = n > 0 ? taken[n - 1].end : 0;
    const after = norm.slice(end, Math.min(end + 12, next));
    const before = norm.slice(Math.max(prev, i - 10), i);
    // 後ろは一番近い感じ方の言葉（同じ位置なら長い方）
    let best = null;
    for (const sense of bm.senses) {
      for (const [sword, sw] of sense._words) {
        const k = after.indexOf(sw);
        if (k !== -1 && (!best || k < best.k || (k === best.k && sw.length > best.sw.length))) best = { sense, sword, sw, k };
      }
    }
    if (best) {
      const s1 = end + best.k + best.sw.length;
      const rest = norm.slice(s1, s1 + 8);
      if (NEG.test(rest) || NEG.test(rest.replace(/^(い|く|む|み|かった)/, ''))) { negated.push([i, s1 + 4]); return; }
      hits.push({ part, sense: best.sense, index: i, words: [word, best.sword], senseRange: [end + best.k, s1] });
      return;
    }
    for (const sense of bm.senses) {
      for (const [sword, sw] of sense._words) {
        const b = before.lastIndexOf(sw);
        if (b !== -1 && BETWEEN.test(before.slice(b + sw.length))) {
          const s0 = i - before.length + b;
          hits.push({ part, sense, index: i, words: [word, sword], senseRange: [s0, s0 + sw.length] });
          return;
        }
      }
    }
  });
  return { hits, negated };
}

// がん（癌）の語を見る時は「がんばる」「頑固」「ガンガン」「ガングリオン」「眼科」などを伏せる（位置はそのまま）
const NOT_CANCER = /がんば|がんこ|がんじょう|がんがん|がんぐりおん|がんめん|がんきゅう|がんか|めがね|がんたん|がんらい|がんぼう|がんじつ|がんだむ|がんもどき|がんぷら|(がん|癌)(検診|健診|保険)/g;

// 入力文に出てくる対応表の項目（「〜はない」と打ち消した言葉は拾わない）。入力に出た順
// がん（癌）の語がある時は、部位ごとのがんの項目を出し（cancer: true）、その部位の言葉で拾ったほかの項目（「胃がん」の胃の不調 など）は重ねて出さない
export function matchByomei(bm, text) {
  const norm = normalize(text);
  if (!norm) return { entries: [], cancer: false };
  const cleaned = norm.replace(NOT_CANCER, (m) => '\u0000'.repeat(m.length));
  const cancer = bm.cancerWords.some((w) => cleaned.includes(w));
  const found = new Map();
  const put = (entry, index, words) => {
    if (!entry) return;
    const cur = found.get(entry.id);
    if (!cur) found.set(entry.id, { entry, index, words: [...words] });
    else { cur.index = Math.min(cur.index, index); for (const w of words) if (!cur.words.includes(w)) cur.words.push(w); }
  };
  const shown = (e, hits) => [...new Set(hits.map((h) => e.words[e._words.indexOf(h.kw)] || h.kw))];
  // がんの項目：部位の付いた言い方（胃がん・肺癌・白血病 など）。無ければ、がんの語と部位の言葉が離れている時（「がんが肝臓に転移」）
  const cancerRanges = [];
  if (cancer) {
    const ces = bm.entries.filter((e) => e.cancer && !e.general);
    for (const e of ces) {
      const hits = findHits(cleaned, e._words);
      if (!hits.length) continue;
      put(e, Math.min(...hits.map((h) => h.index)), shown(e, hits));
      for (const h of hits) cancerRanges.push([h.index, h.index + h.kw.length]);
    }
    if (!found.size) {
      for (const e of ces) {
        for (const [w, n] of e._sites) {
          const i = cleaned.indexOf(n);
          if (i !== -1) { put(e, i, [`${w}（がん）`]); cancerRanges.push([i, i + n.length]); break; }
        }
      }
    }
    if (bm.general) {
      const hits = findHits(cleaned, bm.general._words);
      if (!found.size || hits.length) put(bm.general, hits.length ? Math.min(...hits.map((h) => h.index)) : 0, hits.length ? shown(bm.general, hits) : bm.cancerWords.filter((w) => cleaned.includes(w)).slice(0, 1).map((w) => (w === 'がん' ? 'がん' : w)));
    }
  }
  // 体の部位 × 感じ方（「膝の裏がジンジンする」「目がかゆい」など）。組み合わせで決まる項目があればそれだけ、無ければ部位の項目と感じ方の項目
  const masked = rangesIn(norm, bm.senseExclude || []).reduce((t, [a, b]) => t.slice(0, a) + '\u0000'.repeat(b - a) + t.slice(b), norm);
  const ps = partSenseHits(bm, masked);
  const inside = (i, ranges) => ranges.some(([a, b]) => a <= i && i < b);
  // 組み合わせで決まった感じ方の言葉は、感じ方だけの項目（「目がかゆい」の皮膚のかゆみ など）として重ねて拾わない
  const comboSense = ps.hits.filter((h) => bm.combos[`${h.part.name}|${h.sense.name}`]).map((h) => ({ range: h.senseRange, entry: h.sense.entry }));
  for (const e of bm.entries) {
    if (e.cancer) continue;
    const hits = findHits(norm, e._words, e._ex).filter((h) => !inside(h.index, ps.negated) && !inside(h.index, cancerRanges) && !comboSense.some((c) => c.entry === e.id && h.index < c.range[1] && c.range[0] < h.index + h.kw.length));
    // 画面には、対応表の元の書き方で出す（カタカナをひらがなに直した形ではなく）
    if (hits.length) put(e, Math.min(...hits.map((h) => h.index)), shown(e, hits));
  }
  for (const h of ps.hits) {
    if (inside(h.index, cancerRanges)) continue;
    const combo = bm.combos[`${h.part.name}|${h.sense.name}`];
    const label = `${h.words[0].replace(/[がのをもは]$/, '')}が${h.words[1]}`;
    if (combo) put(bm.byId[combo], h.index, [label]);
    else {
      put(bm.byId[h.part.entry], h.index, [label]);
      if (h.sense.entry) put(bm.byId[h.sense.entry], h.index, [label]);
    }
  }
  // 「肩がこ」「肩がこる」のように一方がもう一方の頭の部分なら、長い方だけ
  for (const v of found.values()) v.words = v.words.filter((w) => !v.words.some((x) => x !== w && x.startsWith(w))).slice(0, 4);
  // がんの項目を先に（部位の分かるものから）、ほかは入力に出た順
  const rank = (v) => (v.entry.cancer ? (v.entry.general ? 1 : 0) : 2);
  const out = [...found.values()].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return { entries: out, cancer };
}

// 論述の索引（題名と本文）を一度だけ作る
export function indexRonbun(articles) {
  return articles.map((a) => ({ a, title: a.title, body: a.paras.join('\n'), len: a.paras.reduce((s, p) => s + p.length, 0) }));
}

// 当時の言葉で論述を探す。題名に出れば重く、本文の出現は数えて（同じ語は6回まで）、一文字の語（肩・熱など）は軽く。
// 長い論述ほど出やすいので、長さで少しならす。判断の根拠にしている論述は少しだけ上げる
export function searchRonbun(index, terms, { limit = 4, exclude = new Set() } = {}) {
  const scored = [];
  for (const it of index) {
    if (exclude.has(it.a.id)) continue;
    let score = 0;
    let strong = 0;
    terms.forEach((t, j) => {
      const w = (t.length === 1 ? 0.35 : 1) * (j === 0 ? 1.6 : 1);
      if (it.title.includes(t)) { score += 4 * w; if (t.length > 1) strong++; }
      let c = 0;
      let i = it.body.indexOf(t);
      while (i !== -1 && c < 6) { c++; i = it.body.indexOf(t, i + t.length); }
      if (c) { score += w * (1 + Math.log2(c)); if (t.length > 1) strong++; }
    });
    // 二文字以上の当時の言葉が一つも無い論述は出さない（「肩」「熱」だけの一致は弱い）
    if (!strong && terms.some((t) => t.length > 1)) continue;
    score = score / Math.sqrt(Math.max(1, it.len / 1500)) + (it.a.basis ? 0.3 : 0);
    if (score >= 1.5) scored.push({ it, score });
  }
  scored.sort((x, y) => y.score - x.score);
  // 同じ章の版違い（同じ題名）は一つだけ
  const seen = new Set();
  const uniq = scored.filter(({ it }) => { const k = normalize(it.title.replace(/（.*?）/g, '')).replace(/症$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  return uniq.slice(0, limit).map(({ it, score }) => ({ id: it.a.id, title: it.a.title, date: it.a.date, kind: it.a.kind, basis: it.a.basis, score: Math.round(score * 10) / 10, snippet: snippetOf(it.a, terms) }));
}

// 当時の言葉が出てくる一文（長い語を優先）。前後を詰めて、語の位置を返す
// 一文だけを切り出すと誤解を招く文（治る・放っておいても・医療や手術の話など）は添えず、次の文を探す
const RISKY = /放任|放置|うっちゃ|自然治癒|薬を(やめ|止め|廃)|医療|医学|医家|医師|医者|誤診|間違|手術|注射|切開|治る|治す|治癒|治り|治っ|治ら|全快|全治|全癒|死/;
function trim(text, k, width) {
  if (text.length <= width) return text;
  const start = Math.max(0, Math.min(k - 20, text.length - width));
  return (start > 0 ? '…' : '') + text.slice(start, start + width) + (start + width < text.length ? '…' : '');
}
export function snippetOf(a, terms, width = 70) {
  const order = [...terms].sort((x, y) => y.length - x.length);
  const sents = a.paras.filter((p) => !p.startsWith('〔注')).flatMap((p) => p.split(/(?<=[。！？])/)).map((s) => s.replace(/^\s*(問：|岡田先生：)/, '').trim()).filter(Boolean);
  for (const t of order) {
    for (const s of sents) {
      const k = s.indexOf(t);
      if (k !== -1 && !RISKY.test(s)) return { text: trim(s, k, width), term: t };
    }
  }
  const safe = sents.find((s) => !RISKY.test(s)) || '';
  return { text: trim(safe, 0, width), term: '' };
}

// 入力文 → 項目ごとの論述（同じ論述は最初の項目にだけ出す）
export function ronbunForText(bm, index, text, { perEntry = 3, maxEntries = 4 } = {}) {
  const m = matchByomei(bm, text);
  const used = new Set();
  const groups = [];
  // がんの項目は数に入れず全部出す（ほかの項目は maxEntries まで）
  const list = [...m.entries.filter((x) => x.entry.cancer), ...m.entries.filter((x) => !x.entry.cancer).slice(0, maxEntries)];
  for (const { entry, words } of list) {
    const arts = searchRonbun(index, entry.search, { limit: perEntry, exclude: new Set([...used, ...(entry.avoid || [])]) });
    arts.forEach((x) => used.add(x.id));
    groups.push({ id: entry.id, label: entry.label, show: entry.show, note: entry.note || '', cancer: !!entry.cancer, words, articles: arts });
  }
  return { cancer: m.cancer, groups };
}
