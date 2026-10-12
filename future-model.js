import { clamp } from "./model.js";

export const FUTURE_COLORS = {
  trees: "#32735c", housing: "#efbd62", loss: "#c2685c", gain: "#8ac781",
};
export function linearTrend(points) {
  if(!points.length)return {slope:0,predict:()=>0};
  const meanX=points.reduce((a,p)=>a+p.year,0)/points.length;
  const meanY=points.reduce((a,p)=>a+p.value,0)/points.length;
  const denominator=points.reduce((a,p)=>a+(p.year-meanX)**2,0);
  const slope=denominator?points.reduce((a,p)=>a+(p.year-meanX)*(p.value-meanY),0)/denominator:0;
  return { slope, predict:(year)=>meanY+slope*(year-meanX) };
}

export function futureDefaults(baseline) {
  const history = baseline.landcoverHistory;
  const treeRate = history["2021"].treeHa > 0
    ? ((history["2025"].treeHa / history["2021"].treeHa) ** 0.25 - 1) * 100 : 0;
  return { enabled: false, year: 2030, policy: "compact", model: "footprint", rate: baseline.population.annualRate,
    household: 3, infill: 60, land: 160, slope: 25, protectTrees: true,
    treeRate: 0, restoration: 0, rehouse: 0, seed: 1, trees: true,
    observedTreeRate: treeRate, mappedTreeTrend: false };
}

export function policySettings(policy, baseline) {
  if (policy === "expansion") return { policy, infill: 20, land: 240, protectTrees: false,
    treeRate: 0, restoration: 0, slope: 25 };
  if (policy === "restoration") return { policy, infill: 70, land: 160, protectTrees: true,
    treeRate: 0, restoration: 1, slope: 25 };
  return { policy: "compact", infill: 60, land: 160, protectTrees: true,
    treeRate: 0, restoration: 0, slope: 25 };
}

export function cellPosition(baseline, index) {
  return {
    x: -(baseline.extent[2] - baseline.extent[0]) / 2 + (index % baseline.width + 0.5) * baseline.cellWidth,
    n: (baseline.extent[3] - baseline.extent[1]) / 2 - (Math.floor(index / baseline.width) + 0.5) * baseline.cellDepth,
  };
}

export function cellRing(baseline, index, inset = 0) {
  const { x, n } = cellPosition(baseline, index),
    w = baseline.cellWidth / 2 - inset, d = baseline.cellDepth / 2 - inset;
  return [[x-w,n-d],[x+w,n-d],[x+w,n+d],[x-w,n+d]];
}

