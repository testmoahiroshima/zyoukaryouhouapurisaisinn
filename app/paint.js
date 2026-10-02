// 探査結果を人体図に塗って記録する（熱＝赤、固結・張り＝青、圧痛＝紫。濃淡5段階）
// 塗りは人体図（433×472）の1画素を SCALE×SCALE に分けた格子に 0〜255 で持つ。端末の外へは送らない。

export const LAYERS = [
  { id: 'heat', name: '熱', rgb: [214, 48, 36] },
  { id: 'kouketsu', name: '固結・張り', rgb: [36, 92, 214] },
  { id: 'atsutsuu', name: '圧痛', rgb: [146, 58, 190] },
];

// 拡大して塗る範囲（人体図の座標）
export const REGIONS = [
  { id: 'back_head', name: '頭・首（後ろ）', box: [268, 14, 360, 122] },
  { id: 'side_head', name: '頭（横）', box: [166, 84, 262, 182] },
  { id: 'top_head', name: '頭頂', box: [150, 0, 266, 70] },
  { id: 'front_upper', name: '顔・前肩', box: [62, 18, 152, 128] },
  { id: 'back', name: '肩・背中', box: [246, 88, 382, 214] },
  { id: 'lower_back', name: '腰・骨盤', box: [258, 168, 370, 266] },
  { id: 'front_lower', name: 'おなか・鼠蹊部', box: [50, 180, 164, 270] },
  { id: 'back_full', name: '背面全身', box: [222, 0, 433, 472] },
  { id: 'front_full', name: '前面全身', box: [0, 0, 222, 472] },
];

export const SHADES = 5;
export const BRUSHES = [
  { id: 'fine', name: '細', r: 1.6 },
  { id: 'mid', name: '中', r: 3.2 },
  { id: 'wide', name: '太', r: 6.5 },
];

const SCALE = 3;

export class Painter {
  constructor({ image, width, height }) {
    this.image = image;
    this.W = width;
    this.H = height;
    this.gw = width * SCALE;
    this.gh = height * SCALE;
    this.grids = Object.fromEntries(LAYERS.map((l) => [l.id, new Uint8Array(this.gw * this.gh)]));
    this.layer = 'heat';
    this.shade = 3;
    this.brush = 'mid';
    this.erase = false;
    this.history = [];
    this.onChange = null;
    this.region = REGIONS[0];
    this.markers = [];
  }

  hasPaint() {
    return LAYERS.some((l) => this.grids[l.id].some((v) => v > 0));
  }

  // ---- 表示 ----
  mount(container, regionId, markers = []) {
    this.region = REGIONS.find((r) => r.id === regionId) || REGIONS[0];
    this.markers = markers;
    container.innerHTML = '';
    const [x0, y0, x1, y1] = this.region.box;
    const canvas = document.createElement('canvas');
    canvas.className = 'paint-canvas';
    canvas.style.aspectRatio = `${x1 - x0} / ${y1 - y0}`;
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.resize();
    this.bind();
    this.draw();
  }

