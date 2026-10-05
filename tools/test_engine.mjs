// 症状入力→提案の簡易テスト：node tools/test_engine.mjs
import { readFileSync } from 'node:fs';
import { prepare, analyze, planSession, findingScore, excretionCheck, nextAdvice, historyHints } from '../app/engine.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const db = prepare({
  points: load('body_points'), flows: load('flows'), routes: load('routes'),
  symptoms: load('symptoms'), safety: load('safety'),
  places: load('places'), knowledge: load('knowledge'), kenkai: load('kenkai'), relations: load('relations'),
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

// 左右の差が小さい肩も、全体の傾向で重点の側を決めて時間差をつける。頭部は一か所数分まで
{
  const side = (L, R) => ({ heat: Math.max(L.heat || 0, R.heat || 0), kouketsu: Math.max(L.kouketsu || 0, R.kouketsu || 0), atsutsuu: 0, sides: { L, R } });
  const f = { kata: side({ kouketsu: 3 }, { kouketsu: 3 }), haimen_jinzo: side({ kouketsu: 4 }, { kouketsu: 1 }), zentoubu: { heat: 3, kouketsu: 2 } };
  const pl = planSession(db, f, 60, null);
  const kata = pl.items.find((i) => i.id === 'kata');
  const head = pl.items.filter((i) => i.region === 'head');
  const good = kata.side === 'L' && kata.split.length === 2 && kata.split[0].side === 'L' && kata.split[0].minutes > kata.split[1].minutes
    && head.length === 3 && head.every((i) => i.minutes <= 3) && pl.total === 60;
  console.log(`${good ? 'ok' : 'NG'}  肩は左右同じでも全体の傾向（左）で左を重点 ${kata.split.map((x) => x.side + x.minutes).join('/')}・頭部 ${head.map((i) => i.name + i.minutes).join(' ')}`);
  if (!good) fail++;
  const pl2 = planSession(db, { kata: side({ kouketsu: 2 }, { kouketsu: 2 }) }, 30, analyze(db, '右の肩がこる'));
  const k2 = pl2.items.find((i) => i.id === 'kata');
  const g2 = k2.side === 'R' && k2.split[0].minutes > (k2.split[1]?.minutes || 0);
  console.log(`${g2 ? 'ok' : 'NG'}  訴えが右 → 右の肩を重点 ${k2.split.map((x) => x.side + x.minutes).join('/')}`);
  if (!g2) fail++;
  const pl3 = planSession(db, { zentoubu: { heat: 4, kouketsu: 3 } }, 60, analyze(db, '頭が痛い'));
  const z3 = pl3.items.find((i) => i.id === 'zentoubu');
  const g3 = z3.minutes > 3 && z3.minutes <= Math.max(4, Math.round(45 * 0.12));
  console.log(`${g3 ? 'ok' : 'NG'}  頭痛の訴えがある時だけ頭部を長めに（前頭部 ${z3.minutes}分）`);
  if (!g3) fail++;
}

// 図でさした細かい場所（左右・上中下）から作る文：「右の胸が痛い」→ 胸の分類・右側
{
  const { zoneDetail, phrasesForDetails } = await import('../app/zones.js');
  const d = zoneDetail({ x: -0.06, y: 1.22, z: 0.1 });
  const ph = phrasesForDetails([d], ['itai']);
  const r = analyze(db, ph.join('。'), ['lungs', 'heart']);
  const good = d.zone === 'mune' && d.side === 'R' && ph[0] === '右の胸が痛い' && r.side === 'right' && d.at.length === 3;
  console.log(`${good ? 'ok' : 'NG'}  細かい場所 → ${d.label}（${d.at}）→ 「${ph[0]}」 side=${r.side}`);
  if (!good) fail++;
}

