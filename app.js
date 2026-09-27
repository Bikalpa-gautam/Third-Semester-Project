import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const data = window.EL_UVITO_DATA;

if (!data) {
  throw new Error('The processed El Uvito dataset did not load.');
}

const canvas = document.getElementById('scene-canvas');
const sceneWrap = document.getElementById('scene-wrap');
const loading = document.getElementById('loading');
const heatTint = document.getElementById('heat-tint');
const placementTip = document.getElementById('placement-tip');

const state = {
  year: 2021,
  rain: 65,
  heat: 31,
  placementTool: null,
  interventionCount: 0,
};

const extentWidth = data.extent[2] - data.extent[0];
const extentHeight = data.extent[3] - data.extent[1];
const verticalScale = 1;
const elevationBase = data.minimumElevation;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x182722);
scene.fog = new THREE.FogExp2(0x182722, 0.00016);

const camera = new THREE.PerspectiveCamera(43, 1, 2, 16000);
camera.position.set(extentWidth * 0.72, 1550, extentHeight * 0.88);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 230;
controls.maxDistance = 6200;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, (data.maximumElevation - elevationBase) * 0.28, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xb9d9d3, 0x303a2e, 1.55));
const sun = new THREE.DirectionalLight(0xffefd0, 2.1);
sun.position.set(-1300, 2400, 900);
scene.add(sun);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

const terrainGeometry = new THREE.PlaneGeometry(extentWidth, extentHeight, data.width - 1, data.height - 1);
terrainGeometry.rotateX(-Math.PI / 2);
const terrainPositions = terrainGeometry.attributes.position;
for (let index = 0; index < terrainPositions.count; index += 1) {
  terrainPositions.setY(index, (data.heights[index] - elevationBase) * verticalScale);
}
terrainPositions.needsUpdate = true;
terrainGeometry.computeVertexNormals();

const textureLoader = new THREE.TextureLoader();
const orthoTexture = textureLoader.load(
  data.orthophoto,
  () => loading.classList.add('is-hidden'),
  undefined,
  () => {
    loading.textContent = 'The terrain loaded, but the orthophoto could not be displayed.';
  }
);
orthoTexture.colorSpace = THREE.SRGBColorSpace;
orthoTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const terrainMaterial = new THREE.MeshStandardMaterial({
  map: orthoTexture,
  roughness: 0.92,
  metalness: 0,
});
const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrain.name = 'terrain';
modelGroup.add(terrain);

const terrainSkirt = new THREE.Mesh(
  new THREE.BoxGeometry(extentWidth, 70, extentHeight),
  new THREE.MeshStandardMaterial({ color: 0x1b2b22, roughness: 1 })
);
terrainSkirt.position.y = -38;
modelGroup.add(terrainSkirt);

function elevationAt(localX, localNorth) {
  const u = THREE.MathUtils.clamp((localX + extentWidth / 2) / extentWidth, 0, 1);
  const v = THREE.MathUtils.clamp((extentHeight / 2 - localNorth) / extentHeight, 0, 1);
  const gx = u * (data.width - 1);
  const gy = v * (data.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, data.width - 1);
  const y1 = Math.min(y0 + 1, data.height - 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const h00 = data.heights[y0 * data.width + x0];
  const h10 = data.heights[y0 * data.width + x1];
  const h01 = data.heights[y1 * data.width + x0];
  const h11 = data.heights[y1 * data.width + x1];
  const north = THREE.MathUtils.lerp(h00, h10, tx);
  const south = THREE.MathUtils.lerp(h01, h11, tx);
  return (THREE.MathUtils.lerp(north, south, ty) - elevationBase) * verticalScale;
}

function ringCentroid(ring) {
  let x = 0;
  let north = 0;
  ring.forEach(point => {
    x += point[0];
    north += point[1];
  });
  return [x / ring.length, north / ring.length];
}

function createBuildingGroup(year) {
  const group = new THREE.Group();
  group.name = `buildings-${year}`;
  const material = new THREE.MeshStandardMaterial({
    color: year === '2021' ? 0xf3ead8 : year === '2019' ? 0xe5ddcd : 0xd5cdbf,
    roughness: 0.78,
    metalness: 0,
    transparent: true,
    opacity: 0.94,
  });

  data.buildings[year].forEach((ring, index) => {
    if (ring.length < 3) return;
    const shape = new THREE.Shape();
    shape.moveTo(ring[0][0], ring[0][1]);
    for (let pointIndex = 1; pointIndex < ring.length; pointIndex += 1) {
      shape.lineTo(ring[pointIndex][0], ring[pointIndex][1]);
    }
    shape.closePath();
    const height = 5.5 + ((index * 17) % 35) / 10;
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    geometry.rotateX(-Math.PI / 2);
    const [centreX, centreNorth] = ringCentroid(ring);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = elevationAt(centreX, centreNorth) + 1.2;
    group.add(mesh);
  });
  group.visible = Number(year) === state.year;
  return group;
}

const buildingGroups = {};
['2010', '2019', '2021'].forEach(year => {
  buildingGroups[year] = createBuildingGroup(year);
  modelGroup.add(buildingGroups[year]);
});

const overlayGroups = {};

function addRingLine(targetGroup, ring, material, lift = 8) {
  const points = ring.map(([x, north]) => new THREE.Vector3(x, elevationAt(x, north) + lift, -north));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(geometry, material);
  targetGroup.add(line);
}

function createHazardGroup(key, color) {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
  data.hazards[key].forEach(feature => addRingLine(group, feature.ring, material, 10));
  group.userData.material = material;
  modelGroup.add(group);
  overlayGroups[key] = group;
}

createHazardGroup('massMovement', 0xff6f65);
createHazardGroup('flood', 0x62c7ff);
createHazardGroup('torrential', 0xffa04d);

const riparianMaterial = new THREE.LineDashedMaterial({ color: 0x67e79c, dashSize: 22, gapSize: 13, transparent: true, opacity: 0.82 });
const riparianGroup = new THREE.Group();
data.riparian.forEach(feature => {
  const points = feature.ring.map(([x, north]) => new THREE.Vector3(x, elevationAt(x, north) + 7, -north));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(geometry, riparianMaterial);
  line.computeLineDistances();
  riparianGroup.add(line);
});
modelGroup.add(riparianGroup);
overlayGroups.riparian = riparianGroup;

const riverMaterial = new THREE.LineBasicMaterial({ color: 0x62c7ff, transparent: true, opacity: 0.95 });
const riverGroup = new THREE.Group();
data.rivers.forEach(feature => {
  const points = feature.line.map(([x, north]) => new THREE.Vector3(x, elevationAt(x, north) + 9, -north));
  riverGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), riverMaterial));
});
modelGroup.add(riverGroup);
overlayGroups.river = riverGroup;

