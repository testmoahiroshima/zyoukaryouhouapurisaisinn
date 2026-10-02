import { prepare, analyze } from './engine.js';

const DATA_FILES = ['body_points', 'flows', 'routes', 'symptoms', 'safety', 'concepts', 'changes'];
const KEY_FIELDS = { body_points: 'points' };
const STORE_KEY = 'joka.lastInput';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let db;
let zenshuIndex = null;

async function loadData() {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (f) => {
    const res = await fetch(`data/${f}.json`);
    if (!res.ok) throw new Error(f);
    raw[KEY_FIELDS[f] || f] = await res.json();
  }));
  return raw;
}

// ---- 全集索引（根拠の参考候補）。必要になった時だけ読む ----
async function loadZenshu() {
  if (zenshuIndex) return zenshuIndex;
  const res = await fetch('data/zenshu_index.jsonl');
  const text = await res.text();
  zenshuIndex = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      zenshuIndex[r.id] = r;
    } catch { /* 壊れた行は飛ばす */ }
  }
  return zenshuIndex;
}

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
// 見出しには宗教用語が含まれることがあるため出さず、巻・頁・年のみを示す
function citeZenshu(id, r) {
  if (!r) return `${volumeOf(id)}（索引に該当なし：${id}）`;
  const page = r.page || volumeOf(id);
  const era = eraOf(r.year);
  return `岡田茂吉全集 ${page}${era ? `（${era}）` : ''}`;
}

function zenshuDetails(ids) {
  if (!ids || !ids.length) return '';
  return `<details class="zenshu" data-ids="${esc(ids.join(','))}">
    <summary>岡田茂吉全集の参考候補（${ids.length}件・未確認）</summary>
    <ul><li class="muted">読み込み中…</li></ul>
  </details>`;
}

function wireZenshu(root) {
  root.querySelectorAll('details.zenshu').forEach((el) => {
    el.addEventListener('toggle', async () => {
      if (!el.open || el.dataset.loaded) return;
      el.dataset.loaded = '1';
      const ul = $('ul', el);
      try {
        const idx = await loadZenshu();
        const ids = el.dataset.ids.split(',');
        const rows = ids
          .map((id) => ({ id, r: idx[id] }))
          .sort((a, b) => (a.r?.religious_term_count ?? 999) - (b.r?.religious_term_count ?? 999));
        ul.innerHTML = rows.map(({ id, r }) => `<li>${esc(citeZenshu(id, r))}</li>`).join('')
          + '<li class="muted">参考候補：語句の一致から拾った候補で、内容の確認はまだです。</li>';
      } catch {
        ul.innerHTML = '<li class="muted">全集索引を読み込めませんでした。</li>';
      }
    });
  });
}

// ---- 人体図 ----
function chartSVG({ highlight = {}, showAll = false, includeSelf = false, selected = null } = {}) {
  const { width, height, image } = db.raw.points.chart;
  const items = db.pointList
    .filter((p) => showAll ? (includeSelf || !p.selfProbe) : (highlight[p.id] || !p.selfProbe))
    .map((p) => {
      const h = highlight[p.id];
      const cls = ['pt', h || (showAll && !p.selfProbe) ? 'on' : '', showAll && p.selfProbe ? 'self' : '', h?.key ? 'key' : '', selected === p.id ? 'sel' : ''].join(' ');
      return (p.chart || []).map(([x, y]) =>
        `<g class="${cls}" data-id="${p.id}"><title>${esc(p.no)} ${esc(p.name)}</title><circle cx="${x}" cy="${y}" r="${h || showAll ? 8 : 5}"/>${h || showAll ? `<text x="${x}" y="${y + .4}">${p.no}</text>` : ''}</g>`
      ).join('');
    }).join('');
  return `<div class="chart">
    <img src="${esc(image)}" alt="人体図（前面・背面・側頭部・頭頂）" width="${width}" height="${height}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="探査箇所の位置">${items}</svg>
  </div>`;
}

// ---- 楽屋と舞台 ----
function routeHTML(route) {
  if (!route || !route.length) return '';
  return `<div class="route">${route.map((n, i) => {
    const cls = route.length > 1 && i === 0 ? 'rakuya' : (i === route.length - 1 ? 'butai' : '');
    return `${i ? '<span class="arrow">→</span>' : ''}<span class="node ${cls}">${esc(n)}</span>`;
  }).join('')}</div>`;
}