// Stable noise supplies alternative spatial patterns, not a probability of construction.
function noise(index, seed) {
  let x = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(seed + 1, 0x27d4eb2d);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function projectFuture(b, input) {
  const years = Math.round(clamp(Number(input.year) || 2030, 2025, 2040)) - 2025;
  const rate = clamp(Number(input.rate) || 0, -5, 8);
  const household = clamp(Number(input.household) || 3, 1, 8);
  const land = clamp(Number(input.land) || 160, 80, 500);
  const slopeLimit = clamp(Number(input.slope) || 25, 5, 40);
  const infill = clamp(Number(input.infill) || 0, 0, 90);
  const rehouse = input.model==="footprint"?0:Math.round(clamp(Number(input.rehouse) || 0, 0, 500));
  const population = b.population["2025"] * (1 + rate / 100) ** years;
  const roofTrend=linearTrend(Object.entries(b.footprintHistory||{}).map(([year,p])=>({year:Number(year),value:p.roofHa})));
  const roofIncrementHa=Math.max(0,roofTrend.slope*years);
  const referenceRoof=b.footprintHistory?.["2021"];
  const meanRoof=referenceRoof ? referenceRoof.roofHa*10000/referenceRoof.count : 70;
  const growthDemand = input.model==="footprint" ? Math.ceil(roofIncrementHa*10000/meanRoof)
    : Math.ceil(Math.max(0, population - b.population["2025"]) / household);
  const demand = growthDemand + rehouse;
  const accommodated = Math.floor(demand * infill / 100);
  const outward = demand - accommodated;
  const cellArea = b.cellWidth * b.cellDepth;
  const neededCells = Math.ceil(outward * land / cellArea);
  const housingCandidates = [];
  const nearScale = input.policy === "expansion" ? 500 : 180;
  for (let i = 0; i < b.flags.length; i++) {
    if (b.flags[i] !== 0 || b.slope[i] > slopeLimit || b.distance[i] > 800) continue;
    if (input.protectTrees && b.treeFraction[i] > 0) continue;
    const adjacency = Math.exp(-b.distance[i] / nearScale);
    const gentle = 1 - b.slope[i] / 40;
    const score = 0.58 * adjacency + 0.24 * gentle + 0.18 * noise(i, input.seed || 1);
    housingCandidates.push({ i, score });
  }
  housingCandidates.sort((a,b) => b.score-a.score || a.i-b.i);
  const housing = housingCandidates.slice(0, neededCells).map((p) => p.i);
  const housingSet = new Set(housing);
  const allocated = Math.min(outward, Math.floor(housing.length * cellArea / land + 1e-8));
  const baselineTreeHa = b.landcoverHistory["2025"].treeHa;
  const housingTreeLoss = housing.reduce((sum,i) => sum + b.treeFraction[i] * cellArea / 10000, 0);
  const treeTrend=linearTrend(Object.entries(b.landcoverHistory).map(([year,p])=>({year:Number(year),value:p.treeHa})));
  const targetTreeHa = Math.max(0,input.mappedTreeTrend ? baselineTreeHa+treeTrend.slope*years
    : baselineTreeHa * (1 + clamp(Number(input.treeRate)||0, -10, 10)/100) ** years)
    + clamp(Number(input.restoration)||0, 0, 5) * years;
  let remaining = Math.max(0, baselineTreeHa - housingTreeLoss);
  const afterHousing=remaining;
  const loss = housing.filter((i) => b.treeFraction[i] > 0);
  const gain = [];
  // Do not count housing-related clearing twice when following the historic net tree-cover trend.
  if (targetTreeHa < remaining) {
    const edges = b.treeFraction.map((f,i) => ({i,f,score: Math.exp(-b.distance[i]/300)+noise(i,41)/4}))
      .filter((p) => p.f > 0 && b.insideFraction[p.i] > 0 && !housingSet.has(p.i));
    edges.sort((a,b) => b.score-a.score || a.i-b.i);
    for (const {i,f} of edges) {
      if (remaining <= targetTreeHa) break;
      const removed = f * b.insideFraction[i] * cellArea / 10000;
      if (removed > remaining-targetTreeHa + cellArea/10000) continue;
      loss.push(i); remaining = Math.max(0, remaining-removed);
    }
  }
  if (targetTreeHa > afterHousing) {
    const candidates = b.classes.map((c,i) => ({i,c,score: (b.flags[i]&4 ? 1 : 0) + Math.exp(-b.distance[i]/800) + noise(i,53)/5}))
      .filter(({i,c}) => (b.flags[i] & (1|8|16))===0 && [5,11].includes(c) && b.treeFraction[i]<0.1 && !housingSet.has(i));
    candidates.sort((a,b) => b.score-a.score || a.i-b.i);
    for (const {i} of candidates) {
      if (remaining >= targetTreeHa) break;
      const added = (1-b.treeFraction[i]) * cellArea / 10000;
      gain.push(i); remaining += added;
    }
  }
  const lossHa = baselineTreeHa + gain.reduce((a,i)=>a+(1-b.treeFraction[i])*cellArea/10000,0) - remaining;
  return {
    key: JSON.stringify(input), year: 2025+years, population, demand, growthDemand, rehouse,
    accommodated, outward, allocated, unallocated: outward-allocated,
    housing, loss: [...new Set(loss)], gain, housingSet,
    lossSet: new Set(loss), gainSet: new Set(gain),
    landHa: housing.length*cellArea/10000, treeHa: remaining,
    treeLossHa: Math.max(0,lossHa), treeGainHa: gain.reduce((a,i)=>a+(1-b.treeFraction[i])*cellArea/10000,0),
    unmetTreeHa: Math.max(0,targetTreeHa-remaining), baselineTreeHa,
    eligibleAreaHa: housingCandidates.length*cellArea/10000,
    roofIncrementHa, roofTrendHaPerYear: roofTrend.slope, treeTrendHaPerYear: treeTrend.slope,
    demandUnit: input.model==="footprint"?"footprint-equivalents":"dwellings",
    assumptions: {rate, household, land, slopeLimit, infill},
  };
}

export function exportFuture(result, settings, baseline) {
  return { version: 1, site: baseline.site, crs: baseline.crs, type: "scenario-allocation",
    baselineYear: 2025, targetYear: result.year, parameters: settings,
    summary: { population: result.population, housingDemand: result.demand, demandUnit: result.demandUnit,
      additionalRoofAreaHa: result.roofIncrementHa,
      assumedInExistingFabric: result.accommodated, allocatedOutward: result.allocated,
      unallocated: result.unallocated, landHa: result.landHa, treeHa: result.treeHa,
      treeLossHa: result.treeLossHa, treeGainHa: result.treeGainHa },
    housingZones: result.housing.map((i)=>({ring:cellRing(baseline,i).map(([x,n])=>[x+(baseline.extent[0]+baseline.extent[2])/2,n+(baseline.extent[1]+baseline.extent[3])/2])})),
    treeChangeZones: [ ...result.loss.map((i)=>({i,change:"loss"})), ...result.gain.map((i)=>({i,change:"gain"})) ]
      .map(({i,change})=>({change,ring:cellRing(baseline,i).map(([x,n])=>[x+(baseline.extent[0]+baseline.extent[2])/2,n+(baseline.extent[1]+baseline.extent[3])/2])})),
    sources: baseline.sources };
}
