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
  "data:text/javascript," + encodeURIComponent(block + "\nexport { palmFrame, bodyView, buildZones, hitZone, bodyScale, poseHand, matchHands, reachScore, pickRoles, faceToward, nearestZone, calibKey, dedupePoses, poseFromBox, poseFromTaps, unexplainedBoxes, resolveFrame, stabilize, repairPose };")
);
const { palmFrame, bodyView, buildZones, hitZone, poseHand, matchHands, pickRoles, faceToward, nearestZone, calibKey, dedupePoses, poseFromBox, poseFromTaps, unexplainedBoxes, resolveFrame, stabilize, repairPose } = mod;

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

// ---- 施術者と受ける方の見分け（実際の映像「施術の基本」の画面写真から取った骨格の座標。幅1074） ----
// 左：座って横を向いている受ける方（右肩は画面の外）、右：立って腕を受ける方へ伸ばしている施術者
const pose = (pts) => {
  const P = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
  for (const [i, [x, y, v = 1]] of Object.entries(pts)) P[i] = { x, y, z: 0, v };
  return P;
};
const recv = pose({ 0: [156, 430, 0.97], 11: [110, 506], 12: [-23, 535], 15: [192, 680, 0.04], 16: [98, 572, 0.47], 17: [190, 695, 0.04], 18: [121, 545, 0.37], 19: [182, 693, 0.04], 20: [100, 517, 0.39], 23: [68, 803, 0.67], 24: [-33, 840, 0.7] });
const prac = pose({ 0: [836, 299], 11: [918, 426], 12: [882, 386], 15: [730, 503, 0.62], 16: [747, 505, 0.2], 17: [711, 491, 0.54], 18: [731, 509, 0.18], 19: [723, 473, 0.55], 20: [733, 507, 0.18], 23: [893, 658], 24: [867, 625] });
const W = 1074, handWrist = { x: 609, y: 325 };
check("手の持ち主が決まらなくても、腕を伸ばしている右の人を施術者、左の人を受ける方にする", () => {
  const owners = matchHands([recv, prac], [handWrist], W);
  const r = pickRoles([recv, prac], owners, "auto");
  assert.equal(r.recipient, recv); assert.equal(r.practitioner, prac);
  const r2 = pickRoles([prac, recv], [], "auto");
  assert.equal(r2.recipient, recv); assert.equal(r2.practitioner, prac);
});
check("施術者しか映っていない時は、施術者を受ける方にしない", () => {
  const r = pickRoles([prac], [], "auto");
  assert.equal(r.recipient, null); assert.equal(r.practitioner, prac);
});
check("受ける方しか映っていない時は、その人を受ける方にする", () => {
  assert.equal(pickRoles([recv], [], "auto").recipient, recv);
});
check("画面の左／右の人、タップした人を受ける方に選べる", () => {
  assert.equal(pickRoles([prac, recv], [], "left").recipient, recv);
  assert.equal(pickRoles([prac, recv], [], "right").recipient, prac);
  assert.equal(pickRoles([prac, recv], [], "tap", { x: 120, y: 600 }).recipient, recv);
  assert.equal(pickRoles([prac, recv], [], "tap", { x: 120, y: 600 }).practitioner, prac);
});
check("受ける方の手首の近くの手は、受ける方の手と分かる", () => {
  const [o] = matchHands([recv, prac], [{ x: 100, y: 560 }], W);
  assert.equal(o?.pose, 0); assert.equal(o?.side, "R");
});
check("骨格の手首・指から手の形を作れる（見え具合が低い手は作らない）", () => {
  const h = poseHand(prac, "L");
  assert.ok(h && h[0].x === 730 && h[5].x === 723 && h[17].x === 711);
  assert.equal(poseHand(prac, "R"), null);
  assert.equal(calibKey({ fromPose: true, side: "R", label: "Right" }), "Left");
  assert.equal(calibKey({ label: "Right", side: "R" }), "Right");
});
check("掌の表と裏を、受ける方の側に向く方に決める", () => {
  const { zones } = buildZones(recv, "side");
  const pf = { c: handWrist, n: { x: 0.8, y: -0.6, z: 0 } };  // 受ける方と反対（右上）を向いている
  const z = nearestZone(pf.c, zones);
  const f = faceToward(pf, z);
  assert.ok(f.flipped && f.n.x < 0);
  assert.equal(faceToward(f, z), f);  // すでに受ける方の側なら変えない
});