// 頭部・肩・腎臓部は一まとまり：一部だけ出たり、一部だけが重点になったりしない
{
  const G = [['zentoubu', 'touchoubu', 'sokutoubu', 'koutoubu'], ['kata', 'maekata'], ['haimen_jinzo', 'jinzo_kahou', 'jinzo_kahou_side']];
  const words = [...db.categories.map((c) => c.label.split(/[（・]/)[0]), ...db.kenkai.map((e) => e.label.split(/[・（]/)[0]), '頭がかゆい', '後頭部がかゆい', '眠れない'];
  const bad = [];
  for (const w of words) {
    const r = analyze(db, w);
    if (r.fallback) continue;
    const ids = new Set(r.points.map((p) => p.id));
    const keys = new Set(r.points.filter((p) => p.key).map((p) => p.id));
    for (const g of G) {
      const n = g.filter((id) => ids.has(id)).length;
      const k = g.filter((id) => keys.has(id)).length;
      if ((n && n < g.length) || (k && k < g.length)) bad.push(`${w}:${g[0]}`);
    }
  }
  const hd = analyze(db, '頭がかゆい').points.map((p) => p.id);
  const good = !bad.length && ['zentoubu', 'touchoubu', 'sokutoubu', 'koutoubu'].every((id) => hd.includes(id));
  console.log(`${good ? 'ok' : 'NG'}  頭部・肩・腎臓部は一まとまりで出す（${words.length}語）${bad.length ? ' !! ' + bad.slice(0, 8).join(' ') : ''}`);
  if (!good) fail++;
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
// 上から下の順：頭部は前頭部 → 頭頂部 → こめかみ部 → 後頭部の順で先頭に、そのあとは背面図での高さ順
const HEAD_ORDER = ['zentoubu', 'touchoubu', 'sokutoubu', 'koutoubu'];
const ys = plan.items.map((i) => (HEAD_ORDER.includes(i.id) ? -1000 + HEAD_ORDER.indexOf(i.id) : db.pointById[i.id].anchor[1]));
if (plan.items[0].id !== 'zentoubu' || ys.some((y, i) => i && y < ys[i - 1])) { console.log('NG order top-down', plan.items.map((i) => i.name)); fail++; }
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
  const ids3 = new Set(p3.items.map((i) => i.id));
  const good = ['head', 'shoulder', 'kidney'].every((r) => regs.has(r)) && ids3.has('zentoubu') && ids3.has('touchoubu') && s3 === t
    && p3.items.every((i) => i.minutes >= (i.headStub ? 1 : 2));
  console.log(`${good ? 'ok' : 'NG'}  頭（前頭部・頭頂部）・肩・腎臓部を必ず含む ${t}分: ` + p3.items.map((i) => `${i.name}${i.minutes}${i.stub ? '(所見なし)' : ''}`).join(' '));
  if (!good) fail++;
}

// 鼠蹊部・恥骨部（自己探査）に張り・痛み・熱があれば、ほかの所見が強くても必ず入る
{
  const strong = { kata: { heat: 5, kouketsu: 5, atsutsuu: 4 }, kenkoukan: { heat: 5, kouketsu: 5, atsutsuu: 5 }, kenkoukotsu: { heat: 5, kouketsu: 5 }, haimen_jinzo: { heat: 4, kouketsu: 5, atsutsuu: 4 }, sekichuu: { heat: 4, kouketsu: 4 }, koukeibu: { heat: 4, kouketsu: 4 }, enzui: { heat: 4, kouketsu: 4 } };
  for (const [extra, want, t] of [
    [{ sokeibu: { heat: 0, kouketsu: 0, atsutsuu: 1.5 } }, ['sokeibu'], 30],
    [{ chikotsu: { heat: 0, kouketsu: 2, atsutsuu: 0 } }, ['chikotsu'], 30],
    [{ sokeibu: { heat: 1, kouketsu: 0, atsutsuu: 0 }, chikotsu: { heat: 0, kouketsu: 0, atsutsuu: 2 } }, ['sokeibu', 'chikotsu'], 60],
    [{ sokeibu: { heat: 0, kouketsu: 2, atsutsuu: 1 }, chikotsu: { heat: 0, kouketsu: 1, atsutsuu: 0 } }, ['sokeibu', 'chikotsu'], 15],
  ]) {
    const pl = planSession(db, { ...strong, ...extra }, t, null);
    const got = pl.items.filter((i) => want.includes(i.id));
    const sum = pl.probe + pl.check + pl.items.reduce((x, i) => x + i.minutes, 0);
    const good = got.length === want.length && got.every((i) => i.must && i.minutes >= 1) && pl.items.filter((i) => i.key).length >= 5;
    console.log(`${good ? 'ok' : 'NG'}  鼠蹊部・恥骨部を必ず含む ${t}分（合計${sum}）: ` + pl.items.map((i) => `${i.name}${i.minutes}${i.must ? '(必ず)' : ''}`).join(' '));
    if (!good) fail++;
  }
  // ごく薄い所見（1未満）は、ほかの所見に押し出されてもよい
  const thin = planSession(db, { ...strong, sokeibu: { heat: 0, kouketsu: 0.5, atsutsuu: 0 } }, 30, null);
  if (thin.items.some((i) => i.must)) { console.log('NG 薄い所見まで必ず入れている'); fail++; }
}

