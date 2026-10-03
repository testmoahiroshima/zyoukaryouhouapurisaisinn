// 症状入力→提案の簡易テスト：node tools/test_engine.mjs
import { readFileSync } from 'node:fs';
import { prepare, analyze, planSession } from '../app/engine.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const db = prepare({
  points: load('body_points'), flows: load('flows'), routes: load('routes'),
  symptoms: load('symptoms'), safety: load('safety'),
  places: load('places'), knowledge: load('knowledge'), kenkai: load('kenkai'),
});

const cases = [
  // [入力, 含むべきカテゴリ, 含んではいけないカテゴリ, 期待する安全判定]
  ['朝から頭が重くて、肩が張っている', ['headache', 'katakori'], [], []],
  ['頭痛はない。肩こりがひどい', ['katakori'], ['headache'], []],
  ['首が回らない', ['neck'], [], []],
  ['手首が痛い', ['hands'], ['neck'], []],
  ['足首をひねった', ['legs'], ['neck'], []],
  ['睡眠不足で目が疲れる', ['eyes'], ['legs', 'fatigue'], []],
  ['イライラしておでこが熱い', ['frontal'], [], []],
  ['心配事が多くて頭のてっぺんが重い', ['top'], [], []],
  ['左肩がこって動悸がする', ['heart', 'katakori'], [], []],
  ['胃がもたれて食欲がない', ['stomach'], [], []],
  ['脇腹が痛い', ['ribs'], ['abdomen'], []],
  ['お腹が張って便秘気味', ['abdomen'], [], []],
  ['腰が重い、膝も痛い', ['lowback', 'legs'], [], []],
  ['階段で息切れする', ['breath'], [], []],
  ['耳鳴りがする', ['ear'], [], []],
  ['のどが痛い', ['throat'], [], []],
  ['鼻水とくしゃみ', ['nose'], [], []],
  ['全身がだるい', ['fatigue'], [], []],
  ['なんだか眠れない', ['insomnia'], [], []],
  ['かゆみがひどい', ['k:kayumi'], [], []],
  ['痒くてたまらない', ['k:kayumi'], [], []],
  ['手足が冷える', ['k:hie'], [], []],
  ['背中が張る', ['k:senaka'], [], []],
  ['寝汗をかく', ['k:ase'], [], []],
  ['車酔いしやすい', ['k:norimono'], [], []],
  ['口内炎ができた', ['k:kuchi'], [], []],
  ['手がしびれる', ['k:shibire', 'hands'], [], []],
  ['よくわからない', [], [], []],
  ['立ちくらみがする', ['dizziness'], ['eyes'], []],
  ['熱っぽくて寒気がする', ['fever'], [], []],
  ['糖尿病です', ['k:d_tounyou'], ['urinary'], ['disease']],
  ['高血圧で肩がこる', ['k:d_ketsuatsu', 'katakori'], [], ['disease']],
  ['喘息の発作', ['k:d_zensoku'], [], ['disease']],
  ['インフルエンザにかかった', ['k:d_kansen'], [], ['disease']],
  ['胃がんの疑い', ['k:d_gan'], [], ['disease']],
  ['乳がんで治療中', ['k:d_gan'], [], ['disease', 'medicine']],
  ['躁うつ病と診断された', ['k:yuutsu'], [], ['disease']],
  ['頑張りすぎて頭がガンガンする', ['headache'], ['k:d_gan'], []],
  ['うつ病と言われた', ['k:yuutsu'], [], ['disease']],
  ['頑張りすぎて肩が痛い', ['katakori'], [], []],
  ['頭がガンガンする', ['headache'], [], []],
  ['胸に激痛がある', [], [], ['urgent']],
  ['薬をやめたい', [], [], ['medicine']],
  ['金額が気になって不安', ['top'], ['frontal'], []],
  ['ズキズキする後頭部の痛み', ['occipital'], [], []],
  ['ﾒｶﾞﾈをかけると目の奥が痛い', ['eyes'], [], ['disease'].slice(1)],
  ['生理痛がつらい', ['women'], [], []],
];

