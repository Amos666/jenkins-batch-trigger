/* ====================================================================
 * Jenkins Batch Trigger — webview script (CENTER PANEL ONLY).
 * The sidebar is the native VSCode tree. This webview renders the
 * toolbar + table + action bar + log + param/trigger modals.
 * The webview receives selectedNodes (TreeNode[]) from the sidebar
 * and provides batch trigger/abort/refresh actions.
 * ==================================================================== */

let __i18n = {};
function t(key, params) {
  let s = __i18n[key] || key;
  if (params) { for (const [k, v] of Object.entries(params)) { s = s.replace("{" + k + "}", String(v)); } }
  return s;
}
// Re-apply translations to static (server-rendered) elements. Elements opt in
// via data-i18n (textContent), data-i18n-title (title attr) or
// data-i18n-placeholder (placeholder attr). Called on locale change so baked-in
// HTML text updates immediately without resetting webview state.
function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
}

const vscode = acquireVsCodeApi();
let _rid = 0;
const _pending = new Map();
function rpc(type, data) {
  const id = ++_rid;
  return new Promise((resolve) => {
    _pending.set(id, resolve);
    vscode.postMessage({ type, id, data });
  });
}
function fire(type, data) { vscode.postMessage({ type, data }); }
window.addEventListener("message", (e) => {
  const m = e.data;
  if (m && m.id && _pending.has(m.id)) {
    const fn = _pending.get(m.id);
    _pending.delete(m.id);
    fn(m.data);
  } else if (m && m.type === "state") {
    applySnapshot(m.data);
  } else if (m && m.type === "log") {
    // Network request/response log from JenkinsClient.
    logMsg(m.msg, "info");
  } else if (m && m.type === "locale") {
    __i18n = m.messages || {};
    applyStaticI18n();
    syncLogToggleLabel();
    render();
    renderParamTpl();
    renderParamBtn();
  } else if (m && m.type === "openConfig") {
    // Connection config is now handled by the sidebar settings button.
  }
});

const STATUS_KEY = { running:"webview.status.running", success:"webview.status.success", failed:"webview.status.failed", unstable:"webview.status.unstable", aborted:"webview.status.aborted", idle:"webview.status.idle", unknown:"webview.status.unknown" };
const BADGE = { running:"b-running", success:"b-success", failed:"b-failed", unstable:"b-unstable", aborted:"b-aborted", idle:"b-idle", unknown:"b-idle" };

/* ============ 状态 ============ */
let STATE = { selectedNodes: [], paramTemplates: [], preEnabledPipelines: [], postEnabledPipelines: [] };
let search = "";
let statusFilter = "all";
let params = [];
let activeParamTpl = null;
// Webview-layer selection: which of the sidebar-selected jobs the user wants
// to actually trigger. New jobs coming in from the sidebar are auto-checked.
let webviewChecked = new Set();
let prevSelectedIds = new Set();
// Per-job parameters: maps nodeId → { params: [[k,v],...], expanded: bool }.
// When a job has per-job params, they take priority over the global batch params.
let jobParamMap = new Map();
// Track which job's param editor is currently expanded.
let expandedParamJobId = null;
// Pipeline column display level: 0=job name only, 1=parent/job, 2=grandparent/parent/job
let pipelineDisplayLevel = 0;
// Whether the Pipeline column width is still auto-sized (false once user drags it).
let pipelineColAuto = true;
// Timeout watchdog: tracks which jobs have timeout monitoring enabled.
let timeoutWatchSet = new Set();
let timeoutMinutes = 10;
let timeoutStartTimeMap = new Map(); // nodeId -> Date.now() when first seen running
let timeoutTimer = null;

function applySnapshot(s) {
  if (!s) return;
  if (s.selectedNodes) {
    const newIds = new Set(s.selectedNodes.map((d) => d.id));
    // Auto-check any job that wasn't in the previous sidebar selection.
    for (const id of newIds) {
      if (!prevSelectedIds.has(id)) webviewChecked.add(id);
    }
    // Remove jobs that are no longer in the sidebar selection.
    for (const id of webviewChecked) {
      if (!newIds.has(id)) webviewChecked.delete(id);
    }
    // Clean up per-job params for removed jobs.
    for (const id of [...jobParamMap.keys()]) {
      if (!newIds.has(id)) jobParamMap.delete(id);
    }
    // Clean up timeout watch for removed jobs.
    for (const id of [...timeoutWatchSet]) {
      if (!newIds.has(id)) { timeoutWatchSet.delete(id); timeoutStartTimeMap.delete(id); }
    }
    if (expandedParamJobId && !newIds.has(expandedParamJobId)) expandedParamJobId = null;
    prevSelectedIds = newIds;
    STATE.selectedNodes = s.selectedNodes;
  }
  if (s.paramTemplates) STATE.paramTemplates = s.paramTemplates;
  if (s.preEnabledPipelines) STATE.preEnabledPipelines = s.preEnabledPipelines;
  if (s.postEnabledPipelines) STATE.postEnabledPipelines = s.postEnabledPipelines;
  render();
  renderParamTpl();
}