// 施術者だけを切り出した映像（幅514）：同じ人の骨格が二重に出て、手（手の認識）は骨格の手首から離れて出た
const pa = pose({ 0: [285, 293], 7: [338, 307], 8: [284, 296], 11: [356, 401, 0.99], 12: [302, 359], 13: [317, 500, 0.59], 14: [272, 433, 0.27], 15: [264, 470, 0.52], 16: [242, 451, 0.22], 17: [252, 470, 0.44], 18: [231, 457, 0.2], 19: [252, 453, 0.45], 20: [234, 452, 0.2], 23: [330, 584, 0.99], 24: [298, 551, 0.98] });
const pb = pose({ 0: [281, 283], 7: [348, 304], 8: [273, 263], 11: [359, 405, 0.99], 12: [285, 349], 13: [283, 498, 0.6], 14: [203, 404, 0.41], 15: [201, 443, 0.55], 16: [173, 407, 0.34], 17: [181, 435, 0.45], 18: [165, 407, 0.29], 19: [184, 416, 0.45], 20: [171, 403, 0.3], 23: [338, 577, 0.97], 24: [294, 536, 0.97] });
check("同じ人の骨格が二重に出たら一人にまとめる", () => {
  assert.equal(dedupePoses([pa, pb]).length, 1);
  assert.equal(dedupePoses([recv, prac]).length, 2);
});
check("手首から離れて出た手も、前腕の延長線上なら持ち主が分かり、施術者だけの時は受ける方なしにする", () => {
  const poses = dedupePoses([pa, pb]);
  const owners = matchHands(poses, [{ x: 51, y: 323 }], 514);
  assert.equal(owners[0]?.pose, 0); assert.ok(owners[0]?.byArm);
  const r = pickRoles(poses, owners, "auto");
  assert.equal(r.recipient, null); assert.equal(r.practitioner, poses[0]);
});

// ---- 骨格が取れない受ける方（後ろ向き・暗い服・画面の端）：人の検出の枠・タップから範囲を作る（実際の画面写真の枠。幅1074） ----
check("人の検出の枠から、背面の受ける方の範囲（腎臓・肩甲骨・首）を作る", () => {
  const P = poseFromBox({ x: 56, y: 566, w: 292, h: 435 });
  assert.equal(bodyView(P), "back");
  const ids = buildZones(P, "back").zones.map((z) => z.id);
  for (const id of ["head", "neckL", "neckR", "scL", "scR", "kidL", "kidR"]) assert.ok(ids.includes(id), id);
  assert.ok(P[11].x < P[12].x);  // 背面：人の左肩が画面の左
  assert.equal(bodyView(poseFromBox({ x: 56, y: 566, w: 292, h: 435 }, "front")), "front");
});
check("骨格で取れている人の枠は重ねず、取れていない人の枠だけを使う", () => {
  const pr = pose({ 0: [820, 560], 11: [870, 700], 12: [790, 690], 23: [860, 950], 24: [800, 940] });
  const boxes = [{ x: 56, y: 566, w: 292, h: 435 }, { x: 760, y: 500, w: 240, h: 520 }];
  const left = unexplainedBoxes(boxes, [pr]);
  assert.equal(left.length, 1); assert.equal(left[0].x, 56);
});
check("施術者は骨格、受ける方は枠の時：施術者を受ける方にしない", () => {
  const box = poseFromBox({ x: 0, y: 395, w: 219, h: 488 });
  const r = pickRoles([prac, box], [], "auto");
  assert.equal(r.recipient, box); assert.equal(r.practitioner, prac);
});
check("骨格が誰も取れず枠だけの時は、頭の低い人（座っている人）を受ける方にする", () => {
  const recvBox = poseFromBox({ x: 0, y: 552, w: 292, h: 498 }), pracBox = poseFromBox({ x: 586, y: 474, w: 473, h: 479 });
  assert.equal(pickRoles([pracBox, recvBox], [], "auto").recipient, recvBox);
});
check("頭と腰のタップから受ける方の範囲を作る（傾いていても）", () => {
  const P = poseFromTaps({ x: 300, y: 200 }, { x: 300, y: 600 });
  assert.equal(bodyView(P), "back");
  const z = buildZones(P, "back").zones;
  const kid = z.filter((q) => q.id.startsWith("kid"));
  assert.ok(kid.every((q) => q.y > 400 && q.y < 600));
  const T = poseFromTaps({ x: 200, y: 300 }, { x: 600, y: 300 });  // 横に寝ている
  const tz = buildZones(T, "back").zones;
  assert.ok(tz.find((q) => q.id === "head").x < tz.find((q) => q.id === "kidL").x);
});

