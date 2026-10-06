import * as THREE from "./vendor/three.module.min.js";

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const blur = `
  vec4 blurred(sampler2D image, vec2 uv, vec2 stepSize) {
    vec4 color = texture2D(image, uv) * 0.227027;
    color += texture2D(image, uv + stepSize * 1.384615) * 0.316216;
    color += texture2D(image, uv - stepSize * 1.384615) * 0.316216;
    color += texture2D(image, uv + stepSize * 3.230769) * 0.070270;
    color += texture2D(image, uv - stepSize * 3.230769) * 0.070270;
    return color;
  }
`;

// Render the settlement's actual outline over the same terrain and camera.
// Screen-space compositing then keeps that area sharp, including during orbit.
export class BoundaryFocus {
  constructor(renderer, model, terrainGeometry) {
    this.renderer = renderer;
    this.size = new THREE.Vector2();
    this.sharp = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.horizontal = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.mask = new THREE.WebGLRenderTarget(1, 1);
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = Math.max(2, Math.round(2048 * model.depth / model.width));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    for (const ring of model.data.boundary) {
      ctx.beginPath();
      ring.forEach(([x, n], i) => {
        const px = (x / model.width + 0.5) * canvas.width;
        const py = (0.5 - n / model.depth) * canvas.height;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    }
    this.maskScene = new THREE.Scene();
    this.maskScene.background = new THREE.Color("black");
    this.maskMesh = new THREE.Mesh(terrainGeometry, new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas), toneMapped: false,
    }));
    this.maskScene.add(this.maskMesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.pass = new THREE.ShaderMaterial({
      uniforms: {
        image: { value: this.sharp.texture },
        stepSize: { value: new THREE.Vector2() },
      },
      vertexShader,
      fragmentShader: `varying vec2 vUv; uniform sampler2D image; uniform vec2 stepSize;
        ${blur} void main() { gl_FragColor = blurred(image, vUv, stepSize); }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        image: { value: this.horizontal.texture },
        sharpImage: { value: this.sharp.texture },
        maskImage: { value: this.mask.texture },
        stepSize: { value: new THREE.Vector2() },
      },
      vertexShader,
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D image, sharpImage, maskImage; uniform vec2 stepSize;
        ${blur}
        void main() {
          float inside = texture2D(maskImage, vUv).r;
          gl_FragColor = mix(blurred(image, vUv, stepSize), texture2D(sharpImage, vUv), inside);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.screen = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pass);
    this.screen.add(this.quad);
  }
  render(scene, camera, relief) {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const { x: width, y: height } = this.size;
    for (const target of [this.sharp, this.horizontal, this.mask])
      if (target.width !== width || target.height !== height) target.setSize(width, height);
    const radius = 2.5 * r.getPixelRatio();
    this.pass.uniforms.stepSize.value.set(radius / width, 0);
    this.composite.uniforms.stepSize.value.set(0, radius / height);
    this.maskMesh.scale.y = relief;
    r.setRenderTarget(this.sharp);
    r.render(scene, camera);
    r.setRenderTarget(this.mask);
    r.render(this.maskScene, camera);
    this.quad.material = this.pass;
    r.setRenderTarget(this.horizontal);
    r.render(this.screen, this.camera);
    this.quad.material = this.composite;
    r.setRenderTarget(null);
    r.render(this.screen, this.camera);
  }
}