// 実際の記録から（首のかゆみ・60分）：訴えの首の所見（後頸部・頸髄部）を外さず、頭部は1か所3〜4分まで、
// 骨盤まわり（腰骨部・腸骨の内側）の固結も入れる。頸髄部は熱の強い左を重点に
{
  const f = {"youkotsu":{"heat":0,"kouketsu":5,"atsutsuu":0},"jinzo_kahou":{"heat":1.9,"kouketsu":5,"atsutsuu":0,"sides":{"L":{"heat":1.9,"kouketsu":5,"atsutsuu":0},"R":{"heat":1.5,"kouketsu":5,"atsutsuu":0}}},"kenkoukan":{"heat":2.8,"kouketsu":5,"atsutsuu":1.9,"sides":{"L":{"heat":0,"kouketsu":3.5,"atsutsuu":0},"R":{"heat":2.8,"kouketsu":5,"atsutsuu":1.9}}},"kenkoukotsu_ka":{"heat":1.5,"kouketsu":2,"atsutsuu":0,"sides":{"R":{"heat":1.5,"kouketsu":2,"atsutsuu":0}}},"sekichuu":{"heat":0,"kouketsu":2.1,"atsutsuu":0},"kenkoukotsu":{"heat":1.8,"kouketsu":2,"atsutsuu":1,"sides":{"L":{"heat":0,"kouketsu":2,"atsutsuu":0},"R":{"heat":1.8,"kouketsu":1.9,"atsutsuu":1}}},"koutoubu":{"heat":4,"kouketsu":3,"atsutsuu":0},"haimen_jinzo":{"heat":1.7,"kouketsu":5,"atsutsuu":0,"sides":{"L":{"heat":1.7,"kouketsu":5,"atsutsuu":0},"R":{"heat":0,"kouketsu":2,"atsutsuu":0}}},"koukeibu":{"heat":5,"kouketsu":3.3,"atsutsuu":1.8},"keizui":{"heat":4.8,"kouketsu":4,"atsutsuu":1,"sides":{"L":{"heat":4.8,"kouketsu":4,"atsutsuu":0},"R":{"heat":3.1,"kouketsu":2.8,"atsutsuu":1}}},"jinzo_kahou_side":{"heat":0,"kouketsu":3.1,"atsutsuu":0,"sides":{"L":{"heat":0,"kouketsu":3.1,"atsutsuu":0},"R":{"heat":0,"kouketsu":1,"atsutsuu":0}}},"kata":{"heat":0,"kouketsu":2.9,"atsutsuu":0,"sides":{"R":{"heat":0,"kouketsu":2.9,"atsutsuu":0}}},"touchoubu":{"heat":3,"kouketsu":0,"atsutsuu":0},"sokutoubu":{"heat":3,"kouketsu":0,"atsutsuu":0,"sides":{"L":{"heat":3,"kouketsu":0,"atsutsuu":0},"R":{"heat":3,"kouketsu":0,"atsutsuu":0}}},"choukotsu":{"heat":0,"kouketsu":3.4,"atsutsuu":0,"sides":{"L":{"heat":0,"kouketsu":2.3,"atsutsuu":0},"R":{"heat":0,"kouketsu":3.4,"atsutsuu":0}}},"zentoubu":{"heat":1.8,"kouketsu":0,"atsutsuu":0}};
  const a = analyze(db, '首が痛い。首がかゆい。首が重い。熱っぽい', []);
  for (const t of [60, 45, 30, 15]) {
    const pl = planSession(db, f, t, a);
    const ids = pl.items.map((i) => i.id);
    const sum = pl.probe + pl.check + pl.items.reduce((s, i) => s + i.minutes, 0);
    const head = pl.items.filter((i) => db.pointById[i.id].region === 'head');
    const kz = pl.items.find((i) => i.id === 'keizui');
    const good = sum === t && ids[0] === 'zentoubu' && ids.includes('koukeibu') && ids.includes('youkotsu')
      && head.every((i) => i.minutes <= 4) && (t < 30 || ids.includes('choukotsu')) && (t < 45 || (ids.includes('keizui') && ids.includes('kenkoukan') && kz.split[0].side === 'L'));
    console.log(`${good ? 'ok' : 'NG'}  記録（首のかゆみ）${t}分：` + pl.items.map((i) => `${i.name}${i.minutes}`).join(' '));
    if (!good) fail++;
  }
}