/* ============ 工具 ============ */
function jobBuildUrl(d) {
  if (d.jobUrl && d.buildNumber) return d.jobUrl.replace(/\/+$/, "") + "/" + d.buildNumber + "/";
  return d.jobUrl || "#";
}
function jobConsoleUrl(d) {
  if (d.jobUrl && d.buildNumber) return d.jobUrl.replace(/\/+$/, "") + "/" + d.buildNumber + "/console";
  if (d.jobUrl) return d.jobUrl.replace(/\/+$/, "") + "/console";
  return "#";
}
// Escape HTML special chars so textarea content set via innerHTML is not misparsed.
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}
function logMsg(msg, type) {
  const p = document.getElementById("logPanel");
  const d = document.createElement("div");
  d.className = type || "";
  d.textContent = "• " + new Date().toLocaleTimeString() + "  " + msg;
  p.appendChild(d); p.scrollTop = p.scrollHeight;
}
// Get pipeline display label based on current display level.
// Level 0: job name only
// Level 1: parent/job
// Level 2: grandparent/parent/job
function getPipelineDisplayLabel(d) {
  if (pipelineDisplayLevel === 0) {
    return d.name;
  }
  // Extract path segments from jobPath or folder
  const fullPath = d.jobPath || d.name;
  const parts = fullPath.split("/");
  if (parts.length === 1) {
    return d.name; // No parent info available
  }
  if (pipelineDisplayLevel === 1) {
    // Show immediate parent + job name
    return parts.length >= 2 ? parts.slice(-2).join("/") : d.name;
  }
  // Level 2: show up to 2 ancestors + job name
  return parts.length >= 3 ? parts.slice(-3).join("/") : fullPath;
}

/* ============ Pipeline 列自适应宽度 ============ */
const _measureCtx = document.createElement("canvas").getContext("2d");
// Auto-size the Pipeline column to fit the longest visible job label.
// Skipped once the user has manually dragged the column resizer.
function autoSizePipelineColumn() {
  if (!pipelineColAuto) return;
  const th = document.getElementById("thPipeline");
  if (!th) return;
  const list = visibleData();
  if (list.length === 0) return;
  // Match the font used by the .name cells for accurate measurement.
  const sample = document.querySelector("#tbody .name");
  if (sample) {
    const cs = getComputedStyle(sample);
    _measureCtx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
  }
  let maxW = 60;
  for (const d of list) {
    const w = _measureCtx.measureText(getPipelineDisplayLabel(d)).width;
    if (w > maxW) maxW = w;
  }
  // Cap so the column never swallows the whole table.
  const cap = Math.floor((document.querySelector(".tablewrap") || { clientWidth: 800 }).clientWidth * 0.45);
  th.style.width = Math.min(Math.ceil(maxW + 30), cap) + "px";
}

