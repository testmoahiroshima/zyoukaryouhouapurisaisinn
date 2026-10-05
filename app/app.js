import { prepare, analyze, planSession, normalize, sideFocus, OUTLET_POINTS } from './engine.js';
import { Painter, LAYERS, REGIONS, BRUSHES, SHADES, TOOLS } from './paint.js';
import { Body3D, loadBodyMesh, VIEWS3 } from './body3d.js';
import { zoneById, QUICK_ZONES, SENSATIONS, needsPlace, phrasesFor, catsFor, zoneBounds, zoneDetail, phrasesForDetails } from './zones.js';
import { loadRecords, addRecord, updateRecord, deleteRecord, newId, today, importRecords, exportJSON, exportCSV, download, summarize } from './records.js';
import { TRACKS, Player, unlockAudio, setVolume, chime, speak, stopSpeaking, canSpeak, listFiles, addFiles, removeFile } from './audio.js';

const DATA_FILES = ['body_points', 'flows', 'routes', 'symptoms', 'safety', 'concepts', 'changes', 'places', 'knowledge', 'kenkai', 'zenshu_terms'];
const KEY_FIELDS = { body_points: 'points' };
const STORE_INPUT = 'joka.lastInput';
const STORE_SETTINGS = 'joka.settings';
const FLOW_COLORS = ['#2f5d8a', '#8a4f9e', '#1f7a6a', '#a0522d', '#5a6b2f'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 保存できない環境 */ } },
};

let db;
let zenshuIndex = null;
let lastAnalysis = null;
const player = new Player();
let userFiles = [];

const settings = Object.assign({
  tracks: ['arpeggio', 'drone'],
  titleMusic: true,
  titleTrack: 'arpeggio',
  volume: 0.6,
  switchMin: 5,
  voice: true,
  chime: true,
  minutes: 30,
  paintDim: '3d',
  textSize: 'normal',
  detail: 'simple',
  theme: 'auto',
  welcomed: false,
}, store.get(STORE_SETTINGS, {}));
const saveSettings = () => store.set(STORE_SETTINGS, settings);

// 文字の大きさ・表示の詳しさ・画面の色を画面に反映する
const TEXT_SIZES = [{ id: 'normal', name: 'ふつう' }, { id: 'large', name: '大きい' }, { id: 'xlarge', name: 'とても大きい' }];
function applyLook() {
  const r = document.documentElement;
  r.dataset.size = settings.textSize;
  r.dataset.detail = settings.detail;
  if (settings.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = settings.theme;
}
applyLook();

// 画面の下に短いお知らせを出す
function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function loadData() {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (f) => {
    const res = await fetch(`data/${f}.json`);
    if (!res.ok) throw new Error(f);
    raw[KEY_FIELDS[f] || f] = await res.json();
  }));
  return raw;
}

// ---- 出典の表示 ----
const KANJI_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
function eraOf(year) {
  if (!year) return '';
  if (year >= 1926 && year <= 1988) return `昭和${year - 1925}年`;
  return `${year}年`;
}
// 出典は「岡田茂吉全集」とは書かず、年月（昭和〇年〇月）で示す（見出しには宗教的な語が含まれることがあるため出さない）。
// date は 'YYYYMM' か 'YYYY'（tools/add_cite_dates.py で入れる）
function dateText(c) {
  const d = String(c.date || c.year || '');
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));
  if (!y) return '昭和期';
  return `${eraOf(y)}${m >= 1 && m <= 12 ? `${m}月` : ''}`;
}
function citeText(c) {
  return `岡田先生 ${dateText(c)}`;
}
function citesHTML(k) {
  const parts = [];
  if (k.textbook) parts.push(`3級テキスト ${esc(k.textbook)}`);
  if (k.t2) parts.push(`2級テキスト実践編 ${esc(k.t2)}`);
  const dates = [...new Set((k.cites || []).map(dateText))];
  if (dates.length) parts.push(`岡田先生 ${esc(dates.join('・'))}`);
  // 根拠にしている論述の本文を読む（「学ぶ」の「論文を読む」で開く）
  const seen = new Set();
  const reads = (k.cites || []).filter((c) => c.id && !seen.has(c.id) && seen.add(c.id))
    .map((c) => `<button type="button" class="ronbun-b" data-ronbun="${esc(c.id)}">📖 本文を読む（${esc(dateText(c))}）</button>`).join('');
  return parts.length ? `<div class="cite">根拠：${parts.join('／')}${reads ? `<div class="ronbun-links">${reads}</div>` : ''}</div>` : '';
}

async function loadZenshu() {
  if (zenshuIndex) return zenshuIndex;
  const res = await fetch('data/zenshu_index.jsonl');
  const text = await res.text();
  zenshuIndex = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); zenshuIndex[r.id] = r; } catch { /* 壊れた行は飛ばす */ }
  }
  return zenshuIndex;
}
function zenshuDetails(ids) {
  if (!ids || !ids.length) return '';
  return `<details class="zenshu" data-ids="${esc(ids.join(','))}">
    <summary>参考になる岡田先生の論述（${ids.length}件・未確認）</summary>
    <ul><li class="muted">読み込み中…</li></ul>
  </details>`;
}
function wireZenshu(root) {
  $$('details.zenshu', root).forEach((el) => {
    el.addEventListener('toggle', async () => {
      if (!el.open || el.dataset.loaded) return;
      el.dataset.loaded = '1';
      const ul = $('ul', el);
      try {
        const idx = await loadZenshu();
        const rows = el.dataset.ids.split(',').map((id) => ({ id, r: idx[id] }))
          .sort((a, b) => (a.r?.religious_term_count ?? 999) - (b.r?.religious_term_count ?? 999));
        ul.innerHTML = rows.map(({ r }) => `<li>${esc(r ? citeText({ date: (r.date || '').slice(0, 6), year: r.year }) : '（年月不明）')}</li>`).join('')
          + '<li class="muted">語句の一致から拾った候補で、内容の確認はまだです。</li>';
      } catch {
        ul.innerHTML = '<li class="muted">参考の索引を読み込めませんでした。</li>';
      }
    });
  });
}

// ---- 人体図（探査箇所＋毒素の流れの矢印） ----
let chartSeq = 0;
function anchorOf(st) {
  if (st.points) {
    const p = st.points.map((id) => db.pointById[id]).find((x) => x?.anchor && x.id !== 'maekata') || db.pointById[st.points[0]];
    return p?.anchor || null;
  }
  return db.raw.places.anchors[st.place] || null;
}
function flowPathsSVG(flows, uid) {
  const defs = [];
  const paths = [];
  flows.forEach((fl, fi) => {
    const color = FLOW_COLORS[fi % FLOW_COLORS.length];
    defs.push(`<marker id="ah${uid}-${fi}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`);
    const pts = fl.stations.map((s) => ({ s, xy: anchorOf(s) })).filter((x) => x.xy);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i].xy;
      const [x2, y2] = pts[i + 1].xy;
      if (x1 === x2 && y1 === y2) continue;
      const far = Math.abs(x2 - x1) > 120;
      const via = pts[i].s.via || pts[i + 1].s.via;
      // 番号の丸に重ならないよう、両端を少し縮める
      const len = Math.hypot(x2 - x1, y2 - y1);
      const cut = Math.min(9, len / 3);
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      const sx = x1 + ux * (pts[i].s.points ? cut : 3);
      const sy = y1 + uy * (pts[i].s.points ? cut : 3);
      const ex = x2 - ux * (pts[i + 1].s.points ? cut : 5);
      const ey = y2 - uy * (pts[i + 1].s.points ? cut : 5);
      // 背面図の中は外側（左）へふくらませ、図をまたぐ線は上へ弧を描く
      const mx = (sx + ex) / 2 - (far ? 0 : 10);
      const my = (sy + ey) / 2 - (far ? 40 : 0);
      paths.push(`<path class="flow-line${far ? ' far' : ''}${via ? ' via' : ''}" d="M${sx},${sy} Q${mx},${my} ${ex},${ey}" stroke="${color}" marker-end="url(#ah${uid}-${fi})"/>`);
    }
    const last = pts[pts.length - 1];
    if (last && last.s.place) {
      const [x, y] = last.xy;
      paths.push(`<g class="stage-mark"><circle cx="${x}" cy="${y}" r="4" fill="${color}"/><text x="${x + 6}" y="${y - 5}">${esc(last.s.place)}</text></g>`);
    }
  });
  return { defs: defs.join(''), paths: paths.join('') };
}

function chartSVG({ highlight = {}, showAll = false, includeSelf = false, selected = null, flows = [] } = {}) {
  const { width, height, image } = db.raw.points.chart;
  const uid = ++chartSeq;
  const items = db.pointList
    .filter((p) => (showAll ? (includeSelf || !p.selfProbe) : (highlight[p.id] || !p.selfProbe)))
    .map((p) => {
      const h = highlight[p.id];
      const on = h || (showAll && !p.selfProbe);
      const cls = ['pt', on ? 'on' : '', showAll && p.selfProbe ? 'self' : '', h?.key ? 'key' : '', selected === p.id ? 'sel' : ''].join(' ');
      return (p.chart || []).map(([x, y]) =>
        `<g class="${cls}" data-id="${p.id}"><title>${esc(p.no)} ${esc(p.name)}</title><circle cx="${x}" cy="${y}" r="${h || showAll ? 8 : 5}"/>${h || showAll ? `<text x="${x}" y="${y + 0.4}">${p.no}</text>` : ''}</g>`).join('');
    }).join('');
  const fp = flowPathsSVG(flows, uid);
  return `<div class="chart">
    <img src="${esc(image)}" alt="人体図（前面・背面・側頭部・頭頂）" width="${width}" height="${height}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="探査箇所と毒素の流れ"><defs>${fp.defs}</defs>${items}<g class="flows">${fp.paths}</g></svg>
  </div>`;
}

function flowLabel(fl) {
  return fl.kind === 'flow' ? 'テキスト' : `早見表${fl.src.no}`;
}
const shortLabel = (s) => s.split(/[・（]/)[0];
function stationsText(fl) {
  return `<div class="route">${fl.stations.map((s, i) => {
    const cls = s.place ? 'place' : (s.role === 'rakuya' ? 'rakuya' : (s.role === 'butai' ? 'butai' : ''));
    const last = i === fl.stations.length - 1;
    return `${i ? '<span class="arrow">→</span>' : ''}<span class="node ${cls}${s.via ? ' via' : ''}${last && s.place ? ' butai' : ''}">${esc(s.name)}</span>`;
  }).join('')}</div>`;
}

// ---- 本日の症状 ----
const ROLE_LABEL = { rakuya: '楽屋', keiro: '経路', butai: '舞台', kakuron: '各論', outlet: '出口', look: '' , extra: '' };

function renderChips() {
  $('#chips').innerHTML = db.raw.symptoms.groups.map((g) => `
    <div class="chip-group"><h4>${esc(g)}</h4>
      ${db.categories.filter((c) => c.group === g).map((c) =>
        `<button type="button" class="chip" data-id="${c.id}" aria-pressed="false">${esc(c.label)}</button>`).join('')}
    </div>`).join('');
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    markChips();
  });
}
// 一覧で選んでいる症状の数を、閉じていても見えるように出す（選んだままの症状が、知らないうちに混ざらないように）
function markChips() {
  const n = selectedChips().length;
  const c = $('#chips-count');
  if (c) c.textContent = n ? `：${n}つ選んでいます` : '';
}
const selectedChips = () => $$('#chips .chip[aria-pressed="true"]').map((b) => b.dataset.id);
const SIDE_TEXT = { left: '左側', right: '右側', both: '左右' };

function principleCard(id) {
  const k = db.principleById[id];
  if (!k) return '';
  return `<div class="k-item"><div class="k-title">${esc(k.title)}</div><p>${esc(k.summary)}</p>${k.synthesis ? `<p class="small muted">※${esc(k.synthesis)}</p>` : ''}${citesHTML(k)}</div>`;
}

// ---- 岡田先生の見解（症状から） ----
function noticeHTML(disease = false) {
  return `${disease ? `<div class="banner notice disease-notice">${esc(db.raw.kenkai.disease_notice)}</div>` : ''}<p class="kenkai-notice">${esc(db.raw.kenkai.notice)}</p>`;
}
function spiritualHTML(words) {
  return words.length ? `<div class="banner notice">${esc(db.raw.kenkai.spiritual.message)}</div>` : '';
}
function kenkaiItemHTML(e, { open = true, link = false } = {}) {
  const pts = e.points.map((id) => db.pointById[id]).filter(Boolean);
  return `<details class="kenkai-item"${open ? ' open' : ''}>
    <summary>${e.disease ? '<span class="dis-tag">病気</span>' : ''}${esc(e.label)}</summary>
    ${e.disease ? '<p class="small dis-line">病気の診断・治療は医療機関で受けてください。以下は岡田先生の見解の紹介です。</p>' : ''}
    <p>${esc(e.view)}</p>
    ${e.note ? `<div class="caution">${esc(e.note)}</div>` : ''}
    ${pts.length ? `<div class="small">見解で挙げられている箇所：${pts.map((p) => `<span class="tag">${p.no} ${esc(p.name)}</span>`).join('')}${pts.some((p) => p.region === 'head') && pts.filter((p) => p.region === 'head').length < 4 ? '<span class="muted">（頭部は、前頭部・頭頂部・こめかみ部・後頭部の全体を見ます）</span>' : ''}</div>` : '<div class="small muted">見解の中に施術箇所の記述はありません。重要施術部位（腎臓部）から探査してみましょう。</div>'}
    ${citesHTML(e)}
    ${link ? `<button type="button" class="ghost small-btn" data-kenkai-go="${esc(e.id)}">この症状で探査する箇所を見る →</button>` : ''}
  </details>`;
}
// 見解の無い言葉は、その言葉が出てくる岡田先生の論述（年）を参考に示す
function termRefs(words) {
  const terms = db.raw.zenshu_terms.terms;
  const seen = new Set();
  const refs = [];
  for (const w of words) {
    for (const [id, page, year] of terms[w] || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push({ id, page, year, w });
    }
  }
  return refs.slice(0, 6);
}
function termRefsHTML(words) {
  const refs = termRefs(words);
  if (!refs.length) return '';
  return `<div class="k-item"><div class="small">岡田先生の論述でこの言葉が出てくるもの（参考・内容は未確認）：</div>
    <ul class="small">${refs.map((r) => `<li>「${esc(r.w)}」${esc(citeText(r))}</li>`).join('')}</ul></div>`;
}
function wireKenkaiLinks(root) {
  $$('[data-kenkai-go]', root).forEach((b) => b.addEventListener('click', () => {
    const e = db.kenkai.find((x) => x.id === b.dataset.kenkaiGo);
    showTab('today');
    $('#symptom-text').value = e.label;
    resetAsk();
    store.set(STORE_INPUT, e.label);
    renderResult(analyze(db, e.label, [`k:${e.id}`]));
  }));
}

// 入力したこと（ことば・場所・感じ・一覧で選んだ症状）。読み取った症状は、ここに書いたことだけから出す
function askedHTML(r) {
  const rows = [];
  const text = r.askText ?? r.input;
  if (text) rows.push(['ことば', `<span class="tag tag-said">${esc(text)}</span>`]);
  if (ask.zones.length) rows.push(['つらい場所', placeLabels().map((l) => `<span class="tag tag-place">${esc(l)}</span>`).join('')]);
  if (r.picked?.senses.length) rows.push(['どのように', r.picked.senses.map((x) => `<span class="tag tag-said">${esc(x)}</span>`).join('')]);
  if (r.picked?.chips.length) rows.push(['一覧で選んだ', r.picked.chips.map((x) => `<span class="tag tag-said">${esc(x)}</span>`).join('')]);
  return rows.map(([k, v]) => `<div class="sum-row"><span class="sum-label">${k}</span><div>${v}</div></div>`).join('');
}