// 重なりの加点：薄くても、色が重なっていれば重く数える（三つ重なれば急所）
{
  const thin = findingScore({ heat: 0.3, kouketsu: 0.3 });
  const tri = findingScore({ heat: 0.3, kouketsu: 0.3, atsutsuu: 0.3 });
  const good = thin > findingScore({ kouketsu: 3 }) && tri > thin + 1.5;
  console.log(`${good ? 'ok' : 'NG'}  重なりの加点：熱0.3＋固結0.3=${thin.toFixed(2)}、三つ=${tri.toFixed(2)}、固結3=${findingScore({ kouketsu: 3 }).toFixed(2)}`);
  if (!good) fail++;
  // ほかの固結に熱が無い時は、腎臓部を長めに（浄化力を高める）
  const p1 = planSession(db, { kata: { kouketsu: 3 }, kenkoukan: { kouketsu: 3 }, haimen_jinzo: { kouketsu: 3 } }, 60, null);
  const p2 = planSession(db, { kata: { kouketsu: 3, heat: 3 }, kenkoukan: { kouketsu: 3 }, haimen_jinzo: { kouketsu: 3 } }, 60, null);
  const kid = (p) => p.items.find((i) => i.id === 'haimen_jinzo').minutes;
  const g2 = kid(p1) > kid(p2);
  console.log(`${g2 ? 'ok' : 'NG'}  ほかに熱が無い時は腎臓部を長めに：${kid(p1)}分（熱がある時 ${kid(p2)}分）`);
  if (!g2) fail++;
}

// 頭痛の元：首の固結の圧迫（脳貧血）・頸部淋巴腺の浄化熱・延髄部の浄化熱（根原は腎臓）・頭部の毒血
{
  const cases = [
    ['頭が痛い', { koukeibu: { kouketsu: 4 }, kata: { kouketsu: 3 }, haimen_jinzo: { kouketsu: 2 } }, 'hinketsu', 'koukeibu'],
    ['おでこが痛い', { keibu_lymph: { heat: 3, kouketsu: 2 }, zentoubu: { heat: 1 }, kata: { kouketsu: 2 }, haimen_jinzo: { kouketsu: 2 } }, 'lymph', 'keibu_lymph'],
    ['後頭部が痛い', { enzui: { heat: 3 }, kata: { kouketsu: 2 }, haimen_jinzo: { kouketsu: 3 } }, 'enzui', 'enzui'],
    ['頭が痛い', { zentoubu: { heat: 4 }, kata: { kouketsu: 2 }, haimen_jinzo: { kouketsu: 2 } }, 'doku', 'zentoubu'],
  ];
  for (const [text, f, type, id] of cases) {
    const pl = planSession(db, f, 30, analyze(db, text, []));
    const it = pl.items.find((i) => i.id === id);
    const note = pl.notes.find((n) => n.title === '頭痛の元の見立て');
    const sum = pl.probe + pl.check + pl.items.reduce((s, i) => s + i.minutes, 0);
    const good = it && it.reasons.some((r) => r.ref === 'zutsuu_moto') && note && sum === 30 && (type !== 'doku' || it.minutes >= 4);
    console.log(`${good ? 'ok' : 'NG'}  頭痛の元（${type}）「${text}」：` + pl.items.map((i) => `${i.name}${i.minutes}`).join(' '));
    if (!good) fail++;
  }
  const none = planSession(db, { kata: { kouketsu: 3 } }, 30, analyze(db, '頭が痛い', []));
  if (!none.notes.some((n) => n.title === '頭痛の元を探りましょう')) { console.log('NG 頭痛で所見が無い時の案内'); fail++; }
}

