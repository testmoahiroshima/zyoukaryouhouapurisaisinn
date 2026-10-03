// 3D人体図の形を作る：node tools/build_body.mjs
// 頭・首・胴・腕・脚などの形（符号付き距離）をなめらかにつなぎ、表面を三角形の網にして data/body3d.bin に書き出す。
// 単位はメートル。y が上、z が前（顔の向き）、x が体の左右（+x が体の左側）。
import { writeFileSync } from 'node:fs';

const v3 = (x, y, z) => [x, y, z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function ellipsoid(c, r) {
  return (p) => {
    const q = sub(p, c);
    const k0 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
    const k1 = Math.hypot(q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2]));
    return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
  };
}
// 半径が端から端へ変わる棒（丸い円すい）
function cone(a, b, ra, rb) {
  const ba = sub(b, a);
  const L2 = dot(ba, ba);
  return (p) => {
    const pa = sub(p, a);
    const h = Math.max(0, Math.min(1, dot(pa, ba) / L2));
    const d = len([pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h]);
    return d - (ra + (rb - ra) * h);
  };
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

const parts = [];
const add = (f, k = 0.035) => parts.push([f, k]);
const both = (fn, k) => { add(fn(1), k); add(fn(-1), k); };

// 頭
add(ellipsoid(v3(0, 1.625, 0.006), v3(0.078, 0.104, 0.094)), 0.03);
add(ellipsoid(v3(0, 1.645, -0.02), v3(0.079, 0.094, 0.09)), 0.03);
add(ellipsoid(v3(0, 1.556, 0.034), v3(0.058, 0.058, 0.064)), 0.03);
add(ellipsoid(v3(0, 1.6, 0.097), v3(0.011, 0.021, 0.017)), 0.012);
both((s) => ellipsoid(v3(0.079 * s, 1.6, -0.006), v3(0.011, 0.028, 0.019)), 0.01);
// 首・肩（僧帽筋）
add(cone(v3(0, 1.42, -0.012), v3(0, 1.565, -0.006), 0.057, 0.05), 0.04);
both((s) => cone(v3(0, 1.43, -0.03), v3(0.168 * s, 1.384, -0.025), 0.05, 0.043), 0.045);
// 胴
add(ellipsoid(v3(0, 1.27, 0), v3(0.162, 0.16, 0.104)), 0.05);
both((s) => ellipsoid(v3(0.07 * s, 1.3, 0.044), v3(0.083, 0.068, 0.058)), 0.04);
both((s) => ellipsoid(v3(0.08 * s, 1.3, -0.046), v3(0.088, 0.1, 0.063)), 0.04);
add(ellipsoid(v3(0, 1.08, -0.002), v3(0.133, 0.14, 0.093)), 0.06);
add(ellipsoid(v3(0, 1.06, 0.032), v3(0.118, 0.12, 0.068)), 0.05);
add(ellipsoid(v3(0, 0.94, -0.006), v3(0.153, 0.1, 0.103)), 0.06);
both((s) => ellipsoid(v3(0.07 * s, 0.9, -0.054), v3(0.084, 0.09, 0.074)), 0.04);
// 腕
both((s) => ellipsoid(v3(0.19 * s, 1.36, -0.006), v3(0.054, 0.06, 0.054)), 0.04);
both((s) => cone(v3(0.2 * s, 1.35, -0.006), v3(0.25 * s, 1.08, -0.012), 0.044, 0.034), 0.03);
both((s) => cone(v3(0.25 * s, 1.08, -0.012), v3(0.288 * s, 0.84, 0.01), 0.034, 0.025), 0.02);
both((s) => ellipsoid(v3(0.3 * s, 0.77, 0.014), v3(0.021, 0.064, 0.041)), 0.015);
// 脚
both((s) => cone(v3(0.085 * s, 0.9, 0), v3(0.095 * s, 0.5, 0.004), 0.084, 0.05), 0.05);
both((s) => cone(v3(0.095 * s, 0.5, 0.004), v3(0.1 * s, 0.1, -0.012), 0.05, 0.032), 0.03);
both((s) => ellipsoid(v3(0.097 * s, 0.36, -0.03), v3(0.044, 0.1, 0.044)), 0.03);
both((s) => ellipsoid(v3(0.1 * s, 0.036, 0.038), v3(0.041, 0.035, 0.108)), 0.025);

function sdf(p) {
  let d = Infinity;
  for (const [f, k] of parts) d = d === Infinity ? f(p) : smin(d, f(p), k);
  return d;
}

// ---- 表面を三角形の網にする（Surface Nets） ----
const h = 0.0068;
const min = [-0.37, -0.012, -0.16];
const max = [0.37, 1.78, 0.17];
const nx = Math.ceil((max[0] - min[0]) / h);
const ny = Math.ceil((max[1] - min[1]) / h);
const nz = Math.ceil((max[2] - min[2]) / h);
const gi = (x, y, z) => x + (nx + 1) * (y + (ny + 1) * z);
const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
  field[gi(x, y, z)] = sdf([min[0] + x * h, min[1] + y * h, min[2] + z * h]);
}
const ci = (x, y, z) => x + nx * (y + ny * z);
const cellVert = new Int32Array(nx * ny * nz).fill(-1);
const pos = [];
const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  const v = corners.map(([a, b, c]) => field[gi(x + a, y + b, z + c)]);
  let inside = 0;
  for (const s of v) if (s < 0) inside++;
  if (inside === 0 || inside === 8) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of edges) {
    if ((v[a] < 0) === (v[b] < 0)) continue;
    const t = v[a] / (v[a] - v[b]);
    const A = corners[a], B = corners[b];
    sx += A[0] + (B[0] - A[0]) * t;
    sy += A[1] + (B[1] - A[1]) * t;
    sz += A[2] + (B[2] - A[2]) * t;
    n++;
  }
  cellVert[ci(x, y, z)] = pos.length / 3;
  pos.push(min[0] + (x + sx / n) * h, min[1] + (y + sy / n) * h, min[2] + (z + sz / n) * h);
}
const idx = [];
const quad = (a, b, c, d, flip) => {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
};
for (let z = 1; z < nz; z++) for (let y = 1; y < ny; y++) for (let x = 0; x < nx; x++) {
  // x方向の辺
  const s0 = field[gi(x, y, z)] < 0, s1 = field[gi(x + 1, y, z)] < 0;
  if (s0 !== s1) quad(cellVert[ci(x, y - 1, z - 1)], cellVert[ci(x, y, z - 1)], cellVert[ci(x, y, z)], cellVert[ci(x, y - 1, z)], s1);
}
for (let z = 1; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 1; x < nx; x++) {
  const s0 = field[gi(x, y, z)] < 0, s1 = field[gi(x, y + 1, z)] < 0;
  if (s0 !== s1) quad(cellVert[ci(x - 1, y, z - 1)], cellVert[ci(x - 1, y, z)], cellVert[ci(x, y, z)], cellVert[ci(x, y, z - 1)], s1);
}
for (let z = 0; z < nz; z++) for (let y = 1; y < ny; y++) for (let x = 1; x < nx; x++) {
  const s0 = field[gi(x, y, z)] < 0, s1 = field[gi(x, y, z + 1)] < 0;
  if (s0 !== s1) quad(cellVert[ci(x - 1, y - 1, z)], cellVert[ci(x, y - 1, z)], cellVert[ci(x, y, z)], cellVert[ci(x - 1, y, z)], s1);
}