function renderResult(r) {
  lastAnalysis = r;
  const out = [];
  for (const s of r.safety.filter((x) => x.level === 'urgent')) out.push(`<div class="banner urgent">${esc(s.message)}</div>`);
  const diseaseShown = !r.urgent && r.kenkai.some((e) => e.disease);
  for (const s of r.safety.filter((x) => x.level !== 'urgent' && !(diseaseShown && x.id === 'disease'))) out.push(`<div class="banner notice">${esc(s.message)}</div>`);

  // 場所がわからない訴えには、どのあたりかを問い返す
  const askText = r.askText ?? r.input;
  if (!r.urgent && !ask.zones.length && (needsPlace(askText) || (r.fallback && (askText || ask.senses.length)))) {
    const w = senseWordOf(askText);
    out.push(`<div class="card ask-back">
      <h2>具体的に、どのあたりが${esc(w)}ですか？</h2>
      <p class="small">場所がわかると、探査して見つめる箇所をしぼれます。当てはまる所を押してください。</p>
      <div class="place-grid">${QUICK_ZONES.map((id) => `<button type="button" class="place-b" data-askback="${id}">${esc(zoneById[id].name)}</button>`).join('')}</div>
      <button type="button" class="ghost wide" id="askback-3d">からだの図で、場所を指でさす</button>
    </div>`);
  }
  if (!r.fallback || r.points.length) {
    const fl0 = r.categories.flatMap((c) => [...c.flows, ...c.routes])[0];
    out.push(`<div class="card summary-card">
      <div class="sum-head"><h2>${r.fallback ? '基本の19か所を探査しましょう' : '調べた結果'}</h2>
        <button type="button" class="speak-b" id="speak-result" aria-pressed="false"><span aria-hidden="true">🔊</span>読み上げ</button></div>
      ${r.fallback ? `<p>${askText || r.safety.length ? '入力から当てはまる症状の流れが見つかりませんでした。' : ''}頭部4か所、頸部6か所、肩2か所、背部4か所、腎臓部3か所を、番号の順にまんべんなく探査してみましょう。</p><p class="cite">根拠：岡田式浄化療法の実際 p130-131（基本的な探査箇所と探査の順序）</p>`
        : `${askedHTML(r)}
      <div class="sum-row"><span class="sum-label">読み取った症状</span><div>${r.categories.map((c) => `<span class="tag">${esc(c.label)}</span>`).join('')}</div></div>
      ${r.side ? `<p class="small">「${SIDE_TEXT[r.side]}」の訴えがあります。探査では${SIDE_TEXT[r.side]}を特によく見つめましょう。</p>` : ''}
      <div class="sum-row"><span class="sum-label">見つめる箇所</span><div class="sum-points">${r.points.map((p) => `<span class="sum-pt${p.key ? ' key' : ''}"><b>${p.no}</b>${esc(p.name)}</span>`).join('')}</div></div>
      ${fl0 ? `<div class="sum-row"><span class="sum-label">毒素の流れ</span>${stationsText(fl0)}</div>` : ''}`}
      <button type="button" class="primary wide big" id="to-session-top">② 探査へ進む →</button>
      <div class="sum-actions">
        <button type="button" class="ghost" id="share-result">共有・コピー</button>
        <button type="button" class="ghost" id="print-result">印刷</button>
      </div>
    </div>`);
  }
  if (!r.fallback) {
    out.push(`<p class="small muted read-words">${r.categories.filter((c) => c.words.length).map((c) => `「${esc(c.words.join('」「'))}」`).join(' ')}${r.categories.some((c) => c.words.length) ? ' から読み取りました。' : ''}</p>`);
  }

  // 岡田先生の見解
  if (r.spiritual.length) out.push(spiritualHTML(r.spiritual));
  if (!r.fallback && !r.urgent) {
    const noView = r.categories.filter((c) => !c.kenkai.length);
    out.push(`<div class="card kenkai-card">
      <h2>岡田先生の見解</h2>
      ${noticeHTML(r.kenkai.some((e) => e.disease))}
      ${r.kenkai.map((e) => kenkaiItemHTML(e)).join('')}
      ${noView.map((c) => `<div class="k-item"><div class="k-title">${esc(c.label)}</div>
        <p class="small muted">この症状について、岡田先生のまとまった見解は見当たりませんでした。下の毒素の流れと各論を参考にしてください。</p>
        ${termRefsHTML(c.words)}</div>`).join('')}
    </div>`);
  }

  // 探査して見つめる箇所＋流れの矢印
  const allFlows = r.categories.flatMap((c) => [...c.flows, ...c.routes].map((fl) => ({ fl, cat: c })));
  const highlight = Object.fromEntries(r.points.map((p) => [p.id, p]));
  const regionsHit = new Set(r.points.map((p) => p.region));
  const cautions = db.raw.points.regions.filter((g) => g.caution && regionsHit.has(g.id));
  out.push(`<div class="card" id="probe-card">
    <h2>探査して見つめる箇所</h2>
    ${allFlows.length ? `<div class="flow-chips" role="group" aria-label="矢印で示す流れ">
      ${allFlows.map(({ fl, cat }, i) => `<button type="button" class="chip flow-chip" data-i="${i}" aria-pressed="${i === 0}"><i style="background:${FLOW_COLORS[i % FLOW_COLORS.length]}"></i>${esc(shortLabel(cat.label))}｜${esc(flowLabel(fl))}</button>`).join('')}
      ${allFlows.length > 1 ? '<button type="button" class="chip flow-chip" data-i="all" aria-pressed="false">すべて</button>' : ''}
    </div>` : ''}
    <div class="b3-stage guide-stage"><div class="b3-wrap" id="result-3d"><p class="small muted b3-loading">図を読み込んでいます…</p></div>${zoomHTML('rs')}</div>
    <p class="small muted">緑の丸の番号は探査の順番、線と矢印は毒素の流れです。1本指でなぞると、なぞった向きに回ります（下へなぞると上から見えます）。上下の移動は ▲▼、大きくするのは ＋ で。</p>
    <details class="flat-chart"><summary>平面図で見る</summary><div id="result-chart">${chartSVG({ highlight, flows: allFlows.slice(0, 1).map((x) => x.fl) })}</div></details>
    <div class="chart-legend">
      <span><i style="background:var(--point)"></i>見つめる箇所</span>
      ${r.points.some((p) => p.key) ? '<span><i style="background:var(--point-key);box-shadow:0 0 0 2px #ffd36b"></i>重点</span>' : ''}
      ${allFlows.length ? '<span><b class="lg-line"></b>毒素の流れ（点線は基本経路で補った所）</span>' : ''}
    </div>
    <ul class="point-list">
      ${r.points.map((p) => `<li>
        <span class="no ${p.key ? 'key' : ''}">${p.no}</span>
        <div><span class="name">${esc(p.name)}</span><span class="region">${esc(p.regionName)}${p.selfProbe ? '・自己探査' : ''}</span>${p.key ? '<span class="badge">重点</span>' : ''}
          <div class="roles">${p.roles.map((x) => ROLE_LABEL[x]).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map((x) => `<span class="role role-${x}">${x}</span>`).join('')}</div></div>
      </li>`).join('')}
    </ul>
    <p class="small muted">番号は探査の順序（岡田式浄化療法の実際 p131）。20〜25は骨盤まわりの自己探査（22 鼠蹊部は岡田先生の論述、23〜25は2級テキスト実践編 p74-76 による追加）。</p>
    ${r.points.some((p) => p.region === 'head') ? '<div class="caution">頭部：前頭部・頭頂部・こめかみ部・後頭部は、すべて大事な所です。中でも熱のある所を見つけて施術します。後頭部は頭部の毒素の出入り口で、延髄部・首とつながっています。</div>' : ''}
    ${cautions.map((g) => `<div class="caution">${esc(g.name)}：${esc(g.caution)}</div>`).join('')}
    <button type="button" class="primary wide big" id="to-session">② 探査へ進む →</button>
  </div>`);

  // 施術の大事なポイント（4つの要素）
  if (!r.fallback) {
    const kakuron = [];
    const seen = new Set();
    for (const c of r.categories) for (const k of c.kakuron) if (!seen.has(k.id)) { seen.add(k.id); kakuron.push(k); }
    out.push(`<details class="card fold"${settings.detail === 'full' ? ' open' : ''}><summary><h2>施術の大事なポイント（4つ）</h2></summary>
      <details class="el" open><summary>① 重要施術部位（頭・肩・腎臓）</summary>
        ${principleCard('atama_first')}${principleCard('kata_gauge')}${principleCard('jinzo_first')}
      </details>
      <details class="el" open><summary>② 楽屋と舞台（毒素の流れ）</summary>
        <p class="small muted">症状が出ている所が舞台、その原因になっている所が楽屋。楽屋をやらなければ根本的には治らない（3級テキスト p59-61）。</p>
        ${r.categories.map((c) => `<h3>${esc(c.label)}</h3>
          ${c.flows.map((fl) => `<div class="flow-block"><div class="flow-title"><span class="src-label">${fl.src.t2 ? 'テキスト' : '3級テキスト'}</span>${esc(fl.src.stage)}</div>${stationsText(fl)}<p class="basis">${esc(fl.src.basis)}</p><div class="cite">根拠：3級テキスト ${esc(fl.src.textbook)}${fl.src.t2 ? `／2級テキスト実践編 ${esc(fl.src.t2)}` : ''}</div>${zenshuDetails(fl.src.zenshu_candidates)}</div>`).join('')}
          ${c.routes.map((fl) => `<div class="flow-block"><div class="flow-title"><span class="src-label">早見表 No.${fl.src.no}</span>${esc(fl.src.text)}</div>${stationsText(fl)}${fl.src.note ? `<div class="small muted">※${esc(fl.src.note)}</div>` : ''}</div>`).join('')}
          ${c.basis ? `<p class="basis">${esc(c.basis)}</p>${c.textbook ? `<div class="cite">根拠：3級テキスト ${esc(c.textbook)}</div>` : ''}` : ''}`).join('')}
        <p class="small muted">（ ）の箇所は、基本経路（腎臓部→肩甲間部→肩→頸部→頭／腎臓部→腎臓下方部→腰部）で補った箇所です。早見表は、既存のテキストに基づく試験的な分類です。</p>
        ${principleCard('joushou')}${principleCard('atama_kudari')}${principleCard('senaka_main')}
      </details>
      <details class="el"${r.pelvic ? ' open' : ''}><summary>③ 毒素集溜と排泄の順序</summary>
        <div class="k-item"><div class="k-title">毒素集溜の特徴</div><p>${esc(db.raw.concepts.concepts.find((x) => x.id === 'shuryu')?.definition)}</p><div class="cite">根拠：3級テキスト p61-62, p64</div></div>
        <div class="k-item"><div class="k-title">溶解と排泄の順序</div><p>肩や首に溜まった毒素が溶けると、胸や胃に降りてきて、下痢やコシケなどで出ていく。腰に溜まった毒素が溶けると足に流れる。</p><div class="cite">根拠：3級テキスト p63-65</div></div>
        ${principleCard('deguchi')}${principleCard('kotsuban')}${r.pelvic ? principleCard('kakou') + principleCard('ten_chi') : ''}
      </details>
      ${kakuron.length ? `<details class="el" open><summary>④ 各論（本日の症状について説かれたこと）</summary>
        ${kakuron.map((k) => `<div class="k-item"><div class="k-title">${esc(k.title)}</div><p>${esc(k.summary)}</p>
          <div class="small">見る箇所：${k.points.map((id) => esc(db.pointById[id]?.name)).join('、')}</div>${citesHTML(k)}</div>`).join('')}
      </details>` : ''}
    </details>`);
  }

  out.push(`<details class="card fold"${settings.detail === 'full' ? ' open' : ''}><summary><h2>探査と施術の心得</h2></summary>
    <div class="k-item"><div class="k-title">探査の手順</div><p>①発熱 ②固結 ③圧痛の順に確かめる。熱・圧痛のある所は第二浄化作用の段階にある急所。</p><div class="cite">根拠：3級テキスト p93-98</div></div>
    ${principleCard('tansa_ishiki')}${principleCard('netsu')}${principleCard('netsu_junban')}${principleCard('minaoshi')}${principleCard('chikara')}${principleCard('tooshi')}${principleCard('jikan')}${principleCard('shizuka')}
  </details>`);

  const el = $('#result');
  el.innerHTML = out.join('');
  wireZenshu(el);
  // 3D図：見つめる箇所（探査の番号）と毒素の流れ
  const sidePref = r.side === 'left' ? 'L' : r.side === 'right' ? 'R' : null;
  const guideFlows = (list) => list.flatMap(({ fl, i }) => {
    const color = parseInt(FLOW_COLORS[i % FLOW_COLORS.length].slice(1), 16);
    const ids = fl.stations.flatMap((st) => (st.points || []).slice(0, 1));
    if (ids.length < 2) return [];
    const sides = sidePref ? [sidePref] : ['R', 'L'];
    return sides.map((sd) => ({ ids: ids.map((id) => [id, sd]), color }));
  });
  const guideSpec = (list) => ({ items: r.points.map((p) => ({ id: p.id, side: sidePref, order: p.no, emphasis: !!p.key })), flows: guideFlows(list), focus: false });
  const indexed = allFlows.map((x, i) => ({ ...x, i }));
  resultGuide = guideSpec(indexed.slice(0, 1));
  mountGuide($('#result-3d', el), resultGuide, { ratio: 1.1, maxH: 0.55 }).then((ok) => {
    if (ok) guide.b3.setView(r.points.filter((p) => ['zentoubu', 'maekata', 'hentousen', 'sokeibu', 'choukotsu', 'chikotsu'].includes(p.id)).length > r.points.length / 2 ? 'front' : 'back');
  });
  wireZoom(el, 'rs', () => guide.b3);
  $$('.flow-chip', el).forEach((b) => b.addEventListener('click', () => {
    $$('.flow-chip', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    resultGuide = guideSpec(b.dataset.i === 'all' ? indexed : [indexed[Number(b.dataset.i)]]);
    guide.b3?.setGuide(resultGuide);
    const flows = b.dataset.i === 'all' ? allFlows.map((x) => x.fl) : [allFlows[Number(b.dataset.i)].fl];
    $('#result-chart').innerHTML = chartSVG({ highlight, flows });
    // 1本だけ描く時は、ボタンの色にそろえる
    if (b.dataset.i !== 'all') {
      const color = FLOW_COLORS[Number(b.dataset.i) % FLOW_COLORS.length];
      $$('#result-chart .flow-line').forEach((p) => p.setAttribute('stroke', color));
      $$('#result-chart marker path').forEach((p) => p.setAttribute('fill', color));
      $$('#result-chart .stage-mark circle').forEach((p) => p.setAttribute('fill', color));
    }
  }));
  const toSession = () => { if (session.state !== 'run') session.state = 'input'; showTab('session'); };
  $('#to-session', el)?.addEventListener('click', toSession);
  $('#to-session-top', el)?.addEventListener('click', toSession);
  $('#speak-result', el)?.addEventListener('click', (e) => speakToggle(e.currentTarget, resultSpeech(r)));
  $('#share-result', el)?.addEventListener('click', () => shareText('浄化療法 実践サポート', resultText(r)));
  $('#print-result', el)?.addEventListener('click', () => printSection('print-result'));
  $$('[data-askback]', el).forEach((b) => b.addEventListener('click', () => { toggleZone(b.dataset.askback); runAsk(); }));
  $('#askback-3d', el)?.addEventListener('click', () => { openPicker(true); $('#picker-box').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- 症状の入力（場所 → 感じ → ことば） ----
const STORE_ASK = 'joka.lastAsk';
// 症状の入力は、アプリを開いている間だけ覚える。前に開いた時の入力（文章・場所・感じ・図の印）は持ち越さない
// （前の人・前の日の訴えが、本日の症状に混ざらないように）
store.del(STORE_ASK);
store.del(STORE_INPUT);
// 図でさした印：{ zone, p:{x,y,z}, d: zoneDetail }。座標と細かい場所（左右・上中下）を残す
const ask = { zones: [], senses: [], pins: [] };
let zoneBoundsCache = null;
let askPicker = null;

function placeName(id) { return zoneById[id]?.name || id; }
// 選んだ場所の名前（図でさした所は細かい名前で）
function placeLabels() {
  const out = [];
  for (const z of ask.zones) {
    const ps = ask.pins.filter((x) => x.zone === z);
    if (ps.length) for (const x of ps) out.push(x.d.label);
    else out.push(placeName(z));
  }
  return [...new Set(out)];
}

function renderTodayForm() {
  $('#today-form').innerHTML = `
    ${stepBar(1)}
    <form class="card ask-card" id="symptom-form" autocomplete="off">
      <h2 class="ask-title">① どこが、どのように つらいですか？</h2>
      <p class="small muted">わかる所だけで大丈夫です。選ぶと、探査して見つめる箇所と毒素の流れをお示しします。</p>
      <div class="ask-step">
        <div class="step-head"><span class="step-no">1</span>つらい場所</div>
        <div class="place-grid" role="group" aria-label="つらい場所">${QUICK_ZONES.map((id) => `<button type="button" class="place-b" data-zone="${id}">${esc(zoneById[id].name)}</button>`).join('')}</div>
        <button type="button" class="ghost wide picker-open" id="open-picker" aria-expanded="false">からだの図で、場所を指でさす</button>
        <div id="picker-box" class="picker-box" hidden>
          <div class="region-chips" role="group" aria-label="向き">${['front', 'back', 'left', 'right', 'head', 'lowerback'].map((v) => `<button type="button" class="chip region-chip" data-ask-view="${v}">${esc(VIEWS3.find((x) => x.id === v).name)}</button>`).join('')}</div>
          <div class="b3-stage">
            <div class="b3-wrap" id="ask-3d"><p class="small muted b3-loading">からだの図を読み込んでいます…</p></div>
            <div class="b3-float b3-edit" role="group" aria-label="印の操作">
              <button type="button" id="pin-undo" aria-label="最後の印を戻す" disabled><span aria-hidden="true">↶</span>戻す</button>
              <button type="button" id="pin-clear" aria-label="印を全部消す" disabled><span aria-hidden="true">✕</span>消す</button>
            </div>
            ${zoomHTML('ask')}
          </div>
          <p class="small muted">つらい所に、指で軽く触れてください。触れた所に印がつき、下に場所の名前が出ます。1本指でなぞると、なぞった向きに回ります（下へなぞると上から見えます）。上下の移動は ▲▼、大きくするのは ＋ で。</p>
        </div>
        <div id="chosen-places" class="chosen" aria-live="polite"></div>
      </div>
      <div class="ask-step">
        <div class="step-head"><span class="step-no">2</span>どのように</div>
        <div class="sense-grid" role="group" aria-label="つらさの感じ">${SENSATIONS.map((x) => `<button type="button" class="sense-b" data-sense="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      </div>
      <div class="ask-step">
        <div class="step-head"><span class="step-no">3</span>ことばで<span class="step-opt">（なくても大丈夫）</span></div>
        <label for="symptom-text" class="visually-hidden">本日の症状</label>
        <textarea id="symptom-text" rows="2" placeholder="例：朝から頭が重く、肩が張っている"></textarea>
      </div>
      <div class="actions">
        <button type="submit" class="primary big">探査する箇所を調べる</button>
        <button type="button" id="clear-btn" class="ghost">やり直す</button>
      </div>
      <details class="chips-box"><summary>症状の一覧から選ぶ（くわしい方向け）<span id="chips-count" class="chips-count"></span></summary><div id="chips"></div></details>
    </form>`;
  renderChips();
  wireStepBar($('#today-form'));
  const ta = $('#symptom-text');
  ta.value = store.get(STORE_INPUT, '') || '';
  const form = $('#symptom-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); runAsk(); });
  $$('.place-b', form).forEach((b) => b.addEventListener('click', () => { toggleZone(b.dataset.zone); }));
  $$('.sense-b', form).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.sense;
    ask.senses = ask.senses.includes(id) ? ask.senses.filter((x) => x !== id) : [...ask.senses, id];
    markAsk();
  }));
  $('#open-picker', form).addEventListener('click', () => openPicker(!$('#picker-box').hidden ? false : true));
  $$('[data-ask-view]', form).forEach((b) => b.addEventListener('click', () => { askPicker?.setView(b.dataset.askView); markAsk(); }));
  wireZoom(form, 'ask', () => askPicker);
  $('#pin-undo', form).addEventListener('click', () => undoPin());
  $('#pin-clear', form).addEventListener('click', () => clearPinZones());
  $('#clear-btn', form).addEventListener('click', () => {
    ta.value = '';
    ask.zones = [];
    ask.senses = [];
    ask.pins = [];
    askPicker?.clearPins();
    $$('#chips .chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    markChips();
    $('#result').innerHTML = '';
    lastAnalysis = null;
    store.del(STORE_INPUT);
    store.del(STORE_ASK);
    markAsk();
  });
  markAsk();
}

// 場所・感じ・図の印・一覧で選んだ症状を空にする（文章はそのまま）
function resetAsk() {
  ask.zones = [];
  ask.senses = [];
  ask.pins = [];
  askPicker?.clearPins();
  $$('#chips .chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  markChips();
  markAsk();
}

function markAsk() {
  $$('.place-b').forEach((b) => b.setAttribute('aria-pressed', String(ask.zones.includes(b.dataset.zone))));
  $$('.sense-b').forEach((b) => b.setAttribute('aria-pressed', String(ask.senses.includes(b.dataset.sense))));
  $$('[data-ask-view]').forEach((b) => b.setAttribute('aria-pressed', String(askPicker?.view === b.dataset.askView)));
  for (const id of ['pin-undo', 'pin-clear']) { const b = $(`#${id}`); if (b) b.disabled = !ask.pins.length; }
  const box = $('#chosen-places');
  if (box) {
    const chips = ask.zones.flatMap((id) => {
      const ps = ask.pins.map((x, i) => [x, i]).filter(([x]) => x.zone === id);
      return ps.length
        ? ps.map(([x, i]) => `<button type="button" class="chosen-b" data-unpin="${i}" aria-label="${esc(x.d.label)}を外す">${esc(x.d.label)}<span aria-hidden="true">×</span></button>`)
        : [`<button type="button" class="chosen-b" data-unzone="${id}" aria-label="${esc(placeName(id))}を外す">${esc(placeName(id))}<span aria-hidden="true">×</span></button>`];
    });
    box.innerHTML = chips.length ? `<span class="small muted">選んだ場所：</span>${chips.join('')}` : '';
    $$('[data-unzone]', box).forEach((b) => b.addEventListener('click', () => toggleZone(b.dataset.unzone)));
    $$('[data-unpin]', box).forEach((b) => b.addEventListener('click', () => removePin(Number(b.dataset.unpin))));
  }
  store.set(STORE_ASK, { zones: ask.zones, senses: ask.senses, pins: ask.pins });
}

// 最後につけた印を外す（その場所に他の印が無ければ、選んだ場所からも外す）
function undoPin() {
  const last = ask.pins.pop();
  if (!last) return;
  askPicker?.removeLastPin();
  if (!ask.pins.some((x) => x.zone === last.zone)) ask.zones = ask.zones.filter((z) => z !== last.zone);
  toast(`「${last.d.label}」の印を戻しました`);
  markAsk();
}
// 図につけた印を全部消す（ボタンで選んだ場所はそのまま）
function clearPinZones() {
  if (!ask.pins.length) return;
  const zones = new Set(ask.pins.map((x) => x.zone));
  ask.pins = [];
  askPicker?.clearPins();
  ask.zones = ask.zones.filter((z) => !zones.has(z));
  toast('図の印を消しました');
  markAsk();
}

// 印を一つ外す（その場所に他の印が無ければ、選んだ場所からも外す）
function removePin(i) {
  const [x] = ask.pins.splice(i, 1);
  if (!x) return;
  if (!ask.pins.some((y) => y.zone === x.zone)) ask.zones = ask.zones.filter((z) => z !== x.zone);
  redrawPins();
  markAsk();
}
function redrawPins() {
  if (!askPicker) return;
  askPicker.clearPins();
  for (const x of ask.pins) askPicker.addPin(x.p);
}

function toggleZone(id, pin = null, detail = null) {
  if (ask.zones.includes(id) && !pin) {
    ask.zones = ask.zones.filter((x) => x !== id);
    ask.pins = ask.pins.filter((x) => x.zone !== id);
    redrawPins();
  } else {
    if (!ask.zones.includes(id)) ask.zones.push(id);
    if (pin) {
      const p = { x: pin.x, y: pin.y, z: pin.z };
      ask.pins.push({ zone: id, p, d: detail || zoneDetail(p, zoneBoundsCache) });
      askPicker?.addPin(p);
    }
  }
  markAsk();
}

async function openPicker(open) {
  const box = $('#picker-box');
  box.hidden = !open;
  $('#open-picker').setAttribute('aria-expanded', String(open));
  $('#open-picker').textContent = open ? 'からだの図を閉じる' : 'からだの図で、場所を指でさす';
  if (!open) { askPicker?.dispose(); return; }
  const wrap = $('#ask-3d');
  try {
    if (!askPicker) {
      const mesh = await loadMesh();
      zoneBoundsCache ||= zoneBounds(mesh.positions);
      askPicker = new Body3D(mesh, db.pointList);
      askPicker.mode = 'pick';
      askPicker.showNumbers = false;
      askPicker.view = 'front';
      askPicker.onPick = (p) => {
        const d = zoneDetail(p, zoneBoundsCache);
        toggleZone(d.zone, p, d);
        toast(`「${d.label}」を選びました`);
      };
    }
    if (!askPicker.mount(wrap)) throw new Error('webgl');
    for (const x of ask.pins) askPicker.addPin(x.p);
  } catch {
    wrap.innerHTML = '<p class="small warn-text">この端末では、からだの図を表示できません。上の場所のボタンから選んでください。</p>';
  }
  markAsk();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// つらさの言い方（問い返しに使う）
function senseWordOf(text) {
  const s = ask.senses.map((id) => SENSATIONS.find((x) => x.id === id)).find((x) => x && x.place !== false);
  if (s) return s.form === '張る' ? '張っている' : s.form;
  const t = text || '';
  if (/かゆ|痒/.test(t)) return 'かゆい';
  if (/しびれ|痺/.test(t)) return 'しびれる';
  if (/だる/.test(t)) return 'だるい';
  if (/重/.test(t)) return '重い';
  if (/痛|いた/.test(t)) return '痛い';
  return 'つらい';
}

function runAsk() {
  const text = $('#symptom-text').value.trim();
  // 図でさした所は「右の胸が痛い」のように細かく、ボタンで選んだ所は場所の名前で
  const pinZones = new Set(ask.pins.map((x) => x.zone));
  const phrases = [...new Set([...phrasesFor(ask.zones.filter((z) => !pinZones.has(z)), ask.senses), ...phrasesForDetails(ask.pins.map((x) => x.d), ask.senses)])];
  const full = [text, ...phrases].filter(Boolean).join('。');
  const chips = [...new Set([...selectedChips(), ...catsFor(ask.zones)])];
  store.set(STORE_INPUT, text);
  const r = analyze(db, full, chips);
  r.askText = text;
  // 何をもとに読み取ったか（結果に示す）
  r.picked = { senses: ask.senses.map((id) => SENSATIONS.find((x) => x.id === id)?.name).filter(Boolean), chips: selectedChips().map((id) => db.categories.find((c) => c.id === id)?.label).filter(Boolean) };
  renderResult(r);
}

function setupToday() {
  renderTodayForm();
}

// 「くわしく」を開くかどうか（かんたん表示では閉じておく）
function fold(title, inner, { open = false, cls = '' } = {}) {
  return `<details class="card fold ${cls}"${open || settings.detail === 'full' ? ' open' : ''}><summary><h2>${title}</h2></summary>${inner}</details>`;
}

// 結果を声で読む・共有する・印刷する
function resultSpeech(r) {
  const parts = [];
  if (!r.fallback && r.categories.length) parts.push(`読み取った症状は、${r.categories.map((c) => c.label.split('（')[0]).join('、')}です。`);
  if (r.points.length) parts.push(`探査して見つめる箇所は、${r.points.map((p) => p.reading || p.name).join('、')}です。`);
  const fl = r.categories.flatMap((c) => [...c.flows, ...c.routes])[0];
  if (fl) parts.push(`毒素の流れは、${fl.stations.map((x) => x.name).join('から、')}へ、です。`);
  if (!r.urgent && r.kenkai.length) parts.push(`岡田先生の見解。${r.kenkai[0].view}`);
  parts.push('これは岡田先生の見解の紹介で、医療の診断ではありません。');
  return parts.join('');
}
function resultText(r) {
  const lines = ['【浄化療法 実践サポート】'];
  if (r.askText || r.input) lines.push(`本日の症状：${r.askText || r.input}`);
  if (!r.fallback) lines.push(`読み取った症状：${r.categories.map((c) => c.label).join('、')}`);
  lines.push(`探査して見つめる箇所：${r.points.map((p) => `${p.no} ${p.name}`).join('、')}`);
  const fl = r.categories.flatMap((c) => [...c.flows, ...c.routes])[0];
  if (fl) lines.push(`毒素の流れ：${fl.stations.map((x) => x.name).join(' → ')}`);
  for (const e of r.urgent ? [] : r.kenkai.slice(0, 2)) lines.push(`岡田先生の見解（${e.label}）：${e.view}`);
  lines.push(db.raw.kenkai.notice);
  return lines.join('\n');
}
function speakToggle(btn, text) {
  if (window.speechSynthesis?.speaking) { stopSpeaking(); btn.setAttribute('aria-pressed', 'false'); return; }
  if (!canSpeak()) { toast('この端末では読み上げが使えません'); return; }
  speak(text, { rate: 0.9 });
  btn.setAttribute('aria-pressed', 'true');
  const t = setInterval(() => { if (!window.speechSynthesis.speaking) { btn.setAttribute('aria-pressed', 'false'); clearInterval(t); } }, 500);
}
async function shareText(title, text) {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
  } catch { return; }
  try { await navigator.clipboard.writeText(text); toast('文章をコピーしました。メールやメッセージに貼り付けられます'); } catch { toast('コピーできませんでした'); }
}
function printSection(cls) {
  document.body.classList.add(cls);
  // 閉じている「くわしく」も印刷に入れる
  const closed = $$('#result details:not([open])');
  closed.forEach((d) => { d.open = true; });
  const done = () => { document.body.classList.remove(cls); closed.forEach((d) => { d.open = false; }); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}

// ---- 探査と施術（塗って入力 → 時間配分 → タイマー） ----
const session = { state: 'input', findings: {}, after: {}, plan: null, run: null, order: 'top', pads: {}, receiver: store.get('joka.lastReceiver', ''), ratingBefore: 5, ratingAfter: 5, changes: [], memo: '', savedId: null };

// 塗る板：3D人体図と平面図の両方を持ち、道具・色・筆は共通。読み取りは両方の濃い方を使う
let bodyMeshP = null;
const loadMesh = () => (bodyMeshP ||= loadBodyMesh('data/body3d.bin').catch((e) => { bodyMeshP = null; throw e; }));

function getPad(prefix) {
  if (!session.pads[prefix]) {
    const { width, height, image } = db.raw.points.chart;
    const img = new Image();
    img.src = image;
    session.pads[prefix] = { flat: new Painter({ image: img, width, height }), b3: null, layer: 'heat', tool: 'paint', brush: 'mid', dim: '3d', how: settings.paintHow || 'select', finger: 'paint', region: null };
  }
  return session.pads[prefix];
}

function padSample(pad) {
  const a = pad.flat.sample(db.pointList);
  const b = pad.b3 ? pad.b3.sample() : {};
  const out = {};
  const mx = (x, y) => Object.fromEntries(LAYERS.map((l) => [l.id, Math.max(x?.[l.id] || 0, y?.[l.id] || 0)]));
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[id] = mx(a[id], b[id]);
    const sa = a[id]?.sides;
    const sb = b[id]?.sides;
    if (sa || sb) {
      out[id].sides = {};
      for (const k of ['L', 'R']) if (sa?.[k] || sb?.[k]) out[id].sides[k] = mx(sa?.[k], sb?.[k]);
    }
  }
  return out;
}

// 画面を描き替える前に、3D表示の描画を手放す（塗った値は残る）
function releasePads() {
  for (const pad of Object.values(session.pads)) pad.b3?.dispose();
}

// 濃さ（0〜5）を色の帯で示す
function shadeBars(f) {
  return `<span class="shade-bars">${LAYERS.map((l) => {
    const v = f?.[l.id] || 0;
    return `<span class="sb" title="${l.name} ${v}"><span class="sb-l">${l.name.split('・')[0]}</span><span class="sb-track"><i style="width:${(v / SHADES) * 100}%;background:rgb(${l.rgb.join(',')})"></i></span></span>`;
  }).join('')}</span>`;
}

// 塗りの道具と人体図（3D／平面図）。塗りが変わるたびに onChange を呼ぶ
function painterHTML(prefix) {
  const P = `data-${prefix}`;
  const views = ['back', 'front', 'upperback', 'head', 'top', 'lowerback', 'abdomen'];
  const SIDE = { L: '左', R: '右' };
  const groups = db.raw.points.regions.map((g) => `<div class="pl-group"><div class="pl-name">${esc(g.name)}</div>${g.points.map((p) => {
    const two = (p.p3 || []).length > 1;
    return two
      ? `<span class="pl-pt"><b>${p.no}</b> ${esc(p.name)} ${['R', 'L'].map((sd) => `<button type="button" class="pl-b" ${P}-pick="${p.id}:${sd}">${SIDE[sd]}</button>`).join('')}</span>`
      : `<span class="pl-pt"><button type="button" class="pl-b wide" ${P}-pick="${p.id}:"><b>${p.no}</b> ${esc(p.name)}</button></span>`;
  }).join('')}</div>`).join('');
  return `
    <div class="dim-switch" role="group" aria-label="人体図の種類">
      <button type="button" class="chip" ${P}-dim="3d">3D人体図</button>
      <button type="button" class="chip" ${P}-dim="2d">平面図</button>
    </div>
    <div ${P}-box="3d">
      <div class="how-switch" role="group" aria-label="入れ方">
        <button type="button" ${P}-how="select"><span aria-hidden="true">👆</span>番号を押して選ぶ<small>かんたん</small></button>
        <button type="button" ${P}-how="paint"><span aria-hidden="true">✎</span>なぞって塗る<small>こまかく</small></button>
      </div>
      <div class="region-chips" role="group" aria-label="向き">${views.map((id) => `<button type="button" class="chip region-chip" ${P}-view="${id}">${esc(VIEWS3.find((v) => v.id === id).name)}</button>`).join('')}</div>
      <div class="finger-switch" role="group" aria-label="1本指でなぞった時" ${P}-fingerbox hidden>
        <span class="small">1本指でなぞると</span>
        <button type="button" ${P}-finger="paint"><span aria-hidden="true">✎</span>塗る</button>
        <button type="button" ${P}-finger="turn"><span aria-hidden="true">✋</span>回す</button>
      </div>
      ${prefix === 'pa' ? `<button type="button" class="peek-b" ${P}-peek="1" aria-pressed="false"><span aria-hidden="true">👁</span>施術前の図を見る</button>` : ''}
      <div class="b3-stage">
        <p class="peek-banner" ${P}-peekbanner hidden>施術前の図</p>
        <div class="b3-wrap" id="${prefix}-3d"><p class="small muted b3-loading">3D人体図を読み込んでいます…</p></div>
        <div class="b3-float b3-edit" role="group" aria-label="入れた結果の操作">
          <button type="button" ${P}-undo="1" aria-label="最後に入れたものを戻す"><span aria-hidden="true">↶</span>戻す</button>
        </div>
        <div class="b3-paintbar" ${P}-paintbar hidden>
          <div role="group" aria-label="塗るもの">${LAYERS.map((l) => `<button type="button" class="pb-layer" ${P}-layer="${l.id}" style="--c:rgb(${l.rgb.join(',')})" aria-label="${esc(l.name)}を塗る"><i></i><span>${esc(l.name.split('・')[0])}</span></button>`).join('')}</div>
          <div role="group" aria-label="道具">
            <button type="button" class="pb-tool" ${P}-tool="paint" aria-label="塗る"><b>✎</b><span>塗る</span></button>
            <button type="button" class="pb-tool" ${P}-tool="deepen" aria-label="濃くする"><b>＋</b><span>濃く</span></button>
            <button type="button" class="pb-tool" ${P}-tool="lighten" aria-label="薄くする"><b>－</b><span>薄く</span></button>
          </div>
        </div>
        <div class="b3-float b3-right" role="group" aria-label="表示">
          <button type="button" ${P}-organs="1">内臓</button>
          <button type="button" ${P}-nums="1">番号</button>
        </div>
        ${zoomHTML(prefix)}
      </div>
      <p class="gesture-hint small" ${P}-hint="select">番号の丸を押すと、その箇所の熱・固結・圧痛を選べます。1本指でなぞると、<b>なぞった向きに体が回ります</b>（下へなぞると上から見えて、頭頂部が見えます）。体に沿った上下の移動は <b>▲▼</b>、大きくするのは <b>＋</b>。</p>
      <p class="gesture-hint small" ${P}-hint="paint" hidden>1本指でなぞって塗ります。図の左の「熱・固結・圧痛」で色を、「塗る・濃く・薄く」で道具を変えられます。<b>回したい時は「✋回す」</b>を押すか、体の外から指でなぞってください。頭頂部は「頭頂」か「上から」で。</p>
      <p class="gesture-hint small muted">色が重なった所は、あとから塗った色で塗り、下の色はふちの線で示します。2本指でも動かせます（広げる・つまむ＝大きさ／動かす＝位置）。2回続けて触れると、その所へ寄ります。</p>
      <div class="lv-panel" id="${prefix}-level" hidden></div>
      <details class="pt-list"><summary>箇所の一覧から選ぶ</summary>${groups}</details>
    </div>
    <div ${P}-box="2d" hidden>
      <div class="region-chips" role="group" aria-label="拡大する部位">${REGIONS.map((r) => `<button type="button" class="chip region-chip" ${P}-region="${r.id}">${esc(r.name)}</button>`).join('')}</div>
      <div class="paint-wrap" id="${prefix}-canvas"></div>
    </div>
    <div class="paint-tools" ${P}-tools>
      <div class="tool-row" role="group" aria-label="塗るもの">${LAYERS.map((l) => `<button type="button" class="layer-b" ${P}-layer="${l.id}" style="--c:rgb(${l.rgb.join(',')})"><i></i>${esc(l.name)}</button>`).join('')}</div>
      <div class="tool-row" role="group" aria-label="道具">
        <span class="tool-l">道具</span>${TOOLS.map((t) => `<button type="button" class="brush-b tool-b" ${P}-tool="${t.id}">${esc(t.name)}</button>`).join('')}
      </div>
      <div class="tool-row" role="group" aria-label="筆">
        <span class="tool-l">筆</span>${BRUSHES.map((x) => `<button type="button" class="brush-b" ${P}-brush="${x.id}"><i style="--s:${x.r * 2.4}px"></i>${x.name}</button>`).join('')}
        <button type="button" class="mini" ${P}-undo="1">戻す</button>
      </div>
      <div class="tool-row" role="group" aria-label="見せる層">
        <span class="tool-l">表示</span>
        <button type="button" class="brush-b" ${P}-show="all">全部</button>${LAYERS.map((l) => `<button type="button" class="brush-b" ${P}-show="${l.id}">${esc(l.name.split('・')[0])}だけ</button>`).join('')}
      </div>
      <div class="level-legend small muted" aria-hidden="true">${LAYERS.map((l) => `<span><b>${esc(l.name.split('・')[0])}</b><i style="background:linear-gradient(90deg,rgb(${l.light.join(',')}),rgb(${l.deep.join(',')}))"></i></span>`).join('')}<span class="lv-note">うすい ← 20段階 → こい</span></div>
    </div>`;
}

// 選んだ箇所の熱・固結・圧痛を、0〜5の大きなボタンで入れる
function levelPanelHTML(b3, k) {
  const t = b3.targets[k];
  const p = db.pointById[t.id];
  const cur = b3.targetLevels(k);
  const sideName = t.side === 'L' ? '（左）' : t.side === 'R' ? '（右）' : '';
  const other = t.side ? b3.targetIndexes(t.id, t.side === 'L' ? 'R' : 'L').find((x) => b3.targets[x].side) : -1;
  return `<div class="lv-head"><span class="no">${p.no}</span><b>${esc(p.name)}${sideName}</b>
      <button type="button" class="lv-close" data-lv-close="1" aria-label="閉じる">×</button></div>
    ${LAYERS.map((l) => `<div class="lv-row"><span class="lv-name" style="--c:rgb(${l.rgb.join(',')})"><i></i>${esc(l.name)}</span>
      <div class="lv-btns" role="radiogroup" aria-label="${esc(l.name)}の強さ">${[0, 1, 2, 3, 4, 5].map((v) => `<button type="button" role="radio" class="lv-b" data-lv="${l.id}:${v}" aria-checked="${cur[l.id] === v}" style="--c:rgb(${l.rgb.join(',')});--a:${v / 5}">${v === 0 ? 'なし' : v}</button>`).join('')}</div></div>`).join('')}
    <p class="small muted">数字が大きいほど強い（5がいちばん強い）。</p>
    ${other >= 0 ? `<button type="button" class="ghost wide" data-lv-other="${other}">反対側（${t.side === 'L' ? '右' : '左'}）も入れる →</button>` : ''}
    ${p.note ? `<details class="lv-note"><summary>この箇所について</summary><p class="small">${esc(p.note)}</p></details>` : ''}`;
}

// 3D人体図の拡大・縮小・回転のボタン（指の操作が難しい時に）
function zoomHTML(prefix) {
  const P = `data-${prefix}`;
  return `<div class="b3-updown" role="group" aria-label="上下に動かす">
    <button type="button" ${P}-move="1" aria-label="頭の方へ動かす">▲</button>
    <button type="button" ${P}-move="-1" aria-label="足の方へ動かす">▼</button>
  </div>
  <div class="b3-zoom" role="group" aria-label="拡大・回転">
    <button type="button" ${P}-zoom="in" aria-label="大きくする">＋</button>
    <button type="button" ${P}-zoom="out" aria-label="小さくする">－</button>
    <button type="button" ${P}-rot="l" aria-label="左に回す">⟲</button>
    <button type="button" ${P}-rot="r" aria-label="右に回す">⟳</button>
    <button type="button" class="tilt-b" ${P}-tilt="1" aria-label="上から見る">上<br>から</button>
    <button type="button" class="tilt-b" ${P}-tilt="-1" aria-label="下から見る">下<br>から</button>
    <button type="button" ${P}-home="1" aria-label="元の向きに戻す">⌂</button>
  </div>`;
}
function wireZoom(root, prefix, get) {
  const q = (k) => $$(`[data-${prefix}-${k}]`, root);
  q('zoom').forEach((b) => b.addEventListener('click', () => get()?.zoomBy(b.getAttribute(`data-${prefix}-zoom`) === 'in' ? 1.35 : 1 / 1.35)));
  q('rot').forEach((b) => b.addEventListener('click', () => get()?.rotateBy(b.getAttribute(`data-${prefix}-rot`) === 'l' ? -Math.PI / 6 : Math.PI / 6)));
  q('home').forEach((b) => b.addEventListener('click', () => { const x = get(); x?.setView(x.view); }));
  q('move').forEach((b) => b.addEventListener('click', () => get()?.stepVertical(Number(b.getAttribute(`data-${prefix}-move`)))));
  q('tilt').forEach((b) => b.addEventListener('click', () => get()?.tiltBy(Number(b.getAttribute(`data-${prefix}-tilt`)))));
}

function wirePainter(root, prefix, pad, onChange) {
  const q = (k) => $$(`[data-${prefix}-${k}]`, root);
  const val = (b, k) => b.getAttribute(`data-${prefix}-${k}`);
  const sync = () => {
    for (const p of [pad.flat, pad.b3]) if (p) Object.assign(p, { layer: pad.layer, tool: pad.tool, brush: pad.brush });
  };
  const mark = () => {
    sync();
    const press = (k, cur) => q(k).forEach((b) => b.setAttribute('aria-pressed', String(val(b, k) === cur)));
    press('dim', pad.dim);
    press('layer', pad.layer);
    press('tool', pad.tool);
    press('brush', pad.brush);
    press('region', pad.flat.region?.id);
    press('view', pad.b3?.view);
    press('mode', pad.b3?.mode);
    press('show', pad.b3?.show || 'all');
    press('how', pad.how);
    press('finger', pad.finger);
    q('fingerbox').forEach((b) => { b.hidden = !(pad.dim === '3d' && pad.how === 'paint'); });
    q('peek').forEach((b) => b.setAttribute('aria-pressed', String(!!pad.peeking)));
    q('peekbanner').forEach((b) => { b.hidden = !pad.peeking; });
    pad.b3?.setMode(modeOf());
    q('hint').forEach((h) => { h.hidden = val(h, 'hint') !== pad.how; });
    const tools = q('tools')[0];
    if (tools) tools.hidden = pad.dim === '3d' && pad.how === 'select';
    q('paintbar').forEach((b) => { b.hidden = !(pad.dim === '3d' && pad.how === 'paint'); });
    q('organs').forEach((b) => b.setAttribute('aria-pressed', String(!!pad.b3?.showOrgans)));
    q('nums').forEach((b) => b.setAttribute('aria-pressed', String(pad.b3?.showNumbers ?? true)));
    const rgb = LAYERS.find((l) => l.id === pad.layer).rgb.join(',');
    root.style.setProperty(`--${prefix}-c`, `rgb(${rgb})`);
  };
  // 1本指の動き：番号を選ぶ時は回す。塗る時は「塗る」「回す」を切り替える（施術前の図を見ている間は回すだけ）
  const modeOf = () => (pad.how === 'paint' && pad.finger !== 'turn' && !pad.peeking ? 'paint' : 'rotate');
  const markers = db.pointList.map((p) => ({ no: p.no, xy: p.chart || [] }));
  const showRegion = (id) => { pad.region = id; pad.flat.mount($(`#${prefix}-canvas`, root), id, markers); mark(); };
  const box = (d) => q('box').forEach((b) => { b.hidden = val(b, 'box') !== d; });
  const use2d = () => {
    pad.dim = '2d';
    box('2d');
    let start = pad.region;
    if (!start) {
      const pts = (lastAnalysis && !lastAnalysis.fallback ? lastAnalysis.points : []).map((p) => db.pointById[p.id]);
      const score = (r) => pts.filter((p) => (p.chart || []).some(([x, y]) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3])).length;
      start = REGIONS.slice(0, 7).map((r) => [r.id, score(r)]).sort((x, y) => y[1] - x[1])[0][0];
      if (!pts.length) start = 'back';
    }
    showRegion(start);
  };
  const use3d = async () => {
    pad.dim = '3d';
    box('3d');
    mark();
    const wrap = $(`#${prefix}-3d`, root);
    try {
      if (!pad.b3) {
        pad.b3 = new Body3D(await loadMesh(), db.pointList);
        pad.b3.view = startView();
        // 施術後の図は、施術前の図をそのまま写して始める
        if (pad.seed) pad.b3.copyFrom(pad.seed);
        pad.seed = null;
      }
      if (!wrap.isConnected || pad.dim !== '3d') return;
      pad.b3.onChange = () => { onChange(); refreshPanel(); };
      pad.b3.onSelectTarget = (k) => { if (pad.how !== 'paint') openPanel(k, false); };
      pad.b3.setMode(modeOf());
      if (pad.peeking) pad.b3.setPeek(pad.before?.b3 || null);
      if (!pad.b3.mount(wrap)) throw new Error('webgl');
    } catch {
      wrap.innerHTML = '<p class="small warn-text">この端末では3D人体図を表示できません。平面図で入力してください。</p>';
      return use2d();
    }
    mark();
  };
  // 番号を選んで入れる
  let panelK = -1;
  const panel = $(`#${prefix}-level`, root);
  const refreshPanel = () => { if (panelK >= 0 && !panel.hidden && pad.b3) { panel.innerHTML = levelPanelHTML(pad.b3, panelK); wirePanel(); } };
  const openPanel = (k, focus = true) => {
    if (!pad.b3) return;
    panelK = k;
    panel.hidden = false;
    panel.innerHTML = levelPanelHTML(pad.b3, k);
    wirePanel();
    pad.b3.setGuide({ items: [{ id: pad.b3.targets[k].id, side: pad.b3.targets[k].side, current: false, emphasis: true }], focus: false });
    if (focus) pad.b3.focusTargets([k], 0.7);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const wirePanel = () => {
    $$('[data-lv]', panel).forEach((b) => b.addEventListener('click', () => {
      const [layer, v] = b.dataset.lv.split(':');
      pad.b3.setTargetLevel(panelK, layer, Number(v));
    }));
    $('[data-lv-close]', panel)?.addEventListener('click', () => { panel.hidden = true; panelK = -1; pad.b3?.setGuide({ items: [], focus: false }); });
    $('[data-lv-other]', panel)?.addEventListener('click', (e) => openPanel(Number(e.currentTarget.dataset.lvOther)));
  };
  q('pick').forEach((b) => b.addEventListener('click', async () => {
    const [id, side] = val(b, 'pick').split(':');
    if (pad.dim !== '3d') return;
    if (!pad.b3) await use3d();
    const k = pad.b3?.targetIndexes(id, side || null)[0];
    if (k !== undefined) openPanel(k);
  }));
  q('how').forEach((b) => b.addEventListener('click', () => {
    pad.how = val(b, 'how');
    settings.paintHow = pad.how;
    saveSettings();
    if (pad.how === 'paint') { panel.hidden = true; panelK = -1; pad.b3?.setGuide({ items: [], focus: false }); }
    mark();
  }));
  pad.flat.onChange = onChange;
  q('dim').forEach((b) => b.addEventListener('click', () => {
    settings.paintDim = val(b, 'dim');
    saveSettings();
    if (settings.paintDim === '3d') use3d(); else use2d();
  }));
  q('region').forEach((b) => b.addEventListener('click', () => showRegion(val(b, 'region'))));
  q('view').forEach((b) => b.addEventListener('click', () => { pad.b3?.setView(val(b, 'view')); mark(); }));
  q('show').forEach((b) => b.addEventListener('click', () => { pad.b3?.setShow(val(b, 'show')); mark(); }));
  q('organs').forEach((b) => b.addEventListener('click', () => { pad.b3?.setOrgans(!pad.b3.showOrgans); mark(); }));
  q('nums').forEach((b) => b.addEventListener('click', () => { pad.b3?.setNumbers(!pad.b3.showNumbers); mark(); }));
  q('finger').forEach((b) => b.addEventListener('click', () => { pad.finger = val(b, 'finger'); mark(); }));
  q('peek').forEach((b) => b.addEventListener('click', () => {
    pad.peeking = !pad.peeking;
    pad.b3?.setPeek(pad.peeking ? pad.before?.b3 || null : null);
    pad.flat.setPeek(pad.peeking ? pad.before?.flat || null : null);
    mark();
  }));
  q('layer').forEach((b) => b.addEventListener('click', () => { pad.layer = val(b, 'layer'); mark(); }));
  q('tool').forEach((b) => b.addEventListener('click', () => { pad.tool = val(b, 'tool'); mark(); }));
  q('brush').forEach((b) => b.addEventListener('click', () => { pad.brush = val(b, 'brush'); mark(); }));
  q('undo').forEach((b) => b.addEventListener('click', () => (pad.dim === '3d' && pad.b3 ? pad.b3 : pad.flat).undo()));
  wireZoom(root, prefix, () => pad.b3);
  if (pad.dim === '3d') use3d(); else use2d();
}

// 探査は、3D人体図の背面の全体が見える所から始める（前面などは向きのチップや指で変える）
function startView() {
  return 'back';
}

// 探査の場面に入ったら、すぐ人体図の所へ移る（上の帯に隠れないように）
// 探査・施術の場面が進むたびに、画面の上の方（3Dの人体図のあたり）へ移る。sel：その場面で上端に合わせる所
function jumpToBody(root, sel = '.dim-switch') {
  const go = () => {
    const el = $(sel, root);
    if (!el || root.hidden || !el.isConnected) return;
    const head = $('header.top')?.offsetHeight || 0;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - head - 8) });
  };
  // タブを開いた時の「いちばん上へ」の後に動かす。文字の読み込みで位置がずれた時も、触っていなければ合わせ直す
  requestAnimationFrame(() => {
    go();
    const y = window.scrollY;
    setTimeout(() => { if (Math.abs(window.scrollY - y) < 2) go(); }, 400);
  });
}

function readoutHTML(findings, highlightIds = new Set()) {
  const rows = db.pointList.filter((p) => findings[p.id]);
  if (!rows.length) return '<p class="small muted">まだ入っていません。番号の丸を押して熱・固結・圧痛を選ぶか、なぞって塗ってください。</p>';
  const sideRows = (f) => {
    const sd = f.sides;
    if (!sd || !(sd.L && sd.R)) return sd ? `<div class="small side-only">${sd.R ? '右' : '左'}のみ</div>` : '';
    const fs = sideFocus(f);
    return `<div class="cmp"><span class="cmp-l">右</span>${shadeBars(sd.R)}</div><div class="cmp"><span class="cmp-l">左</span>${shadeBars(sd.L)}</div>${fs?.side ? `<div class="small side-strong">${fs.side === 'R' ? '右' : '左'}が強い</div>` : ''}`;
  };
  return `<ul class="readout">${rows.map((p) => {
    const f = findings[p.id];
    return `<li${highlightIds.has(p.id) ? ' class="hl"' : ''}><span class="no">${p.no}</span><span class="name">${esc(p.name)}</span>${f.sides?.L && f.sides?.R ? sideRows(f) : shadeBars(f) + sideRows(f)}</li>`;
  }).join('')}</ul>`;
}

// ①〜④の進み具合（今どこにいるか）
const STEPS = [{ n: 1, name: 'つらい所' }, { n: 2, name: '探査' }, { n: 3, name: '施術' }, { n: 4, name: '記録' }];
function stepBar(now) {
  return `<ol class="stepbar" aria-label="進み具合">${STEPS.map((x) => `<li class="${x.n < now ? 'done' : x.n === now ? 'now' : ''}"><button type="button" data-step="${x.n}"${x.n === now ? ' aria-current="step"' : ''}><span class="st-no">${x.n}</span>${x.name}</button></li>`).join('')}</ol>`;
}
function wireStepBar(root) {
  $$('[data-step]', root).forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.step);
    if (n === 1) showTab('today');
    else if (n === 2) { if (session.state !== 'run') session.state = 'input'; showTab('session'); }
    else if (n === 3) { if (session.plan && session.state !== 'run') session.state = 'plan'; showTab('session'); }
    else showTab('records');
  }));
}

