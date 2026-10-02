import { prepare, analyze, planSession } from './engine.js';
import { TRACKS, Player, unlockAudio, setVolume, chime, speak, stopSpeaking, canSpeak, listFiles, addFiles, removeFile } from './audio.js';

const DATA_FILES = ['body_points', 'flows', 'routes', 'symptoms', 'safety', 'concepts', 'changes', 'places', 'knowledge'];
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

function renderResult(r) {
  lastAnalysis = r;
  const out = [];
  for (const s of r.safety.filter((x) => x.level === 'urgent')) out.push(`<div class="banner urgent">${esc(s.message)}</div>`);
  for (const s of r.safety.filter((x) => x.level !== 'urgent')) out.push(`<div class="banner notice">${esc(s.message)}</div>`);

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

// ---- 探査と施術（入力 → 時間配分 → タイマー） ----
const session = { state: 'input', findings: {}, after: {}, showAll: false, plan: null, run: null };
const FIELDS = [['heat', '熱'], ['kouketsu', '固結'], ['atsutsuu', '圧痛']];

function segHTML(id, field, value, prefix = 'f') {
  return `<div class="seg" role="group" aria-label="${field}">${[0, 1, 2, 3].map((v) =>
    `<button type="button" class="seg-b" data-k="${prefix}" data-id="${id}" data-f="${field}" data-v="${v}" aria-pressed="${value === v}">${v}</button>`).join('')}</div>`;
}

function findingRow(p, f = {}, prefix = 'f') {
  return `<li class="find-row">
    <div class="find-head"><span class="no">${p.no}</span><span class="name">${esc(p.name)}</span>${p.hint ? `<span class="role role-${p.hint}">${p.hint}</span>` : ''}</div>
    <div class="find-fields">${FIELDS.map(([k, label]) => `<div class="ff"><span class="ff-l">${label}</span>${segHTML(p.id, k, f[k] || 0, prefix)}</div>`).join('')}</div>
  </li>`;
}

function renderSessionInput() {
  const suggested = lastAnalysis && !lastAnalysis.fallback ? lastAnalysis.points : [];
  const suggestedIds = new Set(suggested.map((p) => p.id));
  const hintOf = (p) => (p.roles.includes('rakuya') ? '楽屋' : p.roles.includes('kakuron') ? '各論' : p.roles.includes('outlet') ? '出口' : '');
  const main = suggested.length
    ? suggested.map((p) => ({ ...db.pointById[p.id], hint: p.key ? '重点' : hintOf(p) }))
    : db.pointList.filter((p) => !p.selfProbe);
  const rest = db.pointList.filter((p) => !main.some((m) => m.id === p.id));
  $('#tab-session').innerHTML = `
    <div class="card">
      <h2>探査の結果を入力</h2>
      <p class="small">${suggested.length ? '本日の症状から見つめる箇所です。' : '本日の症状を入力すると、見つめる箇所がここに並びます。いまは基本の19か所です。'}探査して、熱・固結・圧痛を 0（なし）〜3（強い）で入れてください。</p>
      <ul class="find-list">${main.map((p) => findingRow(p, session.findings[p.id])).join('')}</ul>
      <details class="more"${session.showAll ? ' open' : ''}><summary>ほかの箇所も入力する（${rest.length}か所）</summary>
        <ul class="find-list">${rest.map((p) => findingRow(p, session.findings[p.id])).join('')}</ul>
      </details>
    </div>
    <div class="card">
      <h2>施術にかける時間</h2>
      <div class="time-chips">${[15, 20, 30, 45, 60].map((m) => `<button type="button" class="chip time-chip" data-m="${m}" aria-pressed="${settings.minutes === m}">${m}分</button>`).join('')}</div>
      <p class="small muted">一回の施術は普通十分から三十分くらい（全集 著述篇一巻p182）。</p>
      <button type="button" class="primary wide" id="make-plan">優先順位と時間配分を出す</button>
      <p id="plan-msg" class="small warn-text" hidden></p>
    </div>
    ${criteriaCard()}`;
  wireSeg($('#tab-session'), session.findings, 'f');
  $('details.more', $('#tab-session')).addEventListener('toggle', (e) => { session.showAll = e.target.open; });
  $$('.time-chip').forEach((b) => b.addEventListener('click', () => {
    settings.minutes = Number(b.dataset.m);
    saveSettings();
    $$('.time-chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#make-plan').addEventListener('click', () => {
    const plan = planSession(db, session.findings, settings.minutes, lastAnalysis);
    if (!plan.ok) {
      const m = $('#plan-msg');
      m.textContent = plan.message;
      m.hidden = false;
      return;
    }
    session.plan = plan;
    session.state = 'plan';
    renderSession();
    window.scrollTo({ top: 0 });
  });
}

function wireSeg(root, target, prefix) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest(`.seg-b[data-k="${prefix}"]`);
    if (!b) return;
    const { id, f, v } = b.dataset;
    (target[id] ||= { heat: 0, kouketsu: 0, atsutsuu: 0 })[f] = Number(v);
    $$(`.seg-b[data-k="${prefix}"][data-id="${id}"][data-f="${f}"]`, root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
}

function criteriaCard() {
  return `<details class="card criteria"><summary><h2>優先順位と時間配分の考え方</h2></summary>
    <p class="small">探査の結果に、施術の大事なポイント4つを掛け合わせて優先度を出し、時間を配分します（このアプリの判断基準）。</p>
    <ol class="steps small">
      <li><b>探査の結果</b>：熱を最も重く（熱は溶けて排泄に向かっている印）、固結・圧痛を加え、三つが一致する所（急所）をさらに重くする。</li>
      <li><b>重要施術部位</b>：腎臓部を第一（全身の浄化作用を強める）、頭・肩をそれに次ぐ重みに、背部・肩甲骨部を第二の順位に。腎臓部に所見があれば必ず施術に入れる。</li>
      <li><b>楽屋と舞台</b>：本日の症状の楽屋（元）を重く、流れの経路上をやや重く。</li>
      <li><b>毒素集溜と排泄の順序</b>：骨盤周辺（腰骨部・尾てい骨部・鼠蹊部）は排泄の出口として重く。固結が強い時はさらに重く。</li>
      <li><b>各論</b>：本日の症状について全集で説かれた急所を重く。</li>
      <li><b>時間</b>：はじめに探査（全体の約15%）、最後に確認（約10%）。残りを、最低3分ずつ確保したうえで優先度に比例して配る。施術する箇所は時間8分あたり1か所（2〜5か所）。</li>
      <li><b>順序</b>：頭→首→肩→背→腎臓部→腰（まず頭を清め、首・肩、次に腎臓部）。</li>
    </ol>
    ${principleCard('jinzo_first')}${principleCard('netsu')}${principleCard('kotsuban')}${principleCard('jikan')}
  </details>`;
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
      <p class="small muted">合計 <b id="plan-total">${plan.total}</b>分。順序は頭→首→肩→背→腎臓部→腰です。</p>
      <ol class="plan-list">${plan.items.map((it, i) => `<li class="plan-item">
        <div class="plan-head"><span class="no">${it.no}</span><span class="name">${esc(it.name)}</span>
          <span class="mins"><button type="button" class="mini" data-adj="-1" data-i="${i}" aria-label="1分減らす">−</button><b>${it.minutes}</b>分<button type="button" class="mini" data-adj="1" data-i="${i}" aria-label="1分増やす">＋</button></span></div>
        <div class="bar"><i style="width:${Math.round((it.share / maxShare) * 100)}%"></i></div>
        <div class="small">熱${it.finding.heat}・固結${it.finding.kouketsu}・圧痛${it.finding.atsutsuu}</div>
        <ul class="reasons">${it.reasons.map((r) => `<li>${esc(r.text)}${ref(r)}</li>`).join('')}</ul>
      </li>`).join('')}</ol>
      ${plan.others.length ? `<p class="small muted">今回は外した箇所：${plan.others.map((o) => esc(o.name)).join('、')}（時間があれば続けて）</p>` : ''}
      <div class="actions">
        <button type="button" class="primary" id="start-run">施術を始める</button>
        <button type="button" class="ghost" id="back-input">入力に戻る</button>
      </div>
    </div>
    ${criteriaCard()}`;
  $$('.mini[data-adj]').forEach((b) => b.addEventListener('click', () => {
    const it = plan.items[Number(b.dataset.i)];
    it.minutes = Math.max(1, it.minutes + Number(b.dataset.adj));
    plan.total = plan.probe + plan.check + plan.items.reduce((s, x) => s + x.minutes, 0);
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

function renderDone() {
  const items = session.plan.items;
  $('#tab-session').innerHTML = `
    <div class="card">
      <h2>お疲れさまでした</h2>
      <p>施術した箇所をもう一度探査して、変化を入れてみましょう。熱が冷めた分だけ苦痛は除れます。</p>
      <ul class="find-list">${items.map((it) => findingRow(db.pointById[it.id], session.after[it.id] || it.finding, 'a')).join('')}</ul>
      <div id="compare"></div>
      <div class="actions">
        <button type="button" class="primary" id="compare-btn">変化を見る</button>
        <button type="button" class="ghost" id="new-session">はじめから</button>
      </div>
      <p class="small muted">施術後、溶けた毒素が胸や胃に降りる、反対側に痛みが出る（平均浄化）などの変化が起こることがあります。「用語」の施術後の変化も見てください。</p>
    </div>`;
  for (const it of items) session.after[it.id] ||= { ...it.finding };
  wireSeg($('#tab-session'), session.after, 'a');
  $('#compare-btn').addEventListener('click', () => {
    $('#compare').innerHTML = `<table class="routes compare"><tr><td></td><td>施術前 → 後</td></tr>${items.map((it) => {
      const a = session.after[it.id];
      const d = (k) => `${FIELDS.find((x) => x[0] === k)[1]} ${it.finding[k]}→${a[k]}${a[k] < it.finding[k] ? ' <b class="down">↓</b>' : ''}`;
      return `<tr><td>${it.no}</td><td>${esc(it.name)}<div class="small">${d('heat')}　${d('kouketsu')}　${d('atsutsuu')}</div></td></tr>`;
    }).join('')}</table>`;
  });
  $('#new-session').addEventListener('click', () => {
    session.findings = {};
    session.after = {};
    session.plan = null;
    session.state = 'input';
    renderSession();
  });
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
}

main();