  resize() {
    const [x0, y0, x1, y1] = this.region.box;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 340;
    const cssH = cssW * ((y1 - y0) / (x1 - x0));
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  draw() {
    if (!this.ctx || !this.image.complete) {
      this.image.addEventListener?.('load', () => this.draw(), { once: true });
      return;
    }
    const [x0, y0, x1, y1] = this.region.box;
    const { ctx, canvas } = this;
    const sx = canvas.width / (x1 - x0);
    const sy = canvas.height / (y1 - y0);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const iw = this.image.naturalWidth / this.W;
    ctx.drawImage(this.image, x0 * iw, y0 * iw, (x1 - x0) * iw, (y1 - y0) * iw, 0, 0, canvas.width, canvas.height);
    // 塗りの層（格子 → 小さな画像 → 拡大してなめらかに描く）
    const gx0 = Math.floor(x0 * SCALE);
    const gy0 = Math.floor(y0 * SCALE);
    const gw = Math.ceil((x1 - x0) * SCALE);
    const gh = Math.ceil((y1 - y0) * SCALE);
    this.off.width = gw;
    this.off.height = gh;
    const octx = this.off.getContext('2d');
    const img = octx.createImageData(gw, gh);
    const d = img.data;
    for (let y = 0; y < gh; y++) {
      const row = (gy0 + y) * this.gw;
      for (let x = 0; x < gw; x++) {
        const gi = row + gx0 + x;
        // 一つの格子に複数の層がある時は、斜めの縞で塗り分けて、どれも見えるようにする
        let present = 0;
        for (const l of LAYERS) if (this.grids[l.id][gi]) present++;
        let r = 0, g = 0, b = 0, a = 0;
        if (present) {
          let pick = present > 1 ? Math.floor((gx0 + x + gy0 + y) / 5) % present : 0;
          for (const l of LAYERS) {
            const v = this.grids[l.id][gi];
            if (!v) continue;
            if (pick-- > 0) continue;
            const al = (v / 255) * 0.85;
            [r, g, b] = l.rgb.map((c) => c * al);
            a = al;
            break;
          }
        }
        if (a > 0) {
          const o = (y * gw + x) * 4;
          d[o] = r / a;
          d[o + 1] = g / a;
          d[o + 2] = b / a;
          d[o + 3] = a * 255;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.off, 0, 0, gw, gh, 0, 0, canvas.width * (gw / ((x1 - x0) * SCALE)), canvas.height * (gh / ((y1 - y0) * SCALE)));
    ctx.globalCompositeOperation = 'source-over';
    // 探査箇所の目印
    const fs = Math.max(10, canvas.width / 34);
    ctx.font = `700 ${fs * 0.75}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of this.markers) {
      for (const [mx, my] of m.xy) {
        if (mx < x0 || mx > x1 || my < y0 || my > y1) continue;
        const px = (mx - x0) * sx;
        const py = (my - y0) * sy;
        ctx.beginPath();
        ctx.arc(px, py, fs * 0.62, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, fs * 0.08);
        ctx.strokeStyle = 'rgba(40,48,44,.55)';
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(40,48,44,.85)';
        ctx.fillText(String(m.no), px, py + 0.5);
      }
    }
    ctx.restore();
  }

  // ---- 塗る ----
  bind() {
    const c = this.canvas;
    let last = null;
    let stroke = null;
    const toImage = (ev) => {
      const rect = c.getBoundingClientRect();
      const [x0, y0, x1, y1] = this.region.box;
      return [x0 + ((ev.clientX - rect.left) / rect.width) * (x1 - x0), y0 + ((ev.clientY - rect.top) / rect.height) * (y1 - y0)];
    };
    let raf = 0;
    const redraw = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; this.draw(); });
    };
    c.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      c.setPointerCapture(ev.pointerId);
      stroke = new Map();
      last = toImage(ev);
      this.stamp(last[0], last[1], stroke);
      redraw();
    });
    c.addEventListener('pointermove', (ev) => {
      if (!stroke) return;
      ev.preventDefault();
      const p = toImage(ev);
      const r = this.radius();
      const dist = Math.hypot(p[0] - last[0], p[1] - last[1]);
      const steps = Math.max(1, Math.ceil(dist / (r / 3)));
      for (let i = 1; i <= steps; i++) {
        this.stamp(last[0] + ((p[0] - last[0]) * i) / steps, last[1] + ((p[1] - last[1]) * i) / steps, stroke);
      }
      last = p;
      redraw();
    });
    const end = () => {
      if (!stroke) return;
      if (stroke.size) this.history.push({ layer: this.layer, cells: new Map([...stroke].map(([i, r]) => [i, r.old])) });
      if (this.history.length > 40) this.history.shift();
      stroke = null;
      this.onChange?.();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    this._resize = () => { this.resize(); this.draw(); };
    window.addEventListener('resize', this._resize);
  }

  radius() {
    return BRUSHES.find((b) => b.id === this.brush).r;
  }

  // 筆先：中心は選んだ濃さ、縁に向かってやわらかく薄れる。
  // 一筆の中では、その格子に一番強くかかった筆の強さだけで、元の濃さから選んだ濃さへ近づける
  // （薄い濃さで塗れば薄く塗り直せる。何度なぞっても縁が濃くなりすぎない）
  stamp(ix, iy, stroke) {
    const grid = this.grids[this.layer];
    const R = this.radius() * SCALE;
    const cx = ix * SCALE;
    const cy = iy * SCALE;
    const target = Math.round((this.shade / SHADES) * 255);
    const xa = Math.max(0, Math.floor(cx - R));
    const xb = Math.min(this.gw - 1, Math.ceil(cx + R));
    const ya = Math.max(0, Math.floor(cy - R));
    const yb = Math.min(this.gh - 1, Math.ceil(cy + R));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
        if (dd > 1) continue;
        const t = dd < 0.5 ? 1 : 1 - (dd - 0.5) / 0.5;
        const f = t * t * (3 - 2 * t);
        const i = y * this.gw + x;
        let rec = stroke.get(i);
        if (!rec) { rec = { old: grid[i], f: 0 }; stroke.set(i, rec); }
        if (f <= rec.f) continue;
        rec.f = f;
        grid[i] = this.erase ? Math.round(rec.old * (1 - f)) : Math.round(rec.old + (target - rec.old) * f);
      }
    }
  }

  undo() {
    const h = this.history.pop();
    if (!h) return false;
    const grid = this.grids[h.layer];
    for (const [i, old] of h.cells) grid[i] = old;
    this.draw();
    this.onChange?.();
    return true;
  }

  clear(layerId = null) {
    for (const l of LAYERS) {
      if (layerId && l.id !== layerId) continue;
      const grid = this.grids[l.id];
      const cells = new Map();
      for (let i = 0; i < grid.length; i++) if (grid[i]) { cells.set(i, grid[i]); grid[i] = 0; }
      if (cells.size) this.history.push({ layer: l.id, cells });
    }
    this.draw();
    this.onChange?.();
  }

  // ---- 読み取り ----
  // 各探査箇所の周り（半径 rad 画素）で、濃い方から15%の平均を、その箇所の値（0〜5）とする
  sample(points, rad = 7) {
    const out = {};
    const R = rad * SCALE;
    for (const p of points) {
      const vals = Object.fromEntries(LAYERS.map((l) => [l.id, []]));
      for (const [px, py] of p.chart || []) {
        const cx = px * SCALE;
        const cy = py * SCALE;
        for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(this.gh - 1, Math.ceil(cy + R)); y++) {
          for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(this.gw - 1, Math.ceil(cx + R)); x++) {
            if (Math.hypot(x - cx, y - cy) > R) continue;
            const i = y * this.gw + x;
            for (const l of LAYERS) vals[l.id].push(this.grids[l.id][i]);
          }
        }
      }
      const f = {};
      let any = false;
      for (const l of LAYERS) {
        const v = vals[l.id].filter((x) => x > 0).sort((a, b) => b - a);
        if (!v.length) { f[l.id] = 0; continue; }
        const top = v.slice(0, Math.max(1, Math.ceil(vals[l.id].length * 0.15)));
        const mean = top.reduce((s, x) => s + x, 0) / top.length;
        const lv = Math.round((mean / 255) * SHADES * 10) / 10;
        f[l.id] = lv < 0.5 ? 0 : lv;
        if (f[l.id] > 0) any = true;
      }
      if (any) out[p.id] = f;
    }
    return out;
  }
}
