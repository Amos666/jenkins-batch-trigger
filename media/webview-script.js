/* ====================================================================
 * Jenkins Batch Trigger — webview script (CENTER PANEL ONLY).
 * The sidebar is the native VSCode tree. This webview renders the
 * toolbar + table + action bar + log + param/trigger modals.
 * The webview receives selectedNodes (TreeNode[]) from the sidebar
 * and provides batch trigger/abort/refresh actions.
 * ==================================================================== */

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
  } else if (m && m.type === "openConfig") {
    // Connection config is now handled by the sidebar settings button.
  }
});

const STATUS_LABEL = { running:"Running", success:"Success", failed:"Failed", unstable:"Unstable", aborted:"Aborted", idle:"Idle", unknown:"Unknown" };
const BADGE = { running:"b-running", success:"b-success", failed:"b-failed", unstable:"b-unstable", aborted:"b-aborted", idle:"b-idle", unknown:"b-idle" };

/* ============ 状态 ============ */
let STATE = { selectedNodes: [], paramTemplates: [] };
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
    if (expandedParamJobId && !newIds.has(expandedParamJobId)) expandedParamJobId = null;
    prevSelectedIds = newIds;
    STATE.selectedNodes = s.selectedNodes;
  }
  if (s.paramTemplates) STATE.paramTemplates = s.paramTemplates;
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
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
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
      ? "尚未选择 pipeline — 在左侧树中勾选 job 节点"
      : "没有匹配的 pipeline";
  }
  list.forEach((d) => {
    const tr = document.createElement("tr");
    tr.className = webviewChecked.has(d.id) ? "sel" : "";
    const st = d.status || "unknown";
    const checkedAttr = webviewChecked.has(d.id) ? "checked" : "";
    const hasJobParams = jobParamMap.has(d.id);
    const paramClass = hasJobParams ? "link param-btn has-params" : "link param-btn";
    const paramLabel = hasJobParams ? "✎ 参数*" : "✎ 参数";
    tr.innerHTML =
      `<td class="col-check"><input type="checkbox" class="rowchk" data-id="${d.id}" ${checkedAttr}></td>` +
      `<td><div class="name" title="${d.jobPath || d.name}">${getPipelineDisplayLabel(d)}</div><div class="sub"><span class="folder-tag">${d.folder || d.jobPath || ""}</span></div></td>` +
      `<td><span class="badge ${BADGE[st] || "b-idle"}"><span class="sw"></span>${STATUS_LABEL[st] || "Unknown"}</span></td>` +
      `<td>${d.queue > 0 ? `<span class="qbadge" title="${d.queue} 个构建在队列中等待">${d.queue} 排队</span>` : '<span style="color:var(--text-faint)">—</span>'}</td>` +
      `<td>${d.build || "—"}</td><td>${d.dur || "—"}</td><td>${d.time || "—"}</td>` +
      `<td><span class="link build-link" data-url="${jobBuildUrl(d)}" title="${jobBuildUrl(d)}">${d.build || "—"} ↗</span></td>` +
      `<td><span class="${paramClass}" data-param="${d.id}" title="点击编辑专属参数">${paramLabel}</span></td>` +
      `<td><span class="link" data-run="${d.id}">触发</span> · <span class="link" data-log="${d.id}">日志</span>${st === "running" ? ` · <span class="link warn" data-abort="${d.id}">中止</span>` : ""}</td>`;
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
      paramText = jobP ? JSON.stringify(jobP, null, 2) : "";
    }
    // Escape HTML special chars so textarea content is not misparsed by the HTML parser.
    const paramTextEscaped = escapeHtml(paramText);
    paramTr.innerHTML =
      `<td colspan="10"><div class="job-param-box">` +
      `<textarea class="job-param-textarea" data-jobid="${d.id}" spellcheck="false" placeholder='该 job 专属参数（JSON），留空则使用批量参数。例：{ "BRANCH": "dev" }'>${paramTextEscaped}</textarea>` +
      `<div class="job-param-actions">` +
      `<button class="btn sm" data-paramsave="${d.id}">保存</button>` +
      `<button class="btn sm" data-paramclear="${d.id}">清除</button>` +
      `</div></div>` +
      `<div class="job-param-status" data-jobid="${d.id}">${hasJobParams ? "✓ 已设置专属参数（优先于批量参数）" : ""}</div>` +
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
  ab.title = runSel > 0 ? ("中止 " + runSel + " 个运行中的 pipeline") : "选中的 pipeline 中无运行中的任务";
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
    toast("已清除该 job 的专属参数");
    render();
    return;
  }
  let obj;
  try { obj = JSON.parse(txt); } catch (e) {
    if (statusEl) { statusEl.textContent = "✕ JSON 无效：" + e.message; statusEl.className = "job-param-status err"; }
    ta.classList.add("err");
    return;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    if (statusEl) { statusEl.textContent = "✕ 应为 JSON 对象 { … }"; statusEl.className = "job-param-status err"; }
    ta.classList.add("err");
    return;
  }
  jobParamMap.set(jobId, obj);
  if (statusEl) { statusEl.textContent = "✓ 已保存专属参数（优先于批量参数）"; statusEl.className = "job-param-status ok"; }
  ta.classList.remove("err");
  toast("已保存该 job 的专属参数");
  render();
}
function clearJobParam(jobId) {
  jobParamMap.delete(jobId);
  const ta = document.querySelector('.job-param-textarea[data-jobid="' + jobId + '"]');
  if (ta) ta.value = "";
  const statusEl = document.querySelector('.job-param-status[data-jobid="' + jobId + '"]');
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "job-param-status"; }
  toast("已清除该 job 的专属参数");
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
  else lbl.textContent = params.length ? "自定义" : "未应用模板";
}
function paramsToObj() { const o = {}; params.forEach((p) => { if (p[0] !== "") o[p[0]] = p[1]; }); return o; }
function objToParams(o) { return Object.keys(o || {}).map((k) => [k, String(o[k])]); }
function setPjStatus(ok, msg) {
  const s = document.getElementById("pjStatus"), ta = document.getElementById("paramJson");
  if (!s) return;
  if (ok) { s.textContent = "✓ 有效"; s.className = "pj-status ok"; if (ta) ta.classList.remove("err"); }
  else { s.textContent = "✕ " + (msg || "JSON 无效"); s.className = "pj-status err"; if (ta) ta.classList.add("err"); }
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
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) { setPjStatus(false, "应为 JSON 对象 { … }"); return; }
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
  box.innerHTML = params.length ? "" : '<div class="hint">暂无参数，点击「+ 添加参数」或选择上方模板。</div>';
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
  box.innerHTML = STATE.paramTemplates.length ? "" : '<span class="hint" style="margin:0">暂无模板，配置参数后点「＋ 存为模板」。</span>';
  STATE.paramTemplates.forEach((t) => {
    const c = document.createElement("span");
    c.className = "chip" + (t.id === 0 ? " default" : "");
    c.innerHTML = t.name + (t.id === 0 ? "" : ' <span class="del" data-ptdel="' + t.id + '">✕</span>');
    c.onclick = (e) => {
      if (e.target.dataset.ptdel) {
        e.stopPropagation();
        rpc("deleteParamTpl", { id: +e.target.dataset.ptdel }).then((r) => {
          if (r && r.paramTemplates) { STATE.paramTemplates = r.paramTemplates; renderParamTpl(); }
        });
        return;
      }
      params = t.params.map((p) => p.slice()); renderKv();
      activeParamTpl = t.name; onParamsChanged(); toast("已套用参数模板：" + t.name);
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
// Pipeline column header: double-click to cycle display level (0=job, 1=parent/job, 2=grandparent/parent/job)
document.getElementById("thPipeline").addEventListener("dblclick", () => {
  pipelineDisplayLevel = (pipelineDisplayLevel + 1) % 3;
  const levelNames = ["仅 job 名称", "上级目录/job", "上上级/上级/job"];
  toast("Pipeline 显示：" + levelNames[pipelineDisplayLevel]);
  render();
});
document.getElementById("tbody").addEventListener("click", (e) => {
  if (e.target.dataset.run) triggerOne(e.target.dataset.run);
  if (e.target.dataset.abort) abortOne(e.target.dataset.abort);
  if (e.target.dataset.log) {
    const d = STATE.selectedNodes.find((x) => x.id === e.target.dataset.log);
    fire("openBuild", { url: d ? jobConsoleUrl(d) : "#" }); logMsg("打开 " + (d ? d.name : "") + " 的 console", "info");
  }
  if (e.target.dataset.url) { fire("openBuild", { url: e.target.dataset.url }); logMsg("在浏览器打开构建页面：" + e.target.dataset.url, "info"); }
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
document.getElementById("btnClearLog").onclick = () => {
  document.getElementById("logPanel").innerHTML = "";
  toast("日志已清除");
};

/* ============ 参数弹窗 ============ */
document.getElementById("btnParams").onclick = () => {
  renderKv(); renderParamTpl(); syncJsonFromParams();
  document.getElementById("paramOverlay").classList.add("show");
};
document.getElementById("btnParamCancel").onclick = () => document.getElementById("paramOverlay").classList.remove("show");
document.getElementById("btnAddKv").onclick = () => { params.push(["", ""]); activeParamTpl = null; renderKv(); onParamsChanged(); };

document.getElementById("paramJson").addEventListener("input", syncParamsFromJson);
document.getElementById("btnSaveParamTpl").onclick = () => {
  if (params.length === 0) { toast("请先配置参数"); return; }
  document.getElementById("paramTplSummary").innerHTML = "将保存 <b>" + params.length + "</b> 个参数：<br>" + params.map((p) => p[0] + "=" + p[1]).join("，");
  document.getElementById("paramTplName").value = "";
  document.getElementById("paramTplOverlay").classList.add("show");
  setTimeout(() => document.getElementById("paramTplName").focus(), 50);
};
document.getElementById("btnParamTplCancel").onclick = () => document.getElementById("paramTplOverlay").classList.remove("show");
document.getElementById("btnParamTplSave").onclick = () => {
  const name = document.getElementById("paramTplName").value.trim();
  if (!name) { toast("请输入模板名称"); return; }
  rpc("saveParamTpl", { name, params: params.map((p) => p.slice()) }).then((r) => {
    if (r && r.paramTemplates) { STATE.paramTemplates = r.paramTemplates; renderParamTpl(); }
    document.getElementById("paramTplOverlay").classList.remove("show");
    activeParamTpl = name; renderParamBtn();
    toast("已保存参数模板：" + name); logMsg("新建参数模板 " + name, "ok");
  });
};
document.getElementById("btnParamSave").onclick = () => {
  if (getTriggerParams() === null) { toast("参数 JSON 无效，请检查左侧编辑器"); return; }
  document.getElementById("paramOverlay").classList.remove("show");
  toast("已保存 " + params.length + " 个参数"); renderParamBtn();
};

/* ============ 触发（先预览真实参数，再确认） ============ */
document.getElementById("btnTrigger").onclick = showTriggerPreview;
function showTriggerPreview() {
  const list = checkedVisibleData();
  if (list.length === 0) { toast("请先在左侧树中勾选并在列表中选中要触发的 pipeline"); return; }
  const tp = getTriggerParams();
  if (tp === null) { toast("参数 JSON 无效，请先在「参数」中修正"); return; }
  const names = list.map((d) => d.name);
  const paramLines = tp.length ? tp.map((p) => p[0] + "=" + p[1]).join("\n") : "（无参数）";
  // Build per-job params preview.
  const customJobs = list.filter((d) => jobParamMap.has(d.id));
  const customLines = customJobs.length
    ? customJobs.map((d) => "  • " + d.name + ": " + JSON.stringify(jobParamMap.get(d.id))).join("\n")
    : "（无）";
  document.getElementById("triggerPreviewText").value =
`即将触发 ${list.length} 个 pipeline
================================

[公共参数] (随请求下发的真实值，来自 JSON 编辑器)
${paramLines}

[专属参数 pipeline (${customJobs.length})]
${customLines}

[目标 pipeline (${names.length})]
${names.map((n) => "  • " + n).join("\n")}

> 确认后将立即下发触发请求。专属参数优先于公共参数。`;
  document.getElementById("triggerOverlay").classList.add("show");
}
document.getElementById("btnTriggerCancel").onclick = () => document.getElementById("triggerOverlay").classList.remove("show");
document.getElementById("btnTriggerConfirm").onclick = async () => {
  document.getElementById("triggerOverlay").classList.remove("show");
  await doTrigger();
};
async function doTrigger() {
  const tp = getTriggerParams();
  if (tp === null) { toast("参数 JSON 无效，已取消触发"); return; }
  const list = checkedVisibleData();
  const nodeIds = list.map((d) => d.id);
  const paramsObj = {}; tp.forEach((p) => { paramsObj[p[0]] = p[1]; });
  // Collect per-job params (only for jobs that have them).
  const jobParams = {};
  list.forEach((d) => {
    if (jobParamMap.has(d.id)) jobParams[d.id] = jobParamMap.get(d.id);
  });
  toast("正在触发 " + nodeIds.length + " 个 pipeline…");
  const r = await rpc("trigger", { nodeIds, params: paramsObj, jobParams });
  if (r) { applySnapshot(r); }
  if (r && r.errors && r.errors.length) {
    toast("已触发，" + r.errors.length + " 个失败"); r.errors.forEach((e) => logMsg("触发失败：" + e, "err"));
  } else {
    toast("已批量触发 " + nodeIds.length + " 个 pipeline");
  }
  list.forEach((d) => {
    const eff = getEffectiveParams(d.id);
    const paramStr = eff ? Object.keys(eff).map((k) => k + "=" + eff[k]).join(", ") : "（无参数）";
    const tag = jobParamMap.has(d.id) ? " [专属参数]" : "";
    logMsg("触发 " + d.name + tag + " 参数:" + paramStr, "info");
  });
}
async function triggerOne(nodeId) {
  const d = STATE.selectedNodes.find((x) => x.id === nodeId);
  if (!d) return;
  toast("正在触发 " + d.name + "…");
  const tp = getTriggerParams() || [];
  const paramsObj = {}; tp.forEach((p) => { paramsObj[p[0]] = p[1]; });
  // Include per-job params if set.
  const jobParams = {};
  if (jobParamMap.has(nodeId)) jobParams[nodeId] = jobParamMap.get(nodeId);
  const r = await rpc("trigger", { nodeIds: [nodeId], params: paramsObj, jobParams });
  if (r) applySnapshot(r);
  const eff = getEffectiveParams(nodeId);
  const paramStr = eff ? Object.keys(eff).map((k) => k + "=" + eff[k]).join(", ") : "（无参数）";
  const tag = jobParamMap.has(nodeId) ? " [专属参数]" : "";
  toast("已触发 " + d.name); logMsg("触发 " + d.name + tag + " 参数:" + paramStr, "info");
}

/* ============ 批量中止 ============ */
document.getElementById("btnAbort").onclick = abortSelected;
async function abortSelected() {
  const list = checkedVisibleData().filter((d) => d.status === "running");
  if (list.length === 0) { toast("选中的 pipeline 中没有正在运行 (Running) 的任务"); return; }
  const nodeIds = list.map((d) => d.id);
  toast("正在中止 " + nodeIds.length + " 个运行中的 pipeline…");
  const r = await rpc("abort", { nodeIds });
  if (r) applySnapshot(r);
  toast("已批量中止 " + nodeIds.length + " 个运行中的 pipeline");
  list.forEach((d) => logMsg("中止 " + d.name, "warn"));
}
async function abortOne(nodeId) {
  const d = STATE.selectedNodes.find((x) => x.id === nodeId);
  if (!d || d.status !== "running") { toast(d ? (d.name + " 当前不是运行中，无法中止") : "pipeline 不存在"); return; }
  const r = await rpc("abort", { nodeIds: [nodeId] });
  if (r) applySnapshot(r);
  toast("已中止 " + d.name); logMsg("中止 " + d.name, "warn");
}

/* ============ 刷新（手动+自动） ============ */
document.getElementById("btnRefresh").onclick = doRefresh;
// Manual refresh: refresh ALL jobs currently in the list (regardless of status).
async function doRefresh() {
  toast("正在刷新状态…");
  const r = await rpc("refresh", { mode: "all" });
  if (r) applySnapshot(r);
  toast("已刷新状态");
}
let autoTimer = null;
// Auto refresh: refresh non-terminal jobs (running, unknown) AND terminal jobs
// that still have queue > 0 (queued). Terminal states with no queue are skipped.
async function doAutoRefresh() {
  const r = await rpc("refresh", { mode: "nonTerminal" });
  if (r) applySnapshot(r);
}
document.getElementById("autoChk").addEventListener("change", (e) => {
  if (e.target.checked) { const s = +document.getElementById("autoInt").value; autoTimer = setInterval(doAutoRefresh, s * 1000); toast("自动刷新已开启（每 " + s + " 秒）"); }
  else { clearInterval(autoTimer); autoTimer = null; toast("自动刷新已关闭"); }
});
document.getElementById("autoInt").addEventListener("change", (e) => {
  if (document.getElementById("autoChk").checked) { clearInterval(autoTimer); const s = +e.target.value; autoTimer = setInterval(doAutoRefresh, s * 1000); toast("间隔改为每 " + s + " 秒"); }
});

/* ============ 日志面板（可拖拽调整高度） ============ */
let logCollapsed = false;
const logResizer = document.getElementById("logResizer");
const logPanel = document.getElementById("logPanel");
// Explicitly set initial height to override wireframe's max-height:110px.
logPanel.style.height = "120px";
logPanel.style.flexBasis = "120px";

// Toggle collapse/expand via the "活动日志" label.
document.getElementById("logToggle").onclick = () => {
  logCollapsed = !logCollapsed;
  if (logCollapsed) {
    logPanel.classList.add("collapsed");
    logResizer.classList.add("collapsed");
    document.getElementById("logToggle").textContent = "▸ 活动日志";
  } else {
    logPanel.classList.remove("collapsed");
    logResizer.classList.remove("collapsed");
    document.getElementById("logToggle").textContent = "▾ 活动日志";
  }
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

/* ============ 初始化 ============ */
(async function init() {
  const cfg = await rpc("load", {});
  applySnapshot(cfg);
})();