/* ============ 渲染表格 ============ */
function visibleData() {
  let list = STATE.selectedNodes.slice();
  const q = search.toLowerCase();
  list = list.filter((d) => d.name.toLowerCase().includes(q) && (statusFilter === "all" || d.status === statusFilter));
  return list;
}
// Jobs that are both visible (pass search/filter) and checked in the webview.
// Batch trigger/abort only operate on these.
function checkedVisibleData() {
  return visibleData().filter((d) => webviewChecked.has(d.id));
}
function render() {
  const list = visibleData();
  const tbody = document.getElementById("tbody");
  // Preserve unsaved textarea content and cursor position for the expanded editor.
  let unsavedParamText = null;
  let unsavedCursor = null;
  if (expandedParamJobId) {
    const oldTa = document.querySelector('.job-param-textarea[data-jobid="' + expandedParamJobId + '"]');
    if (oldTa) {
      unsavedParamText = oldTa.value;
      unsavedCursor = { start: oldTa.selectionStart, end: oldTa.selectionEnd };
    }
  }
  tbody.innerHTML = "";
  const es = document.getElementById("emptyState");
  if (list.length) { es.style.display = "none"; }
  else {
    es.style.display = "block";
    es.textContent = STATE.selectedNodes.length === 0
      ? t("webview.emptyNoSelection")
      : t("webview.emptyNoMatch");
  }
  list.forEach((d) => {
    const tr = document.createElement("tr");
    tr.className = webviewChecked.has(d.id) ? "sel" : "";
    const st = d.status || "unknown";
    const checkedAttr = webviewChecked.has(d.id) ? "checked" : "";
    const preChecked = STATE.preEnabledPipelines.includes(d.jobPath || d.name) ? "checked" : "";
    const postChecked = STATE.postEnabledPipelines.includes(d.jobPath || d.name) ? "checked" : "";
    const timeoutChecked = timeoutWatchSet.has(d.id) ? "checked" : "";
    const hasJobParams = jobParamMap.has(d.id);
    const globalParams = getTriggerParams();
    const hasGlobalParams = globalParams && globalParams.some((p) => p[0] !== "");
    let paramClass = "link param-btn";
    let paramLabel = t("webview.paramBtn");
    if (hasJobParams) {
      paramClass = "link param-btn has-job-params";
      paramLabel = t("webview.paramBtnSet");
    } else if (hasGlobalParams) {
      paramClass = "link param-btn has-params";
      paramLabel = t("webview.paramBtnSet");
    }
    tr.innerHTML =
      `<td class="col-check"><input type="checkbox" class="rowchk" data-id="${d.id}" ${checkedAttr}></td>` +
      `<td><div class="name" title="${d.jobPath || d.name}">${getPipelineDisplayLabel(d)}</div><div class="sub"><span class="folder-tag">${d.folder || d.jobPath || ""}</span></div></td>` +
      `<td><span class="badge ${BADGE[st] || "b-idle"}"><span class="sw"></span>${t(STATUS_KEY[st] || "webview.status.unknown")}</span></td>` +
      `<td>${d.queue > 0 ? `<span class="qbadge" title="${t("webview.queueTitle", {n: d.queue})}">${t("webview.queueBadge", {n: d.queue})}</span>` : '<span style="color:var(--text-faint)">—</span>'}</td>` +
      `<td>${d.dur || "—"}</td><td>${d.time || "—"}</td>` +
      `<td><span class="link build-link" data-url="${jobBuildUrl(d)}" title="${jobBuildUrl(d)}">${d.build || "—"} ↗</span></td>` +
      `<td><span class="${paramClass}" data-param="${d.id}" title="${t("webview.editParamTitle")}">${paramLabel}</span></td>` +
      `<td class="col-check"><input type="checkbox" class="tmchk" data-id="${d.id}" ${timeoutChecked}></td>` +
      `<td class="col-check"><input type="checkbox" class="prechk" data-jobpath="${d.jobPath || d.name}" ${preChecked}></td>` +
      `<td class="col-check"><input type="checkbox" class="postchk" data-jobpath="${d.jobPath || d.name}" ${postChecked}></td>` +
      `<td><span class="link" data-run="${d.id}">${t("webview.trigger")}</span> · <span class="link" data-log="${d.id}">${t("webview.log")}</span>${st === "running" ? ` · <span class="link warn" data-abort="${d.id}">${t("webview.abort")}</span>` : ""}</td>`;
    tbody.appendChild(tr);

    // Collapsible per-job parameter editor row.
    const paramTr = document.createElement("tr");
    paramTr.className = "param-row" + (expandedParamJobId === d.id ? " show" : "");
    paramTr.dataset.paramRow = d.id;
    const jobP = jobParamMap.get(d.id);
    // Use unsaved text if this is the expanded editor and text was preserved.
    let paramText;
    if (expandedParamJobId === d.id && unsavedParamText !== null) {
      paramText = unsavedParamText;
    } else {
      // Show effective params: per-job params if set, otherwise global batch params.
      // This lets users see the real trigger params for this job at a glance.
      const eff = getEffectiveParams(d.id);
      paramText = (eff && Object.keys(eff).length > 0) ? JSON.stringify(eff, null, 2) : "";
    }
    // Escape HTML special chars so textarea content is not misparsed by the HTML parser.
    const paramTextEscaped = escapeHtml(paramText);
    paramTr.innerHTML =
      `<td colspan="12"><div class="job-param-box">` +
      `<textarea class="job-param-textarea" data-jobid="${d.id}" spellcheck="false" placeholder='${t("webview.paramPlaceholder")}'>${paramTextEscaped}</textarea>` +
      `<div class="job-param-actions">` +
      `<button class="btn sm" data-paramsave="${d.id}">${t("webview.save")}</button>` +
      `<button class="btn sm" data-paramclear="${d.id}">${t("webview.clear")}</button>` +
      `</div></div>` +
      `<div class="job-param-status" data-jobid="${d.id}">${hasJobParams ? t("webview.paramSet") : (paramText ? t("webview.paramInherited") : "")}</div>` +
      `</td>`;
    tbody.appendChild(paramTr);
  });
  // Restore focus and cursor position for the expanded editor after re-render.
  if (expandedParamJobId && unsavedParamText !== null) {
    const newTa = document.querySelector('.job-param-textarea[data-jobid="' + expandedParamJobId + '"]');
    if (newTa) {
      newTa.focus();
      if (unsavedCursor) {
        try {
          newTa.setSelectionRange(unsavedCursor.start, unsavedCursor.end);
        } catch (e) { /* setSelectionRange may fail in some cases */ }
      }
    }
  }
  // Sync the header checkAll state.
  const checkAll = document.getElementById("checkAll");
  if (list.length > 0 && list.every((d) => webviewChecked.has(d.id))) {
    checkAll.checked = true;
  } else if (list.length > 0 && list.every((d) => !webviewChecked.has(d.id))) {
    checkAll.checked = false;
  } else {
    checkAll.checked = false;
  }
  const checkedList = checkedVisibleData();
  document.getElementById("totalCount").textContent = list.length;
  document.getElementById("selCount").textContent = checkedList.length;
  renderParamBtn();
  const runSel = checkedList.filter((d) => d.status === "running").length;
  const ab = document.getElementById("btnAbort");
  ab.disabled = runSel === 0;
  ab.title = runSel > 0 ? t("webview.abortTitle2", {n: runSel}) : t("webview.abortNoneTitle");
  autoSizePipelineColumn();
}

/* ============ Per-job 参数（优先于批量参数） ============ */
function saveJobParam(jobId) {
  const ta = document.querySelector('.job-param-textarea[data-jobid="' + jobId + '"]');
  if (!ta) return;
  const txt = ta.value.trim();
  const statusEl = document.querySelector('.job-param-status[data-jobid="' + jobId + '"]');
  if (txt === "") {
    jobParamMap.delete(jobId);
    if (statusEl) { statusEl.textContent = ""; statusEl.className = "job-param-status"; }
    ta.classList.remove("err");
    toast(t("webview.paramCleared"));
    render();
    return;
  }
  let obj;
  try { obj = JSON.parse(txt); } catch (e) {
    if (statusEl) { statusEl.textContent = t("webview.paramInvalid", {error: e.message}); statusEl.className = "job-param-status err"; }
    ta.classList.add("err");
    return;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    if (statusEl) { statusEl.textContent = t("webview.paramNotObj"); statusEl.className = "job-param-status err"; }
    ta.classList.add("err");
    return;
  }
  jobParamMap.set(jobId, obj);
  if (statusEl) { statusEl.textContent = t("webview.paramSaved"); statusEl.className = "job-param-status ok"; }
  ta.classList.remove("err");
  toast(t("webview.paramSavedToast"));
  // Collapse the editor after successful save.
  expandedParamJobId = null;
  render();
}
function clearJobParam(jobId) {
  jobParamMap.delete(jobId);
  // Collapse the editor after clear.
  expandedParamJobId = null;
  toast(t("webview.paramCleared"));
  render();
}
// Get effective params for a job: per-job params if set, otherwise global params.
function getEffectiveParams(jobId) {
  if (jobParamMap.has(jobId)) return jobParamMap.get(jobId);
  const tp = getTriggerParams();
  if (tp === null) return null;
  const obj = {};
  tp.forEach((p) => { if (p[0] !== "") obj[p[0]] = p[1]; });
  return obj;
}

