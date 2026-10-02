import { prepare, analyze, planSession, normalize } from './engine.js';
import { Painter, LAYERS, REGIONS, BRUSHES, SHADES } from './paint.js';
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
}, store.get(STORE_SETTINGS, {}));
const saveSettings = () => store.set(STORE_SETTINGS, settings);

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
function volumeOf(id) {
  const m = id.match(/^(chojutsu|kowa)(\d+)/);
  if (!m) return '';
  return `${m[1] === 'kowa' ? '講話篇' : '著述篇'}${KANJI_NUM[Number(m[2])] || m[2]}巻`;
}
function eraOf(year) {
  if (!year) return '';
  if (year >= 1926 && year <= 1988) return `昭和${year - 1925}年`;
  return `${year}年`;
}
// 全集の見出しには宗教的な語が含まれることがあるため出さず、巻・頁・年のみを示す
function citeText(c) {
  const page = c.page || volumeOf(c.id);
  const era = eraOf(c.year);
  return `岡田茂吉全集 ${page}${era ? `（${era}）` : ''}`;
}
function citesHTML(k) {
  const parts = [];
  if (k.textbook) parts.push(`3級テキスト ${esc(k.textbook)}`);
  for (const c of k.cites || []) parts.push(esc(citeText(c)));
  return parts.length ? `<div class="cite">根拠：${parts.join('／')}</div>` : '';
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
    <summary>全集の参考候補（${ids.length}件・未確認）</summary>
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
        ul.innerHTML = rows.map(({ id, r }) => `<li>${esc(r ? citeText({ id, page: r.page, year: r.year }) : `${volumeOf(id)}（索引に該当なし）`)}</li>`).join('')
          + '<li class="muted">語句の一致から拾った候補で、内容の確認はまだです。</li>';
      } catch {
        ul.innerHTML = '<li class="muted">全集索引を読み込めませんでした。</li>';
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
  });
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
    ${pts.length ? `<div class="small">見解で挙げられている箇所：${pts.map((p) => `<span class="tag">${p.no} ${esc(p.name)}</span>`).join('')}</div>` : '<div class="small muted">見解の中に施術箇所の記述はありません。重要施術部位（腎臓部）から探査してみましょう。</div>'}
    ${citesHTML(e)}
    ${link ? `<button type="button" class="ghost small-btn" data-kenkai-go="${esc(e.id)}">この症状で探査する箇所を見る →</button>` : ''}
  </details>`;
}
// 見解の無い言葉は、その言葉が出てくる全集の項（巻・頁・年）を参考に示す
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
  return `<div class="k-item"><div class="small">全集でこの言葉が出てくる項（参考・内容は未確認）：</div>
    <ul class="small">${refs.map((r) => `<li>「${esc(r.w)}」${esc(citeText(r))}</li>`).join('')}</ul></div>`;
}
function wireKenkaiLinks(root) {
  $$('[data-kenkai-go]', root).forEach((b) => b.addEventListener('click', () => {
    const e = db.kenkai.find((x) => x.id === b.dataset.kenkaiGo);
    showTab('today');
    $('#symptom-text').value = e.label;
    store.set(STORE_INPUT, e.label);
    renderResult(analyze(db, e.label, [`k:${e.id}`]));
  }));
}

function renderResult(r) {
  lastAnalysis = r;
  const out = [];
  for (const s of r.safety.filter((x) => x.level === 'urgent')) out.push(`<div class="banner urgent">${esc(s.message)}</div>`);
  const diseaseShown = !r.urgent && r.kenkai.some((e) => e.disease);
  for (const s of r.safety.filter((x) => x.level !== 'urgent' && !(diseaseShown && x.id === 'disease'))) out.push(`<div class="banner notice">${esc(s.message)}</div>`);

  if (r.fallback) {
    out.push(`<div class="card">
      <h2>基本の19か所を探査しましょう</h2>
      <p>${r.input.trim() || r.safety.length ? '入力から当てはまる症状の流れが見つかりませんでした。' : ''}頭部4か所、頸部6か所、肩2か所、背部4か所、腎臓部3か所を、番号の順にまんべんなく探査してみましょう。</p>
      <p class="cite">根拠：岡田式浄化療法の実際 p130-131（基本的な探査箇所と探査の順序）</p>
    </div>`);
  } else {
    out.push(`<div class="card">
      <h2>読み取った症状（舞台）</h2>
      <div>${r.categories.map((c) => `<span class="tag">${esc(c.label)}</span>`).join('')}</div>
      <p class="small muted">${r.categories.filter((c) => c.words.length).map((c) => `「${esc(c.words.join('」「'))}」`).join(' ')}</p>
      ${r.side ? `<p class="small">「${SIDE_TEXT[r.side]}」の訴えがあります。探査では${SIDE_TEXT[r.side]}を特によく見つめましょう。</p>` : ''}
    </div>`);
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
        <p class="small muted">この症状について、全集の中にまとまった見解は見当たりませんでした。下の毒素の流れと各論を参考にしてください。</p>
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
    <div id="result-chart">${chartSVG({ highlight, flows: allFlows.slice(0, 1).map((x) => x.fl) })}</div>
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
    <p class="small muted">番号は探査の順序（岡田式浄化療法の実際 p131）。22 鼠蹊部は全集の記述による追加です。</p>
    ${cautions.map((g) => `<div class="caution">${esc(g.name)}：${esc(g.caution)}</div>`).join('')}
    <button type="button" class="primary wide" id="to-session">この箇所を探査して、施術の時間配分へ →</button>
  </div>`);

  // 施術の大事なポイント（4つの要素）
  if (!r.fallback) {
    const kakuron = [];
    const seen = new Set();
    for (const c of r.categories) for (const k of c.kakuron) if (!seen.has(k.id)) { seen.add(k.id); kakuron.push(k); }
    out.push(`<div class="card">
      <h2>施術の大事なポイント</h2>
      <details class="el" open><summary>① 重要施術部位（頭・肩・腎臓）</summary>
        ${principleCard('atama_first')}${principleCard('kata_gauge')}${principleCard('jinzo_first')}
      </details>
      <details class="el" open><summary>② 楽屋と舞台（毒素の流れ）</summary>
        <p class="small muted">症状が出ている所が舞台、その原因になっている所が楽屋。楽屋をやらなければ根本的には治らない（3級テキスト p59-61）。</p>
        ${r.categories.map((c) => `<h3>${esc(c.label)}</h3>
          ${c.flows.map((fl) => `<div class="flow-block"><div class="flow-title"><span class="src-label">3級テキスト</span>${esc(fl.src.stage)}</div>${stationsText(fl)}<p class="basis">${esc(fl.src.basis)}</p><div class="cite">根拠：3級テキスト ${esc(fl.src.textbook)}</div>${zenshuDetails(fl.src.zenshu_candidates)}</div>`).join('')}
          ${c.routes.map((fl) => `<div class="flow-block"><div class="flow-title"><span class="src-label">早見表 No.${fl.src.no}</span>${esc(fl.src.text)}</div>${stationsText(fl)}${fl.src.note ? `<div class="small muted">※${esc(fl.src.note)}</div>` : ''}</div>`).join('')}
          ${c.basis ? `<p class="basis">${esc(c.basis)}</p>${c.textbook ? `<div class="cite">根拠：3級テキスト ${esc(c.textbook)}</div>` : ''}` : ''}`).join('')}
        <p class="small muted">（ ）の箇所は、基本経路（腎臓部→肩甲間部→肩→頸部→頭／腎臓部→腎臓下方部→腰部）で補った箇所です。早見表は、既存のテキストに基づく試験的な分類です。</p>
        ${principleCard('joushou')}${principleCard('senaka_main')}
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
    </div>`);
  }

  out.push(`<div class="card">
    <h2>探査と施術の心得</h2>
    <div class="k-item"><div class="k-title">探査の手順</div><p>①発熱 ②固結 ③圧痛の順に確かめる。熱・圧痛のある所は第二浄化作用の段階にある急所。</p><div class="cite">根拠：3級テキスト p93-98</div></div>
    ${principleCard('netsu')}${principleCard('netsu_junban')}${principleCard('chikara')}${principleCard('jikan')}${principleCard('shizuka')}
  </div>`);

  const el = $('#result');
  el.innerHTML = out.join('');
  wireZenshu(el);
  $$('.flow-chip', el).forEach((b) => b.addEventListener('click', () => {
    $$('.flow-chip', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
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
  $('#to-session', el)?.addEventListener('click', () => { session.state = 'input'; showTab('session'); });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupToday() {
  renderChips();
  const ta = $('#symptom-text');
  ta.value = store.get(STORE_INPUT, '') || '';
  $('#symptom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    store.set(STORE_INPUT, ta.value);
    renderResult(analyze(db, ta.value, selectedChips()));
  });
  $('#clear-btn').addEventListener('click', () => {
    ta.value = '';
    $$('#chips .chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('#result').innerHTML = '';
    lastAnalysis = null;
    store.del(STORE_INPUT);
    ta.focus();
  });
}

// ---- 探査と施術（塗って入力 → 時間配分 → タイマー） ----
const session = { state: 'input', findings: {}, after: {}, plan: null, run: null, order: 'top', region: null, painter: null, afterPainter: null, receiver: store.get('joka.lastReceiver', ''), ratingBefore: 5, ratingAfter: 5, changes: [], memo: '', savedId: null };

function newPainter() {
  const { width, height, image } = db.raw.points.chart;
  const img = new Image();
  img.src = image;
  return new Painter({ image: img, width, height });
}

// 濃さ（0〜5）を色の帯で示す
function shadeBars(f) {
  return `<span class="shade-bars">${LAYERS.map((l) => {
    const v = f?.[l.id] || 0;
    return `<span class="sb" title="${l.name} ${v}"><span class="sb-l">${l.name.split('・')[0]}</span><span class="sb-track"><i style="width:${(v / SHADES) * 100}%;background:rgb(${l.rgb.join(',')})"></i></span></span>`;
  }).join('')}</span>`;
}

// 塗りの道具と拡大図。painter に塗り、変わるたびに onChange を呼ぶ
function painterHTML(prefix) {
  return `
    <div class="region-chips" role="group" aria-label="拡大する部位">${REGIONS.map((r) => `<button type="button" class="chip region-chip" data-${prefix}-region="${r.id}">${esc(r.name)}</button>`).join('')}</div>
    <div class="paint-wrap" id="${prefix}-canvas"></div>
    <div class="paint-tools">
      <div class="tool-row" role="group" aria-label="塗るもの">${LAYERS.map((l) => `<button type="button" class="layer-b" data-${prefix}-layer="${l.id}" style="--c:rgb(${l.rgb.join(',')})"><i></i>${esc(l.name)}</button>`).join('')}</div>
      <div class="tool-row" role="group" aria-label="濃さ">
        <span class="tool-l">濃さ</span>${Array.from({ length: SHADES }, (_, i) => i + 1).map((v) => `<button type="button" class="shade-b" data-${prefix}-shade="${v}" aria-label="濃さ${v}"><i></i></button>`).join('')}
      </div>
      <div class="tool-row" role="group" aria-label="筆">
        <span class="tool-l">筆</span>${BRUSHES.map((x) => `<button type="button" class="brush-b" data-${prefix}-brush="${x.id}"><i style="--s:${x.r * 2.4}px"></i>${x.name}</button>`).join('')}
        <button type="button" class="brush-b" data-${prefix}-erase="1">消す</button>
        <button type="button" class="mini" data-${prefix}-undo="1">戻す</button>
      </div>
    </div>`;
}

function wirePainter(root, prefix, painter, onChange) {
  const mark = () => {
    $$(`[data-${prefix}-region]`, root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[`${prefix}Region`] === painter.region.id)));
    $$(`[data-${prefix}-layer]`, root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[`${prefix}Layer`] === painter.layer && !painter.erase)));
    const rgb = LAYERS.find((l) => l.id === painter.layer).rgb.join(',');
    $$(`[data-${prefix}-shade]`, root).forEach((b) => {
      const v = Number(b.dataset[`${prefix}Shade`]);
      b.style.setProperty('--c', `rgba(${rgb},${(v / SHADES) * 0.85})`);
      b.setAttribute('aria-pressed', String(v === painter.shade));
    });
    $$(`[data-${prefix}-brush]`, root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[`${prefix}Brush`] === painter.brush)));
    $(`[data-${prefix}-erase]`, root).setAttribute('aria-pressed', String(painter.erase));
  };
  const markers = db.pointList.map((p) => ({ no: p.no, xy: p.chart || [] }));
  const show = (id) => { session.region = id; painter.mount($(`#${prefix}-canvas`, root), id, markers); mark(); };
  painter.onChange = onChange;
  $$(`[data-${prefix}-region]`, root).forEach((b) => b.addEventListener('click', () => show(b.dataset[`${prefix}Region`])));
  $$(`[data-${prefix}-layer]`, root).forEach((b) => b.addEventListener('click', () => { painter.layer = b.dataset[`${prefix}Layer`]; painter.erase = false; mark(); }));
  $$(`[data-${prefix}-shade]`, root).forEach((b) => b.addEventListener('click', () => { painter.shade = Number(b.dataset[`${prefix}Shade`]); painter.erase = false; mark(); }));
  $$(`[data-${prefix}-brush]`, root).forEach((b) => b.addEventListener('click', () => { painter.brush = b.dataset[`${prefix}Brush`]; mark(); }));
  $(`[data-${prefix}-erase]`, root).addEventListener('click', () => { painter.erase = !painter.erase; mark(); });
  $(`[data-${prefix}-undo]`, root).addEventListener('click', () => painter.undo());
  // 本日の症状で見つめる箇所が多い部位から始める
  let start = session.region;
  if (!start) {
    const pts = (lastAnalysis && !lastAnalysis.fallback ? lastAnalysis.points : []).map((p) => db.pointById[p.id]);
    const score = (r) => pts.filter((p) => (p.chart || []).some(([x, y]) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3])).length;
    start = REGIONS.slice(0, 7).map((r) => [r.id, score(r)]).sort((x, y) => y[1] - x[1])[0][0];
    if (!pts.length) start = 'back';
  }
  show(start);
}

