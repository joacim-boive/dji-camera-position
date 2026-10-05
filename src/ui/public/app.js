const token = window.FRAME_TOKEN;

const projectsEl = document.querySelector("#projects");
const clipsEl = document.querySelector("#clips");
const monitorEl = document.querySelector("#monitor");
const emptyEl = document.querySelector("#empty");
const form = document.querySelector("#view-form");
const deltaEl = document.querySelector("#delta");
const notesEl = document.querySelector("#notes");
const writeButton = document.querySelector("#write");
const matchSelect = document.querySelector("#match");
const levelEl = document.querySelector("#level");
const levelCaption = document.querySelector("#level-caption");
const presetsEl = document.querySelector("#presets");
const studioEl = document.querySelector("#studio");
const toastEl = document.querySelector("#toast");

const state = {
  projects: [],
  draft: null,
  clipIndex: 1,
  presets: [],
  studioRunning: false,
  preview: null,
};

const openPath = document.querySelector("#open-path");
const openSubmit = document.querySelector("#open-submit");
const openLabel = document.querySelector("#open-label");
const pickFolderButton = document.querySelector("#pick-folder");

document.querySelector("#open-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const path = new FormData(event.currentTarget).get("path");
  if (typeof path === "string" && path.trim().length > 0) {
    void openDraft(path.trim()).catch((error) => toast(error.message));
  }
});

pickFolderButton.addEventListener("click", () => {
  void pickFolder().catch((error) => toast(error.message));
});

form.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement) {
    event.target.dataset.touched = "1";
    delete event.target.dataset.scrolling;
  }
  paintLevel();
  schedulePreview();
});

form.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!viewKeys.includes(target.name)) return;
  armedField = target.name;
  paintLevel();
});

form.addEventListener("focusout", (event) => {
  if (drag) return;
  const next = event.relatedTarget;
  if (next instanceof HTMLInputElement && viewKeys.includes(next.name)) return;
  armedField = null;
  paintLevel();
});

levelEl.addEventListener("pointerdown", onLevelPointerDown);
levelEl.addEventListener("pointermove", onLevelPointerMove);
levelEl.addEventListener("pointerup", endLevelDrag);
levelEl.addEventListener("pointercancel", endLevelDrag);
levelEl.addEventListener("mousedown", (event) => {
  if (fieldFromFocus()) event.preventDefault();
});

form.addEventListener("wheel", onFieldWheel, { passive: false });

writeButton.addEventListener("click", () => {
  void writeView().catch((error) => {
    toast(error.message);
    paintWrite();
  });
});

matchSelect.addEventListener("change", () => {
  const clip = state.draft?.clips.find(
    (item) => item.index === Number(matchSelect.value),
  );
  if (clip) {
    fillForm(clip.view);
    schedulePreview();
  }
});

document.querySelector("#preset-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name");
  if (typeof name === "string" && name.trim().length > 0) {
    void savePreset(name.trim()).catch((error) => toast(error.message));
  }
});

void refreshStudio();
void loadProjects();
void loadPresets();
window.setInterval(() => {
  void refreshStudio();
}, 4000);

async function refreshStudio() {
  const body = await api("/api/studio");
  state.studioRunning = body.running === true;
  studioEl.textContent = state.studioRunning
    ? "DJI Studio is open. Quit it before writing."
    : "DJI Studio is quit. A write will keep a backup.";
  studioEl.className = state.studioRunning ? "studio running" : "studio clear";
  const canPick = body.pickFolder === true;
  openPath.hidden = canPick;
  openSubmit.hidden = canPick;
  pickFolderButton.hidden = !canPick;
  openLabel.htmlFor = canPick ? "pick-folder" : "open-path";
  paintWrite();
}

async function pickFolder() {
  const body = await api("/api/pick-folder", {});
  if (typeof body.path !== "string" || body.path.length === 0) {
    return;
  }
  await openDraft(body.path);
}

async function loadProjects() {
  const body = await api("/api/projects");
  state.projects = Array.isArray(body.projects) ? body.projects : [];
  paintProjects();
}

async function openDraft(path) {
  const draft = await api(`/api/draft?path=${encodeURIComponent(path)}`);
  state.draft = draft;
  state.clipIndex = draft.clips[0]?.index ?? 1;
  paintDraft();
}