/* ============ 参数按钮 + JSON 编辑器 ============ */
function renderParamBtn() {
  document.getElementById("paramCount").textContent = params.length;
  const lbl = document.getElementById("paramTplLabel");
  if (activeParamTpl) lbl.textContent = activeParamTpl;
  else lbl.textContent = params.length ? t("webview.custom") : t("webview.noTplApplied");
}
function paramsToObj() { const o = {}; params.forEach((p) => { if (p[0] !== "") o[p[0]] = p[1]; }); return o; }
function objToParams(o) { return Object.keys(o || {}).map((k) => [k, String(o[k])]); }
function setPjStatus(ok, msg) {
  const s = document.getElementById("pjStatus"), ta = document.getElementById("paramJson");
  if (!s) return;
  if (ok) { s.textContent = t("webview.jsonValid"); s.className = "pj-status ok"; if (ta) ta.classList.remove("err"); }
  else { s.textContent = "✕ " + (msg || t("webview.jsonInvalidShort")); s.className = "pj-status err"; if (ta) ta.classList.add("err"); }
}
function syncJsonFromParams() {
  const ta = document.getElementById("paramJson"); if (!ta) return;
  ta.value = JSON.stringify(paramsToObj(), null, 2); setPjStatus(true);
}
function syncParamsFromJson() {
  const ta = document.getElementById("paramJson"); if (!ta) return;
  const txt = ta.value.trim();
  if (txt === "") { params = []; setPjStatus(true); renderKv(); renderParamBtn(); return; }
  let obj; try { obj = JSON.parse(txt); } catch (e) { setPjStatus(false, e.message); return; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) { setPjStatus(false, t("webview.jsonNotObjShort")); return; }
  params = objToParams(obj); setPjStatus(true); renderKv(); renderParamBtn();
}
function onParamsChanged() { syncJsonFromParams(); renderParamBtn(); }
function getTriggerParams() {
  const ta = document.getElementById("paramJson");
  if (!ta) return params.slice();
  const txt = ta.value.trim();
  if (txt === "") return [];
  try { const o = JSON.parse(txt); if (o && typeof o === "object" && !Array.isArray(o)) return Object.keys(o).map((k) => [k, String(o[k])]); }
  catch (e) { return null; }
  return params.slice();
}
function renderKv() {
  const box = document.getElementById("kvList");
  box.innerHTML = params.length ? "" : '<div class="hint">' + t("webview.noParams") + '</div>';
  params.forEach((p, i) => {
    const row = document.createElement("div"); row.className = "kv-row";
    row.innerHTML = `<input class="k" value="${p[0]}" placeholder="KEY"><input value="${p[1]}" placeholder="VALUE"><span class="del">✕</span>`;
    row.querySelector(".k").oninput = (e) => { params[i][0] = e.target.value; activeParamTpl = null; onParamsChanged(); };
    row.querySelectorAll("input")[1].oninput = (e) => { params[i][1] = e.target.value; activeParamTpl = null; onParamsChanged(); };
    row.querySelector(".del").onclick = () => { params.splice(i, 1); activeParamTpl = null; renderKv(); onParamsChanged(); };
    box.appendChild(row);
  });
}
function renderParamTpl() {
  const box = document.getElementById("paramTplList");
  if (!box) return;
  box.innerHTML = STATE.paramTemplates.length ? "" : '<span class="hint" style="margin:0">' + t("webview.noTemplates") + '</span>';
  STATE.paramTemplates.forEach((tpl) => {
    const c = document.createElement("span");
    const isDefault = tpl.id === 0;
    const isActive = tpl.name === activeParamTpl;
    c.className = "chip" + (isDefault ? " default" : "") + (isActive ? " on" : "");
    c.innerHTML = tpl.name
      + (isDefault ? ' <span class="save-def" data-ptsave="0" title="' + t("webview.tplSaveDefTitle") + '">↻</span>' : ' <span class="del" data-ptdel="' + tpl.id + '">✕</span>');
    c.onclick = (e) => {
      // Overwrite Default template with current params.
      if (e.target.dataset.ptsave !== undefined) {
        e.stopPropagation();
        if (params.length === 0) { toast(t("webview.noParamsConfig")); return; }
        rpc("overwriteDefaultTpl", { params: params.map((p) => p.slice()) }).then((r) => {
          if (r && r.paramTemplates) { STATE.paramTemplates = r.paramTemplates; renderParamTpl(); }
          activeParamTpl = tpl.name; onParamsChanged(); renderParamBtn();
          toast(t("webview.tplOverwriteDefault"));
        });
        return;
      }
      // Delete template (non-default only).
      if (e.target.dataset.ptdel) {
        e.stopPropagation();
        rpc("deleteParamTpl", { id: +e.target.dataset.ptdel }).then((r) => {
          if (r && r.paramTemplates) { STATE.paramTemplates = r.paramTemplates; renderParamTpl(); }
        });
        return;
      }
      // Apply template: load its params and mark as active.
      params = tpl.params.map((p) => p.slice()); renderKv();
      activeParamTpl = tpl.name; onParamsChanged(); renderParamTpl(); toast(t("webview.tplApplied", {name: tpl.name}));
      rpc("saveActiveTpl", { name: tpl.name });
    };
    box.appendChild(c);
  });
}