const KENKAI_EXPECT = { '朝から頭が重くて、肩が張っている': 'katakori', '胃がもたれて食欲がない': 'i', '首が回らない': 'kubi', 'めまいがする': 'memai' };
let fail = 0;
for (const [text, must, mustNot, safety] of cases) {
  const r = analyze(db, text);
  const ids = r.categories.map((c) => c.id);
  const sids = r.safety.map((s) => s.id);
  const errs = [];
  for (const m of must) if (!ids.includes(m)) errs.push(`missing ${m}`);
  for (const m of mustNot) if (ids.includes(m)) errs.push(`unexpected ${m}`);
  for (const s of safety) if (!sids.includes(s)) errs.push(`missing safety ${s}`);
  for (const s of sids) if (!safety.includes(s)) errs.push(`unexpected safety ${s}`);
  if (!must.length && ids.length) errs.push(`expected none, got ${ids}`);
  // 見解が出るべき症状
  if (KENKAI_EXPECT[text] && !r.kenkai.some((e) => e.id === KENKAI_EXPECT[text])) errs.push(`missing kenkai ${KENKAI_EXPECT[text]}`);
  if (!must.length && !r.fallback) errs.push('expected fallback');
  const pts = r.points.map((p) => p.no + (p.key ? '*' : '')).join(',');
  console.log(`${errs.length ? 'NG' : 'ok'}  ${text} → [${ids}] safety[${sids}] side=${r.side} points=${pts}${errs.length ? '  !! ' + errs.join('; ') : ''}`);
  if (errs.length) fail++;
}

// 「霊的」という言葉は画面に出さない。見解を載せない病気も、受診の案内だけ
{
  const txt = JSON.stringify(db.raw.kenkai) + JSON.stringify(db.raw.knowledge);
  const r = analyze(db, '統合失調症と言われた');
  const good = !txt.replace(/"_note":"[^"]*"/g, '').includes('霊的') && r.spiritual.length && !r.kenkai.length && !db.raw.kenkai.spiritual.message.includes('霊');
  console.log(`${good ? 'ok' : 'NG'}  「霊的」を出さない・見解を載せない病気は受診の案内のみ`);
  if (!good) fail++;
  const gan = db.kenkai.find((e) => e.id === 'd_gan');
  const g2 = gan && gan.disease && /医療機関/.test(gan.note) && /医療に代わるものではありません/.test(gan.note);
  console.log(`${g2 ? 'ok' : 'NG'}  がんの見解は医療を前提にした注意つき`);
  if (!g2) fail++;
}

// 毒素の流れの補完（例：肩の前に肩甲間部・腎臓部）
const has = (text, ids) => {
  const r = analyze(db, text);
  const got = new Set(r.points.map((p) => p.id));
  const miss = ids.filter((id) => !got.has(id));
  console.log(`${miss.length ? 'NG' : 'ok'}  points(${text}) ⊇ ${ids}${miss.length ? '  !! missing ' + miss : ''}`);
  if (miss.length) fail++;
  return r;
};
has('肩が重い', ['kata', 'kenkoukan', 'haimen_jinzo']);
has('首が回らない', ['kata', 'kenkoukan', 'haimen_jinzo', 'enzui']);
has('後頭部が痛い', ['koutoubu', 'enzui', 'kata', 'kenkoukan', 'haimen_jinzo']);
has('足がだるい', ['youkotsu', 'biteikotsu', 'jinzo_kahou', 'haimen_jinzo', 'sokeibu']);
has('痔で困っている', ['koutoubu', 'sokeibu', 'biteikotsu']);
const kat = analyze(db, '肩が重い');
const flow = kat.categories[0].flows[0];
const names = flow.stations.map((s) => (s.via ? '(' + s.name + ')' : s.name)).join(' → ');
console.log('     流れ:', names);
if (!flow.stations.some((s) => s.points?.includes('kenkoukan'))) { console.log('NG  katakori flow lacks 肩甲間部'); fail++; }

