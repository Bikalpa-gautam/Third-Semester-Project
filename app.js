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
const storageKey = "el-uvito-plan-v1";
const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const params = new URLSearchParams(location.search);
let lang =
  (params.get("lang") || stored("el-uvito-language")) === "es" ? "es" : "en";
let t = translator(lang),
  model,
  mapView,
  terrainView,
  images,
  toastTimer,
  selectedTab = "explore",
  ready = false,
  metresPerPixel = 4;
const data = window.EL_UVITO_DATA;
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
if (["2010", "2019", "2021"].includes(params.get("year")))
  state.year = Number(params.get("year"));
if (["aerial", "elevation", "slope"].includes(params.get("base")))
  state.base = params.get("base");
if (params.get("mode") === "map") state.mode = "map";
if (params.has("layers")) {
  const keys = params.get("layers").split(",");
  for (const k of Object.keys(state.layers)) state.layers[k] = keys.includes(k);
}
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
function translate() {
  document.documentElement.lang = lang;
  t = translator(lang);
  $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
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
  $("building-count").textContent = data?.buildings[state.year]?.length ?? "—";
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
  const snapshot = { ...state, layers: { ...state.layers } };
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
      : `<span>${t("noHazard")}</span><br><span>${t("coverageNote")}</span>`;
    $("inspect-content").innerHTML =
      `<div class="inspect-values"><div><small>${t("elevation")}</small><strong>${fmt(p.elevation)}<em>m</em></strong></div><div><small>${t("slope")}</small><strong>${fmt(p.slope, 1)}<em>°</em></strong></div></div><div class="inspect-hazards">${hazards}</div><div class="inspect-coords">EPSG:9377 · E ${fmt(p.easting, 1)} · N ${fmt(p.northing, 1)}<br>${t("measuredGrid")}</div>`;
  } else if (s.kind === "measure") {
    if (state.measurePoints.length !== 2) return;
    const result = measurePoints(...state.measurePoints, model);
    $("inspect-eyebrow").textContent = t("measurement");
    $("inspect-title").textContent = t("measuredDistance");
    $("inspect-content").innerHTML =
      `<div class="inspect-values"><div><small>${t("horizontal")}</small><strong>${fmt(result.distance, 1)}<em>m</em></strong></div><div><small>${t("rise")}</small><strong>${result.rise > 0 ? "+" : ""}${fmt(result.rise, 1)}<em>m</em></strong></div></div><p class="small-note">${t("measureDetail")}</p>`;
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
  for (const name of ["explore", "scenarios", "plan"])
    $(`panel-${name}`).hidden = name !== tab;
  if (tab !== "plan" && Object.hasOwn(PROPOSALS, state.tool)) {
    state.tool = null;
    refresh();
  }
}
function resize() {
  state.mobilePanel = mobilePanel();
  const snapshot = { ...state, layers: { ...state.layers } };
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
    "el-uvito-plan.json",
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
  const tabs = ["explore", "scenarios", "plan"],
    i = tabs.indexOf(selectedTab);
  setTab(
    tabs[
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? 2
          : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3
    ],
    true,
  );
});
$("sidebar").addEventListener("change", (e) => {
  if (e.target.matches("[data-layer]")) {
    state.layers[e.target.dataset.layer] = e.target.checked;
    refresh();
  }
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
    ctx.fillText("El Uvito", 24, 39);
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
      state.mode === "3d" ? `${t("relief")}: ${state.relief}×` : "",
      state.rain || state.warmth ? t("scenarioCapture") : "",
      state.proposals.length ? t("annotationCapture") : "",
    ]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillText(details, 20, h + 104);
    output.toBlob((blob) => {
      if (blob) {
        download(blob, `el-uvito-${state.year}-${state.base}.png`);
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
  if (!data) {
    $("loading").innerHTML =
      `<p>${t("dataFail")}</p><button class="secondary-button" id="retry-load">${t("retry")}</button>`;
    $("retry-load").onclick = () => location.reload();
    return;
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
  } catch {
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
  console.error("El Uvito failed to initialize:", error);
  $("loading").innerHTML =
    `<p>${t("dataFail")}</p><button class="secondary-button" id="retry-load">${t("retry")}</button>`;
  $("retry-load").onclick = () => location.reload();
});