/* ============ 工具栏事件 ============ */
document.getElementById("searchInput").addEventListener("input", (e) => { search = e.target.value; render(); });
document.getElementById("statusChips").addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (!c) return;
  document.querySelectorAll("#statusChips .chip").forEach((x) => x.classList.remove("on"));
  c.classList.add("on"); statusFilter = c.dataset.st; render();
});
// Per-row checkbox: toggle webview-layer selection.
document.getElementById("tbody").addEventListener("change", (e) => {
  if (e.target.classList.contains("rowchk")) {
    const id = e.target.dataset.id;
    if (e.target.checked) webviewChecked.add(id);
    else webviewChecked.delete(id);
    render();
  }
  if (e.target.classList.contains("prechk")) {
    const jobPath = e.target.dataset.jobpath;
    rpc("togglePre", { jobPath }).then((r) => { if (r) applySnapshot(r); });
  }
  if (e.target.classList.contains("postchk")) {
    const jobPath = e.target.dataset.jobpath;
    rpc("togglePost", { jobPath }).then((r) => { if (r) applySnapshot(r); });
  }
  if (e.target.classList.contains("tmchk")) {
    const id = e.target.dataset.id;
    if (e.target.checked) timeoutWatchSet.add(id);
    else { timeoutWatchSet.delete(id); timeoutStartTimeMap.delete(id); }
    ensureTimeoutTimer();
  }
});
// Header checkAll: check/uncheck all visible rows.
document.getElementById("checkAll").addEventListener("change", (e) => {
  const list = visibleData();
  if (e.target.checked) {
    list.forEach((d) => webviewChecked.add(d.id));
  } else {
    list.forEach((d) => webviewChecked.delete(d.id));
  }
  render();
});
// Header thPre: double-click to toggle PRE actions for all visible rows.
document.getElementById("thPre").addEventListener("dblclick", () => {
  const list = visibleData();
  const jobPaths = list.map((d) => d.jobPath || d.name);
  const allEnabled = list.length > 0 && list.every((d) => STATE.preEnabledPipelines.includes(d.jobPath || d.name));
  rpc("setPreBatch", { jobPaths, enabled: !allEnabled }).then((r) => { if (r) applySnapshot(r); });
});
// Header thPost: double-click to toggle POST actions for all visible rows.
document.getElementById("thPost").addEventListener("dblclick", () => {
  const list = visibleData();
  const jobPaths = list.map((d) => d.jobPath || d.name);
  const allEnabled = list.length > 0 && list.every((d) => STATE.postEnabledPipelines.includes(d.jobPath || d.name));
  rpc("setPostBatch", { jobPaths, enabled: !allEnabled }).then((r) => { if (r) applySnapshot(r); });
});
// Header thTimeout: double-click to toggle timeout watch for all visible rows.
document.getElementById("thTimeout").addEventListener("dblclick", () => {
  const list = visibleData();
  const allOn = list.length > 0 && list.every((d) => timeoutWatchSet.has(d.id));
  list.forEach((d) => {
    if (allOn) { timeoutWatchSet.delete(d.id); timeoutStartTimeMap.delete(d.id); }
    else timeoutWatchSet.add(d.id);
  });
  ensureTimeoutTimer();
  render();
});
// Pipeline column header: double-click to cycle display level (0=job, 1=parent/job, 2=grandparent/parent/job)
document.getElementById("thPipeline").addEventListener("dblclick", () => {
  pipelineDisplayLevel = (pipelineDisplayLevel + 1) % 3;
  const levelNames = [t("webview.levelName"), t("webview.levelParent"), t("webview.levelGrand")];
  toast(t("webview.pipelineDisplay", {level: levelNames[pipelineDisplayLevel]}));
  render();
});
document.getElementById("tbody").addEventListener("click", (e) => {
  if (e.target.dataset.run) triggerOne(e.target.dataset.run);
  if (e.target.dataset.abort) abortOne(e.target.dataset.abort);
  if (e.target.dataset.log) {
    const d = STATE.selectedNodes.find((x) => x.id === e.target.dataset.log);
    fire("openBuild", { url: d ? jobConsoleUrl(d) : "#" }); logMsg(t("webview.openConsoleLog", {name: d ? d.name : ""}), "info");
  }
  if (e.target.dataset.url) { fire("openBuild", { url: e.target.dataset.url }); logMsg(t("webview.openBrowserLog", {url: e.target.dataset.url}), "info"); }
  // Per-job param button: toggle inline editor.
  if (e.target.dataset.param) {
    const jobId = e.target.dataset.param;
    expandedParamJobId = (expandedParamJobId === jobId) ? null : jobId;
    render();
  }
  // Save per-job params.
  if (e.target.dataset.paramsave) {
    saveJobParam(e.target.dataset.paramsave);
  }
  // Clear per-job params.
  if (e.target.dataset.paramclear) {
    clearJobParam(e.target.dataset.paramclear);
  }
});
document.getElementById("btnExportLog").onclick = () => {
  const lines = Array.from(document.getElementById("logPanel").children).map((d) => d.textContent);
  if (lines.length === 0) {
    toast(t("webview.logEmpty"));
    return;
  }
  fire("exportLog", { text: lines.join("\n") });
  toast(t("webview.logExported"));
};
document.getElementById("btnClearLog").onclick = () => {
  document.getElementById("logPanel").innerHTML = "";
  toast(t("webview.logCleared"));
};
document.getElementById("btnActionsConfig").onclick = () => {
  fire("openActionsConfig");
};