// 時間配分
const plan = planSession(db, {
  kata: { heat: 3, kouketsu: 5, atsutsuu: 3 },
  kenkoukan: { heat: 2, kouketsu: 3, atsutsuu: 1 },
  haimen_jinzo: { heat: 2, kouketsu: 5, atsutsuu: 0 },
  zentoubu: { heat: 0, kouketsu: 2, atsutsuu: 0 },
  kenkoukotsu_ka: { heat: 4, kouketsu: 4, atsutsuu: 4 },
  kenkoukotsu: { heat: 4, kouketsu: 4, atsutsuu: 4 },
}, 45, kat);
const sum = plan.probe + plan.check + plan.items.reduce((s, i) => s + i.minutes, 0);
console.log(`${sum === 45 ? 'ok' : 'NG'}  plan 45分: 探査${plan.probe} ` + plan.items.map((i) => `${i.name}${i.minutes}`).join(' ') + ` 確認${plan.check} (合計${sum})`);
if (sum !== 45) fail++;
// 上から下の順（背面図での高さ）
const ys = plan.items.map((i) => db.pointById[i.id].anchor[1]);
if (ys.some((y, i) => i && y < ys[i - 1])) { console.log('NG order top-down', plan.items.map((i) => i.name)); fail++; }
console.log('     順序（上から下）:', plan.items.map((i) => i.name).join(' → '));
const planT = planSession(db, { kenkoukotsu_ka: { heat: 4, kouketsu: 4 }, kenkoukotsu: { heat: 4, kouketsu: 4 } }, 30, kat, { order: 'text' });
if (planT.items[0].no > planT.items[1].no) { console.log('NG order text'); fail++; }
const none = planSession(db, {}, 30, kat);
if (none.ok) { console.log('NG empty plan should fail'); fail++; }
for (const t of [15, 20, 45, 60]) {
  const p2 = planSession(db, { kata: { heat: 3, kouketsu: 3, atsutsuu: 2 }, sokeibu: { heat: 2, kouketsu: 3, atsutsuu: 2 }, haimen_jinzo: { heat: 0, kouketsu: 3, atsutsuu: 0 } }, t, kat);
  const s2 = p2.probe + p2.check + p2.items.reduce((s, i) => s + i.minutes, 0);
  console.log(`${s2 === t ? 'ok' : 'NG'}  plan ${t}分 → 合計${s2}: ` + p2.items.map((i) => `${i.name}${i.minutes}`).join(' '));
  if (s2 !== t) fail++;
}
// 重要施術部位（頭・肩・腎臓部）は所見が無くても必ず入る
for (const [f, t] of [[{ sokeibu: { heat: 4 } }, 15], [{ youkotsu: { kouketsu: 5 }, biteikotsu: { kouketsu: 5 } }, 30], [{ koutoubu: { heat: 2 } }, 60]]) {
  const p3 = planSession(db, f, t, null);
  const regs = new Set(p3.items.map((i) => db.pointById[i.id].region));
  const s3 = p3.probe + p3.check + p3.items.reduce((s, i) => s + i.minutes, 0);
  const good = ['head', 'shoulder', 'kidney'].every((r) => regs.has(r)) && s3 === t && p3.items.every((i) => i.minutes >= 2);
  console.log(`${good ? 'ok' : 'NG'}  頭・肩・腎臓部を必ず含む ${t}分: ` + p3.items.map((i) => `${i.name}${i.minutes}${i.stub ? '(所見なし)' : ''}`).join(' '));
  if (!good) fail++;
}

