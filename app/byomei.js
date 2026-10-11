// 今日の症状に書かれた言葉（現代の病名・症状・言い回し）から、岡田先生の論述（data/ronbun.json）の中で関係のありそうなものを探す。
// 現代の病名と当時の病名は一致しないことがあるので、data/byomei.json の対応表で当時の言い方に置き換えてから探す（アプリ内で完結）。
import { normalize, findHits } from './engine.js';

export function prepareByomei(raw) {
  const entries = (raw?.entries || []).map((e) => ({ ...e, _words: e.words.map(normalize) }));
  return { entries, block: (raw?.block || []).map(normalize) };
}

// 入力文に出てくる対応表の項目（「〜はない」と打ち消した言葉は拾わない）。入力に出た順
export function matchByomei(bm, text) {
  const norm = normalize(text);
  if (!norm) return { entries: [], blocked: false };
  const blocked = bm.block.some((w) => norm.includes(w)) && !/がんば|頑張|がんこ|頑固|がんじょう|頑丈|がんがん|ガンガン|めがね|眼瞼/.test(text);
  const out = [];
  for (const e of bm.entries) {
    const hits = findHits(norm, e._words);
    // 画面には、対応表の元の書き方で出す（カタカナをひらがなに直した形ではなく）
    if (hits.length) out.push({ entry: e, index: Math.min(...hits.map((h) => h.index)), words: [...new Set(hits.map((h) => e.words[e._words.indexOf(h.kw)] || h.kw))] });
  }
  out.sort((a, b) => a.index - b.index);
  return { entries: out, blocked };
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
export function snippetOf(a, terms, width = 70) {
  const order = [...terms].sort((x, y) => y.length - x.length);
  for (const t of order) {
    for (const p of a.paras) {
      const i = p.indexOf(t);
      if (i < 0 || p.startsWith('〔注')) continue;
      const sents = p.split(/(?<=[。！？])/);
      let pos = 0;
      for (const s of sents) {
        if (pos <= i && i < pos + s.length) {
          let text = s.replace(/^(問：|岡田先生：)/, '');
          const k = text.indexOf(t);
          if (text.length > width) {
            const start = Math.max(0, Math.min(k - 20, text.length - width));
            text = (start > 0 ? '…' : '') + text.slice(start, start + width) + (start + width < text.length ? '…' : '');
          }
          return { text, term: t };
        }
        pos += s.length;
      }
    }
  }
  return { text: (a.paras[0] || '').slice(0, width) + '…', term: '' };
}

// 入力文 → 項目ごとの論述（同じ論述は最初の項目にだけ出す）
export function ronbunForText(bm, index, text, { perEntry = 3, maxEntries = 4 } = {}) {
  const m = matchByomei(bm, text);
  if (m.blocked) return { blocked: true, groups: [] };
  const used = new Set();
  const groups = [];
  for (const { entry, words } of m.entries.slice(0, maxEntries)) {
    const arts = searchRonbun(index, entry.search, { limit: perEntry, exclude: used });
    arts.forEach((x) => used.add(x.id));
    groups.push({ id: entry.id, label: entry.label, show: entry.show, words, articles: arts });
  }
  return { blocked: false, groups };
}
