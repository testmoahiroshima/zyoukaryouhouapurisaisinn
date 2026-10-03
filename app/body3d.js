// 3D人体図に探査結果を塗る（熱＝赤、固結・張り＝青、圧痛＝紫。各1色、20段階。重ねて塗るほど濃くなる）
// 色・段階・道具・読み取り方は paint.js（平面図）と同じ。
// 人体の形は data/body3d.bin（tools/build_body.mjs で作成）。単位はメートル、y が上、z が前、+x が体の左側。
import * as THREE from './vendor/three.module.min.js';
import { LAYERS, LEVELS, applyTool, levelColor, summarizeLevels } from './paint.js';

export const BRUSHES3 = [
  { id: 'fine', name: '細', r: 0.012 },
  { id: 'mid', name: '中', r: 0.022 },
  { id: 'wide', name: '太', r: 0.04 },
];
export const VIEWS3 = [
  { id: 'front', name: '前', pos: [0, 1.0, 3.6], target: [0, 0.89, 0] },
  { id: 'back', name: '後ろ', pos: [0, 1.0, -3.6], target: [0, 0.89, 0] },
  { id: 'left', name: '左', pos: [3.6, 1.0, 0], target: [0, 0.89, 0] },
  { id: 'right', name: '右', pos: [-3.6, 1.0, 0], target: [0, 0.89, 0] },
  { id: 'head', name: '頭・首', pos: [0.35, 1.68, -0.62], target: [0, 1.56, 0] },
  { id: 'top', name: '頭頂', pos: [0, 2.35, 0.15], target: [0, 1.62, 0] },
  { id: 'face', name: '顔・前肩', pos: [0.2, 1.5, 0.75], target: [0, 1.48, 0.02] },
  { id: 'upperback', name: '肩・背中', pos: [0, 1.42, -1.0], target: [0, 1.3, 0] },
  { id: 'lowerback', name: '腰・骨盤', pos: [0, 1.0, -0.9], target: [0, 0.97, 0] },
  { id: 'abdomen', name: 'おなか・鼠蹊部', pos: [0, 1.0, 0.9], target: [0, 0.96, 0] },
];

// 内臓のおおよその位置（目安）。塗りの色（赤・青・紫）と紛れないよう、すべて同じ淡い色で示す
const ORGANS = [
  { name: '脳', c: [0, 1.645, -0.005], r: [0.064, 0.068, 0.078] },
  { name: '肺', c: [0.075, 1.29, -0.008], r: [0.058, 0.105, 0.058] },
  { name: '肺', c: [-0.075, 1.29, -0.008], r: [0.058, 0.105, 0.058], noLabel: true },
  { name: '心臓', c: [0.03, 1.235, 0.035], r: [0.042, 0.052, 0.038] },
  { name: '肝臓', c: [-0.055, 1.135, 0.018], r: [0.1, 0.048, 0.06] },
  { name: '胃', c: [0.055, 1.1, 0.03], r: [0.058, 0.042, 0.038] },
  { name: '膵臓', c: [0.0, 1.075, -0.005], r: [0.06, 0.014, 0.02] },
  { name: '腎臓', c: [0.06, 1.06, -0.052], r: [0.024, 0.044, 0.02] },
  { name: '腎臓', c: [-0.06, 1.06, -0.052], r: [0.024, 0.044, 0.02], noLabel: true },
  { name: '腸', c: [0, 0.985, 0.028], r: [0.1, 0.07, 0.058] },
  { name: '膀胱', c: [0, 0.88, 0.04], r: [0.034, 0.028, 0.03] },
];