function readoutHTML(findings, highlightIds = new Set()) {
  const rows = db.pointList.filter((p) => findings[p.id]);
  if (!rows.length) return '<p class="small muted">まだ塗られていません。探査で熱を感じた所を赤、固い所・張っている所を青、押して痛い所を紫で塗ってください。</p>';
  return `<ul class="readout">${rows.map((p) => `<li${highlightIds.has(p.id) ? ' class="hl"' : ''}><span class="no">${p.no}</span><span class="name">${esc(p.name)}</span>${shadeBars(findings[p.id])}</li>`).join('')}</ul>`;
}

function renderSessionInput() {
  session.painter ||= newPainter();
  const painter = session.painter;
  const suggested = lastAnalysis && !lastAnalysis.fallback ? lastAnalysis.points : [];
  const sugIds = new Set(suggested.map((p) => p.id));
  $('#tab-session').innerHTML = `
    <div class="card">
      <h2>探査の結果を塗って入力</h2>
      <p class="small">部位を選んで拡大し、指でなぞって塗ります。<b class="c-heat">熱は赤</b>、<b class="c-kou">固結・張りは青</b>、<b class="c-atsu">圧痛は紫</b>。濃さは5段階で、薄い濃さで上からなぞれば薄く塗り直せます。</p>
      ${suggested.length ? `<p class="small">本日の症状から見つめる箇所：${suggested.map((p) => `<span class="tag">${p.no} ${esc(p.name)}</span>`).join('')}</p>` : ''}
      ${painterHTML('pb')}
    </div>
    <div class="card">
      <h2>読み取った探査の結果</h2>
      <p class="small muted">塗った濃さを、近くの探査箇所ごとに読み取ります（5段階）。</p>
      <div id="readout">${readoutHTML(session.findings, sugIds)}</div>
    </div>
    <div class="card">
      <h2>施術にかける時間</h2>
      <div class="time-chips">${[15, 20, 30, 45, 60].map((m) => `<button type="button" class="chip time-chip" data-m="${m}" aria-pressed="${settings.minutes === m}">${m}分</button>`).join('')}</div>
      <p class="small muted">一回の施術は普通十分から三十分くらい（全集 著述篇一巻p182）。</p>
      <button type="button" class="primary wide" id="make-plan">優先順位と時間配分を出す</button>
      <p id="plan-msg" class="small warn-text" hidden></p>
    </div>
    ${criteriaCard()}`;
  const root = $('#tab-session');
  wirePainter(root, 'pb', painter, () => {
    session.findings = painter.sample(db.pointList);
    $('#readout').innerHTML = readoutHTML(session.findings, sugIds);
  });
  $$('.time-chip').forEach((b) => b.addEventListener('click', () => {
    settings.minutes = Number(b.dataset.m);
    saveSettings();
    $$('.time-chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#make-plan').addEventListener('click', () => {
    session.findings = painter.sample(db.pointList);
    const plan = planSession(db, session.findings, settings.minutes, lastAnalysis, { order: session.order });
    if (!plan.ok) {
      const m = $('#plan-msg');
      m.textContent = '探査で熱・固結・圧痛を感じた所を、人体図に塗ってください。';
      m.hidden = false;
      return;
    }
    session.plan = plan;
    session.state = 'plan';
    renderSession();
    window.scrollTo({ top: 0 });
  });
}

function criteriaCard() {
  return `<details class="card criteria"><summary><h2>優先順位と時間配分の考え方</h2></summary>
    <p class="small">探査の結果に、施術の大事なポイント4つを掛け合わせて優先度を出し、時間を配分します（このアプリの判断基準）。</p>
    <ol class="steps small">
      <li><b>探査の結果</b>：塗った濃さ（5段階）を探査箇所ごとに読み取る。熱を最も重く（熱は溶けて排泄に向かっている印）、固結・張り・圧痛を加え、重なる所（急所）をさらに重くする。</li>
      <li><b>重要施術部位</b>：腎臓部を第一（全身の浄化作用を強める）、頭・肩をそれに次ぐ重みに、背部・肩甲骨部を第二の順位に。腎臓部に所見があれば必ず施術に入れる。</li>
      <li><b>楽屋と舞台</b>：本日の症状の楽屋（元）を重く、流れの経路上をやや重く。</li>
      <li><b>毒素集溜と排泄の順序</b>：骨盤周辺（腰骨部・尾てい骨部・鼠蹊部）は排泄の出口として重く。固結が強い時はさらに重く。</li>
      <li><b>各論</b>：本日の症状について全集で説かれた急所を重く。</li>
      <li><b>時間</b>：はじめに探査（全体の約15%）、最後に確認（約10%）。残りを、最低3分ずつ確保したうえで優先度に比例して配る。施術する箇所は時間8分あたり1か所（2〜5か所）。</li>
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

function renderSessionPlan() {
  const plan = session.plan;
  const ref = (r) => (r.ref && db.principleById[r.ref] ? ` <span class="ref">${esc(db.principleById[r.ref].cites.map(citeText)[0] || '')}</span>` : '');
  const maxShare = Math.max(...plan.items.map((i) => i.share));
  $('#tab-session').innerHTML = `
    <div class="card">
      <h2>施術の優先順位と時間配分</h2>
      <div class="timeline">
        <span class="tl probe">探査 ${plan.probe}分</span>
        ${plan.items.map((it) => `<span class="tl treat">${esc(it.name)} ${it.minutes}分</span>`).join('')}
        <span class="tl check">確認 ${plan.check}分</span>
      </div>
      <div class="order-row" role="group" aria-label="施術の順序">
        <span class="tool-l">順序</span>
        <button type="button" class="chip order-chip" data-order="top" aria-pressed="${plan.order === 'top'}">上から下（基本）</button>
        <button type="button" class="chip order-chip" data-order="text" aria-pressed="${plan.order === 'text'}">テキストの探査順</button>
      </div>
      <p class="small muted">合計 <b id="plan-total">${plan.total}</b>分。施術は上から下へ進めるのが基本です（まず頭を清め、首・肩、背、腎臓部、腰へ）。</p>
      <ol class="plan-list">${plan.items.map((it, i) => `<li class="plan-item">
        <div class="plan-head"><span class="no">${it.no}</span><span class="name">${esc(it.name)}</span>
          <span class="mins"><button type="button" class="mini" data-adj="-1" data-i="${i}" aria-label="1分減らす">−</button><b>${it.minutes}</b>分<button type="button" class="mini" data-adj="1" data-i="${i}" aria-label="1分増やす">＋</button></span></div>
        <div class="bar"><i style="width:${Math.round((it.share / maxShare) * 100)}%"></i></div>
        <div class="small">${shadeBars(it.finding)}</div>
        <ul class="reasons">${it.reasons.map((r) => `<li>${esc(r.text)}${ref(r)}</li>`).join('')}</ul>
      </li>`).join('')}</ol>
      ${plan.others.length ? `<p class="small muted">今回は外した箇所：${plan.others.map((o) => esc(o.name)).join('、')}（時間があれば続けて）</p>` : ''}
    </div>
    <div class="card">
      <h2>記録の準備</h2>
      ${receiverHTML()}
      ${ratingHTML('before', '施術前のつらさ', session.ratingBefore)}
      <div class="actions">
        <button type="button" class="primary" id="start-run">施術を始める</button>
        <button type="button" class="ghost" id="back-input">入力に戻る</button>
      </div>
    </div>
    ${criteriaCard()}`;
  wireRecordInputs($('#tab-session'));
  $$('.mini[data-adj]').forEach((b) => b.addEventListener('click', () => {
    const it = plan.items[Number(b.dataset.i)];
    it.minutes = Math.max(1, it.minutes + Number(b.dataset.adj));
    plan.total = plan.probe + plan.check + plan.items.reduce((s, x) => s + x.minutes, 0);
    renderSessionPlan();
  }));
  $$('.order-chip').forEach((b) => b.addEventListener('click', () => {
    session.order = b.dataset.order;
    const keep = Object.fromEntries(plan.items.map((it) => [it.id, it.minutes]));
    session.plan = planSession(db, session.findings, settings.minutes, lastAnalysis, { order: session.order });
    for (const it of session.plan.items) if (keep[it.id]) it.minutes = keep[it.id];
    session.plan.total = session.plan.probe + session.plan.check + session.plan.items.reduce((s, x) => s + x.minutes, 0);
    renderSessionPlan();
  }));
  $('#back-input').addEventListener('click', () => { session.state = 'input'; renderSession(); });
  $('#start-run').addEventListener('click', startRun);
}

function speechName(id) {
  const p = db.pointById[id];
  return p?.reading || p?.name || '';
}

function startRun() {
  unlockAudio();
  const plan = session.plan;
  const phases = [{ type: 'probe', label: '探査', sec: plan.probe * 60 }];
  plan.items.forEach((it, i) => phases.push({ type: 'treat', id: it.id, label: it.name, sec: it.minutes * 60, n: i + 1 }));
  phases.push({ type: 'check', label: '確認（再探査）', sec: plan.check * 60 });
  session.run = { phases, i: 0, left: phases[0].sec, paused: false, tick: null, adviced: false, wake: null };
  session.state = 'run';
  renderSession();
  window.scrollTo({ top: 0 });
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
  return `${ph.n}番目、${speechName(ph.id)}です。${Math.round(ph.sec / 60)}分。力を抜いて、軽い気持ちで。`;
}

function enterPhase() {
  const run = session.run;
  const ph = run.phases[run.i];
  run.left = ph.sec;
  run.adviced = false;
  if (settings.chime) chime();
  if (settings.voice) setTimeout(() => speak(phaseMessage(ph)), settings.chime ? 1200 : 0);
  clearInterval(run.tick);
  run.tick = setInterval(tick, 1000);
  renderRun();
}

function tick() {
  const run = session.run;
  if (!run || run.paused) return;
  run.left--;
  const ph = run.phases[run.i];
  // 施術の終わり近くで、熱・固結・圧痛の確認を促す
  if (ph.type === 'treat' && !run.adviced && run.left === Math.min(60, Math.floor(ph.sec / 3))) {
    run.adviced = true;
    if (settings.voice) speak('施術した箇所の、熱、固結、圧痛を確認してみましょう。');
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

function renderRun() {
  const run = session.run;
  const ph = run.phases[run.i];
  const next = run.phases[run.i + 1];
  const highlight = ph.type === 'treat' ? { [ph.id]: { key: true } } : Object.fromEntries(session.plan.items.map((it) => [it.id, {}]));
  $('#tab-session').innerHTML = `
    <div class="card run-card">
      <div class="run-phase">${ph.type === 'treat' ? `施術 ${ph.n}/${session.plan.items.length}` : esc(ph.label)}</div>
      <div class="run-name">${ph.type === 'treat' ? esc(ph.label) : (ph.type === 'probe' ? '発熱・固結・圧痛を確かめる' : '熱が冷めたか、固結がゆるんだか')}</div>
      <div class="run-clock" id="run-clock">${mmss(run.left)}</div>
      <div class="run-progress"><i id="run-bar" style="width:0%"></i></div>
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
    <div class="card">${chartSVG({ highlight })}</div>
    <ol class="card phase-list">${run.phases.map((p, i) => `<li class="${i === run.i ? 'now' : i < run.i ? 'done' : ''}">${esc(p.label)}<span>${Math.round(p.sec / 60)}分</span></li>`).join('')}</ol>`;
  updateRunClock();
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

function renderDone() {
  const items = session.plan.items;
  session.afterPainter ||= newPainter();
  const painter = session.afterPainter;
  $('#tab-session').innerHTML = `
    <div class="card">
      <h2>お疲れさまでした</h2>
      <p>施術した箇所をもう一度探査して、今の熱・固結・圧痛を塗ってみましょう。熱が冷めたか、固結がゆるんだかを確かめます。</p>
      ${painterHTML('pa')}
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
  wirePainter(root, 'pa', painter, () => {
    session.after = painter.sample(db.pointList);
    $('#compare').innerHTML = compareHTML(items);
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
    Object.assign(session, { findings: {}, after: {}, plan: null, painter: null, afterPainter: null, state: 'input', ratingBefore: 5, ratingAfter: 5, changes: [], memo: '', savedId: null });
    renderSession();
  });
}

const r1 = (v) => Math.round((v || 0) * 10) / 10;
function buildRecord() {
  const toList = (f) => Object.entries(f).map(([point_id, v]) => ({ point_id, heat: r1(v.heat), kouketsu: r1(v.kouketsu), atsutsuu: r1(v.atsutsuu) }));
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
    treatments: session.plan.items.map((it, i) => ({ point_id: it.id, minutes: it.minutes, order: i + 1 })),
    findings_after: toList(session.after),
    self_rating_after: { つらさ: session.ratingAfter },
    changes_observed: session.changes.slice(),
    memo: session.memo,
    follow_up: '',
    plan_minutes: { probe: session.plan.probe, check: session.plan.check },
  };
}

function renderSession() {
  if (session.state === 'plan' && session.plan) return renderSessionPlan();
  if (session.state === 'run' && session.run) return renderRun();
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
      <p class="small muted">お知らせは、各箇所のはじめ（箇所の名前と分数、「力を抜いて」）、終わり近く（「熱、固結、圧痛を確認してみましょう」）、最後の確認の時です。施術は話しながら行わないため、お知らせは短くしています。</p>
    </div>`;
  wireMusicBar($('#tab-settings'));
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
    setTimeout(() => speak('施術した箇所の、熱、固結、圧痛を確認してみましょう。'), settings.chime ? 1000 : 0);
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
      <p class="small muted">頭部4か所、頸部6か所、肩2か所、背部4か所、腎臓部3か所。※20〜22は自己探査。</p>
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
      body = `<p>「${esc(q)}」について、全集の中にまとまった見解は見当たりませんでした。</p>
        ${r.categories.length ? `<p class="small">症状の流れでは「${r.categories.map((c) => esc(c.label)).join('」「')}」に当たります。<button type="button" class="ghost small-btn" id="kk-go-today">探査する箇所を見る →</button></p>` : '<p class="small">言い方を変えて（例：「頭が重い」「足がだるい」）調べてみてください。</p>'}
        ${termRefsHTML(words)}`;
    }
    box.innerHTML = `${banners}${spiritualHTML(r.spiritual)}${body ? `<div class="card kenkai-card">${hits.some((e) => e.disease) ? noticeHTML(true) : ''}${body}</div>` : ''}`;
    wireKenkaiLinks(box);
    $('#kk-go-today', box)?.addEventListener('click', () => {
      showTab('today');
      $('#symptom-text').value = q;
      store.set(STORE_INPUT, q);
      renderResult(analyze(db, q));
    });
  });
}

// ---- 流れと用語 ----
function renderLearnTab() {
  const { concepts } = db.raw.concepts;
  const { patterns } = db.raw.changes;
  const { routes, intro, source } = db.raw.routes;
  const k = db.knowledge;
  $('#tab-learn').innerHTML = `
    <div class="card">
      <h2>用語</h2>
      <dl class="terms">${concepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.definition)}<div class="cite">${esc(c.source)}</div></dd>`).join('')}</dl>
    </div>
    <div class="card">
      <h2>全集から：施術の知見</h2>
      ${['重要施術部位', '楽屋と舞台', '毒素集溜と排泄の順序', '探査', '施術'].map((el) => `<h3>${esc(el)}</h3>${k.principles.filter((p) => p.element === el).map((p) => principleCard(p.id)).join('')}`).join('')}
    </div>
    <div class="card">
      <h2>全集から：各論</h2>
      ${k.kakuron.map((x) => `<div class="k-item"><div class="k-title">${esc(x.title)}</div><p>${esc(x.summary)}</p><div class="small">見る箇所：${x.points.map((id) => esc(db.pointById[id]?.name)).join('、')}</div>${citesHTML(x)}</div>`).join('')}
    </div>
    <div class="card">
      <h2>施術中・施術後に起こりうる変化</h2>
      <dl class="terms">${patterns.map((p) => `<dt>${esc(p.trigger)}</dt><dd>${esc(p.meaning)}<div class="cite">3級テキスト ${esc(p.textbook)}</div>${zenshuDetails(p.zenshu_candidates)}</dd>`).join('')}</dl>
    </div>
    <div class="card">
      <h2>3級テキストにある毒素の流れ</h2>
      ${db.raw.flows.flows.map((f) => `<div class="flow-block"><div class="flow-title">${esc(f.stage)}</div><div class="small">${f.route.map(esc).join(' → ') || '—'}</div><p class="basis">${esc(f.basis)}</p><div class="cite">3級テキスト ${esc(f.textbook)}</div></div>`).join('')}
    </div>
    <div class="card">
      <h2>具体的な毒素の移動経路（早見表）</h2>
      <p class="small">${esc(intro)}</p>
      <table class="routes">${routes.map((r) => `<tr><td>${r.no}</td><td>${esc(r.text)}${r.note ? `<div class="small muted">※${esc(r.note)}</div>` : ''}</td></tr>`).join('')}</table>
      <p class="small muted">各経路は、既存のテキストに基づく試験的な分類であり、必ずしも浄化療法の病理の全体像を反映するものではありません。</p>
      <p class="cite">${esc(source)}</p>
    </div>`;
  wireZenshu($('#tab-learn'));
}

// ---- 画面の切り替え・タイトル ----
function showTab(name) {
  $('#title-screen').hidden = true;
  $('header.top').hidden = false;
  $('nav.tabs').hidden = false;
  $('main').hidden = false;
  $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === name)));
  $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  if (name === 'session') renderSession();
  if (name === 'settings') renderSettings();
  if (name === 'records') renderRecordsTab();
  // タイトルの音楽は、施術中でなければ静かに止める
  if (player.playing && player.titleMode) { player.titleMode = false; player.stop(4); }
  window.scrollTo({ top: 0 });
}