const boundaryMaterial = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 30, gapSize: 15, transparent: true, opacity: 0.82 });
const boundaryGroup = new THREE.Group();
data.boundary.forEach(ring => {
  const points = ring.map(([x, north]) => new THREE.Vector3(x, elevationAt(x, north) + 12, -north));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), boundaryMaterial);
  line.computeLineDistances();
  boundaryGroup.add(line);
});
modelGroup.add(boundaryGroup);

const interventionGroup = new THREE.Group();
scene.add(interventionGroup);

function interventionMarker(type, point) {
  const marker = new THREE.Group();
  marker.position.copy(point);
  marker.position.y += 3;
  if (type === 'trees') {
    for (let index = 0; index < 3; index += 1) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.5, 18, 8), new THREE.MeshStandardMaterial({ color: 0x6e4b2f }));
      trunk.position.y = 9;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(13, 30, 9), new THREE.MeshStandardMaterial({ color: 0x69c98a }));
      crown.position.y = 30;
      tree.add(trunk, crown);
      tree.position.set((index - 1) * 18, 0, index % 2 ? 9 : -4);
      marker.add(tree);
    }
  } else if (type === 'garden') {
    const garden = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 4, 28), new THREE.MeshStandardMaterial({ color: 0x4fc88a, roughness: 1 }));
    garden.position.y = 2;
    marker.add(garden);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 5, 24), new THREE.MeshStandardMaterial({ color: 0x5fb9e8, transparent: true, opacity: .8 }));
    water.position.y = 4;
    marker.add(water);
  } else {
    const channel = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 13), new THREE.MeshStandardMaterial({ color: 0x68bde9, roughness: .5 }));
    channel.position.y = 3;
    channel.rotation.y = Math.PI * .18;
    marker.add(channel);
  }
  marker.userData.type = type;
  return marker;
}

const rainCount = 1100;
const rainPositions = new Float32Array(rainCount * 3);
for (let index = 0; index < rainCount; index += 1) {
  rainPositions[index * 3] = (Math.random() - .5) * extentWidth * 1.2;
  rainPositions[index * 3 + 1] = 300 + Math.random() * 1500;
  rainPositions[index * 3 + 2] = (Math.random() - .5) * extentHeight * 1.2;
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rainMaterial = new THREE.PointsMaterial({ color: 0x8dd5ff, size: 5, transparent: true, opacity: .58, depthWrite: false });
const rain = new THREE.Points(rainGeometry, rainMaterial);
scene.add(rain);

function rainScenarioLabel() {
  if (state.rain < 35) return 'Baseline rain';
  if (state.rain < 70) return 'Heavy rain';
  return 'Extreme rain';
}

function updateScenario() {
  document.getElementById('rain-output').textContent = `${state.rain}%`;
  document.getElementById('heat-output').textContent = `${state.heat} °C`;
  document.getElementById('scenario-label').textContent = rainScenarioLabel();
  rainMaterial.opacity = state.rain === 0 ? 0 : .14 + state.rain / 100 * .65;
  rain.visible = state.rain > 4;
  const hazardOpacity = .28 + state.rain / 100 * .67;
  overlayGroups.massMovement.userData.material.opacity = hazardOpacity;
  overlayGroups.flood.userData.material.opacity = hazardOpacity;
  overlayGroups.torrential.userData.material.opacity = hazardOpacity;
  heatTint.style.opacity = String(Math.max(0, (state.heat - 22) / 20) * .68);
  document.getElementById('interpretation').textContent = state.rain < 35
    ? 'Mapped hazards remain visible while the weather emphasis stays low.'
    : state.rain < 70
      ? 'Heavy rain makes existing mapped hazard boundaries more prominent.'
      : 'Extreme rain strongly emphasizes mapped water and mass-movement hazards.';
  document.getElementById('training-question').textContent = state.interventionCount
    ? `Would the ${state.interventionCount} placed intervention${state.interventionCount === 1 ? '' : 's'} be feasible and culturally acceptable here?`
    : state.rain >= 70
      ? 'Where should protective action begin under this scenario?'
      : 'Which access area or building cluster should be discussed first?';
}

function updateYear(year) {
  state.year = Number(year);
  Object.entries(buildingGroups).forEach(([groupYear, group]) => {
    group.visible = Number(groupYear) === state.year && document.getElementById('layer-buildings').checked;
  });
  document.querySelectorAll('[data-year]').forEach(button => {
    button.setAttribute('aria-pressed', Number(button.dataset.year) === state.year ? 'true' : 'false');
  });
  document.getElementById('year-output').textContent = String(state.year);
  document.getElementById('building-count').textContent = String(data.buildings[String(state.year)].length);
  document.getElementById('view-title').textContent = `El Uvito · ${state.year} building layer`;
}

function setPlacementTool(tool) {
  state.placementTool = state.placementTool === tool ? null : tool;
  document.querySelectorAll('[data-tool]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.tool === state.placementTool ? 'true' : 'false');
  });
  canvas.classList.toggle('is-placing', Boolean(state.placementTool));
  placementTip.hidden = !state.placementTool;
}