function renderSessionInput() {
  const pad = getPad('pb');
  const suggested = lastAnalysis && !lastAnalysis.fallback ? lastAnalysis.points : [];
  const sugIds = new Set(suggested.map((p) => p.id));
  $('#tab-session').innerHTML = `
    ${stepBar(2)}
    <div class="card">
      <h2>② 探査の結果を入れる</h2>
      <p class="small">探査して感じたことを入れます。<b class="c-heat">熱は赤</b>、<b class="c-kou">固結・張りは青</b>、<b class="c-atsu">圧痛は紫</b>。<b>左右で違う時は、それぞれに入れてください</b>（強い側を重点にした施術をお示しします）。</p>
      ${suggested.length ? `<p class="small">本日の症状から見つめる箇所：${suggested.map((p) => `<span class="tag">${p.no} ${esc(p.name)}</span>`).join('')}</p>` : ''}
      <p class="small">骨盤まわり（20〜25：腰骨部・尾てい骨部・鼠蹊部・腸骨の内側・仙腸関節付近・恥骨部）は本人に確かめてもらい、<b>排泄経路は整っているか</b>も入れておきましょう。</p>
      ${painterHTML('pb')}
    </div>
    <div class="card">
      <h2>入った探査の結果</h2>
      <p class="small muted">箇所ごとに5段階で読み取ります。塗った時は、一番近い探査箇所にだけ数え、少しはみ出しただけの所は数えません。</p>
      <div id="readout">${readoutHTML(session.findings, sugIds)}</div>
    </div>
    <div class="card">
      <h2>施術にかける時間</h2>
      <div class="time-chips">${[15, 20, 30, 45, 60].map((m) => `<button type="button" class="chip time-chip" data-m="${m}" aria-pressed="${settings.minutes === m}">${m}分</button>`).join('')}</div>
      <p class="small muted">一回の施術は普通十分から三十分くらい（岡田先生 昭和10年）。</p>
      <button type="button" class="primary wide big" id="make-plan">③ 施術の順番と時間を出す →</button>
      <p id="plan-msg" class="small warn-text" hidden></p>
    </div>
    ${criteriaCard()}`;
  const root = $('#tab-session');
  wireStepBar(root);
  jumpToBody(root);
  wirePainter(root, 'pb', pad, () => {
    session.findings = padSample(pad);
    $('#readout').innerHTML = readoutHTML(session.findings, sugIds);
  });
  $$('.time-chip').forEach((b) => b.addEventListener('click', () => {
    settings.minutes = Number(b.dataset.m);
    saveSettings();
    $$('.time-chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#make-plan').addEventListener('click', () => {
    session.findings = padSample(pad);
    const plan = planSession(db, session.findings, settings.minutes, lastAnalysis, { order: session.order });
    if (!plan.ok) {
      const m = $('#plan-msg');
      m.textContent = '探査で熱・固結・圧痛を感じた所を、番号を押して入れるか、人体図に塗ってください。';
      m.hidden = false;
      return;
    }
    session.plan = plan;
    session.state = 'plan';
    renderSession();
  });
}

function criteriaCard() {
  return `<details class="card criteria"><summary><h2>優先順位と時間配分の考え方</h2></summary>
    <p class="small">探査の結果に、施術の大事なポイント4つを掛け合わせて優先度を出し、時間を配分します（このアプリの判断基準）。</p>
    <ol class="steps small">
      <li><b>探査の結果</b>：塗った濃さ（5段階）を探査箇所ごとに読み取る。熱を最も重く（熱は溶けて排泄に向かっている印）、固結・張り・圧痛を加え、重なる所（急所）をさらに重くする。</li>
      <li><b>重要施術部位</b>：頭（前頭部・頭頂部・後頭部は外さず、所見が無くても1〜3分）・肩・腎臓部は、必ず施術に入れる（肩・腎臓部は所見のある箇所があればそこを、無ければ短い時間で）。鼠蹊部・恥骨部（自己探査）に張り・痛み・熱があれば、短くても必ず入れる（排泄の出口）。頭部は一か所あたり3分ほどまで（頭痛など頭部が特に大事と読み取れる時だけ長めに）。</li><li><b>左右</b>：左右がある箇所は、どちらが大事かを必ず決めて、重点の側から先に長めに施術する（差がはっきりしない時は、からだ全体の左右の傾向や訴えの側で決める）。腎臓部を第一（全身の浄化作用を強める）、頭・肩をそれに次ぐ重みに、背部・肩甲骨部を第二の順位に。</li>
      <li><b>楽屋と舞台</b>：本日の症状の楽屋（元）を重く、流れの経路上をやや重く。腰・脚・婦人科・泌尿器・痔などでは、頭から脊柱の際を下りて腰に溜まる流れもみて、頭も楽屋になりうるとする。</li>
      <li><b>毒素集溜と排泄の順序</b>：骨盤周辺（腰骨部・尾てい骨部・鼠蹊部）は排泄の出口として重く。固結が強い時はさらに重く。</li>
      <li><b>各論</b>：本日の症状について岡田先生が説かれた急所を重く。</li>
      <li><b>時間</b>：はじめに探査（全体の約15%）、最後に確認（約10%）。残りを、所見のある箇所は最低3分、所見の無い重要施術部位は2〜3分確保したうえで、優先度に比例して配る。所見から選ぶ箇所は時間8分あたり1か所（2〜5か所）。施術中は5分ごとに、熱・固結の変化を確かめる声かけをする。</li>
      <li><b>順序</b>：上から下が基本（まず頭を清め、首・肩、背、腎臓部、腰へ）。テキストの探査順にも切り替えられる。</li>
    </ol>
    ${principleCard('jinzo_first')}${principleCard('netsu')}${principleCard('kotsuban')}${principleCard('jikan')}
  </details>`;
}

function receiverHTML() {
  const codes = [...new Set(loadRecords().map((r) => r.receiver_code))].sort();
  return `<label class="row rec-row">受け手コード
      <input id="rec-code" list="rec-codes" value="${esc(session.receiver)}" placeholder="例：A-01" maxlength="20" autocomplete="off">
      <datalist id="rec-codes">${codes.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </label>
    <p class="small muted">氏名は入れず、受け手ごとの記号で記録します（自分自身なら「自分」など）。記録はこの端末の中にだけ保存されます。</p>`;
}
function ratingHTML(key, label, value) {
  return `<label class="rating"><span>${label}</span>
      <input type="range" min="0" max="10" step="1" value="${value}" data-rating="${key}" aria-label="${label}（0〜10）">
      <b data-rating-v="${key}">${value}</b></label>
    <div class="rating-scale small muted"><span>0 なし</span><span>10 とてもつらい</span></div>`;
}
function wireRecordInputs(root) {
  $('#rec-code', root)?.addEventListener('input', (e) => { session.receiver = e.target.value.trim(); store.set('joka.lastReceiver', session.receiver); });
  $$('[data-rating]', root).forEach((r) => r.addEventListener('input', () => {
    const v = Number(r.value);
    if (r.dataset.rating === 'before') session.ratingBefore = v; else session.ratingAfter = v;
    $(`[data-rating-v="${r.dataset.rating}"]`, root).textContent = v;
  }));
}

// ---- 施術箇所を3D図で示す（結果・計画・施術中で共通の1つの図） ----
const guide = { b3: null, el: null };
let resultGuide = null;
async function mountGuide(el, spec, { onSelect = null, ratio = 1.05, maxH = 0.5 } = {}) {
  if (!el) return false;
  try {
    const mesh = await loadMesh();
    if (!el.isConnected) return false;
    if (!guide.b3) {
      guide.b3 = new Body3D(mesh, db.pointList);
      guide.b3.mode = 'rotate';
      guide.b3.showNumbers = false;
      guide.b3.view = 'back';
    }
    const g = guide.b3;
    g.ratio = ratio;
    g.maxH = maxH;
    // 探査で塗った色も重ねて見せる
    const painted = session.pads.pb?.b3;
    // （3Dで塗っていない時は、前の方の塗りが残らないよう空にする）
    if (painted) { g.values = painted.values; g.top = painted.top; }
    else if (g.values.heat.some((v) => v > 0) || g.values.kouketsu.some((v) => v > 0) || g.values.atsutsuu.some((v) => v > 0)) {
      g.values = Object.fromEntries(LAYERS.map((l) => [l.id, new Float32Array(g.nv)]));
      g.top = new Uint8Array(g.nv);
    }
    g.onSelectTarget = onSelect;
    g.guide = spec;
    if (!g.attach(el)) throw new Error('webgl');
    g.setGuide(spec);
    g.updateColors();
    guide.el = el;
    return true;
  } catch {
    if (el.isConnected) el.innerHTML = '<p class="small muted b3-loading">この端末では3D図を表示できません。下の一覧を見てください。</p>';
    return false;
  }
}
function releaseGuide() { guide.b3?.dispose(); }

// 計画の箇所 → 図に示すもの（強い側を強調）
function planGuideItems(plan, currentKey = null, doneKeys = new Set()) {
  const out = [];
  plan.items.forEach((it, i) => {
    const sides = it.split ? it.split.map((x) => x.side) : [it.side || null];
    for (const sd of sides) {
      const key = `${it.id}:${sd || ''}`;
      out.push({ id: it.id, side: sd, order: i + 1, emphasis: !!it.side && sd === it.side, current: key === currentKey, done: doneKeys.has(key) });
    }
  });
  return out;
}

const SIDE_JA = { L: '左', R: '右' };
function splitText(it) {
  if (!it.split) return it.side ? `${SIDE_JA[it.side]}を重点に` : '';
  return it.split.map((x) => `${SIDE_JA[x.side]} ${x.minutes}分`).join(' → ');
}
function reSplit(it) {
  if (!it.split) return;
  const total = it.split.reduce((t, x) => t + x.minutes, 0) || 1;
  let left = it.minutes;
  it.split = it.split.map((x, i) => {
    const m = i === it.split.length - 1 ? left : Math.max(1, Math.round((x.minutes / total) * it.minutes));
    left -= m;
    return { ...x, minutes: m };
  }).filter((x) => x.minutes > 0);
}

function renderSessionPlan({ jump = true } = {}) {
  const plan = session.plan;
  const ref = (r) => {
    const k = r.ref && db.principleById[r.ref];
    if (!k) return '';
    const c = k.cites?.length ? citeText(k.cites[0]) : k.t2 ? `2級テキスト実践編 ${k.t2.split(',')[0]}` : k.textbook ? `3級テキスト ${k.textbook}` : '';
    return c ? ` <span class="ref">${esc(c)}</span>` : '';
  };
  const ORDER_NAME = { top: '上から下（基本・前頭部から）', outlet: '排泄経路を整える（サブプラン）', text: 'テキストの探査順' };
  $('#tab-session').innerHTML = `
    ${stepBar(3)}
    <div class="card plan-card">
      <h2>③ 今日の施術（この方に合わせた順番）</h2>
      <div class="guide-wrap"><div class="b3-stage guide-stage"><div class="b3-wrap" id="plan-3d"><p class="small muted b3-loading">図を読み込んでいます…</p></div>${zoomHTML('pg')}</div>
        <p class="small muted">緑の丸の番号が施術の順番です。大きい丸は重点の側。一覧の箇所を押すと、図がその場所へ寄ります。</p></div>
      ${plan.notes.map((n) => `<div class="plan-note ${n.kind}"><b>${esc(n.title)}</b><p>${esc(n.text)}${ref(n)}</p></div>`).join('')}
      <div class="order-row" role="group" aria-label="施術の順序">
        <span class="tool-l">順番</span>
        ${['top', 'outlet', 'text'].map((o) => `<button type="button" class="chip order-chip" data-order="${o}" aria-pressed="${plan.order === o}">${ORDER_NAME[o]}</button>`).join('')}
      </div>
      <ol class="plan-list">${plan.items.map((it, i) => `<li class="plan-item" data-focus="${i}">
        <div class="plan-head"><span class="ord">${i + 1}</span><span class="name"><span class="no">${it.no}</span>${esc(it.name)}${it.side ? ` <span class="tag tag-side">${SIDE_JA[it.side]}重点</span>` : ''}${it.key ? ' <span class="tag">重要施術部位</span>' : ''}${it.must ? ' <span class="tag tag-must">自己探査・必ず入れる</span>' : ''}${OUTLET_POINTS.includes(it.id) ? ' <span class="tag tag-outlet">出口</span>' : ''}</span>
          <span class="mins"><button type="button" class="mini" data-adj="-1" data-i="${i}" aria-label="1分減らす">−</button><b>${it.minutes}</b>分<button type="button" class="mini" data-adj="1" data-i="${i}" aria-label="1分増やす">＋</button></span></div>
        ${splitText(it) ? `<div class="split">${esc(splitText(it))}</div>` : ''}
        <details class="why"><summary>なぜここを？</summary>
          <div class="small">${shadeBars(it.finding)}</div>
          <ul class="reasons">${it.reasons.map((r) => `<li>${esc(r.text)}${ref(r)}</li>`).join('')}</ul>
        </details>
      </li>`).join('')}</ol>
      <p class="small muted">${plan.order === 'outlet' ? '排泄経路を整えるサブプラン：頭のあと、先に骨盤まわりの出口を開けてから、腎臓部・首・肩・背へ。' : plan.order === 'top' ? '基本の順序：前頭部から始めて、頭 → 首・肩 → 背 → 腎臓部 → 腰と、上から下へ。' : ''}</p>
      <p class="small muted">合計 <b>${plan.total}</b>分（はじめに探査 ${plan.probe}分、最後に確認 ${plan.check}分）。</p>
      ${plan.others.length ? `<p class="small muted">今回は外した箇所：${plan.others.map((o) => esc(o.name)).join('、')}（時間があれば続けて）</p>` : ''}
    </div>
    <details class="card fold before-card"${settings.detail === 'full' ? ' open' : ''}>
      <summary><h2>施術の前に（実践の心得）</h2></summary>
      <ul class="check-list">${(db.knowledge.practice?.before || []).map((x, i) => `<li><label><input type="checkbox" data-before="${i}"> ${esc(x)}</label></li>`).join('')}</ul>
      <p class="small muted">「治るとは約束できませんが、浄化作用が働きやすいようにお手伝いします」など、安心していただける言葉で。くわしくは「学ぶ」の実践の心得へ。</p>
      <div class="cite">根拠：岡田式浄化療法の実際 p135-141</div>
    </details>
    <div class="card">
      <h2>記録の準備</h2>
      ${receiverHTML()}
      ${ratingHTML('before', '施術前のつらさ', session.ratingBefore)}
      <div class="actions">
        <button type="button" class="primary big" id="start-run">施術を始める</button>
        <button type="button" class="ghost" id="back-input">探査に戻る</button>
      </div>
    </div>
    ${criteriaCard()}`;
  const root = $('#tab-session');
  wireStepBar(root);
  wireRecordInputs(root);
  mountGuide($('#plan-3d'), { items: planGuideItems(plan), focus: false });
  wireZoom(root, 'pg', () => guide.b3);
  $$('[data-focus]', root).forEach((li) => li.addEventListener('click', (e) => {
    if (e.target.closest('button, summary, details')) return;
    const it = plan.items[Number(li.dataset.focus)];
    const ks = guide.b3?.targetIndexes(it.id, it.side || null) || [];
    guide.b3?.focusTargets(ks, 0.75);
    $$('[data-focus]', root).forEach((x) => x.classList.toggle('sel', x === li));
    $('#plan-3d')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  $$('.mini[data-adj]').forEach((b) => b.addEventListener('click', () => {
    const it = plan.items[Number(b.dataset.i)];
    it.minutes = Math.max(1, it.minutes + Number(b.dataset.adj));
    reSplit(it);
    plan.total = plan.probe + plan.check + plan.items.reduce((s, x) => s + x.minutes, 0);
    renderSessionPlan({ jump: false });
  }));
  $$('.order-chip').forEach((b) => b.addEventListener('click', () => {
    session.order = b.dataset.order;
    const keep = Object.fromEntries(plan.items.map((it) => [it.id, it.minutes]));
    session.plan = planSession(db, session.findings, settings.minutes, lastAnalysis, { order: session.order });
    for (const it of session.plan.items) if (keep[it.id]) { it.minutes = keep[it.id]; reSplit(it); }
    session.plan.total = session.plan.probe + session.plan.check + session.plan.items.reduce((s, x) => s + x.minutes, 0);
    renderSessionPlan();
  }));
  $('#back-input').addEventListener('click', () => { session.state = 'input'; renderSession(); });
  $('#start-run').addEventListener('click', startRun);
  if (jump) jumpToBody(root, '.plan-card');
}

function speechName(id) {
  const p = db.pointById[id];
  return p?.reading || p?.name || '';
}

function startRun() {
  unlockAudio();
  const plan = session.plan;
  const phases = [{ type: 'probe', label: '探査', sec: plan.probe * 60 }];
  // 左右がある箇所は、強い側から先に、左右を分けて施術する
  plan.items.forEach((it, i) => {
    const parts = it.split && it.split.length ? it.split : [{ side: it.side || null, minutes: it.minutes }];
    for (const x of parts) {
      phases.push({ type: 'treat', id: it.id, side: x.side, key: `${it.id}:${x.side || ''}`, label: `${it.name}${x.side ? `（${SIDE_JA[x.side]}）` : ''}`, sec: x.minutes * 60, n: i + 1 });
    }
  });
  phases.push({ type: 'check', label: '確認（再探査）', sec: plan.check * 60 });
  session.run = { phases, i: 0, left: phases[0].sec, paused: false, tick: null, wake: null, checkShow: 0 };
  session.state = 'run';
  renderSession();
  startMusic();
  enterPhase();
  requestWake();
}

async function requestWake() {
  try { session.run.wake = await navigator.wakeLock?.request('screen'); } catch { /* 画面の常時点灯に未対応 */ }
}
function releaseWake() { try { session.run?.wake?.release(); } catch { /* 何もしない */ } }

function phaseMessage(ph) {
  if (ph.type === 'probe') return '探査を始めます。発熱、固結、圧痛の順に確かめましょう。';
  if (ph.type === 'check') return '最後に、施術した箇所をもう一度探査して、熱が冷めたか、固結がゆるんだかを確かめましょう。';
  return `${ph.n}番目、${ph.side ? (ph.side === 'R' ? 'みぎの' : 'ひだりの') : ''}${speechName(ph.id)}です。${Math.round(ph.sec / 60)}分。力を抜いて、軽い気持ちで。`;
}

function enterPhase() {
  const run = session.run;
  const ph = run.phases[run.i];
  run.left = ph.sec;
  if (settings.chime) chime();
  if (settings.voice) setTimeout(() => speak(phaseMessage(ph)), settings.chime ? 1200 : 0);
  clearInterval(run.tick);
  run.tick = setInterval(tick, 1000);
  renderRun();
  // 次の箇所に移るたびに、画面の上（時計と3Dの図）へ
  jumpToBody($('#tab-session'), '.run-card');
}

// 施術中の確認の声かけ：5分ごと。5分に満たない箇所は、その箇所の施術が終わる時に
const CHECK_VOICE = '固結の変化、熱の変化など、もう一度確認してみましょう。';
const CHECK_EVERY = 300;

function tick() {
  const run = session.run;
  if (!run || run.paused) return;
  run.left--;
  if (run.checkShow > 0 && --run.checkShow === 0) { const el = $('#run-check'); if (el) el.hidden = true; }
  const ph = run.phases[run.i];
  if (ph.type === 'treat') {
    const done = ph.sec - run.left;
    const short = ph.sec < CHECK_EVERY;
    if ((!short && done > 0 && done % CHECK_EVERY === 0) || (short && run.left <= 0)) {
      if (settings.voice) speak(CHECK_VOICE);
      // 画面にも15秒ほど出す（次の箇所に移っても残す）
      run.checkShow = 15;
      const el = $('#run-check');
      if (el) el.hidden = false;
    }
  }
  if (run.left <= 0) return nextPhase();
  updateRunClock();
}

function nextPhase() {
  const run = session.run;
  if (run.i >= run.phases.length - 1) return finishRun();
  run.i++;
  enterPhase();
}

function finishRun() {
  const run = session.run;
  clearInterval(run.tick);
  releaseWake();
  if (settings.chime) chime();
  if (settings.voice) setTimeout(() => speak('お疲れさまでした。施術した箇所の変化を確かめておきましょう。'), 1200);
  session.state = 'done';
  setTimeout(() => player.stop(6), 4000);
  renderSession();
}

const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function updateRunClock() {
  const run = session.run;
  const ph = run.phases[run.i];
  const c = $('#run-clock');
  if (!c) return;
  c.textContent = mmss(run.left);
  $('#run-bar').style.width = `${Math.round(((ph.sec - run.left) / ph.sec) * 100)}%`;
}

// 今施術する所の、探査の記録（熱・固結・圧痛。左右がある所はその側の値）
function recordLineHTML(ph) {
  const it = session.plan.items.find((x) => x.id === ph.id);
  const f = (ph.side && it?.finding?.sides?.[ph.side]) || it?.finding;
  if (!f) return '';
  const parts = LAYERS.map((l) => [l, Math.round((f[l.id] || 0) * 10) / 10]).filter(([, v]) => v > 0);
  return `<p class="run-record small">探査の記録：${parts.length ? parts.map(([l, v]) => `<span class="rec-v" style="--c:rgb(${l.rgb.join(',')})"><i></i>${esc(l.name.split('・')[0])} ${v}</span>`).join('') : '<span class="muted">所見なし（重要施術部位として）</span>'}</p>`;
}

function renderRun() {
  const run = session.run;
  const ph = run.phases[run.i];
  const next = run.phases[run.i + 1];
  const doneKeys = new Set(run.phases.slice(0, run.i).filter((p) => p.type === 'treat').map((p) => p.key));
  $('#tab-session').innerHTML = `
    ${stepBar(3)}
    <div class="card run-card">
      <div class="run-phase">${ph.type === 'treat' ? `施術 ${ph.n}/${session.plan.items.length}` : esc(ph.label)}</div>
      <div class="run-name">${ph.type === 'treat' ? esc(ph.label) : (ph.type === 'probe' ? '発熱・固結・圧痛を確かめる' : '熱が冷めたか、固結がゆるんだか')}</div>
      <div class="run-clock" id="run-clock">${mmss(run.left)}</div>
      <div class="run-progress"><i id="run-bar" style="width:0%"></i></div>
      ${ph.type === 'treat' ? recordLineHTML(ph) : ''}
      <div class="b3-stage guide-stage run-stage"><div class="b3-wrap" id="run-3d"><p class="small muted b3-loading">図を読み込んでいます…</p></div>${zoomHTML('rg')}</div>
      <p class="small muted run-guide-note">${ph.type === 'treat' ? '<b class="c-now">橙の矢印</b>が今施術する所（探査で塗った記録の、熱・固結・圧痛がいちばん強い所）です。緑は、これから施術する所。' : '緑の丸が今日施術する所です（番号は順番。探査で塗った記録の、いちばん強い所に置いています）。'}</p>
      <p class="run-check" id="run-check"${run.checkShow > 0 ? '' : ' hidden'}>${esc(CHECK_VOICE)}</p>
      <p class="small muted">${next ? `次：${esc(next.label)}（${Math.round(next.sec / 60)}分）` : '最後の段階です'}</p>
      <div class="run-controls">
        <button type="button" id="run-pause" class="ghost">${run.paused ? '▶ 再開' : '⏸ 停止'}</button>
        <button type="button" id="run-plus" class="ghost">＋1分</button>
        <button type="button" id="run-next" class="ghost">次へ ⏭</button>
        <button type="button" id="run-stop" class="ghost">■ 終了</button>
      </div>
      <p class="small hint">${ph.type === 'treat' ? '力を抜いて、軽い気持ちで。施術中は話さずに。' : '額や首の周りに手を当てて熱い所を探し、固結・圧痛を確かめます。頸部は三指で強く押さずに。'}</p>
    </div>
    ${musicBarHTML()}
    <ol class="card phase-list">${run.phases.map((p, i) => `<li class="${i === run.i ? 'now' : i < run.i ? 'done' : ''}">${esc(p.label)}<span>${Math.round(p.sec / 60)}分</span></li>`).join('')}</ol>`;
  updateRunClock();
  wireStepBar($('#tab-session'));
  mountGuide($('#run-3d'), { items: planGuideItems(session.plan, ph.type === 'treat' ? ph.key : null, doneKeys), focus: ph.type === 'treat' }, { ratio: 0.9, maxH: 0.45 });
  wireZoom($('#tab-session'), 'rg', () => guide.b3);
  $('#run-pause').addEventListener('click', () => { run.paused = !run.paused; renderRun(); });
  $('#run-plus').addEventListener('click', () => { run.left += 60; ph.sec += 60; updateRunClock(); });
  $('#run-next').addEventListener('click', () => { stopSpeaking(); nextPhase(); });
  $('#run-stop').addEventListener('click', () => { stopSpeaking(); finishRun(); });
  wireMusicBar($('#tab-session'));
}

function compareHTML(items) {
  const after = session.after;
  return `<ul class="readout compare-list">${items.map((it) => {
    const b = it.finding;
    const f = after[it.id] || { heat: 0, kouketsu: 0, atsutsuu: 0 };
    const diff = LAYERS.map((l) => {
      const d = Math.round(((f[l.id] || 0) - (b[l.id] || 0)) * 10) / 10;
      if (!d) return '';
      return `<span class="diff ${d < 0 ? 'down' : 'up'}">${esc(l.name.split('・')[0])}${d < 0 ? '↓' : '↑'}</span>`;
    }).join('');
    return `<li><span class="no">${it.no}</span><span class="name">${esc(it.name)}</span>
      <div class="cmp"><span class="cmp-l">前</span>${shadeBars(b)}</div>
      <div class="cmp"><span class="cmp-l">後</span>${shadeBars(f)}</div>
      <div class="small">${diff || '<span class="muted">変化なし</span>'}</div></li>`;
  }).join('')}</ul>`;
}

// 施術後の図を、施術前の図の写しで始める（塗った時はそのまま、まだ図が無い時は何もしない）
function seedAfterPad(pad) {
  const before = session.pads.pb;
  if (!before) return;
  pad.before = before;
  pad.flat.copyFrom(before.flat);
  pad.seed = before.b3 || null;
  pad.region = before.region;
  pad.dim = before.dim;
  pad.how = 'paint';
  pad.finger = 'paint';
  pad.tool = 'lighten';
  pad.layer = 'heat';
  session.after = JSON.parse(JSON.stringify(session.findings || {}));
}

function renderDone() {
  const items = session.plan.items;
  const fresh = !session.pads.pa;
  const pad = getPad('pa');
  if (fresh) seedAfterPad(pad);
  $('#tab-session').innerHTML = `
    ${stepBar(4)}
    <div class="card">
      <h2>④ お疲れさまでした</h2>
      <p>施術した箇所をもう一度探査しましょう。<b>施術前に塗った図をそのまま持ってきています。</b>熱が冷めた所・固結がゆるんだ所は<b>「薄く」</b>、強くなった所は<b>「濃く」</b>でなぞって、変化を見つめます。</p>
      ${session.pads.pb ? '' : '<p class="small muted">施術前の図がないため、白い図から始めます。</p>'}
      ${painterHTML('pa')}
      ${session.pads.pb ? '<button type="button" class="ghost small-btn" id="pa-reset">施術前の図からやり直す</button>' : ''}
    </div>
    <div class="card">
      <h2>施術の前と後</h2>
      <div id="compare">${compareHTML(items)}</div>
    </div>
    <div class="card">
      <h2>記録する</h2>
      ${receiverHTML()}
      ${ratingHTML('after', '施術後のつらさ', session.ratingAfter)}
      <p class="small">施術前のつらさ：${session.ratingBefore}</p>
      <fieldset class="changes"><legend class="small">施術中・施術後に起きた変化</legend>
        ${db.raw.changes.patterns.map((c) => `<label><input type="checkbox" data-change="${esc(c.id)}" ${session.changes.includes(c.id) ? 'checked' : ''}> ${esc(c.trigger.split('（')[0])}</label>`).join('')}
      </fieldset>
      <label class="field-label small" for="rec-memo">メモ</label>
      <textarea id="rec-memo" rows="2" placeholder="気づいたこと（氏名は書かないでください）">${esc(session.memo)}</textarea>
      <div class="actions">
        <button type="button" class="primary" id="save-record">${session.savedId ? '記録を上書き保存' : '記録を保存'}</button>
        <button type="button" class="ghost" id="new-session">はじめから</button>
      </div>
      <p id="save-msg" class="small" hidden></p>
      <p class="small muted">施術後、溶けた毒素が胸や胃に降りる、反対側に痛みが出る（平均浄化）などの変化が起こることがあります。「用語」の施術後の変化も見てください。</p>
    </div>`;
  const root = $('#tab-session');
  wireStepBar(root);
  const afterChange = () => {
    session.after = padSample(pad);
    $('#compare').innerHTML = compareHTML(items);
  };
  wirePainter(root, 'pa', pad, afterChange);
  jumpToBody(root);
  $('#pa-reset', root)?.addEventListener('click', () => {
    if (!confirm('施術後に塗り直した所を消して、施術前の図に戻しますか？')) return;
    pad.flat.copyFrom(session.pads.pb.flat);
    if (pad.b3 && session.pads.pb.b3) pad.b3.copyFrom(session.pads.pb.b3);
    else if (pad.b3) pad.b3.clear();
    afterChange();
  });
  wireRecordInputs(root);
  $$('[data-change]', root).forEach((cb) => cb.addEventListener('change', () => {
    session.changes = $$('[data-change]:checked', root).map((x) => x.dataset.change);
  }));
  $('#rec-memo', root).addEventListener('input', (e) => { session.memo = e.target.value; });
  $('#save-record', root).addEventListener('click', () => {
    const msg = $('#save-msg', root);
    if (!session.receiver) { msg.textContent = '受け手コードを入れてください。'; msg.hidden = false; return; }
    const rec = buildRecord();
    const ok = session.savedId ? updateRecord(session.savedId, rec) : addRecord(rec);
    if (ok) session.savedId = rec.session_id;
    msg.innerHTML = ok ? '保存しました。<button type="button" class="ghost small-btn" id="go-records">記録を見る →</button>' : '保存できませんでした（この端末では保存が使えない設定のようです）。';
    msg.hidden = false;
    $('#save-record', root).textContent = '記録を上書き保存';
    $('#go-records', root)?.addEventListener('click', () => showTab('records'));
  });
  $('#new-session').addEventListener('click', () => {
    releasePads();
    Object.assign(session, { findings: {}, after: {}, plan: null, pads: {}, order: 'top', state: 'input', ratingBefore: 5, ratingAfter: 5, changes: [], memo: '', savedId: null });
    renderSession();
  });
}

const r1 = (v) => Math.round((v || 0) * 10) / 10;
function buildRecord() {
  const one = (v) => ({ heat: r1(v.heat), kouketsu: r1(v.kouketsu), atsutsuu: r1(v.atsutsuu) });
  const toList = (f) => Object.entries(f).map(([point_id, v]) => ({ point_id, ...one(v), ...(v.sides ? { sides: Object.fromEntries(Object.entries(v.sides).map(([k, x]) => [k, one(x)])) } : {}) }));
  const complaints = [];
  if (lastAnalysis?.input?.trim()) complaints.push(lastAnalysis.input.trim());
  for (const c of lastAnalysis?.categories || []) complaints.push(c.label);
  return {
    session_id: session.savedId || newId(),
    date: today(),
    receiver_code: session.receiver,
    complaints: [...new Set(complaints)],
    self_rating_before: { つらさ: session.ratingBefore },
    findings: toList(session.findings),
    treatments: session.plan.items.map((it, i) => ({ point_id: it.id, minutes: it.minutes, order: i + 1, ...(it.side ? { side: it.side } : {}), ...(it.split ? { split: it.split } : {}) })),
    findings_after: toList(session.after),
    self_rating_after: { つらさ: session.ratingAfter },
    changes_observed: session.changes.slice(),
    memo: session.memo,
    places: ask.pins.length || ask.zones.length ? [
      ...ask.pins.map((x) => ({ zone: x.zone, label: x.d.label, side: x.d.side, at: x.d.at })),
      ...ask.zones.filter((z) => !ask.pins.some((x) => x.zone === z)).map((z) => ({ zone: z, label: placeName(z) })),
    ] : undefined,
    follow_up: '',
    plan_minutes: { probe: session.plan.probe, check: session.plan.check },
  };
}

function renderSession() {
  releasePads();
  if (!(session.state === 'plan' || session.state === 'run')) releaseGuide();
  if (session.state === 'plan' && session.plan) return renderSessionPlan();
  if (session.state === 'run' && session.run) { renderRun(); jumpToBody($('#tab-session'), '.run-card'); return; }
  if (session.state === 'done' && session.plan) return renderDone();
  return renderSessionInput();
}

// ---- 音楽 ----
function trackNames() {
  return Object.fromEntries(userFiles.map((f) => [f.id, f.name]));
}
function playlist() {
  const valid = new Set([...TRACKS.map((t) => t.id), ...userFiles.map((f) => f.id)]);
  return settings.tracks.filter((id) => valid.has(id));
}
function startMusic() {
  const list = playlist();
  if (!list.length) return;
  player.minutes = settings.switchMin;
  player.setList(list, trackNames());
  player.titleMode = false;
  player.play(0);
}
function musicBarHTML() {
  return `<div class="card music-bar">
    <button type="button" class="mb-play" aria-label="${player.playing ? '音楽を止める' : '音楽を流す'}">${player.playing ? '⏸' : '▶'}</button>
    <div class="mb-name">♪ ${esc(player.playing ? player.currentName : '音楽は止まっています')}</div>
    <button type="button" class="mb-next" aria-label="次の曲">⏭</button>
    <input type="range" class="mb-vol" min="0" max="1" step="0.05" value="${settings.volume}" aria-label="音量">
  </div>`;
}
function wireMusicBar(root) {
  $('.mb-play', root)?.addEventListener('click', () => { if (player.playing) player.stop(); else startMusic(); });
  $('.mb-next', root)?.addEventListener('click', () => { if (player.playing) player.next(); else startMusic(); });
  $('.mb-vol', root)?.addEventListener('input', (e) => { settings.volume = Number(e.target.value); setVolume(settings.volume); saveSettings(); });
}
player.onChange = () => {
  $$('.music-bar').forEach((bar) => {
    $('.mb-play', bar).textContent = player.playing ? '⏸' : '▶';
    $('.mb-name', bar).textContent = `♪ ${player.playing ? player.currentName : '音楽は止まっています'}`;
  });
  const mb = $('#music-btn');
  if (mb) mb.classList.toggle('on', player.playing);
};

// ---- 音楽と音声の設定 ----
async function renderSettings() {
  userFiles = await listFiles();
  const all = [...TRACKS.map((t) => ({ ...t, gen: true })), ...userFiles];
  const order = (id) => { const i = settings.tracks.indexOf(id); return i < 0 ? '' : i + 1; };
  $('#tab-settings').innerHTML = `
    ${lookSettingsHTML()}
    ${musicBarHTML()}
    <div class="card">
      <h2>施術中の音楽</h2>
      <p class="small muted">複数選べます。選んだ順に流れ、最後まで行けば最初に戻ります。</p>
      <ul class="track-list">${all.map((t) => `<li>
        <label><input type="checkbox" data-track="${esc(t.id)}" ${settings.tracks.includes(t.id) ? 'checked' : ''}><span class="t-order">${order(t.id)}</span>${esc(t.name)}${t.gen ? '' : ' <span class="small muted">（ファイル）</span>'}</label>
        <span class="t-actions"><button type="button" class="mini" data-try="${esc(t.id)}">試聴</button>${t.gen ? '' : `<button type="button" class="mini" data-del="${esc(t.id)}" aria-label="削除">×</button>`}</span>
      </li>`).join('')}</ul>
      <label class="file-add">＋ 手持ちの音楽ファイルを追加<input type="file" id="file-input" accept="audio/*" multiple hidden></label>
      <p class="small muted">ファイルはこの端末の中にだけ保存されます。</p>
      <label class="row">生成音楽の切り替え
        <select id="switch-min">${[3, 5, 10, 15].map((m) => `<option value="${m}" ${settings.switchMin === m ? 'selected' : ''}>${m}分ごと</option>`).join('')}</select>
      </label>
    </div>
    <div class="card">
      <h2>タイトル画面の音楽</h2>
      <label class="row"><input type="checkbox" id="title-on" ${settings.titleMusic ? 'checked' : ''}> タイトル画面で音楽を流す</label>
      <label class="row">曲
        <select id="title-track">${all.map((t) => `<option value="${esc(t.id)}" ${settings.titleTrack === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="card">
      <h2>音声アドバイス</h2>
      ${canSpeak() ? '' : '<p class="small warn-text">この端末のブラウザは音声読み上げに対応していません。</p>'}
      <label class="row"><input type="checkbox" id="voice-on" ${settings.voice ? 'checked' : ''}> 施術の切り替わりで声でお知らせ</label>
      <label class="row"><input type="checkbox" id="chime-on" ${settings.chime ? 'checked' : ''}> 切り替わりで鐘を鳴らす</label>
      <button type="button" class="ghost" id="voice-try">試しに聞く</button>
      <p class="small muted">お知らせは、各箇所のはじめ（箇所の名前と分数、「力を抜いて」）、施術中の5分ごと（5分に満たない箇所はその箇所の終わりに「固結の変化、熱の変化など、もう一度確認してみましょう」）、最後の確認の時です。施術は話しながら行わないため、お知らせは短くしています。</p>
    </div>`;
  wireMusicBar($('#tab-settings'));
  wireLookSettings($('#tab-settings'));
  $$('input[data-track]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.track;
    settings.tracks = settings.tracks.filter((x) => x !== id);
    if (cb.checked) settings.tracks.push(id);
    saveSettings();
    renderSettings();
  }));
  $$('[data-try]').forEach((b) => b.addEventListener('click', () => {
    player.minutes = settings.switchMin;
    player.setList([b.dataset.try], trackNames());
    player.titleMode = false;
    player.play(0);
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await removeFile(b.dataset.del);
    settings.tracks = settings.tracks.filter((x) => x !== b.dataset.del);
    saveSettings();
    renderSettings();
  }));
  $('#file-input').addEventListener('change', async (e) => {
    const added = await addFiles([...e.target.files]);
    settings.tracks.push(...added.map((a) => a.id));
    if (added.some((a) => a.temp)) userFiles.push(...added);
    saveSettings();
    renderSettings();
  });
  $('#switch-min').addEventListener('change', (e) => { settings.switchMin = Number(e.target.value); player.minutes = settings.switchMin; saveSettings(); });
  $('#title-on').addEventListener('change', (e) => { settings.titleMusic = e.target.checked; saveSettings(); });
  $('#title-track').addEventListener('change', (e) => { settings.titleTrack = e.target.value; saveSettings(); });
  $('#voice-on').addEventListener('change', (e) => { settings.voice = e.target.checked; saveSettings(); });
  $('#chime-on').addEventListener('change', (e) => { settings.chime = e.target.checked; saveSettings(); });
  $('#voice-try').addEventListener('click', () => {
    unlockAudio();
    if (settings.chime) chime();
    setTimeout(() => speak(CHECK_VOICE), settings.chime ? 1000 : 0);
  });
}

// ---- 施術の記録（見える化） ----
let recFilter = 'all';

// つらさの前→後（1色の濃淡で、前＝淡い点・後＝濃い点を線で結ぶ）
function dumbbellSVG(list) {
  const rows = list.filter((r) => Number.isFinite(r.self_rating_before?.つらさ) && Number.isFinite(r.self_rating_after?.つらさ)).slice(-20);
  if (!rows.length) return '<p class="small muted">つらさの記録がまだありません。</p>';
  const W = 360, H = 190, L = 28, R = 10, T = 10, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const x = (i) => L + (rows.length === 1 ? iw / 2 : (i * iw) / (rows.length - 1));
  const y = (v) => T + ih - (v / 10) * ih;
  const step = Math.ceil(rows.length / 5);
  const grid = [0, 5, 10].map((v) => `<line class="viz-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-axis" x="${L - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`).join('');
  const marks = rows.map((r, i) => {
    const b = r.self_rating_before.つらさ;
    const a = r.self_rating_after.つらさ;
    const cx = x(i);
    const tip = `${r.date}　${r.receiver_code}　つらさ ${b} → ${a}`;
    const label = i % step === 0 || i === rows.length - 1 ? `<text class="viz-axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(r.date.slice(5).replace('-', '/'))}</text>` : '';
    return `<g class="viz-col" data-tip="${esc(tip)}" tabindex="0">
      <rect class="viz-hit" x="${cx - Math.max(8, iw / rows.length / 2)}" y="${T}" width="${Math.max(16, iw / rows.length)}" height="${ih}"/>
      <line class="viz-link" x1="${cx}" x2="${cx}" y1="${y(b)}" y2="${y(a)}"/>
      <circle class="viz-before" cx="${cx}" cy="${y(b)}" r="4.5"/>
      <circle class="viz-after" cx="${cx}" cy="${y(a)}" r="4.5"/>${label}</g>`;
  }).join('');
  return `<div class="viz-legend small"><span><i class="lg-before"></i>施術前</span><span><i class="lg-after"></i>施術後</span></div>
    <svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="つらさの施術前と施術後（直近${rows.length}回）">${grid}${marks}</svg>`;
}

function minutesBarsHTML(minutes) {
  const rows = Object.entries(minutes).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!rows.length) return '<p class="small muted">施術の記録がまだありません。</p>';
  const max = rows[0][1];
  return `<ul class="viz-bars">${rows.map(([id, m]) => {
    const p = db.pointById[id];
    return `<li data-tip="${esc(`${p?.name || id}　合計${m}分`)}" tabindex="0"><span class="vb-name">${p ? `${p.no} ${esc(p.name)}` : esc(id)}</span>
      <span class="vb-track"><i style="width:${Math.max(2, (m / max) * 100)}%"></i></span><span class="vb-val">${m}分</span></li>`;
  }).join('')}</ul>`;
}

function changeTableHTML(change) {
  const rows = Object.entries(change).sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  if (!rows.length) return '<p class="small muted">施術の前後を塗った記録がまだありません。</p>';
  const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
  return `<table class="routes rec-table"><tr><td>箇所</td><td>回</td><td>熱 前→後</td><td>固結 前→後</td></tr>${rows.map(([id, c]) => {
    const p = db.pointById[id];
    const hb = c.heatB / c.n, ha = c.heatA / c.n, kb = c.kouB / c.n, ka = c.kouA / c.n;
    return `<tr><td>${p ? `${p.no} ${esc(p.name)}` : esc(id)}</td><td>${c.n}</td><td>${f(hb)}→${f(ha)}${ha < hb ? ' <b class="down">↓</b>' : ''}</td><td>${f(kb)}→${f(ka)}${ka < kb ? ' <b class="down">↓</b>' : ''}</td></tr>`;
  }).join('')}</table><p class="small muted">値は塗りの濃さ（0〜5）の平均です。</p>`;
}

function recordItemHTML(r) {
  const name = (id) => db.pointById[id]?.name || id;
  const minutes = (r.treatments || []).reduce((s, t) => s + (t.minutes || 0), 0);
  const fb = Object.fromEntries((r.findings || []).map((x) => [x.point_id, x]));
  const fa = Object.fromEntries((r.findings_after || []).map((x) => [x.point_id, x]));
  const changes = (r.changes_observed || []).map((id) => db.raw.changes.patterns.find((c) => c.id === id)?.trigger.split('（')[0] || id);
  return `<details class="rec-item">
    <summary><span class="rec-date">${esc(r.date)}</span> <span class="tag">${esc(r.receiver_code)}</span>
      <span class="small muted">${minutes}分・つらさ ${r.self_rating_before?.つらさ ?? '−'}→${r.self_rating_after?.つらさ ?? '−'}</span></summary>
    ${(r.complaints || []).length ? `<p class="small">症状：${r.complaints.map(esc).join('、')}</p>` : ''}
    ${(r.places || []).length ? `<p class="small">つらい場所：${r.places.map((x) => esc(x.label)).join('、')}</p>` : ''}
    <ul class="readout compare-list">${(r.treatments || []).map((t) => `<li><span class="no">${db.pointById[t.point_id]?.no ?? ''}</span><span class="name">${esc(name(t.point_id))}　${t.minutes}分</span>
      <div class="cmp"><span class="cmp-l">前</span>${shadeBars(fb[t.point_id])}</div>
      <div class="cmp"><span class="cmp-l">後</span>${shadeBars(fa[t.point_id])}</div></li>`).join('')}</ul>
    ${changes.length ? `<p class="small">変化：${changes.map(esc).join('、')}</p>` : ''}
    ${r.memo ? `<p class="small">メモ：${esc(r.memo)}</p>` : ''}
    <label class="field-label small">翌日以降の変化（排泄・平均浄化・再浄化など）</label>
    <textarea rows="2" data-follow="${esc(r.session_id)}">${esc(r.follow_up || '')}</textarea>
    <div class="actions"><button type="button" class="ghost small-btn" data-follow-save="${esc(r.session_id)}">保存</button>
      <button type="button" class="ghost small-btn" data-del="${esc(r.session_id)}">この記録を消す</button></div>
  </details>`;
}

function renderRecordsTab() {
  const all = loadRecords().sort((a, b) => (a.date + a.session_id).localeCompare(b.date + b.session_id));
  const codes = [...new Set(all.map((r) => r.receiver_code))].sort();
  if (recFilter !== 'all' && !codes.includes(recFilter)) recFilter = 'all';
  const list = recFilter === 'all' ? all : all.filter((r) => r.receiver_code === recFilter);
  const sum = summarize(list);
  $('#tab-records').innerHTML = `
    <div class="card">
      <h2>施術の記録</h2>
      <div class="filter-row" role="group" aria-label="受け手">
        <button type="button" class="chip rec-filter" data-code="all" aria-pressed="${recFilter === 'all'}">すべて</button>
        ${codes.map((c) => `<button type="button" class="chip rec-filter" data-code="${esc(c)}" aria-pressed="${recFilter === c}">${esc(c)}</button>`).join('')}
      </div>
      <div class="stats">
        <div class="stat"><b>${sum.count}</b><span>記録</span></div>
        <div class="stat"><b>${sum.total}</b><span>施術の合計（分）</span></div>
        <div class="stat"><b>${sum.avgDelta === null ? '−' : (sum.avgDelta > 0 ? '+' : '') + (Math.round(sum.avgDelta * 10) / 10)}</b><span>つらさの変化（平均）</span></div>
      </div>
    </div>
    <div class="card"><h2>つらさの前と後</h2>${dumbbellSVG(list)}</div>
    <div class="card"><h2>箇所ごとの施術時間</h2>${minutesBarsHTML(sum.minutes)}</div>
    <div class="card"><h2>箇所ごとの変化</h2>${changeTableHTML(sum.change)}</div>
    <div class="card"><h2>記録の一覧</h2>
      ${list.length ? list.slice().reverse().map(recordItemHTML).join('') : '<p class="small muted">まだ記録がありません。施術の終わりに「記録を保存」で残せます。</p>'}
    </div>
    <div class="card"><h2>書き出し・読み込み</h2>
      <div class="actions">
        <button type="button" class="ghost" id="exp-json">JSONで書き出す</button>
        <button type="button" class="ghost" id="exp-csv">CSVで書き出す</button>
      </div>
      <label class="file-add">JSONを読み込む<input type="file" id="imp-json" accept="application/json,.json" hidden></label>
      <p id="imp-msg" class="small" hidden></p>
      <p class="small muted">記録はこの端末の中にだけ保存されています。機種変更やブラウザのデータ消去に備えて、ときどき書き出しておいてください。</p>
    </div>
    <div class="viz-tip" id="viz-tip" hidden></div>`;
  const root = $('#tab-records');
  $$('.rec-filter', root).forEach((b) => b.addEventListener('click', () => { recFilter = b.dataset.code; renderRecordsTab(); }));
  $$('[data-follow-save]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.followSave;
    updateRecord(id, { follow_up: $(`[data-follow="${CSS.escape(id)}"]`, root).value });
    b.textContent = '保存しました';
  }));
  $$('[data-del]', root).forEach((b) => b.addEventListener('click', () => {
    if (!confirm('この記録を消します。元に戻せません。よろしいですか？')) return;
    deleteRecord(b.dataset.del);
    renderRecordsTab();
  }));
  const stamp = today();
  $('#exp-json', root).addEventListener('click', () => download(`浄化療法記録_${stamp}.json`, exportJSON(loadRecords()), 'application/json'));
  $('#exp-csv', root).addEventListener('click', () => download(`浄化療法記録_${stamp}.csv`, exportCSV(loadRecords(), (id) => db.pointById[id]?.name || id), 'text/csv'));
  $('#imp-json', root).addEventListener('change', async (e) => {
    const m = $('#imp-msg', root);
    try {
      const n = importRecords(JSON.parse(await e.target.files[0].text()));
      renderRecordsTab();
      const m2 = $('#imp-msg');
      m2.textContent = `${n}件の記録を読み込みました。`;
      m2.hidden = false;
    } catch {
      m.textContent = '読み込めませんでした。このアプリで書き出したJSONか確かめてください。';
      m.hidden = false;
    }
  });
  wireTips(root);
}

// グラフの値を、触れた所・指した所に出す
function wireTips(root) {
  const tip = $('#viz-tip', root);
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    tip.style.top = `${y - tip.offsetHeight - 12}px`;
  };
  $$('[data-tip]', root).forEach((el) => {
    el.addEventListener('pointerenter', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', () => { tip.hidden = true; });
  });
}

// ---- 探査19か所 ----
function pointInfo(id) {
  const p = db.pointById[id];
  if (!p) return '<p class="muted small">人体図の番号をタップすると説明が出ます。</p>';
  const region = db.raw.points.regions.find((g) => g.id === p.region);
  return `<p><span class="no">${p.no}</span> <strong>${esc(p.name)}</strong> <span class="muted small">${esc(region.name)}${p.selfProbe ? '・自己探査' : ''}</span></p>
    ${p.note ? `<p class="small">${esc(p.note)}</p>` : ''}
    ${region.caution ? `<div class="caution">${esc(region.caution)}</div>` : ''}`;
}
function renderPointsTab(selected = null) {
  const regions = db.raw.points.regions;
  $('#tab-points').innerHTML = `
    <div class="card">
      <h2>基本的な探査箇所と探査の順序</h2>
      <p class="small muted">頭部4か所、頸部6か所、肩2か所、背部4か所、腎臓部3か所。※20〜25は骨盤まわりの自己探査（排泄の出口。本人に確かめてもらう）。</p>
      ${chartSVG({ showAll: true, includeSelf: true, selected })}
      <div class="point-info">${pointInfo(selected)}</div>
    </div>
    ${regions.map((g) => `<div class="card">
      <h2>${esc(g.name)}<span class="muted small">（${g.count}か所${g.self_probe ? '・自己探査' : ''}）</span></h2>
      ${g.caution ? `<div class="caution">${esc(g.caution)}</div>` : ''}
      <ul class="point-list">${g.points.map((p) => `<li>
        <span class="no ${g.self_probe ? 'dim' : ''}">${p.no}</span>
        <div><span class="name">${esc(p.name)}</span>${p.note ? `<div class="detail">${esc(p.note)}</div>` : ''}</div>
      </li>`).join('')}</ul>
      ${g.note ? `<p class="small muted">${esc(g.note)}</p>` : ''}
      <p class="cite">3級テキスト ${esc(g.textbook)}</p>
    </div>`).join('')}
    <p class="cite">出典：${esc(db.raw.points.source)}</p>`;
  $('#tab-points .chart svg').addEventListener('click', (e) => {
    const g = e.target.closest('.pt');
    if (g) renderPointsTab(g.dataset.id);
  });
}

// ---- 見解（症状から調べる） ----
function renderKenkaiTab() {
  const groups = db.raw.kenkai.groups;
  $('#tab-kenkai').innerHTML = `
    <div class="card">
      <h2>症状・病気から岡田先生の見解を調べる</h2>
      ${noticeHTML()}
      <form id="kk-form" class="kk-form" autocomplete="off">
        <input id="kk-q" type="search" placeholder="例：かゆみ、肩こり、糖尿病" aria-label="症状・病名">
        <button type="submit" class="primary">調べる</button>
      </form>
      <p class="small muted">症状（例：背中が張る、手足が冷える）でも、病名（例：糖尿病、喘息）でも調べられます。病名の付いた病気は、必ず医療機関で診断・治療を受けてください。</p>
    </div>
    <div id="kk-result" aria-live="polite"></div>
    <div class="card">
      <h2>症状・病気の一覧</h2>
      ${groups.map((g) => `<h3>${esc(g)}</h3>${db.kenkai.filter((e) => e.group === g).map((e) => kenkaiItemHTML(e, { open: false, link: true })).join('')}`).join('')}
    </div>`;
  wireKenkaiLinks($('#tab-kenkai'));
  $('#kk-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#kk-q').value.trim();
    const box = $('#kk-result');
    if (!q) { box.innerHTML = ''; return; }
    const r = analyze(db, q);
    const nq = normalize(q);
    const hits = r.urgent ? [] : r.kenkai.slice();
    // 見出し（症状名）からも引く
    for (const e of db.kenkai) if (!hits.some((h) => h.id === e.id) && !r.urgent && nq.length >= 2 && normalize(e.label).includes(nq)) hits.push(e);
    // 病名の見解を出す時は、受診の注意を見解の欄にまとめる（重ねて出さない）
    const dup = hits.some((e) => e.disease);
    const banners = r.safety.filter((x) => !(dup && x.id === 'disease')).map((x) => `<div class="banner ${x.level === 'urgent' ? 'urgent' : 'notice'}">${esc(x.message)}</div>`).join('');
    const blocked = r.urgent || r.spiritual.length > 0;
    let body = '';
    if (hits.length) {
      body = hits.map((e) => kenkaiItemHTML(e, { link: true })).join('');
    } else if (!blocked) {
      const words = [...new Set([q, ...r.categories.flatMap((c) => c.words)])];
      body = `<p>「${esc(q)}」について、岡田先生のまとまった見解は見当たりませんでした。</p>
        ${r.categories.length ? `<p class="small">症状の流れでは「${r.categories.map((c) => esc(c.label)).join('」「')}」に当たります。<button type="button" class="ghost small-btn" id="kk-go-today">探査する箇所を見る →</button></p>` : '<p class="small">言い方を変えて（例：「頭が重い」「足がだるい」）調べてみてください。</p>'}
        ${termRefsHTML(words)}`;
    }
    box.innerHTML = `${banners}${spiritualHTML(r.spiritual)}${body ? `<div class="card kenkai-card">${hits.some((e) => e.disease) ? noticeHTML(true) : ''}${body}</div>` : ''}`;
    wireKenkaiLinks(box);
    $('#kk-go-today', box)?.addEventListener('click', () => {
      showTab('today');
      $('#symptom-text').value = q;
      resetAsk();
      store.set(STORE_INPUT, q);
      renderResult(analyze(db, q));
    });
  });
}

// ---- 学ぶ：流れと用語 ----
function renderLearnTab() {
  const { concepts } = db.raw.concepts;
  const { patterns } = db.raw.changes;
  const { routes, intro, source } = db.raw.routes;
  $('#learn-flows').innerHTML = `
    <div class="card">
      <h2>用語</h2>
      <dl class="terms">${concepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.definition)}<div class="cite">${esc(c.source)}</div></dd>`).join('')}</dl>
    </div>
    <div class="card">
      <h2>施術中・施術後に起こりうる変化</h2>
      <dl class="terms">${patterns.map((p) => `<dt>${esc(p.trigger)}</dt><dd>${esc(p.meaning)}${citesHTML(p)}${zenshuDetails(p.zenshu_candidates)}</dd>`).join('')}</dl>
    </div>
    <div class="card">
      <h2>3級テキストにある毒素の流れ</h2>
      ${db.raw.flows.flows.map((f) => `<div class="flow-block"><div class="flow-title">${esc(f.stage)}</div><div class="small">${f.route.map(esc).join(' → ') || '—'}</div><p class="basis">${esc(f.basis)}</p><div class="cite">3級テキスト ${esc(f.textbook)}${f.t2 ? `／2級テキスト実践編 ${esc(f.t2)}` : ''}</div></div>`).join('')}
    </div>
    <div class="card">
      <h2>具体的な毒素の移動経路（早見表）</h2>
      <p class="small">${esc(intro)}</p>
      <table class="routes">${routes.map((r) => `<tr><td>${r.no}</td><td>${esc(r.text)}${r.note ? `<div class="small muted">※${esc(r.note)}</div>` : ''}</td></tr>`).join('')}</table>
      <p class="small muted">各経路は、既存のテキストに基づく試験的な分類であり、必ずしも浄化療法の病理の全体像を反映するものではありません。</p>
      <p class="cite">${esc(source)}</p>
    </div>`;
  wireZenshu($('#learn-flows'));
  renderKnowledge();
  renderPractice();
  renderGuide();
}

// ---- 学ぶ：論文を読む ----
// 判断の根拠にしている岡田先生の論述・講話の本文（data/ronbun.json。tools/build_ronbun.py で作る）。
// 精神面・宗教面の部分を外して意味が通るように整え、「浄霊」は「浄化療法」に改めている。出典は年月で示す
let ronbunList = null;
async function loadRonbun() {
  if (!ronbunList) ronbunList = (await (await fetch('data/ronbun.json')).json()).articles;
  return ronbunList;
}
const RONBUN_NOTE = 'このアプリの判断の根拠にしている、岡田先生の論述・講話（昭和10〜28年）です。精神面・宗教面の部分は外して意味が通るように整え、施術の呼び名は「浄化療法」にそろえています。言い回しや病名は当時のままです。薬・手術・病気の見方についての記述は当時の考えで、現在の医療の判断とは異なります。病気やけがの時は医療機関にかかり、服薬や治療は自己判断でやめないでください。';
const ronbunState = { q: '', kind: 'all', open: null };
function ronbunParaHTML(p) {
  const note = (t) => esc(t).replace(/〔注：(.*?)〕/g, '<span class="med-note">注：$1</span>');
  if (p.startsWith('問：')) return `<p class="qa-q"><b>問</b>${note(p.slice(2))}</p>`;
  if (p.startsWith('岡田先生：')) return `<p class="qa-a"><b>岡田先生</b>${note(p.slice(5))}</p>`;
  return `<p>${note(p)}</p>`;
}
// その論述を根拠にしている知見・見解
function ronbunUsedBy(id) {
  const has = (x) => (x.cites || []).some((c) => c.id === id);
  return [
    ...db.knowledge.principles.filter(has).map((x) => x.title),
    ...db.knowledge.kakuron.filter(has).map((x) => x.title),
    ...db.kenkai.filter(has).map((x) => `${x.label}（岡田先生の見解）`),
  ];
}
async function renderRonbun() {
  const box = $('#learn-ronbun');
  if (!box) return;
  let list;
  try { list = await loadRonbun(); } catch { box.innerHTML = '<div class="card"><p>論文を読み込めませんでした。電波のある所で、もう一度開いてください。</p></div>'; return; }
  const st = ronbunState;
  if (st.open) {
    const a = list.find((x) => x.id === st.open);
    if (!a) { st.open = null; return renderRonbun(); }
    const used = ronbunUsedBy(a.id);
    box.innerHTML = `
      <div class="card rb-reader">
        <button type="button" class="ghost small-btn" id="rb-back">← 論文の一覧へ</button>
        <h2 class="rb-title">${esc(a.title)}</h2>
        <p class="cite">岡田先生 ${esc(dateText(a))}${a.kind === 'kowa' ? '（講話）' : ''}${a.excerpt ? ' <span class="tag">抜粋</span>' : ''}</p>
        <div class="banner notice small">${esc(RONBUN_NOTE)}</div>
        <div class="rb-body">${a.paras.map(ronbunParaHTML).join('')}</div>
        ${used.length ? `<div class="rb-used"><div class="small"><b>この論述を根拠にしているもの</b></div><ul class="small">${used.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        <button type="button" class="ghost wide" id="rb-back2">← 論文の一覧へ</button>
      </div>`;
    const back = () => { st.open = null; renderRonbun(); };
    $('#rb-back', box).addEventListener('click', back);
    $('#rb-back2', box).addEventListener('click', back);
    jumpToBody($('#tab-learn'), '#learn-ronbun');
    return;
  }
  const nq = normalize(st.q.trim());
  const hits = list.filter((a) => (st.kind === 'all' || a.kind === st.kind) && (!nq || normalize(`${a.title}${a.paras.join('')}`).includes(nq)));
  const byYear = new Map();
  for (const a of hits) {
    const y = Number(String(a.date || '').slice(0, 4));
    const key = y ? eraOf(y) : '年代不詳';
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(a);
  }
  box.innerHTML = `
    <div class="card">
      <h2>岡田先生の論文を読む</h2>
      <p class="small">${esc(RONBUN_NOTE)}</p>
      <form class="kk-form" id="rb-form" role="search"><input id="rb-q" type="search" value="${esc(st.q)}" placeholder="例：肩、腎臓、力を抜く" aria-label="論文を言葉で探す"><button type="submit" class="primary">探す</button></form>
      <div class="region-chips" role="group" aria-label="種類">${[['all', 'すべて'], ['chojutsu', '著述'], ['kowa', '講話']].map(([k, n]) => `<button type="button" class="chip" data-rb-kind="${k}" aria-pressed="${st.kind === k}">${n}</button>`).join('')}</div>
      <p class="small muted">${hits.length}件${st.q ? `（「${esc(st.q)}」で探した結果）` : ''}</p>
    </div>
    ${[...byYear].map(([y, as]) => `<div class="card"><h2>${esc(y)}</h2><ul class="rb-list">${as.map((a) => `<li><button type="button" class="rb-item" data-rb-open="${esc(a.id)}"><span class="rb-t">${esc(a.title)}</span><span class="small muted">${esc(dateText(a))}${a.kind === 'kowa' ? '・講話' : ''}${a.excerpt ? '・抜粋' : ''}</span><span class="small rb-snip">${esc(a.paras[0].slice(0, 46))}…</span></button></li>`).join('')}</ul></div>`).join('')}
    ${!hits.length ? '<div class="card"><p>見つかりませんでした。別の言葉で探してみてください。</p></div>' : ''}`;
  $('#rb-form', box).addEventListener('submit', (e) => { e.preventDefault(); st.q = $('#rb-q', box).value; renderRonbun(); });
  $$('[data-rb-kind]', box).forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.rbKind; renderRonbun(); }));
  $$('[data-rb-open]', box).forEach((b) => b.addEventListener('click', () => { st.open = b.dataset.rbOpen; renderRonbun(); }));
}
// どの画面からでも、出典の「本文を読む」で論文を開く
function openRonbun(id) {
  ronbunState.open = id;
  showTab('learn');
  showLearn('ronbun');
}