// 左右と排泄経路：右の腎臓部が強く、右の腸骨の内側にも固結 → 右の腎臓部を重点・出口を先に
{
  const side = (L, R) => ({ heat: Math.max(L.heat || 0, R.heat || 0), kouketsu: Math.max(L.kouketsu || 0, R.kouketsu || 0), atsutsuu: Math.max(L.atsutsuu || 0, R.atsutsuu || 0), sides: { L, R } });
  const f = {
    haimen_jinzo: side({ kouketsu: 1.5 }, { kouketsu: 4, atsutsuu: 2 }),
    choukotsu: side({ kouketsu: 1 }, { kouketsu: 3.5 }),
    kata: side({ kouketsu: 3, heat: 2 }, { kouketsu: 3, heat: 2 }),
    koutoubu: { heat: 2, kouketsu: 1 },
  };
  const pl = planSession(db, f, 40, null);
  const kid = pl.items.find((i) => i.id === 'haimen_jinzo');
  const cho = pl.items.find((i) => i.id === 'choukotsu');
  const idx = (id) => pl.items.findIndex((i) => i.id === id);
  const good = kid?.side === 'R' && kid.reasons.some((r) => r.ref === 'kotsuban_naibu') && cho?.side === 'R'
    && pl.order === 'outlet' && idx('choukotsu') < idx('haimen_jinzo') && idx('haimen_jinzo') < idx('kata')
    && pl.excretion.level === 'blocked' && pl.excretion.side === 'R' && kid.split?.[0].side === 'R' && kid.split[0].minutes > (kid.split[1]?.minutes || 0)
    && pl.notes.some((n) => n.ref === 'haisetsu_keiro');
  console.log(`${good ? 'ok' : 'NG'}  右の腎臓部＋右の腸骨内側 → 順序 ${pl.items.map((i) => `${i.name}${i.side ? '(' + (i.side === 'R' ? '右' : '左') + ')' : ''}${i.minutes}${i.split ? '[' + i.split.map((x) => (x.side === 'R' ? '右' : '左') + x.minutes).join('/') + ']' : ''}`).join(' → ')}`);
  if (!good) fail++;
  // 骨盤まわりが塗られていなければ「排泄経路は整っていますか？」と促す
  const pl2 = planSession(db, { kata: { kouketsu: 3 } }, 30, null);
  const g2 = pl2.order === 'top' && pl2.notes.some((n) => n.title.includes('排泄経路は整って'));
  console.log(`${g2 ? 'ok' : 'NG'}  骨盤まわり未入力 → 確認を促す（順序 ${pl2.order}）`);
  if (!g2) fail++;
}

// つらい場所の問い返しと、場所・感じから作る文
{
  const { needsPlace, phrasesFor, catsFor } = await import('../app/zones.js');
  const cases = [['痛い', true], ['ずっとかゆい', true], ['膝が痛い', false], ['肩が重い', false], ['眠れない', false], ['', false]];
  for (const [t, want] of cases) {
    const got = needsPlace(t);
    console.log(`${got === want ? 'ok' : 'NG'}  問い返し「${t}」→ ${got}`);
    if (got !== want) fail++;
  }
  const ph = phrasesFor(['hiza', 'kata'], ['itai', 'nemure']);
  const r = analyze(db, ph.join('。'), catsFor(['hiza', 'kata']));
  const ids = r.categories.map((c) => c.id);
  const good = ph.includes('膝が痛い') && ph.includes('眠れない') && ids.includes('legs') && ids.includes('katakori') && ids.includes('insomnia');
  console.log(`${good ? 'ok' : 'NG'}  場所＋感じ → ${ph.join('・')} → ${ids.join(',')}`);
  if (!good) fail++;
}

// データの整合：参照している id がすべて存在するか
const ids = new Set(db.pointList.map((p) => p.id));
for (const k of db.raw.knowledge.kakuron) for (const id of k.points) if (!ids.has(id)) { console.log('bad point in kakuron', k.id, id); fail++; }
for (const k of db.raw.knowledge.kakuron) for (const c of k.categories) if (!db.categories.some((x) => x.id === c)) { console.log('bad category in kakuron', k.id, c); fail++; }
for (const f of db.raw.flows.flows) for (const id of f.look_points) if (!ids.has(id)) { console.log('bad point in flow', f.id, id); fail++; }
for (const r of db.raw.routes.routes) for (const id of r.look_points) if (!ids.has(id)) { console.log('bad point in route', r.no, id); fail++; }
for (const c of db.raw.symptoms.categories) {
  for (const id of c.flows) if (!db.flowById[id]) { console.log('bad flow', c.id, id); fail++; }
  for (const no of c.routes) if (!db.routeByNo[no]) { console.log('bad route', c.id, no); fail++; }
  for (const id of c.extra_points || []) if (!ids.has(id)) { console.log('bad extra', c.id, id); fail++; }
}
const used = new Set(db.raw.symptoms.categories.flatMap((c) => c.routes));
for (const r of db.raw.routes.routes) if (!used.has(r.no)) console.log('route not used by any category:', r.no);
const usedF = new Set(db.raw.symptoms.categories.flatMap((c) => c.flows));
for (const f of db.raw.flows.flows) if (!usedF.has(f.id)) console.log('flow not used by any category:', f.id);
console.log('keywords:', db.categories.reduce((n, c) => n + c.keywords.length, 0), 'categories:', db.categories.length);
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