function showTitle() {
  if (session.state === 'run') { showTab('session'); return; }
  $('#title-screen').hidden = false;
  $('header.top').hidden = true;
  $('nav.tabs').hidden = true;
  $('main').hidden = true;
  if (audioStarted && settings.titleMusic && !player.playing) playTitleMusic();
}

let audioStarted = false;
function playTitleMusic() {
  player.minutes = 60;
  player.setList([settings.titleTrack || 'arpeggio'], trackNames());
  player.play(0);
  player.titleMode = true;
  updateTitleMusicBtn();
}
function updateTitleMusicBtn() {
  const b = $('#title-music');
  b.setAttribute('aria-pressed', String(player.playing));
  b.textContent = player.playing ? '♪ 音楽 オン' : '♪ 音楽 オフ';
}

function setupTitle() {
  $('#tap-start').addEventListener('click', async () => {
    audioStarted = unlockAudio();
    setVolume(settings.volume);
    userFiles = await listFiles();
    $('#tap-start').hidden = true;
    $('#title-menu').hidden = false;
    $('#title-music').hidden = false;
    if (settings.titleMusic) playTitleMusic();
    updateTitleMusicBtn();
  });
  $('#title-music').addEventListener('click', () => {
    if (player.playing) { player.stop(); settings.titleMusic = false; } else { settings.titleMusic = true; playTitleMusic(); }
    saveSettings();
    updateTitleMusicBtn();
  });
  $$('#title-menu [data-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.go)));
  $('#menu-btn').addEventListener('click', showTitle);
  $('#music-btn').addEventListener('click', () => showTab('settings'));
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
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
}

main();