// ---- 学ぶ：岡田先生の知見（言葉で絞り込める） ----
function renderKnowledge(q = '') {
  const k = db.knowledge;
  const nq = normalize(q.trim());
  const hit = (x) => !nq || normalize(`${x.title}${x.summary}`).includes(nq);
  const els = ['重要施術部位', '楽屋と舞台', '毒素集溜と排泄の順序', '探査', '施術'];
  const ps = k.principles.filter(hit);
  const ks = k.kakuron.filter(hit);
  $('#learn-knowledge').innerHTML = `
    <div class="card">
      <h2>岡田先生の論述から読み取った施術の知見</h2>
      <p class="small muted">岡田先生の論述の中身を、3級テキストの言葉で書き直しています。出典は年月で示します。</p>
      <form class="kk-form" id="kn-form" role="search"><input id="kn-q" type="search" value="${esc(q)}" placeholder="例：熱、肩、力を抜く" aria-label="知見を言葉で探す"><button type="submit" class="primary">探す</button></form>
    </div>
    ${els.map((el) => {
      const items = ps.filter((p) => p.element === el);
      return items.length ? `<div class="card"><h2>${esc(el)}</h2>${items.map((p) => principleCard(p.id)).join('')}</div>` : '';
    }).join('')}
    ${ks.length ? `<div class="card"><h2>各論（症状について説かれたこと）</h2>
      ${ks.map((x) => `<div class="k-item"><div class="k-title">${esc(x.title)}</div><p>${esc(x.summary)}</p><div class="small">見る箇所：${x.points.map((id) => esc(db.pointById[id]?.name)).join('、')}</div>${citesHTML(x)}</div>`).join('')}</div>` : ''}
    ${!ps.length && !ks.length ? '<div class="card"><p>見つかりませんでした。別の言葉で探してみてください。</p></div>' : ''}`;
  $('#kn-form').addEventListener('submit', (e) => { e.preventDefault(); renderKnowledge($('#kn-q').value); });
}