// 頭部の熱の浅い・深い：深い熱は頭部が元（頭部を長めに）、浅い熱はほかから（首の淋巴腺・耳下腺・陰部、後頭部は延髄部の辺り）
{
  const base = { zentoubu: { heat: 3 }, keibu_lymph: { kouketsu: 2 }, chikotsu: { kouketsu: 1.5 }, kata: { kouketsu: 3 }, haimen_jinzo: { kouketsu: 3 } };
  const deep = planSession(db, { ...base, zentoubu: { heat: 3, depth: 'deep' } }, 60, null);
  const shallow = planSession(db, { ...base, zentoubu: { heat: 3, depth: 'shallow' } }, 60, null);
  const m = (p, id) => p.items.find((i) => i.id === id)?.minutes || 0;
  const P = (p, id) => p.items.find((i) => i.id === id)?.P || 0;
  const good = m(deep, 'zentoubu') > m(shallow, 'zentoubu') && P(shallow, 'keibu_lymph') > P(deep, 'keibu_lymph') && P(shallow, 'chikotsu') > P(deep, 'chikotsu')
    && shallow.notes.some((n) => n.title === '頭部の熱の浅い・深い') && deep.notes.some((n) => n.title === '頭部の熱の浅い・深い');
  console.log(`${good ? 'ok' : 'NG'}  熱の深さ：深い→前頭部${m(deep, 'zentoubu')}分、浅い→前頭部${m(shallow, 'zentoubu')}分・頸部淋巴腺部${m(shallow, 'keibu_lymph')}分・恥骨部${m(shallow, 'chikotsu')}分`);
  if (!good) fail++;
  const back = planSession(db, { koutoubu: { heat: 3, depth: 'shallow' }, enzui: { kouketsu: 2 }, kata: { kouketsu: 2 }, haimen_jinzo: { kouketsu: 2 } }, 30, null);
  const g2 = back.items.find((i) => i.id === 'enzui')?.reasons.some((r) => r.ref === 'netsu_fukasa');
  console.log(`${g2 ? 'ok' : 'NG'}  後頭部の浅い熱 → 延髄部の辺りを元として重く`);
  if (!g2) fail++;
  // 頭痛：浅い熱は頭部の毒血とみない
  const hp = planSession(db, { zentoubu: { heat: 4, depth: 'shallow' }, keibu_lymph: { kouketsu: 3 }, kata: { kouketsu: 2 }, haimen_jinzo: { kouketsu: 2 } }, 30, analyze(db, '頭が痛い', []));
  const g3 = !hp.items.find((i) => i.id === 'zentoubu').reasons.some((r) => r.text.includes('毒血'));
  console.log(`${g3 ? 'ok' : 'NG'}  頭痛で浅い熱は、頭部の毒血とみない`);
  if (!g3) fail++;
}

// 排泄経路：骨盤まわりの強い圧痛・熱も詰まりとみる（固結より軽く）
{
  const lv = (f) => excretionCheck(db, f, null).level;
  const good = lv({ sokeibu: { atsutsuu: 5, heat: 4 } }) === 'blocked' && lv({ sokeibu: { atsutsuu: 3 } }) === 'some' && lv({ sokeibu: { atsutsuu: 1 } }) === 'clear';
  console.log(`${good ? 'ok' : 'NG'}  排泄経路に圧痛・熱も入れる`);
  if (!good) fail++;
}

