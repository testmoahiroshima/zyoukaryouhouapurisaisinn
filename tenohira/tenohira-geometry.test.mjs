// 掌の向き記録：位置計算（GEOMETRY ブロック）の確認テスト
// 使い方: node tenohira-geometry.test.mjs [HTMLファイルのパス]
// 既定のパスは同じフォルダの index.html（掌の向き記録の本体）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const path = process.argv[2] || fileURLToPath(new URL("./index.html", import.meta.url));
const html = readFileSync(path, "utf8");
const block = html.split("// GEOMETRY-START")[1]?.split("// GEOMETRY-END")[0];
if (!block) throw new Error("GEOMETRY-START / GEOMETRY-END の目印が見つかりません: " + path);
const mod = await import(
  "data:text/javascript," + encodeURIComponent(block + "\nexport { palmFrame, bodyView, buildZones, hitZone };")
);
const { palmFrame, bodyView, buildZones, hitZone } = mod;

// 背中をカメラに向けて座った受ける方（画素座標）。人の左肩が画面の左
const P = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 1 }));
const set = (i, x, y, v = 1) => (P[i] = { x, y, v });
set(0, 500, 200, 0.1); set(7, 470, 210); set(8, 530, 210);
set(11, 420, 320); set(12, 580, 320); set(23, 440, 620); set(24, 560, 620);
set(13, 380, 450); set(14, 620, 450); set(25, 440, 820, 0.2); set(26, 560, 820, 0.2);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("OK", name); };

check("背面と判定する", () => assert.equal(bodyView(P), "back"));

const { zones, u } = buildZones(P, "back");
check("背面の範囲に腎臓・肩甲骨・首があり、胸はない", () => {
  const ids = zones.map((z) => z.id);
  for (const id of ["kidL", "kidR", "scL", "scR", "neckL", "neckR"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("chest"));
  assert.ok(zones.filter((z) => z.caution).every((z) => z.id.startsWith("neck")));
});
check("見えていない膝は範囲に入れない", () => assert.ok(!zones.some((z) => z.id.startsWith("knee"))));

// 画面右から左向きに掌を向けた手（掌の面が y-z 平面）
const h = Array.from({ length: 21 }, () => ({ x: 760, y: 550, z: 0 }));
h[0] = { x: 760, y: 590, z: 0 }; h[5] = { x: 760, y: 510, z: -30 }; h[9] = { x: 760, y: 505, z: 0 }; h[17] = { x: 760, y: 510, z: 30 };
check("掌の向きの延長線で 腎臓（右） に当たる", () => {
  const pf = palmFrame(h, 1);
  assert.ok(pf.n.x < -0.99);
  const r = hitZone(pf.c, pf.n, zones, u);
  assert.equal(r?.zone.id, "kidR");
  assert.equal(r?.mode, "ray");
});
check("向きを反転すると体から外れる", () => {
  const pf = palmFrame(h, -1);
  assert.equal(hitZone(pf.c, pf.n, zones, u), null);
});

// 掌がカメラに向いている（法線が -z）：重なった位置で判定
const h2 = h.map((p) => ({ ...p }));
h2[0] = { x: 540, y: 580, z: 0 }; h2[5] = { x: 580, y: 510, z: 0 }; h2[9] = { x: 540, y: 505, z: 0 }; h2[17] = { x: 500, y: 510, z: 0 };
check("カメラ向きの掌は重なり位置で 腎臓（右） と判定", () => {
  const pf = palmFrame(h2, 1);
  assert.ok(pf.n.z < -0.99);
  const r = hitZone(pf.c, pf.n, zones, u);
  assert.equal(r?.zone.id, "kidR");
  assert.equal(r?.mode, "depth");
});

// 前面を向いた受ける方（人の左肩が画面の右）
const F = P.map((p) => ({ ...p }));
F[0] = { x: 500, y: 200, v: 0.95 }; F[11] = { x: 580, y: 320, v: 1 }; F[12] = { x: 420, y: 320, v: 1 };
F[23] = { x: 560, y: 620, v: 1 }; F[24] = { x: 440, y: 620, v: 1 };
check("前面と判定し、胸・みぞおち・腹部の範囲を作る", () => {
  assert.equal(bodyView(F), "front");
  const ids = buildZones(F, "front").zones.map((z) => z.id);
  for (const id of ["chest", "epi", "abd"]) assert.ok(ids.includes(id), id);
});

console.log(`\n${passed} 件すべて合格`);