// ---- 学ぶ：実践の心得（岡田式浄化療法の実際） ----
function practiceHTML() {
  const pr = db.knowledge.practice;
  if (!pr) return '';
  const ref = (r) => `<div class="cite">根拠：岡田式浄化療法の実際 ${esc(r)}</div>`;
  return `
    <div class="card">
      <h2>安心・信頼・礼儀</h2>
      <p class="small">岡田式浄化療法は医療行為ではありません。だからこそ、言葉・態度・説明が大切です。技術の前に、信頼される姿勢を。</p>
      <div class="pillars">${pr.pillars.map((x) => `<div class="pillar"><b>${esc(x.name)}</b><span>${esc(x.text)}</span></div>`).join('')}</div>
      ${ref('p135-141')}
    </div>
    <div class="card">
      <h2>施術の前に行うこと</h2>
      <ol class="steps">${pr.before.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${ref(pr.before_ref)}
    </div>
    <div class="card">
      <h2>避けること</h2>
      <ul class="avoid">${pr.avoid.map((x) => `<li><b>${esc(x.name)}</b>${esc(x.text)}</li>`).join('')}</ul>
      ${ref(pr.avoid_ref)}
    </div>
    <div class="card">
      <h2>探査と医療の立て分け</h2>
      <table class="routes distinction"><tr><td></td><td>探査</td><td>医療</td></tr>${pr.distinction.rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>
      <p class="small muted">立て分けがあるからこそ、それぞれが活きます。</p>
      ${ref(pr.distinction.ref)}
    </div>
    <div class="card">
      <h2>安心していただける言葉の例</h2>
      <ul class="words">${pr.words.map((x) => `<li>「${esc(x)}」</li>`).join('')}</ul>
      ${ref('p135-141')}
    </div>
    <div class="card">
      <h2>身近な一人を、ていねいに</h2>
      <ol class="steps">${pr.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${principleCard('keiken')}
      ${ref(pr.steps_ref)}
    </div>`;
}
function renderPractice() {
  $('#learn-practice').innerHTML = practiceHTML();
}

