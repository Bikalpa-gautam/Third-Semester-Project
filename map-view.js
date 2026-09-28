import { LAYERS, PROPOSALS, RAMPS, sampleRamp, clamp } from "./model.js";

export function surfaceImages(model, aerial) {
  const { data } = model;
  const images = { aerial };
  for (const kind of ["elevation", "slope"]) {
    const canvas = document.createElement("canvas");
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext("2d"),
      pixels = ctx.createImageData(data.width, data.height);
    for (let y = 0; y < data.height; y++)
      for (let x = 0; x < data.width; x++) {
        const i = y * data.width + x;
        const value =
          kind === "elevation"
            ? (data.heights[i] - data.minimumElevation) /
              (data.maximumElevation - data.minimumElevation)
            : model.slopes[i] / 60;
        const color = sampleRamp(RAMPS[kind], value);
        const ex =
          (data.heights[y * data.width + Math.min(x + 1, data.width - 1)] -
            data.heights[y * data.width + Math.max(0, x - 1)]) /
          (2 * model.dx);
        const ny =
          (data.heights[Math.max(0, y - 1) * data.width + x] -
            data.heights[Math.min(y + 1, data.height - 1) * data.width + x]) /
          (2 * model.dn);
        const light = clamp(
          (-ex * 0.4 + ny * 0.5 + 0.8) / Math.hypot(ex, ny, 1),
          0,
          1,
        );
        const shade =
          kind === "elevation" ? 0.76 + 0.24 * light : 0.91 + 0.09 * light;
        for (let k = 0; k < 3; k++)
          pixels.data[i * 4 + k] = Math.round(color[k] * shade);
        pixels.data[i * 4 + 3] = 255;
      }
    ctx.putImageData(pixels, 0, 0);
    images[kind] = canvas;
  }
  return images;
}