document.querySelectorAll('[data-year]').forEach(button => button.addEventListener('click', () => updateYear(button.dataset.year)));
document.getElementById('rain-range').addEventListener('input', event => { state.rain = Number(event.target.value); updateScenario(); });
document.getElementById('heat-range').addEventListener('input', event => { state.heat = Number(event.target.value); updateScenario(); });

document.getElementById('layer-buildings').addEventListener('change', event => {
  buildingGroups[String(state.year)].visible = event.target.checked;
});
document.getElementById('layer-mass').addEventListener('change', event => { overlayGroups.massMovement.visible = event.target.checked; });
document.getElementById('layer-flood').addEventListener('change', event => { overlayGroups.flood.visible = event.target.checked; });
document.getElementById('layer-torrential').addEventListener('change', event => { overlayGroups.torrential.visible = event.target.checked; });
document.getElementById('layer-riparian').addEventListener('change', event => { overlayGroups.riparian.visible = event.target.checked; });
document.getElementById('layer-river').addEventListener('change', event => { overlayGroups.river.visible = event.target.checked; });

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setPlacementTool(button.dataset.tool)));

document.getElementById('clear-interventions').addEventListener('click', () => {
  while (interventionGroup.children.length) interventionGroup.remove(interventionGroup.children[0]);
  state.interventionCount = 0;
  document.getElementById('intervention-count').textContent = '0 placed';
  updateScenario();
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;
canvas.addEventListener('pointerdown', event => { pointerDown = [event.clientX, event.clientY]; });
canvas.addEventListener('pointerup', event => {
  if (!state.placementTool || !pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]);
  pointerDown = null;
  if (moved > 6) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if (!hit) return;
  interventionGroup.add(interventionMarker(state.placementTool, hit.point));
  state.interventionCount += 1;
  document.getElementById('intervention-count').textContent = `${state.interventionCount} placed`;
  updateScenario();
});

function resetCamera() {
  camera.position.set(extentWidth * .72, 1550, extentHeight * .88);
  controls.target.set(0, (data.maximumElevation - elevationBase) * .28, 0);
  controls.update();
}

document.getElementById('reset-view').addEventListener('click', resetCamera);
document.getElementById('top-view').addEventListener('click', () => {
  camera.position.set(0, Math.max(extentWidth, extentHeight) * 1.08, 0.1);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('save-view').addEventListener('click', () => {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = `el-uvito-${state.year}-scenario.png`;
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
});

const notesDialog = document.getElementById('notes-dialog');
document.getElementById('open-notes').addEventListener('click', () => notesDialog.showModal());
document.getElementById('terrain-note').textContent = data.notes.terrain;
document.getElementById('imagery-note').textContent = data.notes.imagery;
document.getElementById('buildings-note').textContent = data.notes.buildings;
document.getElementById('hazards-note').textContent = data.notes.hazards;

function resize() {
  const width = sceneWrap.clientWidth;
  const height = sceneWrap.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(sceneWrap);
resize();
updateYear(state.year);
updateScenario();

const clock = new THREE.Clock();
function animate() {
  const delta = Math.min(clock.getDelta(), .05);
  if (rain.visible && state.rain > 0) {
    const positions = rain.geometry.attributes.position;
    const speed = 260 + state.rain * 5.5;
    for (let index = 0; index < rainCount; index += 1) {
      let y = positions.getY(index) - speed * delta;
      if (y < -40) y = 1350 + Math.random() * 500;
      positions.setY(index, y);
    }
    positions.needsUpdate = true;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