/* ============ 超时看守 ============ */
document.getElementById("btnTimeout").onclick = () => {
  document.getElementById("timeoutInput").value = String(timeoutMinutes);
  document.getElementById("timeoutOverlay").classList.add("show");
  setTimeout(() => document.getElementById("timeoutInput").focus(), 50);
};
document.getElementById("btnTimeoutCancel").onclick = () => document.getElementById("timeoutOverlay").classList.remove("show");
document.getElementById("btnTimeoutSave").onclick = () => {
  const v = parseInt(document.getElementById("timeoutInput").value, 10);
  if (!v || v <= 0) { toast(t("webview.timeoutInvalid")); return; }
  timeoutMinutes = v;
  document.getElementById("timeoutVal").textContent = v;
  document.getElementById("timeoutOverlay").classList.remove("show");
  toast(t("webview.timeoutSet", {n: v}));
  ensureTimeoutTimer();
};
// Watchdog timer: runs every 10s while any job has timeout watch enabled.
function ensureTimeoutTimer() {
  if (timeoutTimer) { clearInterval(timeoutTimer); timeoutTimer = null; }
  if (timeoutWatchSet.size > 0) {
    timeoutTimer = setInterval(checkTimeouts, 10000);
  }
}
let timeoutCheckRunning = false;
async function checkTimeouts() {
  // Skip if the previous tick is still in flight (slow refresh/abort), so ticks
  // never overlap and double-abort.
  if (timeoutCheckRunning) return;
  timeoutCheckRunning = true;
  try {
    // Refresh first so timeout decisions use accurate, up-to-date status.
    // Without this, stale local status (e.g. auto-refresh off) hides running
    // jobs and the watchdog never aborts them.
    const fresh = await rpc("refresh", { mode: "nonTerminal" });
    if (fresh) applySnapshot(fresh);
    const now = Date.now();
    const limit = timeoutMinutes * 60 * 1000;
    const toAbort = [];
    for (const d of STATE.selectedNodes) {
      if (!timeoutWatchSet.has(d.id)) { timeoutStartTimeMap.delete(d.id); continue; }
      if (d.status === "running") {
        if (!timeoutStartTimeMap.has(d.id)) timeoutStartTimeMap.set(d.id, now);
        if (now - timeoutStartTimeMap.get(d.id) >= limit) toAbort.push(d);
      } else {
        timeoutStartTimeMap.delete(d.id);
      }
    }
    if (toAbort.length === 0) return;
    const nodeIds = toAbort.map((d) => d.id);
    logMsg(t("webview.timeoutAborting", {count: nodeIds.length, n: timeoutMinutes}), "warn");
    const r = await rpc("abort", { nodeIds });
    if (r) applySnapshot(r);
    toAbort.forEach((d) => {
      timeoutStartTimeMap.delete(d.id);
      logMsg(t("webview.timeoutAborted", {name: d.name}), "warn");
    });
  } finally {
    timeoutCheckRunning = false;
  }
}

/* ============ 参数弹窗 ============ */
document.getElementById("btnParams").onclick = () => {
  renderKv(); renderParamTpl(); syncJsonFromParams();
  document.getElementById("paramOverlay").classList.add("show");
};
document.getElementById("btnParamCancel").onclick = () => document.getElementById("paramOverlay").classList.remove("show");
document.getElementById("btnAddKv").onclick = () => { params.push(["", ""]); activeParamTpl = null; renderKv(); onParamsChanged(); };

document.getElementById("paramJson").addEventListener("input", syncParamsFromJson);
document.getElementById("btnSaveParamTpl").onclick = () => {
  if (params.length === 0) { toast(t("webview.noParamsConfig")); return; }
  document.getElementById("paramTplSummary").innerHTML = t("webview.tplSummary", {count: params.length}) + "<br>" + params.map((p) => p[0] + "=" + p[1]).join("，");
  document.getElementById("paramTplName").value = "";
  document.getElementById("paramTplOverlay").classList.add("show");
  setTimeout(() => document.getElementById("paramTplName").focus(), 50);
};
document.getElementById("btnParamTplCancel").onclick = () => document.getElementById("paramTplOverlay").classList.remove("show");
document.getElementById("btnParamTplSave").onclick = () => {
  const name = document.getElementById("paramTplName").value.trim();
  if (!name) { toast(t("webview.tplNameRequired")); return; }
  rpc("saveParamTpl", { name, params: params.map((p) => p.slice()) }).then((r) => {
    if (r && r.paramTemplates) { STATE.paramTemplates = r.paramTemplates; renderParamTpl(); }
    document.getElementById("paramTplOverlay").classList.remove("show");
    activeParamTpl = name; renderParamBtn();
    toast(t("webview.tplSaved", {name})); logMsg(t("webview.tplCreated", {name}), "ok");
    rpc("saveActiveTpl", { name });
  });
};
document.getElementById("btnParamSave").onclick = () => {
  if (getTriggerParams() === null) { toast(t("webview.paramJsonInvalid")); return; }
  document.getElementById("paramOverlay").classList.remove("show");
  toast(t("webview.paramsSaved", {count: params.length})); renderParamBtn();
};

