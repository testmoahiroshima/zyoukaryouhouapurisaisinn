// 症状の言い方の取りこぼし確認：node tools/coverage.mjs
import { readFileSync } from 'node:fs';
import { prepare, analyze } from '../app/engine.js';
const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const db = prepare({ points: load('body_points'), flows: load('flows'), routes: load('routes'), symptoms: load('symptoms'), safety: load('safety'), places: load('places'), knowledge: load('knowledge'), kenkai: load('kenkai'), relations: load('relations') });
const words = readFileSync(new URL('./coverage_words.txt', import.meta.url), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
let miss = 0, noView = 0;
for (const w of words) {
  const r = analyze(db, w);
  const blocked = r.safety.some((s) => s.id === 'disease' || s.level === 'urgent');
  if (r.fallback && !blocked) { console.log('MISS  ', w); miss++; continue; }
  if (!r.kenkai.length && !blocked) { console.log('noview', w, '→', r.categories.map((c) => c.label).join('、')); noView++; }
}
console.log(`${words.length}語：取りこぼし${miss}・見解なし${noView}`);
process.exit(miss ? 1 : 0);