export class MapView {
  constructor(canvas, model, images, contours, callbacks) {
    Object.assign(this, { canvas, model, images, contours, callbacks });
    this.ctx = canvas.getContext("2d");
    this.scaleFactor = 1;
    this.center = { x: 0, n: 0 };
    this.pointers = new Map();
    this.dirty = true;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.down = { x: e.clientX, y: e.clientY };
      this.moved = false;
      if (this.pointers.size > 1) {
        this.moved = true;
        this.pinching = true;
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const point = this.toLocal(e.offsetX, e.offsetY);
      this.callbacks.hover(this.model.inside(point.x, point.n) ? point : null);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(
          ([id]) => id !== e.pointerId,
        )?.[1];
        if (other) {
          const before = Math.hypot(prev.x - other.x, prev.y - other.y),
            after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          if (before > 0) this.zoom(after / before);
        }
        this.moved = true;
      } else {
        if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5)
          this.moved = true;
        if (this.moved) {
          this.center.x -= (e.clientX - prev.x) / this.pixelsPerMetre;
          this.center.n += (e.clientY - prev.y) / this.pixelsPerMetre;
          this.dirty = true;
        }
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.draw();
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (!this.moved && !this.pinching) {
        const rect = canvas.getBoundingClientRect(),
          p = this.toLocal(e.clientX - rect.left, e.clientY - rect.top);
        if (model.inside(p.x, p.n)) this.callbacks.pick(p);
      }
      if (!this.pointers.size) this.pinching = false;
      this.down = this.pointers.size ? [...this.pointers.values()][0] : null;
    });
    canvas.addEventListener("pointercancel", () => {
      this.pointers.clear();
      this.pinching = false;
      this.down = null;
    });
    canvas.addEventListener("pointerleave", () => this.callbacks.hover(null));
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = this.toLocal(e.offsetX, e.offsetY);
        this.zoom(Math.exp(-e.deltaY * 0.001));
        const q = this.toLocal(e.offsetX, e.offsetY);
        this.center.x += p.x - q.x;
        this.center.n += p.n - q.n;
        this.dirty = true;
        this.draw();
      },
      { passive: false },
    );
    canvas.addEventListener("keydown", (e) => {
      if (
        [
          "+",
          "=",
          "-",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key)
      ) {
        e.preventDefault();
        if (e.key === "+" || e.key === "=") this.zoom(1.2);
        else if (e.key === "-") this.zoom(1 / 1.2);
        else {
          const step = 60 / this.pixelsPerMetre;
          if (e.key === "ArrowLeft") this.center.x -= step;
          if (e.key === "ArrowRight") this.center.x += step;
          if (e.key === "ArrowUp") this.center.n += step;
          if (e.key === "ArrowDown") this.center.n -= step;
          this.dirty = true;
          this.draw();
        }
      }
    });
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.availableHeight = this.height * (this.state?.mobilePanel ? 0.53 : 1);
    this.fitScale = Math.min(
      (this.width - 45) / this.model.width,
      (this.availableHeight - 125) / this.model.depth,
    );
    this.fitScale = Math.max(0.03, this.fitScale);
    this.dirty = true;
    this.draw();
  }
  project(x, n) {
    const s = this.pixelsPerMetre;
    return [
      this.width / 2 + (x - this.center.x) * s,
      this.availableHeight / 2 + 14 - (n - this.center.n) * s,
    ];
  }
  toLocal(x, y) {
    const s = this.pixelsPerMetre;
    return {
      x: (x - this.width / 2) / s + this.center.x,
      n: (this.availableHeight / 2 + 14 - y) / s + this.center.n,
    };
  }
  get pixelsPerMetre() {
    return (this.fitScale || 0.2) * this.scaleFactor;
  }
  update(state) {
    this.state = state;
    this.dirty = true;
    this.draw();
  }
  reset() {
    this.center = { x: 0, n: 0 };
    this.scaleFactor = 1;
    this.dirty = true;
    this.draw();
  }
  north() {
    // This map is always north-up. Keep the user's zoom and position.
    this.dirty = true;
    this.draw();
  }
  zoom(f) {
    this.scaleFactor = clamp(this.scaleFactor * f, 0.55, 16);
    this.dirty = true;
    this.draw();
  }
  focus(p) {
    this.center = { x: p.x, n: p.n };
    this.scaleFactor = Math.max(2, this.scaleFactor);
    this.dirty = true;
    this.draw();
  }
  getView() {
    return [this.center.x, this.center.n, this.scaleFactor];
  }
  setView(v) {
    if (v?.length === 3 && v.every(Number.isFinite)) {
      this.center = {
        x: clamp(v[0], -this.model.width, this.model.width),
        n: clamp(v[1], -this.model.depth, this.model.depth),
      };
      this.scaleFactor = clamp(v[2], 0.55, 16);
      this.dirty = true;
    }
  }
  path(ring, closed = true) {
    const ctx = this.ctx;
    ctx.beginPath();
    ring.forEach(([x, n], i) => {
      const p = this.project(x, n);
      i ? ctx.lineTo(...p) : ctx.moveTo(...p);
    });
    if (closed) ctx.closePath();
  }
  draw(time = 0) {
    if (
      !this.state ||
      !this.width ||
      this.canvas.hidden ||
      (!this.dirty && !this.state.rain)
    )
      return;
    this.dirty = false;
    const { ctx, state: s, model: m } = this,
      d = m.data;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#e8eae3";
    ctx.fillRect(0, 0, this.width, this.height);
    const tl = this.project(-m.width / 2, m.depth / 2),
      dw = m.width * this.pixelsPerMetre,
      dh = m.depth * this.pixelsPerMetre;
    ctx.save();
    ctx.shadowColor = "#40503a30";
    ctx.shadowBlur = 25;
    ctx.shadowOffsetY = 9;
    ctx.fillStyle = "#f9faf5";
    ctx.fillRect(tl[0] - 3, tl[1] - 3, dw + 6, dh + 6);
    ctx.restore();
    const base = this.images[s.base] || this.images.elevation;
    ctx.drawImage(base, tl[0], tl[1], dw, dh);
    if (s.warmth) {
      ctx.fillStyle = `rgba(224,133,48,${s.warmth * 0.0018})`;
      ctx.fillRect(tl[0], tl[1], dw, dh);
    }
    for (const key of ["massMovement", "flood", "torrential", "riparian"]) {
      if (!s.layers[key]) continue;
      ctx.strokeStyle = LAYERS[key].color;
      ctx.lineWidth = key === "riparian" ? 1 : 1.4;
      ctx.setLineDash(key === "riparian" ? [5, 4] : []);
      for (const f of key === "riparian" ? d.riparian : d.hazards[key]) {
        this.path(f.ring);
        ctx.globalAlpha = s.opacity * 0.002;
        ctx.fillStyle = LAYERS[key].color;
        ctx.fill();
        ctx.globalAlpha = s.opacity / 100;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (s.layers.contours) {
      ctx.strokeStyle = s.base === "aerial" ? "#f5edd4" : "#5d5f43";
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (const [a, b] of this.contours) {
        ctx.moveTo(...this.project(a[0], a[1]));
        ctx.lineTo(...this.project(b[0], b[1]));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (s.layers.river) {
      ctx.strokeStyle = LAYERS.river.color;
      ctx.lineWidth = 2;
      for (const f of d.rivers) {
        this.path(f.line, false);
        ctx.stroke();
      }
    }
    if (s.layers.buildings) {
      ctx.fillStyle = LAYERS.buildings.color;
      ctx.strokeStyle = "#7b6d4c";
      ctx.lineWidth = 0.65;
      for (const ring of d.buildings[s.year]) {
        this.path(ring);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (s.layers.boundary) {
      ctx.strokeStyle = s.base === "aerial" ? "#fffaf0" : "#455b44";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([6, 4]);
      for (const ring of d.boundary) {
        this.path(ring);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (s.rain) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(...tl, dw, dh);
      ctx.clip();
      ctx.strokeStyle = `rgba(210,233,250,${0.12 + s.rain * 0.004})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < s.rain * 3; i++) {
        const x = ((i * 97) % Math.max(1, dw)) + tl[0],
          y = ((i * 53 + time * 0.3) % Math.max(1, dh)) + tl[1];
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y + 7);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (s.measurePoints.length) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      s.measurePoints.forEach((p, i) => {
        const a = this.project(p.x, p.n);
        i ? ctx.lineTo(...a) : ctx.moveTo(...a);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of s.measurePoints) {
        const a = this.project(p.x, p.n);
        ctx.beginPath();
        ctx.arc(...a, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#244e40";
        ctx.fill();
        ctx.stroke();
      }
    }
    s.proposals.forEach((p, i) => {
      const [x, y] = this.project(p.x, p.n);
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 12);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 4, y - 12);
      ctx.fillStyle = PROPOSALS[p.type].color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y - 18, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "500 10px Arial";
      ctx.fillText(String(i + 1), x, y - 18);
    });
    if (s.selection?.kind === "point") {
      const [x, y] = this.project(s.selection.x, s.selection.n);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#244e40";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    this.callbacks.viewChange({
      metresPerPixel: 1 / this.pixelsPerMetre,
      heading: 0,
    });
  }
}
