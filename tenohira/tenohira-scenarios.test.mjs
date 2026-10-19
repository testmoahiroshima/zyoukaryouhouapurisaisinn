// 掌の向き記録：場面の模擬（scenario-sim.mjs）で、判断の当たり具合が落ちていないかを確かめる
// 使い方: node tenohira/tenohira-scenarios.test.mjs
import assert from "node:assert/strict";
import { run } from "./scenario-sim.mjs";

const pct = (a, b) => Math.round((100 * a) / b);
const report = (name, { tot }) => {
  const r = { 受ける方: pct(tot.recv, tot.n), 一致: pct(tot.exact, tot.n), 一致か隣: pct(tot.exact + tot.near, tot.n), 当たりなし: pct(tot.none, tot.n) };
  console.log(name, JSON.stringify(r));
  return r;
};
// 認識が理想どおり（揺れ・見落とし無し）で、案内どおりにタップした時：判断の仕組みそのものの当たり具合
const ideal = report("理想の認識", run(1500, 1, { ideal: true, taps: true }));
assert.ok(ideal.受ける方 >= 98 && ideal.一致 >= 60 && ideal.一致か隣 >= 72, "理想の認識での当たり具合が下がった");
// 実際に近い揺れ・見落とし・手首のずれ・二重検出のもとで、2秒（16コマ）続けた時（案内どおりにタップ）
const real = report("揺れ・見落としあり（2秒・タップあり）", run(800, 1, { taps: true, frames: 16 }));
assert.ok(real.受ける方 >= 85 && real.一致か隣 >= 50, "揺れ・見落としがある時の当たり具合が下がった");
// コマごとに骨格・枠・手がときどき取れない（3割）時に、コマをまたいだ安定化（stabilize）を通しても、
// 受ける方の当たり具合が落ちない（使う人は、案内が出た時・違う人が選ばれた時に一度だけタップする）
const flick = report("取れたり取れなかったり・安定化あり（2秒・一度だけタップ）", run(800, 1, { frames: 16, flicker: true, user: true, stab: true }));
const flickRaw = report("取れたり取れなかったり・安定化なし（2秒・一度だけタップ）", run(800, 1, { frames: 16, flicker: true, user: true }));
assert.ok(flick.受ける方 >= 72 && flick.受ける方 >= flickRaw.受ける方 - 2, "安定化を通すと受ける方の当たり具合が下がる");
console.log("場面の模擬：合格");