// 前回の記録から：終わりにも残っていた所を重く、変わらなかった所は見直しを促す。施術後には次回の提案を出す
{
  const prev = {
    date: '2026-10-01', session_id: 'x',
    findings: [{ point_id: 'kata', kouketsu: 4 }, { point_id: 'kenkoukan', kouketsu: 3, heat: 2 }, { point_id: 'haimen_jinzo', kouketsu: 3 }],
    findings_after: [{ point_id: 'kata', kouketsu: 4 }, { point_id: 'kenkoukan', kouketsu: 1 }, { point_id: 'haimen_jinzo', kouketsu: 3 }],
    treatments: [{ point_id: 'kata', minutes: 5 }, { point_id: 'kenkoukan', minutes: 5 }, { point_id: 'haimen_jinzo', minutes: 5 }],
  };
  const h = historyHints(prev);
  const f = { kata: { kouketsu: 3 }, kenkoukan: { kouketsu: 3 }, haimen_jinzo: { kouketsu: 3 } };
  const p0 = planSession(db, f, 30, null);
  const p1 = planSession(db, f, 30, null, { prev });
  const kata = (p) => p.items.find((i) => i.id === 'kata');
  const good = h.remain.has('kata') && h.unchanged.has('kata') && h.improved.has('kenkoukan')
    && kata(p1).P > kata(p0).P && p1.notes.some((n) => n.title.startsWith('前回'));
  console.log(`${good ? 'ok' : 'NG'}  前回の続き：残った所を重く（肩 ${kata(p0).P.toFixed(1)}→${kata(p1).P.toFixed(1)}）・変化の少ない所の見直し`);
  if (!good) fail++;
  const adv = nextAdvice(db, { kata: { kouketsu: 4 }, kenkoukan: { kouketsu: 3 }, enzui: { kouketsu: 2 } }, { kata: { kouketsu: 4 }, kenkoukan: { kouketsu: 1, heat: 1 }, keizui: { heat: 2 }, enzui: { kouketsu: 2 } }, [{ id: 'kata' }, { id: 'kenkoukan' }]);
  const kinds = adv.map((x) => x.kind);
  const g2 = ['good', 'up', 'move', 'same', 'todo'].every((k) => kinds.includes(k));
  console.log(`${g2 ? 'ok' : 'NG'}  次回の提案：${kinds.join(',')}`);
  if (!g2) fail++;
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
  // 基本は上から下（前頭部から）。排泄経路が詰まっていても自動では出口を先にしない
  const pl0 = planSession(db, f, 40, null);
  const g0 = pl0.order === 'top' && pl0.items[0].id === 'zentoubu' && pl0.notes.some((n) => n.subplan);
  console.log(`${g0 ? 'ok' : 'NG'}  基本の順序は上から下・前頭部から（出口はサブプランで） → ${pl0.items.map((i) => i.name).join(' → ')}`);
  if (!g0) fail++;
  const pl = planSession(db, f, 40, null, { order: 'outlet' });
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

// 指定した場所・感じだけから読み取る（場所から別の症状を推し量って足さない）
{
  const { phrasesFor, catsFor } = await import('../app/zones.js');
  const read = (zones, senses) => analyze(db, phrasesFor(zones, senses).join('。'), catsFor(zones)).categories.map((c) => c.id);
  for (const [zones, senses, mustNot] of [
    [['atama_top'], ['kayui'], ['headache', 'k:zutsuu']],
    [['hitai'], ['kayui'], ['headache', 'k:zutsuu']],
    [['komekami'], ['kayui'], ['headache', 'k:zutsuu']],
    [['mune'], ['itai'], ['lungs', 'heart', 'k:waki']],
    [['mune'], ['kayui'], ['lungs', 'heart']],
    [['kubi_ushiro'], ['itai'], ['occipital']],
    [['shitabara'], ['itai'], ['k:fujin']],
    [['zenshin'], ['kayui'], ['fatigue']],
  ]) {
    const got = read(zones, senses);
    const bad = mustNot.filter((id) => got.includes(id));
    console.log(`${bad.length ? 'NG' : 'ok'}  指定だけから読む ${phrasesFor(zones, senses).join('・')} → ${got.join(',')}`);
    if (bad.length) fail++;
  }
}

// 元をたどる（症状・部位の関係）：訴えの元になりうる所に所見があれば加点し、無ければ探るよう促す
{
  const side = (L, R) => ({ heat: Math.max(L.heat || 0, R.heat || 0), kouketsu: Math.max(L.kouketsu || 0, R.kouketsu || 0), atsutsuu: Math.max(L.atsutsuu || 0, R.atsutsuu || 0), sides: { L, R } });
  const ok = (good, msg) => { console.log(`${good ? 'ok' : 'NG'}  ${msg}`); if (!good) fail++; };
  // 眼の訴え：延髄部に所見 → 加点（＋2）。後頭部は所見なし → 探るよう案内
  const a1 = analyze(db, '目が疲れる');
  ok(a1.points.some((p) => p.id === 'enzui' && p.roles.includes('moto')), '眼の訴え → 延髄部が「元」として探査箇所に入る');
  const p1 = planSession(db, { enzui: { kouketsu: 2 }, kata: { kouketsu: 2 }, haimen_jinzo: { kouketsu: 2 } }, 60, a1);
  const en = p1.items.find((i) => i.id === 'enzui') || p1.others.find((i) => i.id === 'enzui');
  const r1 = en?.reasons.find((r) => r.ref === 'rel_eyes');
  const n1 = p1.notes.find((n) => n.title.startsWith('元をたどる'));
  ok(!!r1 && r1.pts === 2 && !!n1 && n1.text.includes('後頭部') && n1.text.includes('探ってみてください') && p1.items.some((i) => i.id === 'enzui'), `眼の訴え → 延髄部に加点（${r1?.text}）・後頭部を探るよう案内`);
  // 眼と鼻の両方：延髄部への加点は1回だけで、理由に両方の名前
  const p2 = planSession(db, { enzui: { kouketsu: 2 } }, 60, analyze(db, '目が疲れて鼻がつまる'));
  const en2 = p2.items.find((i) => i.id === 'enzui');
  const rs2 = en2.reasons.filter((r) => /^rel_/.test(r.ref || '') && r.pts);
  ok(rs2.length === 1 && rs2[0].text.includes('眼') && rs2[0].text.includes('鼻'), `訴えが二つでも加点は1回（${rs2.map((r) => r.text).join('／')}）`);
  // 痔：訴えと同じ側の鼠蹊部を重点に
  const p3 = planSession(db, { sokeibu: side({ kouketsu: 1.5 }, { kouketsu: 1.5 }) }, 60, analyze(db, '左側の痔が痛い'));
  const so = p3.items.find((i) => i.id === 'sokeibu');
  ok(so?.side === 'L' && so.reasons.some((r) => r.ref === 'rel_anus'), `痔（左）→ 同じ側の鼠蹊部を重点（${so?.side}）`);
  // 咳：右の鼠蹊部を重点に（論述で右に多いと説かれる）
  const p4 = planSession(db, { sokeibu: side({ kouketsu: 1.5 }, { kouketsu: 1.5 }) }, 60, analyze(db, '咳が出る'));
  const so4 = p4.items.find((i) => i.id === 'sokeibu');
  ok(so4?.side === 'R' && so4.reasons.some((r) => r.ref === 'rel_lungs' && r.text.includes('右に多い')), `咳 → 右の鼠蹊部を重点（${so4?.side}）`);
  // 訴えが無くても：淋巴腺に所見 → 肩に＋1（元をたどる）
  const p5 = planSession(db, { keibu_lymph: { heat: 2, kouketsu: 2 }, kata: { kouketsu: 2 } }, 60, null);
  const ka = p5.items.find((i) => i.id === 'kata');
  ok(ka.reasons.some((r) => r.ref === 'rel_p_lymph' && r.pts === 1), '淋巴腺に所見 → 肩に加点（淋巴腺には肩から来る）');
  // 訴えの無い元には加点しない（耳の訴えが無ければ耳の関係は使わない）
  const p6 = planSession(db, { enzui: { kouketsu: 2 } }, 60, analyze(db, '腰が重い'));
  ok(!p6.items.find((i) => i.id === 'enzui')?.reasons.some((r) => /^rel_(eyes|ear|nose)/.test(r.ref || '')), '訴えに無い症状の関係は使わない');
  // 関係表の整合：部位・症状・見解の id がすべてあり、出典がある
  const ids = new Set(db.pointList.map((p) => p.id));
  const cats = new Set(db.categories.map((c) => c.id));
  const kes = new Set(db.kenkai.map((e) => e.id));
  const bad = db.relations.filter((r) => !r.cites?.length || !r.sources.every((id) => ids.has(id)) || !(r.points || []).every((id) => ids.has(id)) || !(r.categories || []).every((id) => cats.has(id)) || !(r.kenkai || []).every((id) => kes.has(id)) || /霊|全集|浄霊/.test(r.summary + r.title));
  ok(!bad.length, `関係表 ${db.relations.length}件の整合${bad.length ? '：' + bad.map((r) => r.id).join(',') : ''}`);
}

// 肩：首の周りの楽屋。所見があれば時間を確保（60分で7分ほど、訴えの楽屋・元なら9分ほど）
{
  const side = (L, R) => ({ heat: Math.max(L.heat || 0, R.heat || 0), kouketsu: Math.max(L.kouketsu || 0, R.kouketsu || 0), atsutsuu: Math.max(L.atsutsuu || 0, R.atsutsuu || 0), sides: { L, R } });
  const ok = (good, msg) => { console.log(`${good ? 'ok' : 'NG'}  ${msg}`); if (!good) fail++; };
  const a = analyze(db, '首がかゆい');
  ok(a.points.find((p) => p.id === 'kata')?.roles.includes('rakuya'), '首の訴え → 肩が楽屋（いったん肩に固まった物が頸へ行く）');
  const f = {
    zentoubu: { heat: 2 }, koutoubu: { heat: 1, kouketsu: 2 }, koukeibu: { kouketsu: 3, atsutsuu: 2 }, enzui: { kouketsu: 2 },
    jikasen: { kouketsu: 3, heat: 2 }, keibu_lymph: side({ kouketsu: 3 }, { kouketsu: 2 }), kata: side({ kouketsu: 1.5 }, { kouketsu: 1 }),
    kenkoukan: side({ kouketsu: 3 }, { kouketsu: 2 }), kenkoukotsu: side({ kouketsu: 3 }, { kouketsu: 3 }),
    haimen_jinzo: side({ kouketsu: 4 }, { kouketsu: 3 }), jinzo_kahou: side({ kouketsu: 3 }, { kouketsu: 3 }),
    choukotsu: side({ kouketsu: 2 }, { kouketsu: 2 }), sokeibu: side({ kouketsu: 2 }, {}), youkotsu: { kouketsu: 3 },
  };
  const p1 = planSession(db, f, 60, a);
  const k1 = p1.items.find((i) => i.id === 'kata');
  ok(k1.minutes >= 9 && p1.total === 60, `首の訴え・肩の所見は軽くても、肩は左右で${k1.minutes}分（${k1.split.map((x) => x.side + x.minutes).join('/')}）`);
  const p2 = planSession(db, f, 60, null);
  const k2 = p2.items.find((i) => i.id === 'kata');
  ok(k2.minutes >= 7 && p2.total === 60, `訴えが無くても、所見のある肩は${k2.minutes}分`);
  const p3 = planSession(db, f, 30, a);
  const k3 = p3.items.find((i) => i.id === 'kata');
  ok(k3.minutes >= 4 && p3.total === 30, `30分でも肩は${k3.minutes}分`);
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
// 論文の本文（data/ronbun.json）：根拠として引いている論述がすべて読めて、精神面・宗教面の語・「浄霊」・本の名前が出ないこと
{
  const rb = load('ronbun').articles;
  const have = new Set(rb.map((a) => a.id));
  const cited = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (typeof x.id === 'string' && /^(chojutsu|kowa)\d+#\d+$/.test(x.id) && ('page' in x || 'date' in x || 'year' in x)) cited.add(x.id);
      Object.values(x).forEach(walk);
    }
  };
  ['knowledge', 'kenkai', 'relations'].forEach((f) => walk(load(f)));
  const missing = [...cited].filter((id) => !have.has(id));
  const bad = rb.filter((a) => /霊|浄霊|全集|観音|明主|信者|御守|神様|百パーセント|治癒率|必ず全治|必ず治/.test(a.title + a.paras.join('')) || a.paras.some((p) => p.split('。').some((x) => x.includes('癌') && !x.includes('注：') && /治|全快|消散|誤|擬似|手術/.test(x))));
  const good = !missing.length && !bad.length && rb.length >= cited.size;
  console.log(`${good ? 'ok' : 'NG'}  論文の本文 ${rb.length}件（根拠 ${cited.size}件）${missing.length ? ' 足りない：' + missing.join(',') : ''}${bad.length ? ' 禁止語：' + bad.map((a) => a.id).join(',') : ''}`);
  if (!good) fail++;
}
console.log('keywords:', db.categories.reduce((n, c) => n + c.keywords.length, 0), 'categories:', db.categories.length);
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