// ---- 学ぶ：使い方 ----
function renderGuide() {
  const step = (n, title, body) => `<li class="guide-step"><span class="g-no">${n}</span><div><b>${title}</b><p>${body}</p></div></li>`;
  $('#learn-guide').innerHTML = `
    <div class="card">
      <h2>このアプリの使い方</h2>
      <ol class="guide">
        ${step(1, 'つらい所を選ぶ', '下の「症状」を押し、つらい場所と、痛い・重いなどの感じを選びます。からだの図を指でさして選ぶこともできます。言葉で書いても大丈夫です。')}
        ${step(2, '探査する箇所を見る', '見つめる箇所（番号）と毒素の流れ（矢印）、岡田先生の見解が出ます。「読み上げ」で声で聞けます。')}
        ${step(3, '探査の結果を塗る', '「施術」で、熱は赤、固結・張りは青、圧痛は紫で、からだの図に塗ります。重ねて塗るほど濃くなります。')}
        ${step(4, '時間配分とタイマー', '塗った結果から、施術の順番と時間をお示しします。タイマーと音楽、声のお知らせで施術を進めます。')}
        ${step(5, '施術の後に塗り直して記録', 'もう一度探査して塗ると、前と後の変化がわかります。記録は「記録」でいつでも見られます。')}
      </ol>
    </div>
    <div class="card">
      <h2>見やすくするには</h2>
      <ul class="tips">
        <li>上の「あ 文字」を押すと、文字が大きくなります（3段階）。</li>
        <li>「設定」で、かんたん表示とくわしい表示を切り替えられます。くわしい表示では、根拠や説明がはじめから開いて出ます。</li>
        <li>スマートフォンの「ホーム画面に追加」で、アプリのように使えます。一度開けば、電波の届かない所でも使えます。</li>
      </ul>
    </div>
    <div class="card">
      <h2>からだの図の動かし方</h2>
      <ul class="tips">
        <li>1本指でなぞる：なぞった向きに体が回る（横＝左右、下へなぞる＝上から見えて頭頂部が見える、上へなぞる＝下から見える）</li>
        <li>「なぞって塗る」の時は、図の上の「✋回す」を押すと1本指で回せます（体の外から指でなぞっても回ります）。塗る時は「✎塗る」に戻します</li>
        <li>右端の ▲ ▼：体に沿って上下（頭の方・足の方）に動く</li>
        <li>右下の ＋ －（大きさ）⟲ ⟳（回す）上から・下から（見る高さ）⌂（元の向き）ボタンでも動かせます。向きの「頭頂」を押すと、頭のてっぺんが見えます</li>
        <li>2本指で広げる・つまむ：大きく・小さく（使わなくても、ボタンだけで動かせます）</li>
      </ul>
    </div>
    <div class="card">
      <h2>大切なこと</h2>
      <p>${esc(db.raw.kenkai.notice)}</p>
      <p>${esc(db.raw.safety.always)}</p>
      <p class="small muted">記録や入力は、この端末の中にだけ保存されます。外へ送られることはありません。</p>
    </div>`;
}