async function loadPresets() {
  const body = await api("/api/presets");
  state.presets = Array.isArray(body.presets) ? body.presets : [];
  paintPresets();
}

async function preview() {
  if (!state.draft) {
    return;
  }
  const view = readForm();
  if (!view) {
    state.preview = null;
    paintPreview();
    return;
  }
  state.preview = await api("/api/preview", {
    path: state.draft.draftPath,
    clip: state.clipIndex,
    ...view,
  });
  paintPreview();
}

let previewTimer = 0;
function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    void preview().catch((error) => toast(error.message));
  }, 160);
}

async function writeView() {
  const view = readForm();
  if (!state.draft || !view) {
    return;
  }
  writeButton.disabled = true;
  const result = await api("/api/write", {
    path: state.draft.draftPath,
    clip: state.clipIndex,
    ...view,
  });
  state.draft = result.draft;
  toast(result.changed ? "Draft updated." : "Clip already has that view.");
  paintDraft();
  await loadProjects();
}

async function savePreset(name) {
  const view = readForm();
  if (!view) {
    toast("Enter the five view values first.");
    return;
  }
  const exists = state.presets.some((preset) => preset.name === name);
  if (exists && !window.confirm(`Replace preset ${name}?`)) {
    return;
  }
  await api("/api/presets", { name, force: exists, ...view });
  toast(exists ? `Replaced ${name}.` : `Saved ${name}.`);
  await loadPresets();
}

async function deletePreset(name) {
  await api("/api/presets", { name }, "DELETE");
  toast(`Deleted ${name}.`);
  await loadPresets();
}