// ---- 寝た姿勢・前からの施術 ----
check("横に寝ている人（頭が画面の左）でも、背面・前面を決め、頭の範囲を頭の先に置く", () => {
  // 背中がカメラ側：頭は左、腰は右、人の左肩が下（立った背面の姿を左へ90°倒した形）
  const L = pose({ 0: [120, 310, 0.1], 7: [140, 290], 8: [140, 330], 11: [260, 370], 12: [260, 250], 23: [520, 350], 24: [520, 270] });
  assert.equal(bodyView(L), "back");
  const z = buildZones(L, "back").zones, head = z.find((q) => q.id === "head"), kid = z.find((q) => q.id === "kidL");
  assert.ok(head.x < 140 && kid.x > 300);
  const F = pose({ 0: [120, 310, 0.95], 7: [140, 290], 8: [140, 330], 11: [260, 250], 12: [260, 370], 23: [520, 270], 24: [520, 350] });  // 前面：人の左肩が上
  assert.equal(bodyView(F), "front");
});
check("前面では鼠径部（左・右）の範囲を作り、掌を向けると当たる", () => {
  const { zones, u } = buildZones(F, "front");
  const g = zones.find((q) => q.id === "groinL");
  assert.ok(g && zones.some((q) => q.id === "groinR"));
  const r = hitZone({ x: g.x + 2 * u, y: g.y }, { x: -1, y: 0, z: 0 }, zones, u);
  assert.equal(r?.zone.id, "groinL");
});
check("掌の延長線上に胴の範囲があれば、手前にある受ける方の膝・肘より胴を選ぶ", () => {
  const zones = [{ id: "kneeL", x: 100, y: 100, r: 20 }, { id: "groinL", x: 160, y: 100, r: 15 }];
  assert.equal(hitZone({ x: 40, y: 100 }, { x: 1, y: 0, z: 0 }, zones, 50)?.zone.id, "groinL");
  assert.equal(hitZone({ x: 40, y: 100 }, { x: 1, y: 0, z: 0 }, [zones[0]], 50)?.zone.id, "kneeL");
});
check("寝ている人が枠でしか見つからない時は、受ける方を決めずに「頭と腰をタップ」の案内", () => {
  const fr = resolveFrame({ poses: [prac], hands: [], boxes: [{ x: 50, y: 600, w: 600, h: 200 }], W: 1074, mem: {} });
  assert.ok(fr.needTap); assert.equal(fr.recipient, null);
  const fr2 = resolveFrame({ poses: [prac], hands: [], boxes: [{ x: 50, y: 600, w: 600, h: 200 }], W: 1074, mem: {}, manual: { head: { x: 100, y: 680 }, waist: { x: 500, y: 700 } } });
  assert.ok(!fr2.needTap && fr2.recipient?.manual);
});
check("施術者の骨格が上にかがんでも、寝ている人の枠を捨てない", () => {
  const bent = pose({ 0: [300, 420], 11: [330, 480], 12: [270, 470], 23: [320, 640], 24: [280, 630] });
  assert.equal(unexplainedBoxes([{ x: 50, y: 600, w: 600, h: 200 }], [bent]).length, 1);
});