function flowBlock(f) {
  return `<div class="flow-block">
    <div class="flow-title"><span class="src-label">3級テキスト</span>${esc(f.stage)}</div>
    ${routeHTML(f.route)}
    <div class="small">探査で見つめる順：${f.look_order.map(esc).join(' → ')}</div>
    <p class="basis">${esc(f.basis)}</p>
    <div class="cite">根拠：3級テキスト ${esc(f.textbook)}</div>
    ${zenshuDetails(f.zenshu_candidates)}
  </div>`;
}

function routeBlock(r) {
  return `<div class="flow-block">
    <div class="flow-title"><span class="src-label">早見表 No.${r.no}</span>${esc(r.text)}</div>
    ${routeHTML(r.route)}
    ${r.note ? `<div class="small muted">※${esc(r.note)}</div>` : ''}
    <div class="cite">根拠：${esc(db.raw.routes.source)}</div>
  </div>`;
}

// ---- 本日の症状 ----
function renderChips() {
  const groups = db.raw.symptoms.groups;
  $('#chips').innerHTML = groups.map((g) => `
    <div class="chip-group"><h4>${esc(g)}</h4>
      ${db.categories.filter((c) => c.group === g).map((c) =>
        `<button type="button" class="chip" data-id="${c.id}" aria-pressed="false">${esc(c.label)}</button>`).join('')}
    </div>`).join('');
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  });
}

function selectedChips() {
  return [...document.querySelectorAll('#chips .chip[aria-pressed="true"]')].map((b) => b.dataset.id);
}

const SIDE_TEXT = { left: '左側', right: '右側', both: '左右' };