function paintProjects() {
  projectsEl.replaceChildren();
  if (state.projects.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No draft.json projects in DJI Studio’s project folder.";
    projectsEl.append(item);
    return;
  }
  for (const project of state.projects) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>Project ${escapeHtml(project.id)}</strong><small>${project.error ? escapeHtml(project.error) : `${project.clipCount} ${project.clipCount === 1 ? "clip" : "clips"} · gen ${escapeHtml(project.generation)}`}</small>`;
    if (state.draft?.draftPath === project.draftPath) {
      button.setAttribute("aria-current", "true");
    }
    button.addEventListener("click", () => {
      void openDraft(project.projectPath).catch((error) =>
        toast(error.message),
      );
    });
    item.append(button);
    projectsEl.append(item);
  }
}

function paintDraft() {
  const draft = state.draft;
  if (!draft) {
    return;
  }
  emptyEl.hidden = true;
  monitorEl.hidden = false;
  document.querySelector("#project-label").textContent = draft.draftPath;
  const signature = document.querySelector("#signature");
  signature.textContent = draft.signatureMatches
    ? `crc32 ${draft.signature} matches`
    : `crc32 ${draft.signature || "missing"} does not match`;
  clipsEl.replaceChildren();
  matchSelect.replaceChildren();
  for (const clip of draft.clips) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.textContent = `Clip ${clip.index}`;
    button.title = clip.label;
    button.setAttribute(
      "aria-selected",
      String(clip.index === state.clipIndex),
    );
    button.addEventListener("click", () => {
      state.clipIndex = clip.index;
      fillForm(clip.view);
      paintDraft();
    });
    clipsEl.append(button);

    const option = document.createElement("option");
    option.value = String(clip.index);
    option.textContent = `Clip ${clip.index}`;
    matchSelect.append(option);
  }
  const current =
    draft.clips.find((clip) => clip.index === state.clipIndex) ??
    draft.clips[0];
  if (current) {
    state.clipIndex = current.index;
    fillForm(current.view);
    matchSelect.value = String(current.index);
  }
  paintProjects();
  schedulePreview();
}

function paintPreview() {
  deltaEl.replaceChildren();
  notesEl.replaceChildren();
  const preview = state.preview;
  if (!preview) {
    paintWrite();
    return;
  }
  for (const line of preview.lines ?? []) {
    const item = document.createElement("li");
    item.textContent = line;
    deltaEl.append(item);
  }
  for (const note of preview.notes ?? []) {
    const item = document.createElement("li");
    item.textContent = note;
    notesEl.append(item);
  }
  if ((preview.lines ?? []).length === 0) {
    const item = document.createElement("li");
    item.textContent = "Matches the draft.";
    deltaEl.append(item);
  }
  paintWrite();
}

function paintWrite() {
  const blocked =
    state.studioRunning || state.draft?.signatureMatches === false;
  const changed = state.preview?.changed === true;
  writeButton.disabled = blocked || !changed;
  writeButton.textContent = blocked
    ? "Write blocked"
    : changed
      ? `Write clip ${state.clipIndex}`
      : "Write to draft";
}

function paintLevel() {
  const view = readForm();
  if (!view) {
    return;
  }
  const tilt = Math.max(-50, Math.min(50, view.tilt));
  const markKey = armedField ?? "pan";
  levelEl.style.setProperty("--tilt", `${(-tilt / 50) * 28}px`);
  levelEl.style.setProperty("--roll", `${-view.roll}deg`);
  levelEl.style.setProperty(
    "--mark",
    `${markFraction(markKey, view[markKey]) * 100}%`,
  );
  const armed = armedField !== null;
  levelEl.classList.toggle("armed", armed);
  levelCaption.classList.toggle("armed", armed);
  levelCaption.textContent = armed
    ? `${fieldLabel[armedField]}${drag?.fine ? " · fine" : " · scroll for fine, side-scroll for big"}`
    : "Focus a field, then drag or scroll";
  for (const key of viewKeys) {
    form.elements[key]
      .closest("label")
      ?.classList.toggle("armed", key === armedField);
  }
  if (!armed) {
    levelEl.removeAttribute("role");
    levelEl.removeAttribute("aria-valuemin");
    levelEl.removeAttribute("aria-valuemax");
    levelEl.removeAttribute("aria-valuenow");
    levelEl.removeAttribute("aria-label");
    return;
  }
  const spec = fieldDrag[armedField];
  levelEl.setAttribute("role", "slider");
  levelEl.setAttribute("aria-label", fieldLabel[armedField]);
  levelEl.setAttribute("aria-valuemin", String(spec.min));
  levelEl.setAttribute("aria-valuemax", String(spec.max));
  levelEl.setAttribute("aria-valuenow", String(view[armedField]));
}

function onLevelPointerDown(event) {
  if (event.button !== 0) return;
  const key = fieldFromFocus();
  const view = readForm();
  if (!key || !view) {
    toast("Focus a field, then drag the bar.");
    return;
  }
  event.preventDefault();
  armedField = key;
  const width = levelEl.getBoundingClientRect().width;
  drag = {
    pointerId: event.pointerId,
    key,
    startX: event.clientX,
    startValue: view[key],
    travel: Math.max(1, width * fieldDrag[key].track),
    fine: event.shiftKey,
  };
  levelEl.setPointerCapture(event.pointerId);
  paintLevel();
}

function onLevelPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const spec = fieldDrag[drag.key];
  drag.fine = event.shiftKey;
  const scale = drag.fine ? 0.1 : 1;
  const delta =
    ((event.clientX - drag.startX) / drag.travel) * spec.span * scale;
  writeDraggedField(
    drag.key,
    clampDrag(drag.startValue, drag.startValue + delta, spec),
  );
}

function endLevelDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = null;
  if (levelEl.hasPointerCapture(event.pointerId)) {
    levelEl.releasePointerCapture(event.pointerId);
  }
  if (fieldFromFocus() !== armedField) armedField = fieldFromFocus();
  paintLevel();
}

function writeDraggedField(key, value) {
  const input = form.elements[key];
  input.dataset.touched = "1";
  input.dataset.exact = String(value);
  input.value = formatForInput(key, value);
  paintLevel();
  schedulePreview();
}

function onFieldWheel(event) {
  const input = fieldFromEventTarget(event.target);
  if (!input) return;
  event.preventDefault();
  const view = readForm();
  if (!view) return;
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  const raw = horizontal ? event.deltaX : -event.deltaY;
  if (raw === 0) return;
  input.focus();
  armedField = input.name;
  const spec = fieldDrag[input.name];
  const pixels =
    event.deltaMode === 1 ? raw * 48 : event.deltaMode === 2 ? raw * 240 : raw;
  const gain = horizontal ? spec.scroll : spec.nudge;
  const start = scrollStart(input, view[input.name]);
  const next = clampDrag(start, start + pixels * gain, spec);
  input.dataset.scrolling = String(next);
  writeDraggedField(input.name, next);
}

function scrollStart(input, fallback) {
  const scrolling = Number(input.dataset.scrolling);
  return Number.isFinite(scrolling) ? scrolling : fallback;
}

function fieldFromEventTarget(target) {
  if (!(target instanceof Element)) return null;
  const input =
    target instanceof HTMLInputElement
      ? target
      : target.closest("label")?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) return null;
  return viewKeys.includes(input.name) ? input : null;
}

function fieldFromFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement)) return null;
  return viewKeys.includes(active.name) ? active.name : null;
}

function markFraction(key, value) {
  const spec = fieldDrag[key];
  const ratio = (value - spec.min) / spec.span;
  const clamped = Math.min(1, Math.max(0, ratio));
  return spec.origin + clamped * spec.track;
}

function clampDrag(start, next, spec) {
  if (next >= spec.min && next <= spec.max) return next;
  if (next < spec.min)
    return start < spec.min ? Math.max(next, start) : spec.min;
  return start > spec.max ? Math.min(next, start) : spec.max;
}

const viewKeys = ["pan", "tilt", "roll", "fov", "correction"];

const fieldLabel = {
  pan: "Pan",
  tilt: "Tilt",
  roll: "Roll",
  fov: "FOV",
  correction: "Correction",
};

const fieldDrag = {
  pan: {
    min: -180,
    max: 180,
    span: 360,
    track: 0.72,
    origin: 0.14,
    scroll: 1.5,
    nudge: 0.02,
  },
  tilt: {
    min: -90,
    max: 90,
    span: 180,
    track: 0.84,
    origin: 0.08,
    scroll: 0.8,
    nudge: 0.02,
  },
  roll: {
    min: -180,
    max: 180,
    span: 360,
    track: 0.84,
    origin: 0.08,
    scroll: 1.5,
    nudge: 0.02,
  },
  fov: {
    min: 0,
    max: 180,
    span: 180,
    track: 0.84,
    origin: 0.08,
    scroll: 0.8,
    nudge: 0.02,
  },
  correction: {
    min: -1,
    max: 2,
    span: 3,
    track: 0.84,
    origin: 0.08,
    scroll: 0.015,
    nudge: 0.0005,
  },
};

let armedField = null;
let drag = null;

function paintPresets() {
  presetsEl.replaceChildren();
  if (state.presets.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No presets yet.";
    presetsEl.append(item);
    return;
  }
  for (const preset of state.presets) {
    const item = document.createElement("li");
    const view = preset.view;
    item.innerHTML = `<strong>${escapeHtml(preset.name)}</strong><p>P ${formatNumber(view.pan)} · T ${formatNumber(view.tilt)} · R ${formatNumber(view.roll)}<br>FOV ${formatNumber(view.fov)} · C ${formatNumber(view.correction)}</p>`;
    const actions = document.createElement("div");
    actions.className = "preset-actions";
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Load";
    load.addEventListener("click", () => {
      if (!state.draft) {
        toast("Open a project first.");
        return;
      }
      fillForm(view);
      schedulePreview();
      toast(`Loaded ${preset.name}. Write to store it on the clip.`);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      void deletePreset(preset.name).catch((error) => toast(error.message));
    });
    actions.append(load, remove);
    item.append(actions);
    presetsEl.append(item);
  }
}

function fillForm(view) {
  for (const key of viewKeys) {
    const input = form.elements[key];
    input.dataset.exact = String(view[key]);
    input.dataset.touched = "0";
    delete input.dataset.scrolling;
    input.value = formatForInput(key, view[key]);
  }
  paintLevel();
}

function readForm() {
  const view = {};
  for (const key of viewKeys) {
    const input = form.elements[key];
    const exact =
      input.dataset.touched === "0"
        ? Number(input.dataset.exact)
        : Number(input.value);
    if (!Number.isFinite(exact)) {
      return null;
    }
    view[key] = exact;
  }
  return view;
}

function formatForInput(key, value) {
  const places = key === "correction" ? 2 : 1;
  const rounded = Math.round(value * 10 ** places) / 10 ** places;
  return Object.is(rounded, -0) ? (0).toFixed(places) : rounded.toFixed(places);
}

async function api(path, body, method) {
  const response = await fetch(path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body
      ? { "content-type": "application/json", "x-frame-desk": token }
      : { "x-frame-desk": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function formatNumber(value) {
  return Number(value).toFixed(Math.abs(value) >= 10 ? 1 : 2);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[character] ?? character;
  });
}