// ---- コマをまたいだ安定化 ----
const tc = (Q) => ({ x: (Q[11].x + Q[12].x + Q[23].x + Q[24].x) / 4, y: (Q[11].y + Q[12].y + Q[23].y + Q[24].y) / 4 });
check("一コマだけ判断が入れ替わっても、受ける方は入れ替えない", () => {
  const mem = {};
  let fr;
  for (let k = 0; k < 10; k++) fr = stabilize({ poses: [recv, prac], hands: [], W: 1074, mem, now: k * 125 });
  assert.ok(Math.abs(tc(fr.recipient).x - tc(recv).x) < 50);
  // 一コマだけ「右の人が受ける方」になる入力（左の人が一瞬消える）
  fr = stabilize({ poses: [prac], hands: [], W: 1074, mem, now: 1250 });
  assert.ok(fr.recipient && Math.abs(tc(fr.recipient).x - tc(recv).x) < 50, "一瞬消えた受ける方を保つ");
  fr = stabilize({ poses: [recv, prac], hands: [], W: 1074, mem, now: 1375 });
  assert.ok(Math.abs(tc(fr.recipient).x - tc(recv).x) < 50);
});
check("掌が向いている範囲は多数決で決め、一コマだけ外れても変えない", () => {
  const mem = {};
  const ids = [];  // h：上の「画面右から左向きに掌を向けた手」
  for (let k = 0; k < 8; k++) {
    // 5コマ目だけ掌の表裏を取り違える（体から外れる向き）
    const fr = stabilize({ poses: [P], hands: [{ lm: h, label: "Left" }], mode: "left", orientAuto: false, calib: k === 5 ? { Left: -1, Right: 1 } : undefined, W: 1074, mem, now: k * 125 });
    ids.push(fr.hits.find((x) => x.hit)?.hit.zone.id || null);
  }
  assert.deepEqual(ids.slice(2), ["kidR", "kidR", "kidR", "kidR", "kidR", "kidR"]);
});

// ---- 体の一部しか映らない時 ----
check("顔だけのアップ：顔の大きさと向きから肩を推定し、胴の範囲は画面の外なら出さない", () => {
  // 正面を向いた顔（幅 960×540 の画面いっぱい）。肩・腰は見えていない（見誤りで顔のすぐ下に縮んで出ている）
  const F = Array.from({ length: 33 }, () => ({ x: 480, y: 330, v: 0.05 }));
  const put = (i, x, y, v = 1) => (F[i] = { x, y, v });
  put(0, 480, 300); put(2, 440, 260); put(5, 520, 260); put(7, 600, 280); put(8, 360, 280); put(9, 455, 360); put(10, 505, 360);
  put(11, 520, 380, 0.2); put(12, 440, 380, 0.2); put(23, 510, 420, 0.2); put(24, 450, 420, 0.2);
  const Q = repairPose(F, { W: 960, H: 540 });
  assert.ok(Q.est?.shoulders);
  assert.ok(Math.abs(Q[11].x - Q[12].x) > 400, "肩幅は顔の幅の2倍以上");
  const zi = buildZones(Q, "front", { W: 960, H: 540 });
  const head = zi.zones.find((z) => z.id === "head");
  assert.ok(head && !head.est && Math.abs(head.x - 480) < 40);
  assert.ok(zi.zones.every((z) => z.y <= 540 + z.r), "画面の外の範囲は出さない");
  assert.ok(!zi.zones.some((z) => z.id === "groinL" || z.id === "abd"), "腹・鼠径部は画面の外");
  assert.ok(zi.zones.filter((z) => z.id !== "head").every((z) => z.est), "頭以外は推定の印");
});
check("腰が画面の外：肩から腰を推定し、胴の下の範囲に推定の印を付ける", () => {
  const Q0 = P.map((p) => ({ ...p }));
  const Q = repairPose(Q0, { W: 1000, H: 560 });  // 腰（y=620）は画面の下の外
  assert.ok(Q.est?.hips && !Q.est.shoulders);
  const zi = buildZones(Q, "back", { W: 1000, H: 560 });
  assert.ok(zi.zones.find((z) => z.id === "scL" && !z.est));
  assert.ok(zi.zones.filter((z) => /^(kid|low)/.test(z.id)).every((z) => z.est));
});
check("点が一か所につぶれた骨格は捨てる", () => {
  const C = Array.from({ length: 33 }, (_, i) => ({ x: 300 + (i % 3), y: 400 + (i % 2), v: 0.99 }));
  assert.equal(repairPose(C, { W: 544, H: 900 }), null);
  const fr = resolveFrame({ poses: [C], hands: [], W: 544, H: 900, mem: {} });
  assert.equal(fr.recipient, null);
});
check("掌の線が範囲のすぐ脇を通る時は、一番近い範囲を「近く」とする", () => {
  // 腎臓（右）の少し上を水平に通る線
  const kid = zones.find((z) => z.id === "kidR");
  const c = { x: kid.x + 3 * u, y: kid.y - kid.r - 0.15 * u };
  const r = hitZone(c, { x: -1, y: 0, z: 0 }, zones.filter((z) => z.id === "kidR" || z.id === "kidL"), u);
  assert.equal(r?.mode, "near");
  assert.equal(r?.zone.id, "kidR");
});

console.log(`\n${passed} 件すべて合格`);