function showLearn(sub) {
  $$('#tab-learn .seg button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.learn === sub));
    if (b.dataset.learn === sub) b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  $$('#tab-learn .learn-panel').forEach((el) => { el.hidden = el.id !== (sub === 'points' ? 'tab-points' : sub === 'kenkai' ? 'tab-kenkai' : `learn-${sub}`); });
  store.set('joka.learnSub', sub);
  if (sub === 'ronbun') renderRonbun();
}

// ---- ホーム ----
function greeting() {
  const h = new Date().getHours();
  if (h < 10) return 'おはようございます';
  if (h < 17) return 'こんにちは';
  return 'こんばんは';
}
function renderHome() {
  const n = loadRecords().length;
  const day = Math.floor(Date.now() / 86400000);
  const tips = db.knowledge.principles.filter((p) => p.summary.length < 140);
  const tip = tips[day % tips.length];
  const resume = session.state === 'run'
    ? `<div class="card resume"><b>施術の途中です</b><button type="button" class="primary" data-go="session">施術に戻る</button></div>`
    : (lastAnalysis && (lastAnalysis.askText || lastAnalysis.input || ask.zones.length)
      ? `<div class="card resume"><span>前回調べた症状：<b>${esc(lastAnalysis.askText || placeLabels().join('・') || lastAnalysis.input)}</b></span><button type="button" class="ghost" data-go="today">続きから</button></div>` : '');
  $('#tab-home').innerHTML = `
    <div class="hero">
      <p class="hero-hello">${greeting()}</p>
      <h1 class="hero-title">今日も、ていねいに。</h1>
    </div>
    ${settings.welcomed ? '' : `<div class="card welcome">
      <h2>はじめての方へ</h2>
      <p>読みやすい文字の大きさを選んでください（あとから上の「あ 文字」でも変えられます）。</p>
      <div class="size-choice" role="radiogroup" aria-label="文字の大きさ">${TEXT_SIZES.map((t) => `<button type="button" role="radio" class="size-opt size-${t.id}" data-size="${t.id}" aria-checked="${settings.textSize === t.id}">あ<span>${t.name}</span></button>`).join('')}</div>
      <button type="button" class="primary wide" id="welcome-ok">わかりました</button>
    </div>`}
    ${resume}
    <button type="button" class="start-big" data-go="today">
      <span class="sb-main">はじめる</span>
      <span class="sb-sub">下の4つの順に、画面がご案内します</span>
    </button>
    <ol class="flow4" aria-label="使い方の流れ">
      <li><span class="f-no">1</span><b>つらい所</b><span>場所と感じを選ぶ</span></li>
      <li><span class="f-no">2</span><b>探査</b><span>熱・固結・圧痛を入れる</span></li>
      <li><span class="f-no">3</span><b>施術</b><span>図とタイマーが案内</span></li>
      <li><span class="f-no">4</span><b>記録</b><span>前と後を比べる</span></li>
    </ol>
    <div class="mini-tiles">
      <button type="button" class="mini-tile" data-go="session"><b>探査から始める</b><span>症状を選ばずに</span></button>
      <button type="button" class="mini-tile" data-go="kenkai"><b>岡田先生の見解</b><span>症状・病名から</span></button>
      <button type="button" class="mini-tile" data-go="records"><b>記録</b><span>${n ? `${n}件` : 'まだありません'}</span></button>
      <button type="button" class="mini-tile" data-go="learn"><b>学ぶ</b><span>知見・心得・使い方</span></button>
    </div>
    ${tip ? `<div class="card tip-card"><div class="tip-head">今日のひとこと<span class="small muted">（岡田先生の論述・テキストから）</span></div><div class="k-title">${esc(tip.title)}</div><p>${esc(tip.summary)}</p>${citesHTML(tip)}</div>` : ''}`;
  const root = $('#tab-home');
  $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => showTab(b.dataset.go)));
  $$('[data-size]', root).forEach((b) => b.addEventListener('click', () => { setTextSize(b.dataset.size); renderHome(); }));
  $('#welcome-ok', root)?.addEventListener('click', () => { settings.welcomed = true; saveSettings(); renderHome(); });
}

