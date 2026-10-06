import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createModel, serializePlan, parsePlan, pointInRing } from "../model.js";
import { terrainGeometry, buildingGeometry } from "../terrain-view.js";

function dataset(slug, globalName) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL(`../assets/${slug}-data.js`, import.meta.url), "utf8"), context);
  return JSON.parse(JSON.stringify(context.window[globalName]));
}
const uvito = dataset("el-uvito", "EL_UVITO_DATA");
const palma = dataset("la-palma", "LA_PALMA_DATA");

test("La Palma has its own source extent, orthophoto and valid terrain grid", () => {
  assert.equal(palma.site, "la-palma");
  assert.equal(palma.name, "La Palma");
  assert.equal(palma.crs, "EPSG:9377");
  assert.equal(palma.orthophoto, "assets/la-palma-ortho-2024.jpg");
  assert.deepEqual(palma.buildingBasins, ["Alta", "Media"]);
  assert.notDeepEqual(palma.extent, uvito.extent);
  // Independent source boundary bounds in EPSG:9377, with the 100 m margin.
  const expected = [4703092.109, 2249581.982, 4708284.727, 2252880.261];
  palma.extent.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 0.01));
  assert.equal(palma.heights.length, palma.width * palma.height);
  assert.ok(palma.heights.every((h) => Number.isFinite(h) && h > 1700 && h < 3200));
  assert.deepEqual(Object.values(palma.buildings).map((v) => v.length), [624, 792, 718]);
  const model = createModel(palma);
  for (const ring of palma.boundary) for (const [x, n] of ring) assert.ok(model.inside(x, n));
  // An irregular boundary is essential: the blur must not use the rectangular extent.
  assert.equal(palma.boundary.some((r) => pointInRing(-model.width / 2 + 5, model.depth / 2 - 5, r)), false);
  for (const geometry of [terrainGeometry(model), buildingGeometry(model, 2021)]) {
    assert.ok(geometry.attributes.position.count > 0);
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
    geometry.dispose();
  }
});

test("plans round-trip separately and reject the other settlement", () => {
  const proposal = [{ id: "one", type: "trees", x: 0, n: 0, note: "Workshop note" }];
  const uPlan = serializePlan(proposal, uvito);
  const pPlan = serializePlan(proposal, palma);
  assert.equal(uPlan.site, "el-uvito"); // Existing saved plans remain compatible.
  assert.equal(pPlan.site, "la-palma");
  assert.equal(parsePlan(pPlan, createModel(palma))[0].note, "Workshop note");
  assert.throws(() => parsePlan(uPlan, createModel(palma)));
  assert.throws(() => parsePlan(pPlan, createModel(uvito)));
});
