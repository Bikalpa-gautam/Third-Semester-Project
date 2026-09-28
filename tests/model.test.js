import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  createModel,
  pointInRing,
  measurePoints,
  contourSegments,
  serializePlan,
  parsePlan,
  densify,
} from "../model.js";
import {
  terrainGeometry,
  skirtGeometry,
  buildingGeometry,
} from "../terrain-view.js";
import { messages } from "../i18n.js";

const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(
    new URL("../assets/el-uvito-data.js", import.meta.url),
    "utf8",
  ),
  context,
);
const data = JSON.parse(JSON.stringify(context.window.EL_UVITO_DATA)),
  model = createModel(data);

test("the three source years retain their exact supplied polygon counts", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(data.buildings).map(([year, v]) => [year, v.length]),
    ),
    { 2010: 110, 2019: 155, 2021: 241 },
  );
  assert.equal(data.heights.length, data.width * data.height);
});
test("grid sampling keeps north/east orientation and exact node elevations", () => {
  for (const [row, col] of [
    [0, 0],
    [0, 319],
    [176, 0],
    [176, 319],
    [80, 120],
  ]) {
    const x = -model.width / 2 + col * model.dx,
      n = model.depth / 2 - row * model.dn;
    assert.ok(
      Math.abs(model.elevation(x, n) - data.heights[row * data.width + col]) <
        1e-8,
    );
  }
});
test("slope and bilinear interpolation match an independent planar surface", () => {
  const heights = [];
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) heights.push(100 + x * 10 + 2 * (20 - y * 10));
  const synthetic = createModel({
    width: 3,
    height: 3,
    extent: [0, 0, 20, 20],
    centre: [10, 10],
    heights,
    buildings: { 2021: [] },
    hazards: {},
  });
  assert.equal(synthetic.elevation(0, 0), 130);
  assert.ok(
    Math.abs(
      synthetic.slope(2, -3) - (Math.atan(Math.sqrt(5)) * 180) / Math.PI,
    ) < 0.0001,
  );
});
test("distance is horizontal and rise is the sampled elevation difference", () => {
  const a = { x: 0, n: 0 },
    b = { x: 300, n: 400 },
    m = measurePoints(a, b, model);
  assert.equal(m.distance, 500);
  assert.equal(m.rise, model.elevation(300, 400) - model.elevation(0, 0));
});
test("point-in-polygon handles concave geometry", () => {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 3],
    [3, 3],
    [3, 10],
    [0, 10],
  ];
  assert.equal(pointInRing(1, 8, ring), true);
  assert.equal(pointInRing(8, 8, ring), false);
});
test("contours stay on their level and inside the supplied DEM extent", () => {
  const segments = contourSegments(model);
  assert.ok(segments.length > 500);
  for (const [a, b] of segments) {
    assert.equal(a[2], b[2]);
    assert.equal(a[2] % 50, 0);
    for (const [x, n, h] of [a, b]) {
      assert.ok(model.inside(x, n));
      assert.ok(h >= data.minimumElevation && h <= data.maximumElevation);
    }
  }
});
test("proposal export round-trips projected coordinates without losing notes", () => {
  const p = [
    {
      id: "one",
      type: "garden",
      x: 100.25,
      n: -207.5,
      note: "Discuss drainage with residents.",
    },
  ];
  const result = serializePlan(p, data);
  assert.equal(result.crs, "EPSG:9377");
  assert.equal(result.proposals[0].easting, data.centre[0] + 100.25);
  const restored = parsePlan(result, model);
  assert.equal(restored[0].x, p[0].x);
  assert.equal(restored[0].n, p[0].n);
  assert.equal(restored[0].note, p[0].note);
});
test("imports reject incorrect projections, unknown types, invalid numbers and out-of-area points", () => {
  const valid = serializePlan(
    [{ id: "x", type: "trees", x: 0, n: 0, note: "" }],
    data,
  );
  for (const change of [
    (p) => (p.crs = "EPSG:4326"),
    (p) => (p.proposals[0].type = "constructor"),
    (p) => (p.proposals[0].easting = NaN),
    (p) => (p.proposals[0].northing = 0),
    (p) => (p.proposals = new Array(101).fill(p.proposals[0])),
  ]) {
    const copy = structuredClone(valid);
    change(copy);
    assert.throws(() => parsePlan(copy, model));
  }
});
test("draped line subdivision does not skip terrain between vertices", () => {
  const points = densify(
    [
      [0, 0],
      [100, 0],
    ],
    10,
    false,
  );
  assert.equal(points.length, 11);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [100, 0]);
});
test("3D terrain, solid sides and building meshes have finite geometry and correct extents", () => {
  for (const geometry of [
    terrainGeometry(model),
    skirtGeometry(model),
    ...Object.keys(data.buildings).map((year) => buildingGeometry(model, year)),
  ]) {
    const pos = geometry.attributes.position;
    assert.ok(pos.count > 0);
    assert.ok([...pos.array].every(Number.isFinite));
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.x <= model.width / 2 + 0.01);
    assert.ok(geometry.boundingBox.min.x >= -model.width / 2 - 0.01);
    assert.ok(geometry.boundingBox.min.y >= -55.01);
    geometry.dispose();
  }
});
test("all English interface messages have a Spanish translation", () => {
  assert.deepEqual(
    Object.keys(messages.en).sort(),
    Object.keys(messages.es).sort(),
  );
});