function setTextSize(id) {
  settings.textSize = id;
  saveSettings();
  applyLook();
  for (const pad of Object.values(session.pads)) pad.b3?.resize();
  askPicker?.resize();
}

// ---- 見やすさの設定 ----
function lookSettingsHTML() {
  const radio = (name, list, cur) => `<div class="opt-row" role="radiogroup">${list.map((o) => `<button type="button" role="radio" class="opt-b" data-${name}="${o.id}" aria-checked="${cur === o.id}">${esc(o.name)}</button>`).join('')}</div>`;
  return `
    <div class="card">
      <h2>文字の大きさ</h2>
      <div class="size-choice" role="radiogroup" aria-label="文字の大きさ">${TEXT_SIZES.map((t) => `<button type="button" role="radio" class="size-opt size-${t.id}" data-size="${t.id}" aria-checked="${settings.textSize === t.id}">あ<span>${t.name}</span></button>`).join('')}</div>
    </div>
    <div class="card">
      <h2>表示</h2>
      ${radio('detail', [{ id: 'simple', name: 'かんたん' }, { id: 'full', name: 'くわしく' }], settings.detail)}
      <p class="small muted">かんたん：大事なことを先に、説明は「くわしく」を開いた時に。くわしく：根拠や説明をはじめから開いて表示します（療法士・学ぶ方向け）。</p>
      <h3>画面の色</h3>
      ${radio('theme', [{ id: 'auto', name: '端末に合わせる' }, { id: 'light', name: '明るい' }, { id: 'dark', name: '暗い' }], settings.theme)}
    </div>
    <div class="card">
      <h2>ホーム画面に追加</h2>
      <p class="small">スマートフォンのホーム画面に置くと、アプリのように開けます。一度開いておけば、電波の届かない所でも使えます。</p>
      ${installEvt ? '<button type="button" class="primary" id="install-btn">ホーム画面に追加する</button>' : '<p class="small muted">iPhone：下の共有ボタン（□に↑）→「ホーム画面に追加」。Android：右上の︙ →「ホーム画面に追加」。</p>'}
    </div>`;
}
function wireLookSettings(root) {
  $$('[data-size]', root).forEach((b) => b.addEventListener('click', () => { setTextSize(b.dataset.size); renderSettings(); }));
  $$('[data-detail]', root).forEach((b) => b.addEventListener('click', () => { settings.detail = b.dataset.detail; saveSettings(); applyLook(); renderSettings(); }));
  $$('[data-theme]', root).forEach((b) => b.addEventListener('click', () => { settings.theme = b.dataset.theme; saveSettings(); applyLook(); renderSettings(); }));
  $('#install-btn', root)?.addEventListener('click', async () => { installEvt.prompt(); installEvt = null; });
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

// ---- 画面の切り替え・タイトル ----
let currentTab = 'home';
function showTab(name) {
  // 見解は「学ぶ・見解」の中
  if (name === 'kenkai') { store.set('joka.learnSub', 'kenkai'); name = 'learn'; }
  $('#title-screen').hidden = true;
  $('header.top').hidden = false;
  $('nav.bottom-nav').hidden = false;
  $('main').hidden = false;
  currentTab = name;
  $$('.bottom-nav button').forEach((x) => { if (x.dataset.tab === name) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
  $$('main > .tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  if (name === 'home') renderHome();
  if (name === 'session') renderSession();
  if (name === 'settings') renderSettings();
  if (name === 'records') renderRecordsTab();
  if (name === 'learn') showLearn(store.get('joka.learnSub', 'kenkai'));
  if (name !== 'today' && askPicker?.renderer) askPicker.dispose();
  if (name !== 'today' && name !== 'session') releaseGuide();
  if (name === 'today' && $('#result-3d') && resultGuide) mountGuide($('#result-3d'), resultGuide, { ratio: 1.1, maxH: 0.55 });
  if (name === 'today' && !$('#picker-box').hidden) openPicker(true);
  // タイトルの音楽は、ホーム以外では静かに止める
  if (name !== 'home' && player.playing && player.titleMode) { player.titleMode = false; player.stop(4); }
  window.scrollTo({ top: 0 });
}
let audioStarted = false;
function playTitleMusic() {
  player.minutes = 60;
  player.setList([settings.titleTrack || 'arpeggio'], trackNames());
  player.play(0);
  player.titleMode = true;
}
function setupTitle() {
  const start = async () => {
    if (!$('#title-screen') || $('#title-screen').hidden) return;
    audioStarted = unlockAudio();
    setVolume(settings.volume);
    showTab('home');
    userFiles = await listFiles();
    if (settings.titleMusic) playTitleMusic();
  };
  $('#title-screen').addEventListener('click', start);
  $('#home-btn').addEventListener('click', () => showTab('home'));
  $('#settings-btn').addEventListener('click', () => showTab('settings'));
  $('#size-btn').addEventListener('click', () => {
    const i = TEXT_SIZES.findIndex((t) => t.id === settings.textSize);
    const next = TEXT_SIZES[(i + 1) % TEXT_SIZES.length];
    setTextSize(next.id);
    toast(`文字の大きさ：${next.name}`);
    if (currentTab === 'settings') renderSettings();
    if (currentTab === 'home') renderHome();
  });
  $('#music-btn').addEventListener('click', () => {
    unlockAudio();
    if (player.playing) { player.stop(); toast('音楽を止めました'); return; }
    if (session.state === 'run') startMusic(); else playTitleMusic();
    toast('音楽を流しています');
  });
  $$('.bottom-nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('#tab-learn .seg button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.learn === 'ronbun') ronbunState.open = null; showLearn(b.dataset.learn); }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ronbun]');
    if (b) { e.preventDefault(); openRonbun(b.dataset.ronbun); }
  });
}

async function main() {
  try {
    db = prepare(await loadData());
  } catch (e) {
    $('#load-error').hidden = false;
    console.error(e);
    return;
  }
  $('#always-note').textContent = db.raw.safety.always;
  setupTitle();
  setupToday();
  renderPointsTab();
  renderLearnTab();
  renderKenkaiTab();
  // 一度開けば電波が無くても使えるように（ホーム画面に追加した時など）
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

main();