function renderResult(r) {
  const out = [];

  for (const s of r.safety.filter((x) => x.level === 'urgent')) {
    out.push(`<div class="banner urgent">${esc(s.message)}</div>`);
  }
  for (const s of r.safety.filter((x) => x.level !== 'urgent')) {
    out.push(`<div class="banner notice">${esc(s.message)}</div>`);
  }

  if (r.fallback) {
    out.push(`<div class="card">
      <h2>基本の19か所を探査しましょう</h2>
      <p>${r.input.trim() || r.safety.length ? '入力から当てはまる症状の流れが見つかりませんでした。' : ''}頭部4か所、頸部6か所、肩2か所、背部4か所、腎臓部3か所を、番号の順にまんべんなく探査してみましょう。</p>
      <p class="cite">根拠：第3講座 実習「全身の探査にチャレンジ」／岡田式浄化療法の実際 p130-131</p>
    </div>`);
  } else {
    out.push(`<div class="card">
      <h2>読み取った症状（舞台）</h2>
      <div>${r.categories.map((c) => `<span class="tag">${esc(c.label)}</span>`).join('')}</div>
      <p class="small muted">${r.categories.filter((c) => c.words.length).map((c) => `「${esc(c.words.join('」「'))}」`).join(' ')}</p>
      ${r.side ? `<p class="small">「${SIDE_TEXT[r.side]}」の訴えがあります。探査では${SIDE_TEXT[r.side]}を特によく見つめましょう。</p>` : ''}
    </div>`);
  }

  const highlight = Object.fromEntries(r.points.map((p) => [p.id, p]));
  const regionsHit = new Set(r.points.map((p) => p.region));
  const cautions = db.raw.points.regions.filter((g) => g.caution && regionsHit.has(g.id));
  out.push(`<div class="card">
    <h2>探査して見つめる箇所</h2>
    ${chartSVG({ highlight })}
    <div class="chart-legend">
      <span><i style="background:var(--point)"></i>見つめる箇所</span>
      ${r.points.some((p) => p.key) ? '<span><i style="background:var(--point-key);box-shadow:0 0 0 2px #ffd36b"></i>重点（複数の流れが重なる）</span>' : ''}
      <span><i style="background:var(--point-dim)"></i>その他の探査箇所</span>
    </div>
    <ul class="point-list">
      ${r.points.map((p) => `<li>
        <span class="no ${p.key ? 'key' : ''}">${p.no}</span>
        <div><span class="name">${esc(p.name)}</span><span class="region">${esc(p.regionName)}${p.selfProbe ? '・自己探査' : ''}</span>${p.key ? '<span class="badge">重点</span>' : ''}</div>
      </li>`).join('')}
    </ul>
    <p class="small muted">番号は探査の順序（岡田式浄化療法の実際 p131）です。</p>
    ${cautions.map((g) => `<div class="caution">${esc(g.name)}：${esc(g.caution)}</div>`).join('')}
  </div>`);

  out.push(`<div class="card">
    <h2>探査と施術の目安</h2>
    <ol class="steps">
      <li>上の箇所を探査します。手順は ①発熱 ②固結 ③圧痛。</li>
      <li>一番熱いところ（第二浄化が活発）、一番固いところ（霊のくもりが最も濃い）、熱・固結・圧痛の一致点を探します。</li>
      <li>一番気になる箇所を2か所定めて施術し、変化を見つめます。<br><span class="small">探査5分 → 施術20分 → 確認5分</span></li>
      <li>溶かす場合は力を抜きます。悪い所は小さいので集中します。</li>
    </ol>
    <p class="cite">根拠：第2講座「探査の手順」／第3講座 実習②／第4講座「探査の時に意識すること」／全集 講話篇一巻p224（昭和15年）</p>
  </div>`);

  if (!r.fallback) {
    out.push(`<div class="card">
      <h2>楽屋と舞台（毒素の流れ）</h2>
      <p class="small muted">症状が出ている所が舞台、その原因になっている所が楽屋。楽屋をやらなければ根本的には治らない（3級テキスト p59-61）。</p>
      ${r.categories.map((c) => `
        <h3>${esc(c.label)}</h3>
        ${c.flows.map(flowBlock).join('')}
        ${c.routes.map(routeBlock).join('')}
        ${c.basis ? `<div class="flow-block"><p class="basis">${esc(c.basis)}</p><div class="cite">根拠：3級テキスト ${esc(c.textbook)}</div></div>` : ''}
      `).join('')}
      <p class="small muted">早見表の各経路は、既存のテキストに基づく試験的な分類であり、必ずしも浄化療法の病理の全体像を反映するものではありません。</p>
    </div>`);
  }

  const el = $('#result');
  el.innerHTML = out.join('');
  wireZenshu(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupToday() {
  renderChips();
  const ta = $('#symptom-text');
  try { ta.value = localStorage.getItem(STORE_KEY) || ''; } catch { /* 保存できない環境 */ }
  $('#symptom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try { localStorage.setItem(STORE_KEY, ta.value); } catch { /* 保存できない環境 */ }
    renderResult(analyze(db, ta.value, selectedChips()));
  });
  $('#clear-btn').addEventListener('click', () => {
    ta.value = '';
    document.querySelectorAll('#chips .chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('#result').innerHTML = '';
    try { localStorage.removeItem(STORE_KEY); } catch { /* 保存できない環境 */ }
    ta.focus();
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
      <p class="small muted">頭部4か所、頸部6か所、肩2か所、背部4か所、腎臓部3か所。※20・21は自己探査。</p>
      ${chartSVG({ showAll: true, includeSelf: true, selected })}
      <div class="point-info">${pointInfo(selected)}</div>
    </div>
    ${regions.map((g) => `<div class="card">
      <h2>${esc(g.name)}<span class="muted small">（${g.count}か所${g.self_probe ? '・自己探査' : ''}）</span></h2>
      ${g.caution ? `<div class="caution">${esc(g.caution)}</div>` : ''}
      <ul class="point-list">${g.points.map((p) => `<li data-id="${p.id}">
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
  $('#tab-learn').innerHTML = `
    <div class="card">
      <h2>用語</h2>
      <dl class="terms">${concepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.definition)}<div class="cite">${esc(c.source)}</div></dd>`).join('')}</dl>
    </div>
    <div class="card">
      <h2>施術中・施術後に起こりうる変化</h2>
      <dl class="terms">${patterns.map((p) => `<dt>${esc(p.trigger)}</dt><dd>${esc(p.meaning)}<div class="cite">3級テキスト ${esc(p.textbook)}</div>${zenshuDetails(p.zenshu_candidates)}</dd>`).join('')}</dl>
    </div>
    <div class="card">
      <h2>3級テキストにある毒素の流れ</h2>
      ${db.raw.flows.flows.map(flowBlock).join('')}
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

// ---- タブ ----
function setupTabs() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
      window.scrollTo({ top: 0 });
    });
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
  setupTabs();
  setupToday();
  renderPointsTab();
  renderLearnTab();
}

main();
