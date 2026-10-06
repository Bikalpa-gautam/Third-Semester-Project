import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js?v=2";
import { LAYERS, PROPOSALS, densify, clamp } from "./model.js";
import { BoundaryFocus } from "./boundary-focus.js";

export function terrainGeometry(model) {
  const { data, width, depth } = model;
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    data.width - 1,
    data.height - 1,
  );
  geometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < data.heights.length; i++)
    geometry.attributes.position.setY(
      i,
      data.heights[i] - data.minimumElevation,
    );
  geometry.computeVertexNormals();
  return geometry;
}

export function buildingGeometry(model, year) {
  const all = [];
  for (const ring of model.data.buildings[year]) {
    if (ring.length < 3) continue;
    const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(...p)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 6,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    const attr = geometry.attributes.position;
    const roof =
      Math.max(...ring.map(([x, n]) => model.elevation(x, n))) -
      model.data.minimumElevation +
      6;
    for (let i = 0; i < attr.count; i++) {
      const ground =
        model.elevation(attr.getX(i), -attr.getZ(i)) -
        model.data.minimumElevation;
      attr.setY(i, attr.getY(i) > 3 ? roof : ground + 0.25);
      all.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
    geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(all, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function skirtGeometry(model) {
  const { data, width, depth, dx, dn } = model,
    edge = [];
  for (let x = 0; x < data.width; x++)
    edge.push([
      x * dx - width / 2,
      depth / 2,
      data.heights[x] - data.minimumElevation,
    ]);
  for (let y = 1; y < data.height; y++)
    edge.push([
      width / 2,
      depth / 2 - y * dn,
      data.heights[y * data.width + data.width - 1] - data.minimumElevation,
    ]);
  for (let x = data.width - 2; x >= 0; x--)
    edge.push([
      x * dx - width / 2,
      -depth / 2,
      data.heights[(data.height - 1) * data.width + x] - data.minimumElevation,
    ]);
  for (let y = data.height - 2; y > 0; y--)
    edge.push([
      -width / 2,
      depth / 2 - y * dn,
      data.heights[y * data.width] - data.minimumElevation,
    ]);
  const points = [];
  edge.forEach((a, i) => {
    const b = edge[(i + 1) % edge.length];
    points.push(
      a[0],
      a[2],
      -a[1],
      a[0],
      -55,
      -a[1],
      b[0],
      b[2],
      -b[1],
      b[0],
      b[2],
      -b[1],
      a[0],
      -55,
      -a[1],
      b[0],
      -55,
      -b[1],
    );
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  g.computeVertexNormals();
  return g;
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      }
    });
    group.remove(child);
  }
}

export class TerrainView {
  constructor(canvas, model, images, contours, callbacks) {
    Object.assign(this, { canvas, model, images, contours, callbacks });
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#e8eae3");
    this.camera = new THREE.PerspectiveCamera(40, 1, 2, 18000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.075,
      minDistance: 85,
      maxDistance: 9000,
      maxPolarAngle: Math.PI * 0.485,
      autoRotateSpeed: 0.55,
    });
    this.controls.addEventListener("change", () => {
      this.dirty = true;
    });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x747966, 2.1));
    this.sun = new THREE.DirectionalLight(0xfff6de, 2);
    this.sun.position.set(-1800, 3500, 1400);
    this.scene.add(this.sun);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.geometry = terrainGeometry(model);
    this.textures = {};
    for (const [key, img] of Object.entries(images)) {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      this.textures[key] = t;
    }
    this.terrain = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({
        map: this.textures.aerial,
        roughness: 1,
        metalness: 0,
      }),
    );
    this.world.add(this.terrain);
    this.world.add(
      new THREE.Mesh(
        skirtGeometry(model),
        new THREE.MeshStandardMaterial({
          color: 0x8f9480,
          roughness: 1,
          side: THREE.DoubleSide,
        }),
      ),
    );
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(model.width, 12, model.depth),
      new THREE.MeshStandardMaterial({ color: 0x8b907d, roughness: 1 }),
    );
    base.position.y = -60;
    this.world.add(base);
    this.addGroundShadow();
    this.buildings = {};
    for (const year of Object.keys(model.data.buildings)) {
      const mesh = new THREE.Mesh(
        buildingGeometry(model, year),
        new THREE.MeshStandardMaterial({ color: 0xf0deb7, roughness: 1 }),
      );
      mesh.visible = year === "2021";
      this.buildings[year] = mesh;
      this.world.add(mesh);
    }
    this.overlays = {};
    for (const key of [
      "massMovement",
      "flood",
      "torrential",
      "riparian",
      "river",
      "boundary",
    ])
      this.addLayer(key);
    const cg = new THREE.BufferGeometry().setFromPoints(
      contours.flatMap((seg) =>
        seg.map(
          ([x, n, h]) =>
            new THREE.Vector3(x, h - model.data.minimumElevation + 2.5, -n),
        ),
      ),
    );
    this.overlays.contours = new THREE.LineSegments(
      cg,
      new THREE.LineBasicMaterial({
        color: 0xeee7cb,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.world.add(this.overlays.contours);
    this.markers = new THREE.Group();
    this.world.add(this.markers);
    this.selectionGroup = new THREE.Group();
    this.world.add(this.selectionGroup);
    this.measureGroup = new THREE.Group();
    this.world.add(this.measureGroup);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.setupRain();
    this.dirty = true;
    this.activePointers = new Set();
    canvas.addEventListener("pointerdown", (e) => {
      this.activePointers.add(e.pointerId);
      this.down = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        button: e.button,
      };
      if (this.activePointers.size > 1) this.multiTouch = true;
    });
    canvas.addEventListener("pointerup", (e) => {
      this.activePointers.delete(e.pointerId);
      const down = this.down;
      this.down = null;
      if (
        down &&
        down.id === e.pointerId &&
        down.button === 0 &&
        !this.multiTouch &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6
      ) {
        const p = this.pick(e);
        if (p) this.callbacks.pick(p);
      }
      if (!this.activePointers.size) this.multiTouch = false;
    });
    canvas.addEventListener("pointercancel", () => {
      this.down = null;
      this.activePointers.clear();
      this.multiTouch = false;
    });
    let lastHover = 0;
    canvas.addEventListener("pointermove", (e) => {
      if (performance.now() - lastHover < 70 || this.down) return;
      lastHover = performance.now();
      this.callbacks.hover(this.pick(e));
    });
    canvas.addEventListener("pointerleave", () => this.callbacks.hover(null));
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        this.zoom(1.2);
      }
      if (e.key === "-") {
        e.preventDefault();
        this.zoom(1 / 1.2);
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step =
          this.camera.position.distanceTo(this.controls.target) * 0.025;
        const move = new THREE.Vector3(
          e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
          0,
          e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0,
        );
        this.camera.position.add(move);
        this.controls.target.add(move);
        this.dirty = true;
      }
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.callbacks.contextLost();
    });
    this.reset();
  }
  height(x, n) {
    return this.model.elevation(x, n) - this.model.data.minimumElevation;
  }
  addGroundShadow() {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d"),
      g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
    g.addColorStop(0, "rgba(61,72,44,.24)");
    g.addColorStop(0.6, "rgba(61,72,44,.13)");
    g.addColorStop(1, "rgba(61,72,44,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.model.width * 1.48, this.model.depth * 1.9),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -76;
    this.scene.add(shadow);
  }
  addLayer(key) {
    const { data } = this.model,
      group = new THREE.Group(),
      isRiver = key === "river",
      isBoundary = key === "boundary";
    const features = isRiver
      ? data.rivers.map((f) => f.line)
      : isBoundary
        ? data.boundary
        : key === "riparian"
          ? data.riparian.map((f) => f.ring)
          : data.hazards[key].map((f) => f.ring);
    const color = LAYERS[key].color;
    const material =
      isBoundary || key === "riparian"
        ? new THREE.LineDashedMaterial({
            color,
            dashSize: 12,
            gapSize: 8,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          })
        : new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          });
    for (const ring of features) {
      const points = densify(ring, 8, !isRiver).map(
        ([x, n]) => new THREE.Vector3(x, this.height(x, n) + 3.5, -n),
      );
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        material,
      );
      line.computeLineDistances();
      group.add(line);
    }
    if (!isRiver && !isBoundary) {
      const c = document.createElement("canvas");
      c.width = 2048;
      c.height = Math.round((2048 * this.model.depth) / this.model.width);
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.globalAlpha = key === "riparian" ? 0.14 : 0.19;
      for (const ring of features) {
        ctx.beginPath();
        ring.forEach(([x, n], i) => {
          const px = (x / this.model.width + 0.5) * c.width,
            py = (0.5 - n / this.model.depth) * c.height;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
      }
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      const fill = new THREE.Mesh(
        this.geometry,
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      fill.position.y = 1.5;
      fill.renderOrder = 1;
      group.add(fill);
    }
    this.world.add(group);
    this.overlays[key] = group;
  }
  setupRain() {
    const points = [];
    for (let i = 0; i < 1200; i++) {
      const x = (Math.random() - 0.5) * this.model.width,
        z = (Math.random() - 0.5) * this.model.depth,
        y = this.height(x, -z) + Math.random() * 1000;
      points.push(x, y, z, x - 2, y - 15, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    this.rain = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xb2d4ed,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    this.rain.visible = false;
    this.world.add(this.rain);
  }
  pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    return { x: hit.point.x, n: -hit.point.z };
  }
  resize() {
    const parent = this.canvas.parentElement;
    const width = parent.clientWidth,
      height = parent.clientHeight * (this.state?.mobilePanel ? 0.53 : 1);
    if (!width || !height) return;
    this.canvas.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.dirty = true;
  }
  reset() {
    const h =
      this.model.data.maximumElevation - this.model.data.minimumElevation;
    this.controls.target.set(0, h * 0.38, 0);
    const aspect = this.camera.aspect || 1;
    const distance = this.model.width * (aspect < 1 ? 1.75 : 1.12);
    this.camera.position
      .copy(this.controls.target)
      .add(
        new THREE.Vector3(0.24, 0.57, 0.78)
          .normalize()
          .multiplyScalar(distance),
      );
    this.controls.update();
    this.dirty = true;
  }
  north() {
    const d = this.camera.position.distanceTo(this.controls.target),
      polar = this.controls.getPolarAngle();
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3(0, Math.cos(polar) * d, Math.sin(polar) * d));
    this.controls.update();
    this.dirty = true;
  }
  zoom(f) {
    const v = this.camera.position.clone().sub(this.controls.target),
      distance = clamp(v.length() / f, 85, 9000);
    this.camera.position
      .copy(this.controls.target)
      .add(v.normalize().multiplyScalar(distance));
    this.controls.update();
    this.dirty = true;
  }
  focus(p) {
    const delta = new THREE.Vector3(
      p.x,
      this.height(p.x, p.n) * (this.state?.relief || 1),
      -p.n,
    ).sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.dirty = true;
  }
  getView() {
    return [
      ...this.camera.position.toArray(),
      ...this.controls.target.toArray(),
    ];
  }
  setView(v) {
    if (
      v?.length === 6 &&
      v.every((n) => Number.isFinite(n) && Math.abs(n) < 12000)
    ) {
      this.camera.position.fromArray(v.slice(0, 3));
      this.controls.target.fromArray(v.slice(3));
      this.controls.update();
      this.dirty = true;
    }
  }
  addPin(p, i) {
    const group = new THREE.Group();
    group.position.set(p.x, this.height(p.x, p.n) + 3, -p.n);
    const color = PROPOSALS[p.type].color,
      stem = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 55, 5),
        new THREE.MeshBasicMaterial({ color }),
      );
    stem.position.y = 27;
    group.add(stem);
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext("2d");
    ctx.fillStyle = color;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(48, 48, 37, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = "500 33px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), 48, 49);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c),
        depthTest: false,
      }),
    );
    sprite.position.y = 65;
    sprite.scale.set(58, 58, 1);
    sprite.renderOrder = 10;
    group.add(sprite);
    this.markers.add(group);
  }
  update(state) {
    const old = this.state;
    this.state = state;
    if (!old || old.base !== state.base) {
      this.terrain.material.map =
        this.textures[state.base] || this.textures.elevation;
      this.terrain.material.needsUpdate = true;
    }
    this.terrain.material.color.setRGB(
      1,
      1 - state.warmth * 0.0013,
      1 - state.warmth * 0.0027,
    );
    this.world.scale.y = state.relief;
    for (const [year, mesh] of Object.entries(this.buildings))
      mesh.visible = Number(year) === state.year && state.layers.buildings;
    for (const [key, group] of Object.entries(this.overlays)) {
      group.visible = state.layers[key];
      if (["massMovement", "flood", "torrential", "riparian"].includes(key))
        group.traverse((o) => {
          if (o.material) o.material.opacity = state.opacity / 100;
        });
    }
    this.overlays.contours.material.color.set(
      state.base === "aerial" ? 0xf4edd3 : 0x555b40,
    );
    this.overlays.boundary.traverse((o) => {
      if (o.material)
        o.material.color.set(state.base === "aerial" ? 0xfffaf0 : 0x4b6044);
    });
    const hash = JSON.stringify(
      state.proposals.map(({ id, type, x, n }) => ({ id, type, x, n })),
    );
    if (hash !== this.proposalHash) {
      disposeGroup(this.markers);
      state.proposals.forEach((p, i) => this.addPin(p, i));
      this.proposalHash = hash;
    }
    const selection =
        state.selection?.kind === "point" ? state.selection : null,
      selectedHash = JSON.stringify(selection);
    if (selectedHash !== this.selectedHash) {
      disposeGroup(this.selectionGroup);
      if (selection) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(7, 11, 32),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            depthTest: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(
          selection.x,
          this.height(selection.x, selection.n) + 5,
          -selection.n,
        );
        this.selectionGroup.add(ring);
      }
      this.selectedHash = selectedHash;
    }
    const measureHash = JSON.stringify(state.measurePoints);
    if (measureHash !== this.measureHash) {
      disposeGroup(this.measureGroup);
      const points = state.measurePoints;
      points.forEach((p) => {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(5, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
        );
        dot.position.set(p.x, this.height(p.x, p.n) + 7, -p.n);
        this.measureGroup.add(dot);
      });
      if (points.length === 2) {
        const linePoints = densify(
          points.map((p) => [p.x, p.n]),
          10,
          false,
        ).map(([x, n]) => new THREE.Vector3(x, this.height(x, n) + 7, -n));
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(linePoints),
          new THREE.LineDashedMaterial({
            color: 0xffffff,
            dashSize: 15,
            gapSize: 10,
            depthTest: false,
          }),
        );
        line.computeLineDistances();
        this.measureGroup.add(line);
      }
      this.measureHash = measureHash;
    }
    this.rain.visible = state.rain > 0;
    this.rain.geometry.setDrawRange(
      0,
      Math.round((state.rain / 100) * 1200) * 2,
    );
    this.rain.material.opacity = 0.18 + state.rain * 0.004;
    this.controls.autoRotate = state.orbit && !state.reducedMotion;
    this.dirty = true;
  }
  tick(delta) {
    if (this.canvas.hidden || !this.state) return;
    this.controls.update(delta);
    if (this.rain.visible && !this.state.reducedMotion) {
      const a = this.rain.geometry.attributes.position;
      for (let i = 0; i < a.count; i += 2) {
        const x = a.getX(i),
          z = a.getZ(i),
          floor = this.height(x, -z);
        let y = a.getY(i) - delta * (200 + this.state.rain * 4);
        if (y < floor) y = floor + 900;
        a.setY(i, y);
        a.setY(i + 1, y - 15);
      }
      a.needsUpdate = true;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    if (this.state.boundaryFocus) {
      this.boundaryFocus ||= new BoundaryFocus(this.renderer, this.model, this.geometry);
      this.boundaryFocus.render(this.scene, this.camera, this.state.relief);
    } else this.renderer.render(this.scene, this.camera);
    const distance = this.camera.position.distanceTo(this.controls.target);
    const mpp =
      (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) /
      this.canvas.clientHeight;
    // Project grid north into screen space; the bearing depends on camera tilt.
    const centre = this.controls.target.clone().project(this.camera);
    const north = this.controls.target
      .clone()
      .add(new THREE.Vector3(0, 0, -100))
      .project(this.camera);
    const northX = (north.x - centre.x) * this.canvas.clientWidth;
    const northY = (north.y - centre.y) * this.canvas.clientHeight;
    this.callbacks.viewChange({
      metresPerPixel: mpp,
      heading: (Math.atan2(northX, northY) * 180) / Math.PI,
    });
  }
  render() {
    this.dirty = true;
    this.tick(0);
  }
}