/* ============ 触发（先预览真实参数，再确认） ============ */
document.getElementById("btnTrigger").onclick = showTriggerPreview;
function showTriggerPreview() {
  const list = checkedVisibleData();
  if (list.length === 0) { toast(t("webview.noPipelineSelected")); return; }
  const tp = getTriggerParams();
  if (tp === null) { toast(t("webview.paramJsonInvalidFix")); return; }
  const names = list.map((d) => d.jobPath || d.name);
  const paramLines = tp.length ? tp.map((p) => p[0] + "=" + p[1]).join("\n") : t("webview.noParams2");
  // Build per-job params preview.
  const customJobs = list.filter((d) => jobParamMap.has(d.id));
  const customLines = customJobs.length
    ? customJobs.map((d) => "  • " + (d.jobPath || d.name) + ": " + JSON.stringify(jobParamMap.get(d.id))).join("\n")
    : t("webview.none");
  document.getElementById("triggerPreviewText").value =
`${t("webview.previewHeader", {count: list.length})}
================================

${t("webview.previewCommon")}
${paramLines}

${t("webview.previewCustom", {count: customJobs.length})}
${customLines}

${t("webview.previewTarget", {count: names.length})}
${names.map((n) => "  • " + n).join("\n")}

${t("webview.previewFooter")}`;
  document.getElementById("triggerOverlay").classList.add("show");
}
document.getElementById("btnTriggerCancel").onclick = () => document.getElementById("triggerOverlay").classList.remove("show");
document.getElementById("btnTriggerConfirm").onclick = async () => {
  document.getElementById("triggerOverlay").classList.remove("show");
  await doTrigger();
};
// Force a one-shot refresh 10s after any trigger, regardless of auto-refresh.
let forceRefreshTimer = null;
function scheduleForceRefresh() {
  if (forceRefreshTimer) clearTimeout(forceRefreshTimer);
  forceRefreshTimer = setTimeout(async () => {
    forceRefreshTimer = null;
    const r = await rpc("refresh", { mode: "all" });
    if (r) applySnapshot(r);
  }, 10000);
}
async function doTrigger() {
  const tp = getTriggerParams();
  if (tp === null) { toast(t("webview.paramJsonInvalidCancel")); return; }
  const list = checkedVisibleData();
  const nodeIds = list.map((d) => d.id);
  const paramsObj = {}; tp.forEach((p) => { paramsObj[p[0]] = p[1]; });
  // Collect per-job params (only for jobs that have them).
  const jobParams = {};
  list.forEach((d) => {
    if (jobParamMap.has(d.id)) jobParams[d.id] = jobParamMap.get(d.id);
  });
  toast(t("webview.triggering", {count: nodeIds.length}));
  const r = await rpc("trigger", { nodeIds, params: paramsObj, jobParams });
  if (r) { applySnapshot(r); }
  if (r && r.errors && r.errors.length) {
    toast(t("webview.triggeredWithErrors", {count: r.errors.length})); r.errors.forEach((e) => logMsg(t("webview.triggerFailedLog", {error: e}), "err"));
  } else {
    toast(t("webview.triggered", {count: nodeIds.length}));
  }
  list.forEach((d) => {
    const eff = getEffectiveParams(d.id);
    const paramStr = eff ? Object.keys(eff).map((k) => k + "=" + eff[k]).join(", ") : t("webview.noParams3");
    const tag = jobParamMap.has(d.id) ? t("webview.customTag") : "";
    logMsg(t("webview.triggerLog", {name: d.name, tag, params: paramStr}), "info");
  });
  scheduleForceRefresh();
}
async function triggerOne(nodeId) {
  const d = STATE.selectedNodes.find((x) => x.id === nodeId);
  if (!d) return;
  toast(t("webview.triggeringOne", {name: d.name}));
  const tp = getTriggerParams() || [];
  const paramsObj = {}; tp.forEach((p) => { paramsObj[p[0]] = p[1]; });
  // Include per-job params if set.
  const jobParams = {};
  if (jobParamMap.has(nodeId)) jobParams[nodeId] = jobParamMap.get(nodeId);
  const r = await rpc("trigger", { nodeIds: [nodeId], params: paramsObj, jobParams });
  if (r) applySnapshot(r);
  const eff = getEffectiveParams(nodeId);
  const paramStr = eff ? Object.keys(eff).map((k) => k + "=" + eff[k]).join(", ") : t("webview.noParams3");
  const tag = jobParamMap.has(nodeId) ? t("webview.customTag") : "";
  toast(t("webview.triggeredOne", {name: d.name})); logMsg(t("webview.triggerLog", {name: d.name, tag, params: paramStr}), "info");
  scheduleForceRefresh();
}

/* ============ 批量中止 ============ */
document.getElementById("btnAbort").onclick = abortSelected;
async function abortSelected() {
  const list = checkedVisibleData().filter((d) => d.status === "running");
  if (list.length === 0) { toast(t("webview.abortNone")); return; }
  const nodeIds = list.map((d) => d.id);
  toast(t("webview.aborting", {count: nodeIds.length}));
  const r = await rpc("abort", { nodeIds });
  if (r) applySnapshot(r);
  toast(t("webview.aborted2", {count: nodeIds.length}));
  list.forEach((d) => logMsg(t("webview.abortLog", {name: d.name}), "warn"));
}
async function abortOne(nodeId) {
  const d = STATE.selectedNodes.find((x) => x.id === nodeId);
  if (!d || d.status !== "running") { toast(d ? t("webview.notRunning", {name: d.name}) : t("webview.pipelineNotExist")); return; }
  const r = await rpc("abort", { nodeIds: [nodeId] });
  if (r) applySnapshot(r);
  toast(t("webview.abortedOne", {name: d.name})); logMsg(t("webview.abortLog", {name: d.name}), "warn");
}