export async function loadBodyMesh(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const nv = dv.getUint32(0, true);
  const ni = dv.getUint32(4, true);
  const pos = new Float32Array(nv * 3);
  const q = new Int16Array(buf, 8, nv * 3);
  for (let i = 0; i < nv * 3; i++) pos[i] = q[i] / 10000;
  let o = 8 + nv * 6;
  if (o % 4) o += 2;
  const index = new Uint32Array(buf, o, ni);
  return { positions: pos, index };
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Body3D {
  // mesh: loadBodyMesh() の結果、points: [{ id, no, name, p3: [[x,y,z],...] }]
  constructor(mesh, points) {
    this.mesh = mesh;
    this.points = points;
    this.nv = mesh.positions.length / 3;
    this.values = Object.fromEntries(LAYERS.map((l) => [l.id, new Float32Array(this.nv)]));
    this.layer = 'heat';
    this.tool = 'paint';
    this.brush = 'mid';
    this.mode = 'paint';
    this.show = 'all';
    this.showOrgans = false;
    this.showNumbers = true;
    this.history = [];
    this.onChange = null;
    this.buildIndex();
  }

  // 頂点の近傍探索用の格子と、各頂点がどの探査箇所に属するか（一番近い探査箇所）
  buildIndex() {
    if (this.mesh.index3) { Object.assign(this, this.mesh.index3); return; }
    const P = this.mesh.positions;
    this.cell = 0.03;
    this.hash = new Map();
    const key = (x, y, z) => `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
    for (let i = 0; i < this.nv; i++) {
      const k = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      let a = this.hash.get(k);
      if (!a) this.hash.set(k, (a = []));
      a.push(i);
    }
    // 探査箇所の位置を体の表面の頂点に合わせる
    this.targets = [];
    for (const p of this.points) {
      for (const t of p.p3 || []) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < this.nv; i++) {
          const d = (P[i * 3] - t[0]) ** 2 + (P[i * 3 + 1] - t[1]) ** 2 + (P[i * 3 + 2] - t[2]) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        const x = P[best * 3];
        const side = (p.p3 || []).length > 1 ? (x > 0 ? 'L' : 'R') : null;
        this.targets.push({ id: p.id, no: p.no, side, v: best, x, y: P[best * 3 + 1], z: P[best * 3 + 2] });
      }
    }
    this.owner = new Int16Array(this.nv).fill(-1);
    this.ownerDist = new Float32Array(this.nv);
    for (let i = 0; i < this.nv; i++) {
      let best = -1, bd = Infinity;
      for (let k = 0; k < this.targets.length; k++) {
        const t = this.targets[k];
        const d = (P[i * 3] - t.x) ** 2 + (P[i * 3 + 1] - t.y) ** 2 + (P[i * 3 + 2] - t.z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      this.owner[i] = best;
      this.ownerDist[i] = Math.sqrt(bd);
    }
    this.mesh.index3 = { cell: this.cell, hash: this.hash, targets: this.targets, owner: this.owner, ownerDist: this.ownerDist };
  }

  near(x, y, z, r) {
    const out = [];
    const c = this.cell;
    const P = this.mesh.positions;
    const span = Math.ceil(r / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) for (let d = -span; d <= span; d++) {
      const arr = this.hash.get(`${cx + a},${cy + b},${cz + d}`);
      if (!arr) continue;
      for (const i of arr) {
        const dist = Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y, P[i * 3 + 2] - z);
        if (dist <= r) out.push([i, dist]);
      }
    }
    return out;
  }

  // ---- 表示 ----
  mount(container) {
    this.dispose();
    this.container = container;
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'body3d-canvas';
    container.appendChild(canvas);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch {
      container.innerHTML = '<p class="small warn-text">この端末では3D表示が使えません。「平面図」で入力してください。</p>';
      return false;
    }
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0xf7f5f0);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a6, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(1.5, 2.5, 2);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.9);
    dl2.position.set(-1.5, 1.5, -2.5);
    scene.add(dl2);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(this.mesh.index, 1));
    g.computeVertexNormals();
    this.colors = new Float32Array(this.nv * 3);
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry = g;
    this.body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
    scene.add(this.body);

    // 内臓（薄く、塗りの上に透かして重ねる）
    this.organs = new THREE.Group();
    for (const o of ORGANS) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x8c7b68, transparent: true, opacity: 0.13, depthTest: false, depthWrite: false }));
      m.scale.set(...o.r);
      m.position.set(...o.c);
      m.renderOrder = 5;
      this.organs.add(m);
      if (!o.noLabel) {
        const s = this.label(o.name, '#6b5a50', 0.022);
        s.position.set(o.c[0], o.c[1], o.c[2]);
        s.renderOrder = 6;
        s.material.depthTest = false;
        s.material.opacity = 0.55;
        this.organs.add(s);
      }
    }
    this.organs.visible = this.showOrgans;
    scene.add(this.organs);

    // 探査箇所の番号
    this.markers = new THREE.Group();
    for (const t of this.targets) {
      if (this.onlyIds && !this.onlyIds.has(t.id)) continue;
      const s = this.label(String(t.no), '#2c3a32', 0.019, true);
      const n = new THREE.Vector3(...this.vertexNormal(t.v));
      s.position.set(t.x + n.x * 0.012, t.y + n.y * 0.012, t.z + n.z * 0.012);
      this.markers.add(s);
    }
    this.markers.visible = this.showNumbers;
    scene.add(this.markers);

    // 向き（注視点のまわりの球面座標）。指の操作とボタンで変える
    const fresh = !this.orbit;
    this.orbit ||= { target: new THREE.Vector3(), r: 3, theta: Math.PI, phi: Math.PI / 2 };
    // 指で示した場所の印（つらい所を教える時）
    this.pins = new THREE.Group();
    this.pins.renderOrder = 7;
    scene.add(this.pins);
    this.raycaster = new THREE.Raycaster();
    this.setMode(this.mode);
    if (fresh) this.setView(this.view || 'back'); else this.applyCamera();
    this.updateColors();
    this.bind(canvas);
    this.resize();
    if (this.guide) this.setGuide({ ...this.guide, focus: fresh && this.guide.focus });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    return true;
  }

  // すでに描いている図を、別の入れ物へ移す（描き直さない）
  attach(container) {
    if (this.renderer && this.renderer.domElement) {
      this.container = container;
      container.innerHTML = '';
      container.appendChild(this.renderer.domElement);
      this.resize();
      return true;
    }
    return this.mount(container);
  }

  vertexNormal(i) {
    const n = this.geometry.attributes.normal.array;
    return [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]];
  }

  label(text, color, size, round = false, bg = null) {
    const c = document.createElement('canvas');
    const W = 128;
    c.width = W;
    c.height = round ? W : 64;
    const x = c.getContext('2d');
    x.font = `700 ${round ? 64 : 44}px sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (round && bg) {
      x.fillStyle = bg;
      x.beginPath();
      x.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = 6;
      x.strokeStyle = 'rgba(255,255,255,.95)';
      x.stroke();
    } else if (round) {
      x.fillStyle = 'rgba(255,255,255,.3)';
      x.beginPath();
      x.arc(W / 2, W / 2, W / 2 - 6, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = 7;
      x.strokeStyle = 'rgba(44,58,50,.6)';
      x.stroke();
      x.lineWidth = 10;
      x.strokeStyle = 'rgba(255,255,255,.8)';
      x.strokeText(text, W / 2, W / 2 + 3);
    } else {
      x.lineWidth = 8;
      x.strokeStyle = 'rgba(255,255,255,.85)';
      x.strokeText(text, W / 2, 34);
    }
    x.fillStyle = color;
    x.fillText(text, W / 2, round ? W / 2 + 3 : 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    s.scale.set(size * (round ? 1 : 2), size, 1);
    return s;
  }

  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth || 340;
    const h = Math.round(Math.min(window.innerHeight * (this.maxH || 0.62), w * (this.ratio || 1.25)));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.renderer) this.renderer.render(this.scene, this.camera);
  }

  setView(id) {
    const v = VIEWS3.find((x) => x.id === id) || VIEWS3[1];
    this.view = v.id;
    if (!this.camera) return;
    const o = this.orbit;
    o.target.set(...v.target);
    const off = new THREE.Vector3(...v.pos).sub(o.target);
    o.r = off.length();
    o.theta = Math.atan2(off.x, off.z);
    o.phi = Math.acos(Math.max(-1, Math.min(1, off.y / o.r)));
    this.applyCamera();
  }

  applyCamera() {
    if (!this.camera) return;
    const o = this.orbit;
    o.r = Math.max(0.3, Math.min(5, o.r));
    o.phi = Math.max(0.12, Math.min(Math.PI - 0.12, o.phi));
    const t = o.target;
    t.set(Math.max(-0.45, Math.min(0.45, t.x)), Math.max(0, Math.min(1.85, t.y)), Math.max(-0.35, Math.min(0.35, t.z)));
    const sp = Math.sin(o.phi);
    this.camera.position.set(t.x + o.r * sp * Math.sin(o.theta), t.y + o.r * Math.cos(o.phi), t.z + o.r * sp * Math.cos(o.theta));
    this.camera.lookAt(t);
    this.render();
  }

  // 回す（指で横になぞる・ボタン）
  rotateBy(dTheta, dPhi = 0) {
    this.orbit.theta -= dTheta;
    this.orbit.phi -= dPhi;
    this.applyCamera();
  }

  // 近づける・離す。point を指すと、そこへ寄っていく
  zoomBy(f, point = null) {
    const o = this.orbit;
    const nr = Math.max(0.3, Math.min(5, o.r / f));
    const k = 1 - nr / o.r;
    if (point && k > 0) o.target.lerp(point, k);
    else if (k < 0) o.target.lerp(new THREE.Vector3(0, o.target.y, 0), Math.min(1, -k * 0.5));
    o.r = nr;
    this.applyCamera();
  }

  // mode：'paint'（1本指で塗る）、'rotate'（1本指で回す・軽く触れると番号を選ぶ）、'pick'（1本指で回す・軽く触れると場所を示す）
  setMode(m) {
    this.mode = m;
    if (this.renderer) this.renderer.domElement.style.cursor = m === 'paint' ? 'crosshair' : 'grab';
  }

  setOrgans(on) { this.showOrgans = on; if (this.organs) this.organs.visible = on; this.render(); }
  setNumbers(on) { this.showNumbers = on; if (this.markers) this.markers.visible = on; this.render(); }
  setShow(s) { this.show = s; this.updateColors(); }

  // 肌の色に、塗った層の色を濃さ（20段階）に応じてのせる。
  // 一つの所に複数の層がある時は、斜めの縞で塗り分けて、どれも見えるようにする（色を混ぜると紫が圧痛と紛れるため）
  updateColors() {
    if (!this.colors) return;
    const skin = [238, 226, 212];
    const C = this.colors;
    const P = this.mesh.positions;
    const shown = LAYERS.filter((l) => this.show === 'all' || this.show === l.id);
    for (let i = 0; i < this.nv; i++) {
      let col = skin;
      const present = shown.filter((l) => this.values[l.id][i] >= 0.5);
      if (present.length) {
        const k = present.length > 1 ? Math.abs(Math.floor((P[i * 3] * 0.6 + P[i * 3 + 1] + P[i * 3 + 2] * 0.4) / 0.014)) % present.length : 0;
        const l = present[k];
        const lv = this.values[l.id][i];
        const c = levelColor(l, lv);
        const w = Math.min(0.95, 0.4 + (lv / LEVELS) * 0.55);
        col = skin.map((v, j) => lerp(v, c[j], w));
      }
      C[i * 3] = (col[0] / 255) ** 2.2;
      C[i * 3 + 1] = (col[1] / 255) ** 2.2;
      C[i * 3 + 2] = (col[2] / 255) ** 2.2;
    }
    this.geometry.attributes.color.needsUpdate = true;
    this.render();
  }

  // ---- 指の操作 ----
  // 1本指：塗る（塗るモード）／見るモードでは、縦になぞると体に沿って上下に動き、横になぞると回る。
  // 軽く触れると番号を選ぶ（見るモード）・場所を示す（指すモード）。
  // 2本指：広げる・つまむで拡大・縮小、そのまま動かすと体の位置を動かす、ひねると回す。2回続けて触れると、その所へ寄る。
  // マウス：ホイールで拡大・縮小、右ボタンで位置を動かす、Shiftを押しながら動かすと回す。
  hitAt(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(this.body, false)[0] || null;
  }

  // 画面上の点に一番近い、見えている探査箇所（指の太さを考えて少し広めに）
  targetAt(clientX, clientY, within = 30) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cam = this.camera.position;
    let best = -1, bd = within;
    const v = new THREE.Vector3();
    this.targets.forEach((t, k) => {
      if (this.onlyIds && !this.onlyIds.has(t.id)) return;
      const n = this.vertexNormal(t.v);
      const toCam = [cam.x - t.x, cam.y - t.y, cam.z - t.z];
      if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] < 0) return; // 裏側は選ばない
      v.set(t.x, t.y, t.z).project(this.camera);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  // 画面の上で、体の位置を動かす
  panBy(dx, dy) {
    const o = this.orbit;
    const h = this.renderer.domElement.clientHeight || 400;
    const scale = (2 * o.r * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    o.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.applyCamera();
  }

  // 体に沿って上下に動かす（頭の方へ・足の方へ）。dy は画面の上での指の動き（下へなぞると頭の方が見える）
  moveVertical(dy) {
    const o = this.orbit;
    const h = this.renderer?.domElement.clientHeight || 400;
    const scale = (2 * o.r * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    o.target.y += dy * scale;
    this.applyCamera();
  }

  // ボタンで上下に動かす（見えている高さの約4分の1ずつ）
  stepVertical(dir) {
    const o = this.orbit;
    const span = 2 * o.r * Math.tan((this.camera.fov * Math.PI) / 360);
    this.animateTo({ target: { x: o.target.x, y: Math.max(0, Math.min(1.85, o.target.y + dir * span * 0.25)), z: o.target.z } }, 300);
  }

  bind(canvas) {
    const ptrs = new Map();
    let stroke = null;
    let last = null;
    let raf = 0;
    let drag = null; // 1本指
    let pinch = null; // 2本指
    let lastTap = null;
    const SPEED = 0.008;
    const apply = (p) => {
      if (!p) return;
      const r = BRUSHES3.find((b) => b.id === this.brush).r;
      if (last) {
        const d = last.distanceTo(p);
        const steps = Math.max(1, Math.ceil(d / (r / 3)));
        for (let i = 1; i <= steps; i++) this.stamp(new THREE.Vector3().lerpVectors(last, p, i / steps), r, stroke);
      } else this.stamp(p, r, stroke);
      last = p.clone();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.updateColors(); });
    };
    // 2本目の指が来たら、1本目で塗り始めた分は取り消す（拡大・移動のつもりの指で塗らない）
    const cancelStroke = () => {
      if (!stroke) return;
      const vals = this.values[this.layer];
      for (const [i, rec] of stroke) vals[i] = rec.old;
      stroke = null;
      last = null;
      this.updateColors();
    };
    const finishStroke = () => {
      if (!stroke) return;
      if (stroke.size) this.history.push({ layer: this.layer, cells: new Map([...stroke].map(([i, r]) => [i, r.old])) });
      if (this.history.length > 40) this.history.shift();
      stroke = null;
      last = null;
      this.onChange?.();
    };
    const two = () => {
      const [a, b] = [...ptrs.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    // 2回続けて触れたら、その所へ寄る（寄っている時は元の大きさへ）
    const doubleTap = (x, y) => {
      const h = this.hitAt(x, y);
      if (this.orbit.r < 0.7) this.animateTo({ r: 1.4 });
      else if (h) this.animateTo({ target: h.point, r: Math.max(0.45, this.orbit.r / 2.2) });
    };
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { canvas.setPointerCapture(ev.pointerId); } catch { /* 取れない時もそのまま続ける */ }
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.stopAnim();
      if (ptrs.size === 2) {
        cancelStroke();
        drag = null;
        pinch = two();
        return;
      }
      if (ptrs.size > 2) return;
      const mouseMove = ev.pointerType === 'mouse' && ev.button === 2;
      const mouseRotate = ev.pointerType === 'mouse' && ev.shiftKey;
      if (this.mode === 'paint' && !mouseMove && !mouseRotate) {
        stroke = new Map();
        last = null;
        apply(this.hitAt(ev.clientX, ev.clientY)?.point);
      } else {
        drag = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now(), pan: mouseMove };
      }
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!ptrs.has(ev.pointerId)) return;
      ev.preventDefault();
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && ptrs.size >= 2) {
        const now = two();
        if (now.d > 0 && pinch.d > 0 && Math.abs(now.d - pinch.d) > 0.5) this.zoomBy(now.d / pinch.d);
        this.panBy(now.x - pinch.x, now.y - pinch.y);
        // 2本指をひねると、体を回す
        let da = now.ang - pinch.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > 0.004) this.rotateBy(-da * 1.4);
        pinch = now;
        return;
      }
      if (stroke) { apply(this.hitAt(ev.clientX, ev.clientY)?.point); return; }
      if (drag) {
        const dx = ev.clientX - drag.x;
        const dy = ev.clientY - drag.y;
        if (drag.pan) this.panBy(dx, dy);
        else {
          // 1本指：なぞり始めの向きで決める。縦になぞると体に沿って上下に動き、横になぞると体が回る
          if (!drag.axis) {
            const tx = ev.clientX - drag.sx;
            const ty = ev.clientY - drag.sy;
            if (Math.hypot(tx, ty) < 8) return;
            drag.axis = Math.abs(ty) > Math.abs(tx) * 0.8 ? 'v' : 'h';
          }
          if (drag.axis === 'v') this.moveVertical(dy);
          else this.rotateBy(dx * SPEED, 0);
        }
        drag.x = ev.clientX;
        drag.y = ev.clientY;
      }
    });
    const up = (ev) => {
      if (!ptrs.has(ev.pointerId)) return;
      ptrs.delete(ev.pointerId);
      if (pinch) { if (ptrs.size < 2) pinch = null; return; }
      const tap = ev.type === 'pointerup';
      if (stroke) { finishStroke(); }
      if (drag) {
        const moved = Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy);
        const quick = performance.now() - drag.t < 450;
        drag = null;
        if (moved < 10 && quick && tap) {
          const now = performance.now();
          if (lastTap && now - lastTap.t < 330 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 30) {
            lastTap = null;
            doubleTap(ev.clientX, ev.clientY);
            return;
          }
          lastTap = { t: now, x: ev.clientX, y: ev.clientY };
          if (this.mode === 'pick') {
            const h = this.hitAt(ev.clientX, ev.clientY);
            if (h) this.onPick?.(h.point.clone());
          } else if (this.onSelectTarget) {
            const k = this.targetAt(ev.clientX, ev.clientY);
            if (k >= 0) this.onSelectTarget(k);
          }
        }
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoomBy(Math.exp(-ev.deltaY * 0.0015), this.hitAt(ev.clientX, ev.clientY)?.point || null);
    }, { passive: false });
  }

  // ---- なめらかに向きを変える ----
  stopAnim() { if (this._anim) cancelAnimationFrame(this._anim); this._anim = 0; }
  animateTo({ target = null, r = null, theta = null, phi = null }, ms = 450) {
    if (!this.camera) return;
    this.stopAnim();
    const o = this.orbit;
    const from = { t: o.target.clone(), r: o.r, theta: o.theta, phi: o.phi };
    let dTheta = theta === null ? 0 : theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    const to = { t: target ? new THREE.Vector3(target.x, target.y, target.z) : from.t, r: r ?? from.r, theta: from.theta + dTheta, phi: phi ?? from.phi };
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      o.target.lerpVectors(from.t, to.t, e);
      o.r = lerp(from.r, to.r, e);
      o.theta = lerp(from.theta, to.theta, e);
      o.phi = lerp(from.phi, to.phi, e);
      this.applyCamera();
      this._anim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    this._anim = requestAnimationFrame(step);
  }

  // 探査箇所の番号（target の添字）から、その場所と面の向き
  targetIndexes(id, side = null) {
    const out = [];
    this.targets.forEach((t, k) => { if (t.id === id && (!side || !t.side || t.side === side)) out.push(k); });
    return out;
  }

  // 箇所へ寄る（面の正面から見る）。r は寄る距離
  focusTargets(ks, r = 0.75) {
    if (!ks.length || !this.camera) return;
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const k of ks) {
      const t = this.targets[k];
      c.add(new THREE.Vector3(t.x, t.y, t.z));
      n.add(new THREE.Vector3(...this.vertexNormal(t.v)));
    }
    c.divideScalar(ks.length);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    // 真上・真下から見ないように、少し水平に寄せる
    const ny = Math.max(-0.6, Math.min(0.75, n.y));
    const theta = Math.atan2(n.x, n.z);
    const phi = Math.acos(ny);
    const spread = ks.length > 1 ? Math.hypot(this.targets[ks[0]].x - this.targets[ks[ks.length - 1]].x, this.targets[ks[0]].y - this.targets[ks[ks.length - 1]].y) : 0;
    this.animateTo({ target: c, r: Math.max(r, spread * 2.6 + 0.35), theta, phi });
  }

  // 示した場所の印。体の表面に貼ったシールのように置き、体の陰になる所（裏側）からは見えない
  addPin(p, color = 0xe07a1f) {
    let best = -1, bd = Infinity;
    for (const [i, d] of this.near(p.x, p.y, p.z, 0.03)) if (d < bd) { bd = d; best = i; }
    const n = new THREE.Vector3(...(best >= 0 ? this.vertexNormal(best) : [0, 0, 1])).normalize();
    const at = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(n, 0.004);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.024, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0025, 8, 40), new THREE.MeshBasicMaterial({ color }));
    for (const m of [halo, dot, ring]) { m.position.copy(at); m.quaternion.copy(q); m.renderOrder = 8; }
    dot.position.addScaledVector(n, 0.001);
    const g = new THREE.Group();
    g.add(halo, dot, ring);
    this.pins.add(g);
    this.render();
  }

  // 最後につけた印を外す
  removeLastPin() {
    const last = this.pins?.children[this.pins.children.length - 1];
    if (last) this.pins.remove(last);
    this.render();
  }

  clearPins() {
    this.pins?.clear();
    this.render();
  }

  // ---- 施術箇所を図で示す ----
  // items: [{ id, side, no, order, current, emphasis }]、flows: [{ ids: [[id, side], ...], color }]
  setGuide({ items = [], flows = [], focus = true } = {}) {
    this.guide = { items, flows, focus };
    if (!this.scene) return;
    if (this.guideGroup) { this.scene.remove(this.guideGroup); this.guideGroup.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }
    const G = (this.guideGroup = new THREE.Group());
    this.pulse = [];
    const up = new THREE.Vector3(0, 1, 0);
    const posOf = (k, lift = 0) => {
      const t = this.targets[k];
      const n = new THREE.Vector3(...this.vertexNormal(t.v));
      return { p: new THREE.Vector3(t.x, t.y, t.z).addScaledVector(n, lift), n };
    };
    for (const it of items) {
      const ks = this.targetIndexes(it.id, it.side);
      ks.forEach((k) => {
        const { p, n } = posOf(k, 0.006);
        const strong = it.current || it.emphasis;
        const color = it.current ? 0xe0661f : it.done ? 0x9aa59e : 0x2f8a5a;
        const ringR = it.current ? 0.03 : strong ? 0.024 : 0.018;
        // 印は体の陰になる所（裏側）からは見えない（前につけた印が背中側から透けて見えないように）
        const see = false;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, it.current ? 0.006 : 0.004, 10, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: it.done ? 0.5 : 0.95, depthTest: !see }));
        ring.position.copy(p);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        ring.renderOrder = 9;
        G.add(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(ringR, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: it.current ? 0.28 : 0.16, depthTest: !see, depthWrite: false }));
        disc.position.copy(p);
        disc.quaternion.copy(ring.quaternion);
        disc.renderOrder = 8;
        G.add(disc);
        if (it.current) this.pulse.push(ring, disc);
        if (it.order) {
          const s = this.label(String(it.order), it.current ? '#ffffff' : '#ffffff', it.current ? 0.03 : 0.022, true, it.current ? '#e0661f' : it.done ? '#9aa59e' : '#2f8a5a');
          // 今の所は、矢印に重ならないよう丸の横に番号を置く
          const side = new THREE.Vector3().crossVectors(up, n);
          if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
          side.normalize();
          if (it.current) s.position.copy(p).addScaledVector(n, 0.02).addScaledVector(side, 0.05);
          else s.position.copy(p).addScaledVector(n, 0.03).addScaledVector(up, 0.028);
          s.renderOrder = 11;
          s.material.depthTest = !see;
          G.add(s);
        }
        // 今施術する所には、体の外から指す矢印
        if (it.current) {
          const len = 0.1;
          // 正面から見ても分かるように、斜め上から指す
          const out = n.clone().multiplyScalar(0.6).addScaledVector(up, 0.8).normalize();
          const dir = out.clone().negate();
          const arrow = new THREE.Group();
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 12), new THREE.MeshBasicMaterial({ color: 0xe0661f }));
          shaft.position.y = len / 2 + 0.03;
          const head = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.03, 16), new THREE.MeshBasicMaterial({ color: 0xe0661f }));
          head.position.y = 0.015;
          head.rotation.x = Math.PI;
          arrow.add(shaft, head);
          arrow.position.copy(p).addScaledVector(out, 0.012);
          arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
          arrow.traverse((o) => { o.renderOrder = 12; });
          G.add(arrow);
          this.arrow = { group: arrow, base: arrow.position.clone(), n: out };
        }
      });
    }
    // 毒素の流れ（矢印つきの線）
    for (const fl of flows) {
      const pts = [];
      for (const [id, side] of fl.ids) {
        const ks = this.targetIndexes(id, side);
        if (!ks.length) continue;
        const c = new THREE.Vector3();
        const n = new THREE.Vector3();
        for (const k of ks) { const q = posOf(k); c.add(q.p); n.add(q.n); }
        c.divideScalar(ks.length);
        n.normalize();
        pts.push(c.addScaledVector(n, 0.03));
      }
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 16, 0.0045, 8, false), new THREE.MeshBasicMaterial({ color: fl.color || 0x2f5d8a, transparent: true, opacity: 0.85 }));
      tube.renderOrder = 10;
      G.add(tube);
      for (let i = 1; i < pts.length; i++) {
        const tt = (i - 0.15) / (pts.length - 1);
        const at = curve.getPointAt(Math.min(0.999, tt));
        const tan = curve.getTangentAt(Math.min(0.999, tt));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.026, 14), new THREE.MeshBasicMaterial({ color: fl.color || 0x2f5d8a }));
        cone.position.copy(at);
        cone.quaternion.setFromUnitVectors(up, tan);
        cone.renderOrder = 10;
        G.add(cone);
      }
    }
    this.scene.add(G);
    this.startPulse();
    if (focus) {
      const cur = items.find((x) => x.current);
      if (cur) this.focusTargets(this.targetIndexes(cur.id, cur.side), 0.8);
    }
    this.render();
  }

  startPulse() {
    if (this._pulse) cancelAnimationFrame(this._pulse);
    this._pulse = 0;
    if (!this.pulse?.length && !this.arrow) return;
    // 電池を使いすぎないよう、動かすのは最初の数秒だけ（その後は止まった絵）
    const until = performance.now() + 6000;
    const loop = (now) => {
      if (!this.renderer) return;
      if (now > until) {
        for (const m of this.pulse) m.scale.setScalar(1);
        if (this.arrow) this.arrow.group.position.copy(this.arrow.base);
        this.render();
        this._pulse = 0;
        return;
      }
      const k = 1 + 0.18 * Math.sin(now / 260);
      for (const m of this.pulse) m.scale.setScalar(k);
      if (this.arrow) this.arrow.group.position.copy(this.arrow.base).addScaledVector(this.arrow.n, 0.012 * (1 + Math.sin(now / 200)));
      this.render();
      this._pulse = requestAnimationFrame(loop);
    };
    this._pulse = requestAnimationFrame(loop);
  }

  // ---- 番号を選んで、濃さを段階で入れる（指でなぞるのが難しい時） ----
  // その箇所の周り（一番近い探査箇所がその箇所の所だけ）を、選んだ段階（0〜5 → 0〜20）にそろえる
  setTargetLevel(k, layerId, level5, radius = 0.03) {
    const vals = this.values[layerId];
    const lv = Math.max(0, Math.min(LEVELS, level5 * (LEVELS / 5)));
    const cells = new Map();
    for (let i = 0; i < this.nv; i++) {
      if (this.owner[i] !== k || this.ownerDist[i] > radius) continue;
      cells.set(i, vals[i]);
      const edge = this.ownerDist[i] / radius;
      vals[i] = edge > 0.75 ? lv * (1 - (edge - 0.75) * 2.4) : lv;
      if (vals[i] < 0.5 && lv > 0) vals[i] = Math.max(vals[i], 0);
    }
    if (cells.size) this.history.push({ layer: layerId, cells });
    this.updateColors();
    this.onChange?.();
  }

  targetLevels(k) {
    const t = this.targets[k];
    const f = this.sample()[t.id];
    const v = t.side && f?.sides ? f.sides[t.side] : f;
    return Object.fromEntries(LAYERS.map((l) => [l.id, Math.round(v?.[l.id] || 0)]));
  }

  // 一筆の中では、頂点ごとに一番強くかかった筆の強さで、元の濃さから変える
  stamp(p, r, stroke) {
    const vals = this.values[this.layer];
    for (const [i, d] of this.near(p.x, p.y, p.z, r)) {
      const t = Math.min(1, (1 - d / r) * 2);
      const f = t * t * (3 - 2 * t);
      let rec = stroke.get(i);
      if (!rec) { rec = { old: vals[i], f: 0 }; stroke.set(i, rec); }
      if (f <= rec.f) continue;
      rec.f = f;
      vals[i] = applyTool(this.tool, rec.old, f);
    }
  }

  undo() {
    const h = this.history.pop();
    if (!h) return false;
    const vals = this.values[h.layer];
    for (const [i, old] of h.cells) vals[i] = old;
    this.updateColors();
    this.onChange?.();
    return true;
  }

  clear() {
    for (const l of LAYERS) this.values[l.id].fill(0);
    this.history = [];
    this.updateColors();
    this.onChange?.();
  }

  // ---- 読み取り ----
  // 各頂点は一番近い探査箇所にだけ属し（隣の箇所に漏れない）、その箇所から半径 R 以内の頂点だけを見る
  sample(R = 0.045) {
    const per = new Map();
    for (let i = 0; i < this.nv; i++) {
      const k = this.owner[i];
      if (k < 0 || this.ownerDist[i] > R) continue;
      let a = per.get(k);
      if (!a) per.set(k, (a = { id: this.targets[k].id, side: this.targets[k].side, n: 0, min: 4, vals: Object.fromEntries(LAYERS.map((l) => [l.id, []])) }));
      a.n++;
      for (const l of LAYERS) {
        const v = this.values[l.id][i];
        if (v >= 0.5) a.vals[l.id].push(v);
      }
    }
    return summarizeLevels(per);
  }

  hasPaint() {
    return LAYERS.some((l) => this.values[l.id].some((v) => v > 0.5));
  }

  dispose() {
    this.stopAnim();
    if (this._pulse) cancelAnimationFrame(this._pulse);
    this._pulse = 0;
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      this.renderer.dispose();
      try { this.renderer.forceContextLoss(); } catch { /* 何もしない */ }
      this.renderer = null;
    }
  }
}