// なめらかにする（縮みにくい Taubin 平滑化）
const nv = pos.length / 3;
const nbr = Array.from({ length: nv }, () => new Set());
for (let i = 0; i < idx.length; i += 3) {
  const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
  nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
}
const smooth = (lambda) => {
  const out = pos.slice();
  for (let i = 0; i < nv; i++) {
    const N = nbr[i];
    if (!N.size) continue;
    let ax = 0, ay = 0, az = 0;
    for (const j of N) { ax += pos[j * 3]; ay += pos[j * 3 + 1]; az += pos[j * 3 + 2]; }
    ax /= N.size; ay /= N.size; az /= N.size;
    out[i * 3] += (ax - pos[i * 3]) * lambda;
    out[i * 3 + 1] += (ay - pos[i * 3 + 1]) * lambda;
    out[i * 3 + 2] += (az - pos[i * 3 + 2]) * lambda;
  }
  for (let i = 0; i < pos.length; i++) pos[i] = out[i];
};
for (let it = 0; it < 4; it++) { smooth(0.5); smooth(-0.53); }

// 書き出し：[頂点数 u32][三角形の頂点番号の数 u32][位置 int16×3（0.1mm単位）][番号 u32]
const nIdx = idx.length;
const buf = Buffer.alloc(8 + nv * 6 + (nv * 6 % 4 ? 2 : 0) + nIdx * 4);
buf.writeUInt32LE(nv, 0);
buf.writeUInt32LE(nIdx, 4);
let o = 8;
for (let i = 0; i < nv * 3; i++) { buf.writeInt16LE(Math.round(pos[i] * 10000), o); o += 2; }
if (o % 4) o += 2;
for (let i = 0; i < nIdx; i++) { buf.writeUInt32LE(idx[i], o); o += 4; }
writeFileSync(new URL('../data/body3d.bin', import.meta.url), buf);
console.log(`grid ${nx}x${ny}x${nz}, vertices ${nv}, triangles ${nIdx / 3}, ${(buf.length / 1024).toFixed(0)} KB`);
