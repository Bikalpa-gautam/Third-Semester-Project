import {
  createModel,
  contourSegments,
  LAYERS,
  PROPOSALS,
  measurePoints,
  serializePlan,
  parsePlan,
  clamp,
} from "./model.js";
import { MapView, surfaceImages } from "./map-view.js";
import { translator } from "./i18n.js";
import { futureDefaults, policySettings, projectFuture, exportFuture, cellPosition, FUTURE_COLORS } from "./future-model.js";

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name, cls = "") =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const params = new URLSearchParams(location.search);
const site = params.get("settlement") === "la-palma" ? "la-palma" : "el-uvito";
const siteName = site === "la-palma" ? "La Palma" : "El Uvito";
const storageKey = `${site}-plan-v1`;
let lang =
  (params.get("lang") || stored("el-uvito-language")) === "es" ? "es" : "en";
let t = translator(lang, siteName),
  model,
  mapView,
  terrainView,
  images,
  toastTimer,
  selectedTab = "explore",
  ready = false,
  metresPerPixel = 4;
let data = site === "el-uvito" ? window.EL_UVITO_DATA : null;
let futureBaseline=null, futureResult=null, futureLoadFailed=false;
const futureInputs=[
  ["future-year","year",2025,2040],["future-rate","rate",-5,8],
  ["future-household","household",1,8],["future-infill","infill",0,90],
  ["future-land","land",80,500],["future-slope","slope",5,40],
  ["future-tree-rate","treeRate",-10,10],["future-restoration","restoration",0,5],
  ["future-rehouse","rehouse",0,500],
];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = {
  year: 2021,
  base: "aerial",
  mode: "3d",
  rain: 0,
  warmth: 0,
  opacity: 65,
  relief: 1,
  orbit: false,
  boundaryFocus: params.get("focus") === "1",
  future: null,
  reducedMotion,
  layers: {
    buildings: true,
    massMovement: false,
    flood: false,
    torrential: false,
    riparian: false,
    river: true,
    boundary: true,
    contours: false,
  },
  proposals: [],
  tool: null,
  selection: null,
  measurePoints: [],
  panelOpen: true,
  mobilePanel: false,
};
if (["2010", "2019", "2021", "2025"].includes(params.get("year")))
  state.year = Number(params.get("year"));
if (["aerial", "elevation", "slope"].includes(params.get("base")))
  state.base = params.get("base");
if (params.get("mode") === "map") state.mode = "map";
if (params.has("layers")) {
  const keys = params.get("layers").split(",");
  for (const k of Object.keys(state.layers)) state.layers[k] = keys.includes(k);
}
if (state.boundaryFocus) state.layers.boundary = true;
for (const [key, min, max] of [
  ["rain", 0, 100],
  ["warmth", 0, 100],
  ["relief", 1, 2],
  ["opacity", 15, 100],
])
  if (params.has(key) && Number.isFinite(Number(params.get(key))))
    state[key] = clamp(Number(params.get(key)), min, max);
let undoStack = [],
  redoStack = [];

