import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { futureDefaults, policySettings, projectFuture, exportFuture, cellRing, linearTrend } from "../future-model.js";
import { createModel, pointInRing } from "../model.js";
import { buildingGeometry } from "../terrain-view.js";

for(const site of ["el-uvito","la-palma"]) {
  const b=JSON.parse(fs.readFileSync(new URL(`../assets/${site}-future.json`,import.meta.url)));
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(new URL(`../assets/${site}-data.js`,import.meta.url),"utf8"),context);
  const data=JSON.parse(JSON.stringify(context.window[site==="el-uvito"?"EL_UVITO_DATA":"LA_PALMA_DATA"]));
  test(`${site}: 2025 source grids, geometry and population metadata are complete`,()=>{
    const n=b.width*b.height;
    for(const key of ["flags","treeFraction","insideFraction","classes","slope","distance"]){assert.equal(b[key].length,n);assert.ok(b[key].every(Number.isFinite));}
    assert.deepEqual(b.extent,data.extent);assert.ok(b.population["2025"]>0);assert.ok(b.population["2030"]>0);
    assert.equal(b.buildings2025.length,site==="el-uvito"?218:490);
    assert.ok(b.sources.cadastre.endsWith("/170"));
    assert.match(b.cadastreMethod,/map export/i);
    const weighted=b.population.cells.reduce((a,p)=>a+p.count*p.fraction,0);
    assert.ok(Math.abs(weighted-b.population["2025"])<0.05);
    data.buildings["2025"]=b.buildings2025;
    const geometry=buildingGeometry(createModel(data),2025);
    assert.ok(geometry.attributes.position.count>0);
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));geometry.dispose();
  });
  test(`${site}: demand is conserved and all new housing respects spatial exclusions`,()=>{
    for(const policy of ["compact","expansion","restoration"]) {
      const config={...futureDefaults(b),...policySettings(policy,b),year:2040,rehouse:100};
      const r=projectFuture(b,config);
      assert.equal(r.demand,r.accommodated+r.allocated+r.unallocated);
      assert.equal(r.housing.length,new Set(r.housing).size);
      for(const i of r.housing){
        assert.equal(b.flags[i],0);assert.ok(b.slope[i]<=config.slope);assert.ok(b.distance[i]<=800);
        if(config.protectTrees)assert.equal(b.treeFraction[i],0);
        for(const [x,n] of cellRing(b,i))assert.ok(b.boundary.some((ring)=>pointInRing(x,n,ring)));
      }
      assert.ok(r.treeHa>=0);assert.ok(r.treeLossHa>=0);
      assert.ok(r.gain.every((i)=>!r.housingSet.has(i)));
    }
  });
  test(`${site}: years are nested, seeds reproduce results, and shortfalls remain visible`,()=>{
    const c={...futureDefaults(b),rehouse:20};
    const a=projectFuture(b,c),same=projectFuture(b,c),later=projectFuture(b,{...c,year:2040});
    assert.deepEqual(a.housing,same.housing);assert.ok(a.housing.every((i)=>later.housingSet.has(i)));
    assert.ok(Math.abs(a.population-b.population["2030"])<.1);
    const zero=projectFuture(b,{...c,year:2025,rehouse:0});assert.equal(zero.demand,0);assert.equal(zero.housing.length,0);
    const none=projectFuture({...b,flags:b.flags.map(()=>1)},{...c,infill:0});
    assert.equal(none.allocated,0);assert.equal(none.unallocated,none.demand);
    const falling=projectFuture(b,{...c,model:"population",rate:-5,rehouse:0});assert.equal(falling.demand,0);
    const exported=exportFuture(a,c,b);
    assert.equal(exported.type,"scenario-allocation");assert.equal(exported.site,site);assert.equal(exported.crs,"EPSG:9377");
    assert.ok(exported.housingZones.every((p)=>p.ring.every(([e,n])=>e>4700000&&n>2200000)));
  });
  test(`${site}: independent tree trends conserve area and respect housing protection`,()=>{
    const c={...futureDefaults(b),year:2030,mappedTreeTrend:true,protectTrees:true};
    const r=projectFuture(b,c),hold=projectFuture(b,{...c,mappedTreeTrend:false});
    assert.ok(r.treeHa<hold.treeHa);
    assert.ok(Math.abs(r.treeHa-(r.baselineTreeHa-r.treeLossHa+r.treeGainHa))<1e-8);
    assert.ok(r.housing.every((i)=>b.treeFraction[i]===0));
    const restored=projectFuture(b,{...c,...policySettings("restoration",b),mappedTreeTrend:false});
    assert.ok(restored.treeHa>r.baselineTreeHa);
    assert.ok(restored.gain.every((i)=>(b.flags[i]&(1|8|16))===0));
  });
}
test("linear trend recovers an independent straight line and housing trend uses the original roof history",()=>{
  const trend=linearTrend([{year:2010,value:5},{year:2019,value:23},{year:2021,value:27}]);
  assert.ok(Math.abs(trend.slope-2)<1e-10);assert.ok(Math.abs(trend.predict(2030)-45)<1e-10);
  for(const site of ["el-uvito","la-palma"]){
    const b=JSON.parse(fs.readFileSync(new URL(`../assets/${site}-future.json`,import.meta.url)));
    const settings={...futureDefaults(b),model:"footprint",year:2030};const r=projectFuture(b,settings);
    assert.ok(r.roofIncrementHa>0);assert.equal(r.demandUnit,"footprint-equivalents");
    assert.equal(r.growthDemand,Math.ceil(r.roofIncrementHa*10000/(b.footprintHistory["2021"].roofHa*10000/b.footprintHistory["2021"].count)));
  }
});