/* ============ 刷新（手动+自动） ============ */
document.getElementById("btnRefresh").onclick = doRefresh;
// Manual refresh: refresh ALL jobs currently in the list (regardless of status).
async function doRefresh() {
  toast(t("webview.refreshing"));
  const r = await rpc("refresh", { mode: "all" });
  if (r) applySnapshot(r);
  toast(t("webview.refreshed"));
}
let autoTimer = null;
// Auto refresh: only fires the RPC when there's at least one job that is
// non-terminal (running, idle, unknown) or has queue > 0. If everything is
// in a terminal state with no queue, the tick is skipped entirely.
const TERMINAL_STATES = new Set(["success", "failed", "unstable", "aborted"]);
function autoRefreshSec() {
  const s = parseInt(document.getElementById("autoInt").value, 10);
  return s && s > 0 ? s : 10;
}
async function doAutoRefresh() {
  const needsRefresh = STATE.selectedNodes.some(
    (d) => !TERMINAL_STATES.has(d.status) || (d.queue > 0)
  );
  if (!needsRefresh) return;
  const r = await rpc("refresh", { mode: "nonTerminal" });
  if (r) applySnapshot(r);
}
// Self-rescheduling loop instead of setInterval: the next tick is only armed
// after the current refresh settles, so the real frequency always matches the
// configured interval and a slow Jenkins response can never stack up into
// overlapping concurrent refreshes (which made the log look like it refreshed
// far more often than the displayed interval).
function scheduleNextAutoRefresh() {
  if (!document.getElementById("autoChk").checked) { autoTimer = null; return; }
  autoTimer = setTimeout(async () => {
    try { await doAutoRefresh(); } finally { scheduleNextAutoRefresh(); }
  }, autoRefreshSec() * 1000);
}
function startAutoRefresh() {
  stopAutoRefresh();
  scheduleNextAutoRefresh();
}
function stopAutoRefresh() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}
document.getElementById("autoChk").addEventListener("change", (e) => {
  if (e.target.checked) { startAutoRefresh(); toast(t("webview.autoRefreshOn", {n: autoRefreshSec()})); }
  else { stopAutoRefresh(); toast(t("webview.autoRefreshOff")); }
});
document.getElementById("autoInt").addEventListener("change", () => {
  if (document.getElementById("autoChk").checked) { startAutoRefresh(); toast(t("webview.intervalChanged", {n: autoRefreshSec()})); }
});

/* ============ 日志面板（可拖拽调整高度） ============ */
let logCollapsed = false;
const logResizer = document.getElementById("logResizer");
const logPanel = document.getElementById("logPanel");
// Explicitly set initial height to override wireframe's max-height:110px.
logPanel.style.height = "120px";
logPanel.style.flexBasis = "120px";

// Toggle collapse/expand via the "活动日志" label.
function syncLogToggleLabel() {
  document.getElementById("logToggle").textContent = logCollapsed ? t("webview.logExpand") : t("webview.logCollapse");
}
document.getElementById("logToggle").onclick = () => {
  logCollapsed = !logCollapsed;
  if (logCollapsed) {
    logPanel.classList.add("collapsed");
    logResizer.classList.add("collapsed");
  } else {
    logPanel.classList.remove("collapsed");
    logResizer.classList.remove("collapsed");
  }
  syncLogToggleLabel();
};

// Drag the resizer bar to resize the log panel height.
// Resizer sits above the log panel; dragging up grows the panel, down shrinks it.
let resizing = false;
let startMouseY = 0;
let startPanelHeight = 0;

logResizer.addEventListener("mousedown", (e) => {
  if (logCollapsed) return;
  resizing = true;
  startMouseY = e.clientY;
  startPanelHeight = logPanel.offsetHeight;
  logResizer.classList.add("dragging");
  document.body.style.cursor = "ns-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!resizing) return;
  const dy = e.clientY - startMouseY;
  // Resizer is above the panel: dragging up (dy<0) should grow the panel.
  let newHeight = startPanelHeight - dy;
  // Clamp: min 32px, max leaves room for toolbar/actionbar/table (~200px reserved).
  const maxH = window.innerHeight - 220;
  newHeight = Math.max(32, Math.min(newHeight, maxH));
  // Set both height and flex-basis to ensure the new size takes effect
  // regardless of which CSS property the browser prioritizes.
  logPanel.style.height = newHeight + "px";
  logPanel.style.flexBasis = newHeight + "px";
});

document.addEventListener("mouseup", () => {
  if (resizing) {
    resizing = false;
    logResizer.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
});

/* ============ 列宽拖动 ============ */
(function initColResize() {
  const table = document.querySelector(".tablewrap table");
  if (!table) return;
  const ths = table.querySelectorAll("thead th");
  ths.forEach((th) => {
    const resizer = document.createElement("div");
    resizer.className = "col-resizer";
    th.appendChild(resizer);
    let startX, startW;
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (th.id === "thPipeline") pipelineColAuto = false;
      startX = e.clientX;
      startW = th.offsetWidth;
      resizer.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev) => {
        const w = Math.max(30, startW + ev.clientX - startX);
        th.style.width = w + "px";
      };
      const onUp = () => {
        resizer.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
})();

/* ============ 初始化 ============ */
(async function init() {
  const cfg = await rpc("load", {});
  applySnapshot(cfg);
  if (cfg.activeTpl) {
    const tpl = STATE.paramTemplates.find((t) => t.name === cfg.activeTpl);
    if (tpl) {
      params = tpl.params.map((p) => p.slice());
      activeParamTpl = tpl.name;
      renderKv();
      renderParamBtn();
      renderParamTpl();
      syncJsonFromParams();
    }
  }
})();
