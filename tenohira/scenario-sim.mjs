// 掌の向き記録：場面の模擬（画像を作らずに、いろいろな施術の場面を検査する）
// 受ける方（座位・側臥位・仰向け・うつ伏せ）と施術者（立ち・正座・椅子）を立体の骨組みで作り、
// 施術する範囲（腎臓・肩甲骨・腰・鼠径部など）に掌を向けた姿を、いろいろなカメラの位置から写した
// 「認識結果の座標」（骨格33点・手21点・人の検出の枠）を計算で作る。実際の認識で起きる揺れ・見落とし・
// 手首のずれ・二重検出もわざと混ぜ、index.html の判断（resolveFrame）がどのくらい正しく当てるかを数える。
// 使い方: node tenohira/scenario-sim.mjs [件数（既定 2000）]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const block = html.split("// GEOMETRY-START")[1].split("// GEOMETRY-END")[0];
const G = await import("data:text/javascript," + encodeURIComponent(block + "\nexport { resolveFrame, bodyScale, torsoCenter };"));

// ---- 小さな道具 ----
const V = (x, y, z) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => V(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const nrm = (a) => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
let R = rng(1);
const rand = (a, b) => a + (b - a) * R();
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const gauss = () => { let u = 0, v = 0; while (!u) u = NOISE(); while (!v) v = NOISE(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---- 骨組み：O（骨盤の中心）と、体の向き U（頭の方）・F（胸の前）・L（人の左＝U×F） ----
function body(O, U, F, posture) {
  const L = cross(U, F);
  const at = (l, u, f) => add(O, add(mul(L, l), add(mul(U, u), mul(F, f))));
  const J = {};
  J[23] = at(0.11, 0, 0); J[24] = at(-0.11, 0, 0);
  J[11] = at(0.19, 0.52, 0); J[12] = at(-0.19, 0.52, 0);
  J[7] = at(0.075, 0.76, 0); J[8] = at(-0.075, 0.76, 0);
  J[0] = at(0, 0.76, 0.1); J[2] = at(0.035, 0.79, 0.09); J[5] = at(-0.035, 0.79, 0.09);
  // 受ける方の腕は体の前（膝・太ももの上）に
  J[13] = at(0.22, 0.26, 0.05); J[14] = at(-0.22, 0.26, 0.05);
  J[15] = at(0.17, 0.05, 0.2); J[16] = at(-0.17, 0.05, 0.2);
  J[17] = at(0.17, 0.0, 0.27); J[18] = at(-0.17, 0.0, 0.27); J[19] = at(0.15, 0.02, 0.28); J[20] = at(-0.15, 0.02, 0.28);
  const legs = {
    stand: [[0.1, -0.45, 0], [0.1, -0.88, 0.02]],
    chair: [[0.1, -0.02, 0.45], [0.1, -0.45, 0.45]],
    seiza: [[0.1, -0.05, 0.45], [0.1, -0.1, 0.05]],
    lie: [[0.1, -0.42, 0.18], [0.1, -0.8, 0.05]],
  }[posture];
  J[25] = at(legs[0][0], legs[0][1], legs[0][2]); J[26] = at(-legs[0][0], legs[0][1], legs[0][2]);
  J[27] = at(legs[1][0], legs[1][1], legs[1][2]); J[28] = at(-legs[1][0], legs[1][1], legs[1][2]);
  for (let i = 0; i < 33; i++) J[i] ??= at(0, 0.3, 0);
  return { J, O, U, F, L, at, head: at(0, 0.79, 0) };
}

// 施術する所（体の表面の点と、外向きの向き）。名前は index.html の範囲の id
function spots(b) {
  const back = mul(b.F, -1), front = b.F;
  const s = (l, u, f, n) => ({ p: b.at(l, u, f), n });
  return {
    back: {
      head: { p: add(b.head, mul(back, 0.1)), n: nrm(add(back, mul(b.U, 0.3))) },
      neckL: s(0.05, 0.62, -0.06, back), neckR: s(-0.05, 0.62, -0.06, back),
      shL: s(0.15, 0.56, -0.04, nrm(add(back, b.U))), shR: s(-0.15, 0.56, -0.04, nrm(add(back, b.U))),
      scL: s(0.11, 0.39, -0.1, back), scR: s(-0.11, 0.39, -0.1, back),
      backC: s(0, 0.26, -0.1, back),
      kidL: s(0.08, 0.15, -0.1, back), kidR: s(-0.08, 0.15, -0.1, back),
      lowL: s(0.08, 0.03, -0.1, back), lowR: s(-0.08, 0.03, -0.1, back),
    },
    front: {
      head: { p: add(b.head, mul(front, 0.1)), n: nrm(add(front, mul(b.U, 0.3))) },
      chest: s(0, 0.36, 0.1, front), epi: s(0, 0.23, 0.1, front), abd: s(0, 0.08, 0.1, front),
      groinL: s(0.077, -0.06, 0.08, front), groinR: s(-0.077, -0.06, 0.08, front),
    },
  };
}

// 受ける方の姿勢
const RECEIVERS = {
  座位: () => { const a = rand(0, 2 * Math.PI); return { O: V(0, 0.45, 0), U: V(0, 1, 0), F: V(Math.sin(a), 0, Math.cos(a)), posture: "chair", sides: ["back", "front"] }; },
  正座: () => { const a = rand(0, 2 * Math.PI); return { O: V(0, 0.3, 0), U: V(0, 1, 0), F: V(Math.sin(a), 0, Math.cos(a)), posture: "seiza", sides: ["back", "front"] }; },
  側臥位: () => { const a = rand(0, 2 * Math.PI), U = V(Math.cos(a), 0, Math.sin(a)), side = pick([1, -1]); const L = V(0, -side, 0); return { O: V(0, 0.3, 0), U, F: cross(L, U), posture: "lie", sides: ["back"] }; },
  仰向け: () => { const a = rand(0, 2 * Math.PI); return { O: V(0, 0.22, 0), U: V(Math.cos(a), 0, Math.sin(a)), F: V(0, 1, 0), posture: "lie", sides: ["front"] }; },
  うつ伏せ: () => { const a = rand(0, 2 * Math.PI); return { O: V(0, 0.22, 0), U: V(Math.cos(a), 0, Math.sin(a)), F: V(0, -1, 0), posture: "lie", sides: ["back"] }; },
};

// ---- カメラ：look から pos を見て写す。幅 W・高さ H、横の画角 65° ----
function camera(pos, look, W, H) {
  const fw = nrm(sub(look, pos)), rt = nrm(cross(fw, V(0, 1, 0))), up = cross(rt, fw), f = W / (2 * Math.tan((65 * Math.PI) / 360));
  return { pos, W, H, f, fw, proj: (P) => { const d = sub(P, pos), dep = dot(d, fw); return { x: W / 2 + (f * dot(d, rt)) / dep, y: H / 2 - (f * dot(d, up)) / dep, dep }; } };
}

// 骨格33点を写す（見え具合・揺れ・画面外も）
function projectPose(cam, b, jitter) {
  const toCam = nrm(sub(cam.pos, b.O)), facing = dot(b.F, toCam);
  const hm = cam.proj(lerp3(b.J[23], b.J[24], 0.5));
  const P = [];
  for (let i = 0; i < 33; i++) {
    const q = cam.proj(b.J[i]);
    let v = 1;
    if ([0, 2, 5].includes(i)) v = facing > 0.2 ? 0.98 : facing > -0.2 ? 0.6 : 0.1;
    if (q.x < 0 || q.x > cam.W || q.y < 0 || q.y > cam.H || q.dep < 0.2) v = Math.min(v, 0.05);
    P.push({ x: q.x + gauss() * jitter, y: q.y + gauss() * jitter, z: ((q.dep - hm.dep) * cam.f) / hm.dep + gauss() * jitter * 3, v });
  }
  return P;
}
function boxOf(cam, b) {
  const pts = Object.values(b.J).map((p) => cam.proj(p)).concat([cam.proj(add(b.head, mul(b.U, 0.13)))]);
  const x0 = Math.max(0, Math.min(...pts.map((p) => p.x))), x1 = Math.min(cam.W, Math.max(...pts.map((p) => p.x)));
  const y0 = Math.max(0, Math.min(...pts.map((p) => p.y))), y1 = Math.min(cam.H, Math.max(...pts.map((p) => p.y)));
  return x1 - x0 > 10 && y1 - y0 > 10 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// ---- 1場面を作って判断させる ----
function scene(recvName, opts = {}) {
  const structSeed = Math.floor(R() * 4294967296);
  const frames = [];
  for (let k = 0; k < (opts.frames || 1); k++) {
    R = rng(structSeed);  // 場面の作り（姿勢・カメラ・見落とし）は同じ
    const one = scene1(recvName, opts, k);
    frames.push(one);
  }
  R = rng(structSeed ^ 0x9e3779b9);
  return frames;
}
let NOISE = rng(7);
function scene1(recvName, opts = {}, frameNo = 0) {
  NOISE = rng(1000 + frameNo * 7919 + Math.floor(R() * 1000));
  const r = RECEIVERS[recvName]();
  const recv = body(r.O, r.U, r.F, r.posture);
  const side = pick(r.sides);
  const sp = spots(recv)[side];
  const zoneId = pick(Object.keys(sp));
  const t = sp[zoneId];
  // 施術者：施術する所の外向きの側に、正座・立ち・椅子で。掌は施術する所に向ける（距離は 5〜40cm）
  let hd = V(t.n.x, 0, t.n.z);
  if (Math.hypot(hd.x, hd.z) < 0.3) { const c = cross(recv.U, V(0, 1, 0)); hd = Math.hypot(c.x, c.z) > 0.1 ? c : V(1, 0, 0); if (R() < 0.5) hd = mul(hd, -1); }
  hd = nrm(hd);
  const pracPosture = t.p.y < 0.6 ? pick(["seiza", "seiza", "chair"]) : pick(["stand", "chair", "seiza"]);
  const pelvisY = { stand: 0.95, chair: 0.5, seiza: 0.42 }[pracPosture];
  const pO = add(V(t.p.x, pelvisY, t.p.z), mul(hd, rand(0.45, 0.7)));
  const prac = body(pO, V(0, 1, 0), mul(hd, -1), pracPosture);
  const d = rand(0.05, 0.4);
  const C = add(t.p, mul(t.n, d)), np = mul(t.n, -1);
  const arm = dot(sub(C, prac.O), prac.L) >= 0 ? "L" : "R";
  const S = prac.J[arm === "L" ? 11 : 12];
  const fd = nrm(sub(sub(C, S), mul(np, dot(sub(C, S), np))));  // 指の向き：肩→掌を掌の面に写した向き
  const td = cross(np, fd);
  const wrist = sub(C, mul(fd, 0.05)), elbow = add(lerp3(S, wrist, 0.5), V(0, -0.08, 0));
  const iW = arm === "L" ? [13, 15, 17, 19] : [14, 16, 18, 20];
  prac.J[iW[0]] = elbow; prac.J[iW[1]] = wrist; prac.J[iW[2]] = add(C, add(mul(fd, 0.04), mul(td, -0.03))); prac.J[iW[3]] = add(C, add(mul(fd, 0.05), mul(td, 0.02)));
  // カメラ：施術する所の側から、左右 ±70°・高さ 0.8〜1.8m・距離 2〜3.5m（三脚）
  const az = rand(-70, 70) * (Math.PI / 180), dist = rand(2, 3.5);
  const base = nrm(add(mul(hd, Math.cos(az)), mul(nrm(cross(V(0, 1, 0), hd)), Math.sin(az))));
  const camPos = add(V(t.p.x, rand(0.8, 1.8), t.p.z), mul(base, dist));
  const portrait = R() < 0.5;
  const cam = camera(camPos, lerp3(recv.O, C, 0.5), portrait ? 540 : 960, portrait ? 960 : 540);
  // 認識結果を作る（揺れ・見落とし・手首のずれ・二重検出）
  const uPx = (b) => { const a = cam.proj(b.J[11]), c = cam.proj(b.J[12]), h = cam.proj(lerp3(b.J[23], b.J[24], 0.5)), s = cam.proj(lerp3(b.J[11], b.J[12], 0.5)); return Math.max(Math.hypot(a.x - c.x, a.y - c.y), Math.hypot(h.x - s.x, h.y - s.y) * 0.55); };
  const ideal = !!opts.ideal;
  const jit = ideal ? 0 : 0.03 * uPx(recv);
  const poses = [], boxes = [];
  const recvFacing = dot(recv.F, nrm(sub(cam.pos, recv.O)));
  const pRecv = (recvFacing > 0.2 ? 0.9 : 0.35) * (r.posture === "lie" ? 0.6 : 1) * (opts.poseScale ?? 1);
  let recvPose = null;
  if (ideal || R() < pRecv) { recvPose = projectPose(cam, recv, jit); poses.push(recvPose); if (!ideal && R() < 0.1) poses.push(recvPose.map((p) => ({ ...p, x: p.x + jit, y: p.y + jit }))); }
  else if (R() < 0.85) { const bx = boxOf(cam, recv); if (bx) boxes.push(bx); }
  const pracShown = ideal || R() < 0.85;
  if (pracShown) {
    const pp = projectPose(cam, prac, jit);
    // 骨格の手首・指は、腕を伸ばすと肘の方へずれて出やすい
    const e = pp[iW[0]];
    if (!ideal) for (const k of iW.slice(1)) { pp[k] = { ...pp[k], x: e.x + (pp[k].x - e.x) * 0.8, y: e.y + (pp[k].y - e.y) * 0.8 }; }
    poses.push(pp);
  } else if (R() < 0.85) { const bx = boxOf(cam, prac); if (bx) boxes.push(bx); }
  const hands = [];
  if (ideal || R() < (opts.handRate ?? 0.7)) {
    const lm3 = Array.from({ length: 21 }, () => C);
    lm3[0] = wrist; lm3[5] = add(C, add(mul(fd, 0.045), mul(td, 0.035))); lm3[9] = add(C, mul(fd, 0.05)); lm3[17] = add(C, add(mul(fd, 0.04), mul(td, -0.035)));
    const w = cam.proj(wrist), hj = jit * 0.4;
    const lm = lm3.map((p) => { const q = cam.proj(p); return { x: q.x + gauss() * hj, y: q.y + gauss() * hj, z: ((q.dep - w.dep) * cam.f) / w.dep + gauss() * hj }; });
    hands.push({ lm, label: R() < 0.5 ? "Left" : "Right" });  // 手の左右の判定は当てにしない
  }
  const pj = (p) => { const q = cam.proj(p); return { x: q.x + gauss() * jit, y: q.y + gauss() * jit }; };
  const taps = { head: pj(recv.head), waist: pj(lerp3(recv.J[23], recv.J[24], 0.5)) };
  const truth = { taps, recvCenter: (() => { const s = cam.proj(lerp3(recv.J[11], recv.J[12], 0.5)), h = cam.proj(lerp3(recv.J[23], recv.J[24], 0.5)); return { x: (s.x + h.x) / 2, y: (s.y + h.y) / 2 }; })(), zoneId, recvU: uPx(recv) };
  return { input: { poses, hands, boxes, W: cam.W, mode: "auto", mem: {}, now: 0 }, truth, recvPose: !!recvPose, info: { recv: recvName, side, zoneId, prac: pracPosture, portrait } };
}

// 近い範囲（取り違えても大きくは外れていないもの）
const NEAR = {
  head: ["neckL", "neckR"], neckL: ["head", "shL", "neckR"], neckR: ["head", "shR", "neckL"], shL: ["neckL", "scL"], shR: ["neckR", "scR"],
  scL: ["shL", "backC", "scR"], scR: ["shR", "backC", "scL"], backC: ["scL", "scR", "kidL", "kidR"], kidL: ["backC", "lowL", "kidR"], kidR: ["backC", "lowR", "kidL"],
  lowL: ["kidL", "lowR"], lowR: ["kidR", "lowL"], chest: ["epi"], epi: ["chest", "abd"], abd: ["epi", "groinL", "groinR"], groinL: ["abd", "groinR"], groinR: ["abd", "groinL"],
};

export function run(n = 2000, seed = 1, opts = {}) {
  R = rng(seed);
  const by = {};
  const tot = { n: 0, recv: 0, exact: 0, near: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const name = Object.keys(RECEIVERS)[i % 5];
    const seq = scene(name, opts);
    const sc = seq[0];
    const mem = {}, votes = {};
    let fr = null;
    seq.forEach((f, k) => {
      let r = G.resolveFrame({ ...f.input, mem, now: k * 125 });
      if (opts.taps) {
        const okNow = r.recipient && Math.hypot(G.torsoCenter(r.recipient).x - f.truth.recvCenter.x, G.torsoCenter(r.recipient).y - f.truth.recvCenter.y) < 0.8 * f.truth.recvU;
        if (r.needTap || !r.recipient) r = G.resolveFrame({ ...f.input, manual: sc.truth.taps, mem, now: k * 125 });
        else if (r.uncertain || !okNow) r = G.resolveFrame({ ...f.input, mode: "tap", mem: { ...mem, tapPt: f.truth.recvCenter }, now: k * 125 });
      }
      const h = r.hits.find((x) => x.hit)?.hit?.zone.id || null;
      if (h) votes[h] = (votes[h] || 0) + 1;
      fr = r;
    });
    const voted = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const key = `${sc.info.recv}・${sc.info.side === "back" ? "背中側" : "前側"}`;
    const b = (by[key] ||= { n: 0, recv: 0, exact: 0, near: 0, none: 0 });
    const okRecv = fr.recipient && Math.hypot(G.torsoCenter(fr.recipient).x - sc.truth.recvCenter.x, G.torsoCenter(fr.recipient).y - sc.truth.recvCenter.y) < 0.8 * sc.truth.recvU;
    const hit = voted;
    const exact = okRecv && hit === sc.truth.zoneId, near = okRecv && !exact && (NEAR[sc.truth.zoneId] || []).includes(hit);
    if (opts.collect && !exact) opts.collect.push({ info: sc.info, want: sc.truth.zoneId, got: hit, mode: fr.hits.find((h) => h.hit)?.hit?.mode || (fr.hits.length ? "miss" : "nohand"), view: fr.view, okRecv, synth: !!fr.recipient?.synthetic, nPoses: sc.input.poses.length, nBoxes: sc.input.boxes.length, recvPose: sc.recvPose, pracIsRecv: fr.recipient && fr.practitioner === null });
    for (const o of [b, tot]) { o.n++; o.recv += okRecv ? 1 : 0; o.exact += exact ? 1 : 0; o.near += near ? 1 : 0; o.none += hit ? 0 : 1; }
  }
  return { by, tot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = +(process.argv[2] || 2000);
  const { by, tot } = run(n, 1, { ideal: process.argv.includes("ideal"), taps: process.argv.includes("taps"), frames: process.argv.includes("seq") ? 16 : 1 });
  const pct = (a, b) => `${Math.round((100 * a) / (b || 1))}%`;
  console.log("場面\t件数\t受ける方が正しい\t範囲が一致\t一致か隣\t当たりなし");
  for (const [k, o] of Object.entries(by).sort()) console.log(`${k}\t${o.n}\t${pct(o.recv, o.n)}\t${pct(o.exact, o.n)}\t${pct(o.exact + o.near, o.n)}\t${pct(o.none, o.n)}`);
  console.log(`合計\t${tot.n}\t${pct(tot.recv, tot.n)}\t${pct(tot.exact, tot.n)}\t${pct(tot.exact + tot.near, tot.n)}\t${pct(tot.none, tot.n)}`);
}
