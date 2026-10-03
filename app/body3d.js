// 3D人体図に探査結果を塗る（熱＝赤、固結・張り＝青、圧痛＝紫。各1色、20段階。重ねて塗るほど濃くなる）
// 色・段階・道具・読み取り方は paint.js（平面図）と同じ。
// 人体の形は data/body3d.bin（tools/build_body.mjs で作成）。単位はメートル、y が上、z が前、+x が体の左側。
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
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
        this.targets.push({ id: p.id, no: p.no, v: best, x: P[best * 3], y: P[best * 3 + 1], z: P[best * 3 + 2] });
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
      const s = this.label(String(t.no), '#2c3a32', 0.019, true);
      const n = new THREE.Vector3(...this.vertexNormal(t.v));
      s.position.set(t.x + n.x * 0.012, t.y + n.y * 0.012, t.z + n.z * 0.012);
      this.markers.add(s);
    }
    this.markers.visible = this.showNumbers;
    scene.add(this.markers);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 5;
    this.controls.addEventListener('change', () => this.render());
    this.raycaster = new THREE.Raycaster();
    this.setMode(this.mode);
    this.setView(this.view || 'back');
    this.updateColors();
    this.bind(canvas);
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    return true;
  }

  vertexNormal(i) {
    const n = this.geometry.attributes.normal.array;
    return [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]];
  }

  label(text, color, size, round = false) {
    const c = document.createElement('canvas');
    const W = 128;
    c.width = W;
    c.height = round ? W : 64;
    const x = c.getContext('2d');
    x.font = `700 ${round ? 64 : 44}px sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (round) {
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
    const h = Math.round(Math.min(window.innerHeight * 0.62, w * 1.25));
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
    this.camera.position.set(...v.pos);
    this.controls.target.set(...v.target);
    this.controls.update();
    this.render();
  }

  setMode(m) {
    this.mode = m;
    if (this.controls) this.controls.enabled = m === 'rotate';
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

  // ---- 塗る ----
  bind(canvas) {
    let stroke = null;
    let raf = 0;
    const hit = (ev) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const h = this.raycaster.intersectObject(this.body, false)[0];
      return h ? h.point : null;
    };
    let last = null;
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
    canvas.addEventListener('pointerdown', (ev) => {
      if (this.mode !== 'paint') return;
      ev.preventDefault();
      canvas.setPointerCapture(ev.pointerId);
      stroke = new Map();
      last = null;
      apply(hit(ev));
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!stroke) return;
      ev.preventDefault();
      apply(hit(ev));
    });
    const end = () => {
      if (!stroke) return;
      if (stroke.size) this.history.push({ layer: this.layer, cells: new Map([...stroke].map(([i, r]) => [i, r.old])) });
      if (this.history.length > 40) this.history.shift();
      stroke = null;
      last = null;
      this.onChange?.();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
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
      if (!a) per.set(k, (a = { id: this.targets[k].id, n: 0, min: 4, vals: Object.fromEntries(LAYERS.map((l) => [l.id, []])) }));
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
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      this.controls?.dispose();
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}
