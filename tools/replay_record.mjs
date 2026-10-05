// 書き出した記録（JSON）の探査結果と訴えから、いまの判断で施術計画を出し直す：node tools/replay_record.mjs 記録.json [分]
import { readFileSync } from 'node:fs';
import { prepare, analyze, planSession } from '../app/engine.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const db = prepare({
  points: load('body_points'), flows: load('flows'), routes: load('routes'),
  symptoms: load('symptoms'), safety: load('safety'),
  places: load('places'), knowledge: load('knowledge'), kenkai: load('kenkai'), relations: load('relations'),
});
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const rec of data.records || [data]) {
  const findings = Object.fromEntries((rec.findings || []).map((f) => [f.point_id, { heat: f.heat, kouketsu: f.kouketsu, atsutsuu: f.atsutsuu, ...(f.sides ? { sides: f.sides } : {}) }]));
  const text = (rec.complaints || [])[0] || '';
  const a = analyze(db, text, []);
  const total = Number(process.argv[3]) || (rec.plan_minutes ? rec.plan_minutes.probe + rec.plan_minutes.check + (rec.treatments || []).reduce((s, t) => s + t.minutes, 0) : 30);
  const plan = planSession(db, findings, total, a);
  console.log(`== ${rec.date} 「${text}」 ${total}分 → 読み取り：${a.categories.map((c) => c.label).join('、')}`);
  console.log('前の計画：' + (rec.treatments || []).map((t) => `${db.pointById[t.point_id].name}${t.minutes}`).join(' → '));
  console.log('今の計画：' + plan.items.map((i) => `${i.name}${i.minutes}${i.split ? '[' + i.split.map((x) => (x.side === 'R' ? '右' : '左') + x.minutes).join('/') + ']' : ''}`).join(' → '));
  console.log(`  外した箇所：${plan.others.map((o) => o.name).join('、') || 'なし'}／合計 ${plan.total}分（探査${plan.probe}・確認${plan.check}）`);
}
