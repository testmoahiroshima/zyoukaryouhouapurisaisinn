// 症状入力→提案の簡易テスト：node tools/test_engine.mjs
import { readFileSync } from 'node:fs';
import { prepare, analyze, normalize } from '../app/engine.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const db = prepare({
  points: load('body_points'), flows: load('flows'), routes: load('routes'),
  symptoms: load('symptoms'), safety: load('safety'),
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
  ['なんだか眠れない', [], [], []],
  ['糖尿病です', [], [], ['disease']],
  ['頑張りすぎて肩が痛い', ['katakori'], [], []],
  ['頭がガンガンする', ['headache'], [], []],
  ['胸に激痛がある', [], [], ['urgent']],
  ['薬をやめたい', [], [], ['medicine']],
  ['金額が気になって不安', ['top'], ['frontal'], []],
  ['ズキズキする後頭部の痛み', ['occipital'], [], []],
  ['ﾒｶﾞﾈをかけると目の奥が痛い', ['eyes'], [], ['disease'].slice(1)],
  ['生理痛がつらい', ['women'], [], []],
];

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
  if (!must.length && !r.fallback) errs.push('expected fallback');
  const pts = r.points.map((p) => p.no + (p.key ? '*' : '')).join(',');
  console.log(`${errs.length ? 'NG' : 'ok'}  ${text} → [${ids}] safety[${sids}] side=${r.side} points=${pts}${errs.length ? '  !! ' + errs.join('; ') : ''}`);
  if (errs.length) fail++;
}

// データの整合：参照している id がすべて存在するか
const ids = new Set(db.pointList.map((p) => p.id));
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