function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function fmt(value, digits = 0) {
  return new Intl.NumberFormat(lang, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
function layerRows(keys) {
  return keys
    .map(
      (key) =>
        `<label class="layer-row"><span class="layer-swatch ${["river", "boundary", "contours"].includes(key) ? "line" : ""}" style="--swatch:${LAYERS[key].color}"></span><span>${t(key)}</span><input type="checkbox" data-layer="${key}" ${state.layers[key] ? "checked" : ""}><i class="switch-track" aria-hidden="true"></i></label>`,
    )
    .join("");
}
function refreshFuture() {
  $("future-unavailable").hidden=!futureLoadFailed;
  $("future-controls").hidden=futureLoadFailed;
  $("future-controls").inert=!futureBaseline;
  $("future-badge").hidden=!state.future?.enabled;
  if(!futureBaseline || !state.future)return;
  const config=state.future;
  const key=JSON.stringify(config);
  if(futureResult?.key!==key)futureResult=projectFuture(futureBaseline,config);
  $("future-badge").textContent=`${futureResult.year} · ${t("scenario")}`;
  $("future-enabled").checked=config.enabled;
  $("future-trees").checked=config.trees;
  $("future-protect-trees").checked=config.protectTrees;
  $("future-year-value").textContent=futureResult.year;
  $("future-rate-value").textContent=`${fmt(config.rate,1)}%`;
  $("future-population-source").textContent=t("sourceGrowth");
  for(const [id,key] of futureInputs)if(document.activeElement!==$(id))$(id).value=config[key];
  $$("[data-policy]").forEach((b)=>b.setAttribute("aria-pressed",b.dataset.policy===config.policy));
  const approximate=(value)=>`≈ ${fmt(Math.round(value/10)*10)}`;
  const metrics=[
    ["baselinePopulation",approximate(futureBaseline.population["2025"])],
    ["projectedPopulation",approximate(futureResult.population)],
    [config.model==="footprint"?"additionalFootprints":"additionalDwellings",fmt(futureResult.demand)],
    ["withinFabric",fmt(futureResult.accommodated)],
    ["landNeeded",`${fmt(futureResult.landHa,2)} ha`],
    ["futureTreeCover",`${fmt(futureResult.treeHa,1)} ha`],
  ];
  $("future-metrics").innerHTML=metrics.map(([label,value])=>`<div><small>${t(label)}</small><strong>${value}</strong></div>`).join("");
  $("future-model").value=config.model;
  $("future-household").disabled=config.model==="footprint";
  $("future-rehouse").disabled=config.model==="footprint";
  document.querySelector('label[for="future-land"] > span').textContent=t(config.model==="footprint"?"landPerEquivalent":"landPerDwelling");
  $("future-trend-source").textContent=config.model==="footprint" ? `${t("footprintTrendSource")} ${fmt(futureResult.roofTrendHaPerYear,3)} ha/${t("perYear")}. ${t("footprintEquivalentMeaning")}` : "";
  $("future-tree-rate").disabled=config.mappedTreeTrend;
  $("future-forest-model").value=config.mappedTreeTrend?"trend":"policy";
  $("future-tree-trend-note").hidden=!config.mappedTreeTrend;
  $("future-tree-trend-note").textContent=`${t("linearTreeTrend")}: ${fmt(futureResult.treeTrendHaPerYear,3)} ha/${t("perYear")}.`;
  const roofs=Object.entries(futureBaseline.footprintHistory).map(([year,p])=>({year:Number(year),value:p.roofHa}));
  const tree=Object.entries(futureBaseline.landcoverHistory).map(([year,p])=>({year:Number(year),value:p.treeHa}));
  const roofTarget=roofs.at(-1).value+futureResult.roofTrendHaPerYear*(futureResult.year-roofs.at(-1).year);
  $("future-trends").innerHTML=trendChart(roofs,futureResult.year,roofTarget,t("roofArea"))+trendChart(tree,futureResult.year,futureResult.treeHa,t("mappedTreeCover"));
  const limits=[];
  if(futureResult.unallocated)limits.push(`${t("notAllocated")}: ${fmt(futureResult.unallocated)}`);
  if(futureResult.unmetTreeHa>.04)limits.push(`${t("treeGainNotAllocated")}: ${fmt(futureResult.unmetTreeHa,1)} ha`);
  $("future-shortfall").textContent=limits.join(" · ");$("future-shortfall").hidden=!limits.length;
  $("future-zoom").disabled=!futureResult.housing.length;
}
function trendChart(points,year,target,label) {
  const low=points[0].year,high=Math.max(year,points.at(-1).year+1),maximum=Math.max(target,...points.map((p)=>p.value))*1.2;
  const x=(y)=>20+(y-low)/(high-low)*210,y=(v)=>90-v/Math.max(maximum,.01)*70;
  const path=points.map((p,i)=>`${i?"L":"M"}${x(p.year).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last=points.at(-1);
  return `<div class="future-chart"><small>${label} · ha</small><svg viewBox="0 0 250 115" role="img" aria-label="${label} · ${low}–${year}"><path d="M20 90H230" stroke="#d7ded5" fill="none"/><path d="${path}" stroke="#64736b" stroke-width="1.6" fill="none"/><path d="M${x(last.year)},${y(last.value)} L${x(year)},${y(target)}" stroke="#b38a47" stroke-width="1.8" stroke-dasharray="4 3" fill="none"/>${points.map((p)=>`<circle cx="${x(p.year)}" cy="${y(p.value)}" r="2.5" fill="#64736b"/>`).join("")}<circle cx="${x(year)}" cy="${y(target)}" r="3" fill="#f8f9f6" stroke="#b38a47"/><text x="20" y="108">${low}</text><text x="${x(last.year)}" y="108" text-anchor="middle">${last.year}</text><text x="230" y="108" text-anchor="end">${year}</text><text x="230" y="17" text-anchor="end">${fmt(target,1)} ha</text></svg></div>`;
}
function setFutureParams(url) {
  if(!state.future)return;
  for(const [,key] of futureInputs)url.searchParams.set(`f-${key}`,String(state.future[key]));
  for(const key of ["enabled","protectTrees","trees","mappedTreeTrend"])url.searchParams.set(`f-${key}`,state.future[key]?"1":"0");
  url.searchParams.set("f-model",state.future.model);
  url.searchParams.set("f-policy",state.future.policy);url.searchParams.set("f-seed",String(state.future.seed));
}
for(const [id,key,min,max] of futureInputs)$(id).addEventListener("input",(e)=>{
  if(!state.future || e.target.value==="" || !Number.isFinite(Number(e.target.value)))return;
  state.future[key]=clamp(Number(e.target.value),min,max);
  if(["year","rehouse"].includes(key))state.future[key]=Math.round(state.future[key]);
  if(key==="treeRate")state.future.mappedTreeTrend=false;
  refresh();
});
for(const [id,key] of [["future-enabled","enabled"],["future-trees","trees"],["future-protect-trees","protectTrees"]])$(id).addEventListener("change",(e)=>{
  if(!state.future)return;state.future[key]=e.target.checked;
  refresh();
});
$("panel-future").addEventListener("click",(e)=>{
  const button=e.target.closest("[data-policy]");
  if(button && futureBaseline && state.future) {
    Object.assign(state.future,policySettings(button.dataset.policy,futureBaseline));
    state.future.mappedTreeTrend=false;
    state.future.enabled=true;refresh();
  }
});
$("future-alternative").addEventListener("click",()=>{if(state.future){state.future.seed=state.future.seed%99+1;refresh();}});
$("future-forest-model").addEventListener("change",(e)=>{
  if(!state.future)return;
  state.future.mappedTreeTrend=e.target.value==="trend";
  refresh();
});
$("future-model").addEventListener("change",(e)=>{if(state.future){state.future.model=e.target.value;refresh();}});
$("future-export").addEventListener("click",()=>{
  if(!futureResult || !state.future)return;
  download(new Blob([JSON.stringify(exportFuture(futureResult,state.future,futureBaseline),null,2)],{type:"application/json"}),`${site}-${futureResult.year}-scenario.json`);
});
$("future-zoom").addEventListener("click",()=>{
  if(!futureResult?.housing.length)return;
  const points=futureResult.housing.map((i)=>cellPosition(futureBaseline,i));
  currentView()?.focusArea(points);
});
function translate() {
  document.documentElement.lang = lang;
  t = translator(lang, siteName);
  document.title = siteName;
  $("settlement-select").value = site;
  $("settlement-select").setAttribute("aria-label", t("selectSettlement"));
  $$("[data-settlement-name]").forEach((el) => (el.textContent = siteName));
  $("scene-wrap").setAttribute("aria-label", `Interactive model of ${siteName}`);
  $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  if (site === "la-palma" && data) {
    document.querySelector('[data-i18n="buildingSource"]').textContent = lang === "en"
      ? "Cuenca Alta and Cuenca Media building detections, 2010, 2019 and 2021."
      : "Detecciones de edificaciones de Cuenca Alta y Cuenca Media, 2010, 2019 y 2021.";
    document.querySelector('[data-i18n="terrainSource"]').textContent = t("terrainSource").replace("9 m", `${fmt((data.extent[2] - data.extent[0]) / (data.width - 1), 1)} m`);
  }
  if (futureBaseline) document.querySelector('[data-i18n="buildingSource"]').textContent=t("cadastreSource");
  $$("[data-title]").forEach((el) => {
    el.title = t(el.dataset.title);
    el.setAttribute("aria-label", t(el.dataset.title));
  });
  $("north").title = t("faceNorth");
  $("north").setAttribute("aria-label", t("faceNorth"));
  $("help").title = t("help");
  $("help").setAttribute("aria-label", t("help"));
  $("language").textContent = lang === "en" ? "ES" : "EN";
  $("language").lang = lang === "en" ? "es" : "en";
  $("language").setAttribute(
    "aria-label",
    lang === "en" ? "Cambiar a español" : "Switch to English",
  );
  $("context-layers").innerHTML = layerRows([
    "buildings",
    "river",
    "riparian",
    "boundary",
  ]);
  $("hazard-layers").innerHTML = layerRows([
    "massMovement",
    "flood",
    "torrential",
  ]);
  $("terrain-layers").innerHTML = layerRows(["contours"]);
  $("proposal-tools").innerHTML = Object.entries(PROPOSALS)
    .map(
      ([key, p]) =>
        `<button class="proposal-tool" data-tool="${key}" aria-pressed="false" style="--proposal-color:${p.color}">${icon(p.icon)}<span>${t(key)}</span>${icon("plus", "add")}</button>`,
    )
    .join("");
  refresh();
}
function mobilePanel() {
  return matchMedia("(max-width:720px)").matches && state.panelOpen;
}
function refresh() {
  state.mobilePanel = mobilePanel();
  $$("[data-year]").forEach((b) =>
    b.setAttribute("aria-pressed", Number(b.dataset.year) === state.year),
  );
  $$("[data-base]").forEach((b) =>
    b.setAttribute("aria-pressed", b.dataset.base === state.base),
  );
  $$("[data-mode]").forEach((b) =>
    b.setAttribute("aria-pressed", b.dataset.mode === state.mode),
  );
  $$("[data-layer]").forEach(
    (input) => (input.checked = state.layers[input.dataset.layer]),
  );
  $$("[data-tool]").forEach((b) =>
    b.setAttribute("aria-pressed", b.dataset.tool === state.tool),
  );
  $$("[data-preset]").forEach((b) =>
    b.setAttribute(
      "aria-pressed",
      b.dataset.preset === "clear"
        ? state.rain === 0 && state.warmth === 0
        : b.dataset.preset === "rain"
          ? state.rain === 70 && state.warmth === 0
          : state.warmth === 75 && state.rain === 0,
    ),
  );
  $("year-caption").textContent = state.year;
  document.querySelector('.year-caption [data-i18n="detected"]').textContent=t(state.year===2025?"cadastralPolygons":"detected");
  refreshFuture();
  $("boundary-focus").checked = state.boundaryFocus;
  $("boundary-focus-row").hidden = !state.layers.boundary;
  $("building-count").textContent = data?.buildings[state.year]?.length ?? "";
  for (const [id, key] of [
    ["rain", "rain"],
    ["warmth", "warmth"],
    ["opacity", "opacity"],
    ["relief", "relief"],
  ]) {
    $(`${id}-value`).textContent =
      key === "relief"
        ? `${fmt(state[key], state[key] % 1 ? 1 : 0)}×`
        : `${fmt(state[key])}%`;
  }
  for (const [id, key] of [
    ["rain-range", "rain"],
    ["warmth-range", "warmth"],
    ["layer-opacity", "opacity"],
    ["relief-range", "relief"],
  ])
    $(id).value = state[key];
  $("workspace").classList.toggle("panel-collapsed", !state.panelOpen);
  $("sidebar").inert = !state.panelOpen;
  $("toggle-panel").setAttribute("aria-expanded", state.panelOpen);
  $("scene-wrap").classList.toggle(
    "placing",
    Object.hasOwn(PROPOSALS, state.tool),
  );
  $("scene-wrap").classList.toggle("measuring", state.tool === "measure");
  $("measure").setAttribute("aria-pressed", state.tool === "measure");
  $("orbit").setAttribute("aria-pressed", state.orbit);
  $("relief-setting").hidden = state.mode !== "3d";
  $("orbit").disabled = state.mode !== "3d" || reducedMotion;
  if (state.tool) {
    $("action-hint").hidden = false;
    $("action-hint-text").textContent =
      state.tool === "measure"
        ? t(state.measurePoints.length === 1 ? "secondPoint" : "firstPoint")
        : `${t("placeHint")} ${t(state.tool).toLowerCase()}.`;
  } else $("action-hint").hidden = true;
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  $("plan-count").textContent = state.proposals.length;
  $("plan-count").hidden = !state.proposals.length;
  $("export-plan").disabled = !state.proposals.length;
  renderPlan();
  renderLegend();
  renderInspector();
  const snapshot = { ...state, layers: { ...state.layers }, futureBaseline, futureResult };
  mapView?.update(snapshot);
  terrainView?.update(snapshot);
}
function renderLegend() {
  if (!data) return;
  let html = "";
  if (state.base !== "aerial") {
    const min =
        state.base === "elevation" ? `${fmt(data.minimumElevation)} m` : "0°",
      max =
        state.base === "elevation" ? `${fmt(data.maximumElevation)} m` : "60°+";
    html = `<div><div class="legend-ramp ${state.base}"></div><div class="ramp-labels"><span>${min}</span><span>${max}</span></div></div>`;
  }
  for (const key of ["massMovement", "flood", "torrential", "riparian"])
    if (state.layers[key])
      html += `<span class="legend-item"><i style="--swatch:${LAYERS[key].color}"></i>${t(key)}</span>`;
  if(state.future?.enabled && futureResult) {
    for(const [key,label,visible] of [["housing","housingZones",futureResult.housing.length],
      ["trees","treeCover",state.future.trees],["loss","treeLoss",state.future.trees&&futureResult.loss.length],
      ["gain","treeGain",state.future.trees&&futureResult.gain.length]])
      if(visible)html+=`<span class="legend-item"><i style="--swatch:${FUTURE_COLORS[key]}"></i>${t(label)}</span>`;
  }
  $("legend").innerHTML = html;
  $("legend").hidden = !html;
}
function renderPlan() {
  $("proposal-list").innerHTML = state.proposals.length
    ? state.proposals
        .map(
          (p, i) =>
            `<button class="proposal-row" data-proposal="${escapeHTML(p.id)}"><span class="proposal-number" style="--proposal-color:${PROPOSALS[p.type].color}">${i + 1}</span><span>${t(p.type)}<small>${escapeHTML(p.note || t("noNote"))}</small></span>${icon("chevron")}</button>`,
        )
        .join("")
    : `<div class="empty-plan">${t("emptyPlan")}</div>`;
}
function renderInspector() {
  const s = state.selection;
  $("inspector").hidden = !s;
  if (!s || !model) return;
  if (s.kind === "point") {
    const p = model.inspect(s.x, s.n, state.year);
    $("inspect-eyebrow").textContent = t("selectedPoint");
    $("inspect-title").textContent =
      p.footprint >= 0
        ? `${t("footprint")} ${p.footprint + 1} · ${state.year}`
        : t("ground");
    const grades = { Alta: "high", Media: "medium", Baja: "low" };
    const hazards = p.hazards.length
      ? p.hazards
          .map(
            (h) =>
              `<div><span>${t(h.key)}</span><strong>${h.grades.map((g) => t(grades[g] || g)).join(", ")}</strong></div>`,
          )
          .join("")
      : `<span>${t("noHazard")}</span>`;
    $("inspect-content").innerHTML =
      `<div class="inspect-values"><div><small>${t("elevation")}</small><strong>${fmt(p.elevation)}<em>m</em></strong></div><div><small>${t("slope")}</small><strong>${fmt(p.slope, 1)}<em>°</em></strong></div></div><div class="inspect-hazards">${hazards}</div><div class="inspect-coords">EPSG:9377 · E ${fmt(p.easting, 1)} · N ${fmt(p.northing, 1)}</div>`;
    if(state.future?.enabled && futureResult) {
      const col=Math.floor((p.x+model.width/2)/futureBaseline.cellWidth),row=Math.floor((model.depth/2-p.n)/futureBaseline.cellDepth),i=row*futureBaseline.width+col;
      const label=futureResult.housingSet.has(i)?"housingZones":futureResult.gainSet.has(i)?"treeGain":futureResult.lossSet.has(i)?"treeLoss":"baselineCell";
      $("inspect-content").insertAdjacentHTML("beforeend",`<div class="inspect-coords">${t("scenarioAtPoint")} · ${futureResult.year}<br>${t(label)}</div>`);
    }
  } else if (s.kind === "measure") {
    if (state.measurePoints.length !== 2) return;
    const result = measurePoints(...state.measurePoints, model);
    $("inspect-eyebrow").textContent = t("measurement");
    $("inspect-title").textContent = t("measuredDistance");
    $("inspect-content").innerHTML =
      `<div class="inspect-values"><div><small>${t("horizontal")}</small><strong>${fmt(result.distance, 1)}<em>m</em></strong></div><div><small>${t("rise")}</small><strong>${result.rise > 0 ? "+" : ""}${fmt(result.rise, 1)}<em>m</em></strong></div></div>`;
  } else if (s.kind === "proposal") {
    const index = state.proposals.findIndex((p) => p.id === s.id),
      p = state.proposals[index];
    if (!p) {
      state.selection = null;
      $("inspector").hidden = true;
      return;
    }
    $("inspect-eyebrow").textContent = `${t("proposal")} ${index + 1}`;
    $("inspect-title").textContent = t(p.type);
    $("inspect-content").innerHTML =
      `<label for="proposal-note">${t("note")}</label><textarea id="proposal-note" maxlength="500" placeholder="${t("notePlaceholder")}">${escapeHTML(p.note || "")}</textarea><button class="delete-proposal" id="delete-proposal">${icon("trash")}${t("remove")}</button>`;
  }
}
function viewChange({ metresPerPixel: mpp, heading }) {
  metresPerPixel = mpp;
  $("compass-needle").style.transform = `rotate(${heading}deg)`;
  const target = mpp * 95,
    exponent = 10 ** Math.floor(Math.log10(Math.max(target, 0.1))),
    number = [1, 2, 5, 10]
      .map((v) => v * exponent)
      .reduce((a, b) => (Math.abs(a - target) < Math.abs(b - target) ? a : b));
  $("scale-label").textContent =
    `${number >= 1000 ? `${fmt(number / 1000, number % 1000 ? 1 : 0)} km` : `${fmt(number)} m`}${state.mode === "3d" ? ` · ${t("frameCentre")}` : ""}`;
  $("scale-line").style.width = `${number / mpp}px`;
}
function hover(p) {
  $("cursor-position").textContent =
    p && model
      ? `${fmt(model.elevation(p.x, p.n))} m · ${fmt(model.slope(p.x, p.n), 1)}°`
      : "";
}
function currentView() {
  return state.mode === "3d" ? terrainView : mapView;
}
function pick(p) {
  if (!ready) return;
  if (state.tool === "measure") {
    if (state.measurePoints.length !== 1) state.measurePoints = [];
    state.measurePoints = [...state.measurePoints, p];
    state.selection =
      state.measurePoints.length === 2 ? { kind: "measure" } : null;
  } else if (Object.hasOwn(PROPOSALS, state.tool)) {
    if (state.proposals.length >= 100) {
      toast(t("limit"));
      return;
    }
    changePlan(() =>
      state.proposals.push({
        ...p,
        id: crypto.randomUUID?.() || String(Date.now()),
        type: state.tool,
        note: "",
      }),
    );
  } else {
    const nearest = state.proposals
      .map((proposal) => ({
        p: proposal,
        d: Math.hypot(p.x - proposal.x, p.n - proposal.n),
      }))
      .sort((a, b) => a.d - b.d)[0];
    state.selection =
      nearest && nearest.d < metresPerPixel * 18
        ? { kind: "proposal", id: nearest.p.id }
        : { kind: "point", ...p };
  }
  refresh();
}
function savePlan() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(serializePlan(state.proposals, data)),
    );
    $("save-status").textContent = t("localSave");
  } catch {
    $("save-status").textContent = t("storedFail");
    toast(t("storedFail"));
  }
}
function changePlan(mutate) {
  undoStack.push(structuredClone(state.proposals));
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  mutate();
  savePlan();
}
function historyMove(direction) {
  const from = direction === "undo" ? undoStack : redoStack,
    to = direction === "undo" ? redoStack : undoStack;
  if (!from.length) return;
  to.push(structuredClone(state.proposals));
  state.proposals = from.pop();
  state.selection = null;
  savePlan();
  refresh();
}
function setTool(tool) {
  state.tool = state.tool === tool ? null : tool;
  state.selection = null;
  if (state.tool === "measure") state.measurePoints = [];
  state.orbit = false;
  refresh();
}
function setMode(mode) {
  if (mode === "3d" && !terrainView) {
    if (ready) toast(t("webglRequired"));
    return;
  }
  state.mode = mode;
  state.orbit = false;
  $("terrain-canvas").hidden = mode !== "3d";
  $("map-canvas").hidden = mode !== "map";
  refresh();
  resize();
}
function setTab(tab, focus = false) {
  selectedTab = tab;
  for (const b of $$("[data-tab]")) {
    const active = b.dataset.tab === tab;
    b.setAttribute("aria-selected", active);
    b.tabIndex = active ? 0 : -1;
    if (active && focus) b.focus();
  }
  for (const name of ["explore", "scenarios", "future", "plan"])
    $(`panel-${name}`).hidden = name !== tab;
  if (tab !== "plan" && Object.hasOwn(PROPOSALS, state.tool)) {
    state.tool = null;
    refresh();
  }
  if(tab==="future" && state.future && !state.future.enabled) {
    state.future.enabled=true;
    refresh();
  }
}
function resize() {
  state.mobilePanel = mobilePanel();
  const snapshot = { ...state, layers: { ...state.layers }, futureBaseline, futureResult };
  mapView?.update(snapshot);
  terrainView?.update(snapshot);
  mapView?.resize();
  terrainView?.resize();
}
function cancel() {
  state.tool = null;
  state.selection = null;
  state.measurePoints = [];
  refresh();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // Let slower browsers finish receiving the file before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportPlan() {
  if (!state.proposals.length) {
    toast(t("nothingExport"));
    return;
  }
  download(
    new Blob([JSON.stringify(serializePlan(state.proposals, data), null, 2)], {
      type: "application/json",
    }),
    `${site}-plan.json`,
  );
  toast(t("planExported"));
}

// Delegation keeps layer and language controls accessible after their labels are refreshed.
$("sidebar").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]"),
    year = e.target.closest("[data-year]"),
    tool = e.target.closest("[data-tool]"),
    preset = e.target.closest("[data-preset]"),
    proposal = e.target.closest("[data-proposal]");
  if (tab) setTab(tab.dataset.tab);
  if (year) {
    state.year = Number(year.dataset.year);
    refresh();
  }
  if (tool) setTool(tool.dataset.tool);
  if (preset) {
    state.rain = preset.dataset.preset === "rain" ? 70 : 0;
    state.warmth = preset.dataset.preset === "warm" ? 75 : 0;
    refresh();
  }
  if (proposal) {
    state.selection = { kind: "proposal", id: proposal.dataset.proposal };
    state.tool = null;
    const p = state.proposals.find((p) => p.id === proposal.dataset.proposal);
    if (p) currentView()?.focus(p);
    refresh();
  }
});
document.querySelector(".panel-tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const tabs = ["explore", "scenarios", "future", "plan"],
    i = tabs.indexOf(selectedTab);
  setTab(
    tabs[
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? 3
          : (i + (e.key === "ArrowRight" ? 1 : 3)) % 4
    ],
    true,
  );
});
$("sidebar").addEventListener("change", (e) => {
  if (e.target.matches("[data-layer]")) {
    state.layers[e.target.dataset.layer] = e.target.checked;
    if (e.target.dataset.layer === "boundary" && !e.target.checked)
      state.boundaryFocus = false;
    refresh();
  }
});
$("boundary-focus").addEventListener("change", (e) => {
  state.boundaryFocus = e.target.checked;
  refresh();
});
$("settlement-select").addEventListener("change", (e) => {
  const url = new URL(location.href);
  url.searchParams.set("settlement", e.target.value);
  url.searchParams.delete("view");
  for (const key of ["year", "base", "mode", "rain", "warmth", "relief", "opacity"])
    url.searchParams.set(key, String(state[key]));
  url.searchParams.set("layers", Object.keys(state.layers).filter((k) => state.layers[k]).join(","));
  url.searchParams.set("focus", state.boundaryFocus ? "1" : "0");
  url.searchParams.set("lang", lang);
  setFutureParams(url);
  if(state.future && futureBaseline && Math.abs(state.future.rate-futureBaseline.population.annualRate)<0.001)
    url.searchParams.delete("f-rate");
  location.assign(url.href);
});
for (const [id, key] of [
  ["rain-range", "rain"],
  ["warmth-range", "warmth"],
  ["layer-opacity", "opacity"],
  ["relief-range", "relief"],
])
  $(id).addEventListener("input", (e) => {
    state[key] = Number(e.target.value);
    refresh();
  });
$("scene-wrap").addEventListener("click", (e) => {
  const base = e.target.closest("[data-base]"),
    mode = e.target.closest("[data-mode]");
  if (base) {
    state.base = base.dataset.base;
    refresh();
  }
  if (mode) setMode(mode.dataset.mode);
});
$("reset-scenario").addEventListener("click", () => {
  state.rain = 0;
  state.warmth = 0;
  refresh();
});
$("toggle-panel").addEventListener("click", () => {
  state.panelOpen = !state.panelOpen;
  refresh();
  resize();
});
$("zoom-in").addEventListener("click", () => currentView()?.zoom(1.25));
$("zoom-out").addEventListener("click", () => currentView()?.zoom(0.8));
$("reset-view").addEventListener("click", () => {
  state.orbit = false;
  currentView()?.reset();
  refresh();
});
$("north").addEventListener("click", () => currentView()?.north());
$("orbit").addEventListener("click", () => {
  state.orbit = !state.orbit;
  refresh();
});
$("measure").addEventListener("click", () => setTool("measure"));
$("cancel-tool").addEventListener("click", cancel);
$("close-inspector").addEventListener("click", () => {
  state.selection = null;
  refresh();
});
$("undo").addEventListener("click", () => historyMove("undo"));
$("redo").addEventListener("click", () => historyMove("redo"));
let noteEditingId = null;
$("inspect-content").addEventListener("focusin", (e) => {
  if (e.target.id === "proposal-note") noteEditingId = null;
});
$("inspect-content").addEventListener("input", (e) => {
  if (e.target.id !== "proposal-note") return;
  const proposal = state.proposals.find((p) => p.id === state.selection?.id);
  if (!proposal || proposal.note === e.target.value) return;
  const updateNote = () => {
    proposal.note = e.target.value.slice(0, 500);
  };
  // Save while typing, grouping each focused editing session into one undo step.
  if (noteEditingId !== proposal.id) {
    changePlan(updateNote);
    noteEditingId = proposal.id;
  } else {
    updateNote();
    savePlan();
  }
  renderPlan();
  $("undo").disabled = false;
  $("redo").disabled = true;
});
$("inspect-content").addEventListener("click", (e) => {
  if (e.target.closest("#delete-proposal")) {
    const id = state.selection?.id;
    changePlan(
      () => (state.proposals = state.proposals.filter((p) => p.id !== id)),
    );
    state.selection = null;
    refresh();
  }
});
$("language").addEventListener("click", () => {
  lang = lang === "en" ? "es" : "en";
  try {
    localStorage.setItem("el-uvito-language", lang);
  } catch {}
  translate();
  resize();
});
for (const [button, dialog] of [
  ["open-about", "about-dialog"],
  ["mobile-about", "about-dialog"],
  ["open-sources", "sources-dialog"],
  ["help", "help-dialog"],
  ["future-methods", "future-dialog"],
])
  $(button).addEventListener("click", () => $(dialog).showModal());
$("about-sources").addEventListener("click", () => {
  $("about-dialog").close();
  $("sources-dialog").showModal();
});
$$("[data-close]").forEach((b) =>
  b.addEventListener("click", () => $(b.dataset.close).close()),
);
$$("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) cancel();
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "z" &&
    !e.target.matches("input,textarea")
  ) {
    e.preventDefault();
    historyMove(e.shiftKey ? "redo" : "undo");
  }
});
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen();
    else toast(t("fullscreenFail"));
  } catch {
    toast(t("fullscreenFail"));
  }
});
$("share-view").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  for (const key of [
    "year",
    "base",
    "mode",
    "rain",
    "warmth",
    "relief",
    "opacity",
  ])
    url.searchParams.set(key, String(state[key]));
  url.searchParams.set(
    "layers",
    Object.keys(state.layers)
      .filter((k) => state.layers[k])
      .join(","),
  );
  url.searchParams.set("lang", lang);
  url.searchParams.set("settlement", site);
  setFutureParams(url);
  if (state.boundaryFocus) url.searchParams.set("focus", "1");
  const view = currentView()?.getView();
  if (view)
    url.searchParams.set(
      "view",
      view.map((n) => Math.round(n * 100) / 100).join(","),
    );
  try {
    await navigator.clipboard.writeText(url.href);
    toast(t("linkCopied"));
  } catch {
    toast(t("copyFail"));
  }
});
$("save-view").addEventListener("click", () => {
  if (!ready) {
    toast(t("sceneNotReady"));
    return;
  }
  try {
    currentView().render?.();
    mapView?.draw();
    const source = state.mode === "3d" ? $("terrain-canvas") : $("map-canvas");
    const output = document.createElement("canvas"),
      w = Math.min(source.width, 2200),
      scale = w / source.width;
    const sourceHeight =
      state.mode === "map" && state.mobilePanel
        ? source.height * 0.53
        : source.height;
    const h = Math.round(sourceHeight * scale);
    output.width = w;
    output.height = h + 122;
    const ctx = output.getContext("2d");
    ctx.fillStyle = "#f8f9f6";
    ctx.fillRect(0, 0, w, h + 122);
    ctx.fillStyle = "#253a33";
    ctx.font = "28px Georgia";
    ctx.fillText(siteName, 24, 39);
    ctx.font = "11px Arial";
    ctx.fillStyle = "#64736b";
    ctx.fillText(
      `Medellín, Colombia  ·  ${t(state.base)}  ·  ${state.year}`,
      170,
      36,
    );
    ctx.drawImage(source, 0, 0, source.width, sourceHeight, 0, 61, w, h);
    ctx.fillStyle = "#64736b";
    ctx.font = "10px Arial";
    ctx.fillText(t("sourceCredit"), 20, h + 84);
    const details = [
      state.future?.enabled?`${futureResult.year} · ${t("scenario")}`:"",
      state.mode === "3d" ? `${t("relief")}: ${state.relief}×` : "",
      state.rain || state.warmth ? t("scenarioCapture") : "",
      state.proposals.length ? t("annotationCapture") : "",
    ]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillText(details, 20, h + 104);
    output.toBlob((blob) => {
      if (blob) {
        download(blob, state.future?.enabled?`${site}-${futureResult.year}-scenario.png`:`${site}-${state.year}-${state.base}.png`);
        toast(t("screenshotSaved"));
      } else toast(t("imageFail"));
    }, "image/png");
  } catch {
    toast(t("imageFail"));
  }
});
$("export-plan").addEventListener("click", exportPlan);
$("import-plan").addEventListener("click", () => $("plan-file").click());
$("plan-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 200000) throw new Error("Too large");
    const proposals = parsePlan(JSON.parse(await file.text()), model);
    const apply = () => {
      changePlan(() => (state.proposals = proposals));
      state.selection = null;
      refresh();
      toast(t("importedUndo"));
    };
    if (!state.proposals.length) {
      apply();
      return;
    }
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<h2>${t("planImportTitle")}</h2><p>${t("planImportBody")}</p><div class="plan-actions" style="margin-top:24px"><button class="secondary-button" data-cancel>${t("cancel")}</button><button class="export-button" data-replace>${t("importReplace")}</button></div>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("[data-replace]").onclick = () => {
      dialog.close();
      apply();
    };
    dialog.showModal();
  } catch {
    toast(t("emptyImport"));
  }
});

async function boot() {
  translate();
  if (site === "la-palma") {
    await new Promise((resolve) => {
      const script = document.createElement("script");
      const timeout = setTimeout(resolve, 15000);
      script.src = "assets/la-palma-data.js";
      script.onload = script.onerror = () => { clearTimeout(timeout); resolve(); };
      document.head.append(script);
    });
    data = window.LA_PALMA_DATA;
    translate();
  }
  if (!data) {
    $("loading").innerHTML =
      `<p>${t("dataFail")}</p><button class="secondary-button" id="retry-load">${t("retry")}</button>`;
    $("retry-load").onclick = () => location.reload();
    return;
  }
  try {
    const response=await fetch(`assets/${site}-future.json`,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error("Future baseline unavailable");
    const baseline=await response.json(),n=baseline.width*baseline.height;
    if(baseline.site!==site || baseline.crs!==data.crs || baseline.flags?.length!==n || baseline.treeFraction?.length!==n || !baseline.population?.["2025"])throw new Error("Invalid future baseline");
    futureBaseline=baseline;
    data.buildings["2025"]=baseline.buildings2025;
    $("year-2025").hidden=false;
    if(!params.has("year"))state.year=2025;
    state.future=futureDefaults(baseline);
    const requestedPolicy=params.get("f-policy");
    if(["compact","expansion","restoration"].includes(requestedPolicy))Object.assign(state.future,policySettings(requestedPolicy,baseline));
    for(const [,key,min,max] of futureInputs) {
      const value=params.get(`f-${key}`);
      if(value!==null && Number.isFinite(Number(value)))state.future[key]=clamp(Number(value),min,max);
    }
    for(const key of ["enabled","protectTrees","trees","mappedTreeTrend"])if(params.has(`f-${key}`))state.future[key]=params.get(`f-${key}`)==="1";
    if(["footprint","population"].includes(params.get("f-model")))state.future.model=params.get("f-model");
    if(params.has("f-seed"))state.future.seed=clamp(Number(params.get("f-seed"))||1,1,99);
    translate();
  } catch(error) {
    futureLoadFailed=true;
    if(state.year===2025)state.year=2021;
    console.warn("Future baseline unavailable:",error);
  }
  model = createModel(data);
  try {
    const saved = stored(storageKey);
    if (saved) state.proposals = parsePlan(JSON.parse(saved), model);
  } catch {
    /* Invalid or old plans are ignored without discarding the stored file. */
  }
  const aerial = await new Promise((resolve) => {
    const img = new Image();
    const timeout = setTimeout(() => resolve(null), 15000);
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    img.src = data.orthophoto;
  });
  images = surfaceImages(model, aerial);
  if (!aerial) {
    images.aerial = images.elevation;
    state.base = "elevation";
    toast(t("imageryFail"));
  }
  const contours = contourSegments(model),
    callbacks = {
      pick,
      hover,
      viewChange,
      contextLost: () => {
        terrainView = null;
        $$('[data-mode="3d"]')[0].disabled = true;
        setMode("map");
        toast(t("mapFallback"));
      },
    };
  mapView = new MapView($("map-canvas"), model, images, contours, callbacks);
  try {
    const { TerrainView } = await import("./terrain-view.js");
    terrainView = new TerrainView(
      $("terrain-canvas"),
      model,
      images,
      contours,
      callbacks,
    );
  } catch (error) {
    console.warn("3D view unavailable:", error);
    state.mode = "map";
    const button = $$('[data-mode="3d"]')[0];
    button.disabled = true;
    button.title = t("webglRequired");
    toast(t("mapFallback"));
  }
  ready = true;
  setMode(state.mode);
  terrainView?.reset();
  const requestedView = params.get("view")?.split(",").map(Number);
  if (requestedView) currentView()?.setView(requestedView);
  $("loading").hidden = true;
  refresh();
  if(state.future?.enabled)setTab("future");
  resize();
  new ResizeObserver(resize).observe($("scene-wrap"));
  let last = 0,
    lastRain = 0;
  function frame(now) {
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!document.hidden) {
      if (state.mode === "3d") terrainView?.tick(delta);
      else if (
        (state.rain && !reducedMotion && now - lastRain > 40) ||
        mapView.dirty
      ) {
        mapView.draw(now);
        lastRain = now;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
boot().catch((error) => {
  console.error(`${siteName} failed to initialize:`, error);
  $("loading").innerHTML =
    `<p>${t("dataFail")}</p><button class="secondary-button" id="retry-load">${t("retry")}</button>`;
  $("retry-load").onclick = () => location.reload();
});
