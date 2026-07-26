import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { t } from "./i18n";

/**
 * Builds the CENTER-ONLY webview HTML. The sidebar is the native VSCode tree.
 *
 * CSS is extracted from jenkins-pipeline-batch-wireframe.html (single editable
 * source for styles). The body is a center-only panel (toolbar + table + action
 * bar + log + param/trigger modals). The bridge script (media/webview-script.js)
 * is injected with a per-load nonce under a strict CSP.
 */
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptPath = path.join(extensionUri.fsPath, "media", "webview-script.js");
  const templatePath = path.join(extensionUri.fsPath, "jenkins-pipeline-batch-wireframe.html");

  const script = fs.readFileSync(scriptPath, "utf8");
  const tpl = fs.readFileSync(templatePath, "utf8");

  const styleOpen = tpl.indexOf("<style>");
  const styleClose = tpl.indexOf("</style>");
  if (styleOpen < 0 || styleClose < 0) {
    throw new Error("wireframe template missing <style> block");
  }
  const styleContent = tpl.slice(styleOpen + "<style>".length, styleClose);

  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src 'unsafe-inline' ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Jenkins Batch Trigger</title>
<style>
${styleContent}
/* center-only: ensure the panel fills the webview with no leftover sidebar layout */
.app{height:100vh;display:flex;flex-direction:column;overflow:hidden;}
.center{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;}
/* tablewrap takes remaining space and shrinks when log panel grows.
   min-height:0 is required so flex can shrink it below its content height. */
.tablewrap{flex:1 1 0;min-height:0;overflow:auto;}
/* Resizable columns */
table{table-layout:fixed;width:100%;}
th{position:relative;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
th .col-resizer{position:absolute;right:0;top:0;width:5px;height:100%;cursor:col-resize;user-select:none;}
th .col-resizer:hover,th .col-resizer.dragging{background:var(--accent,#4fc3f7);opacity:0.6;}
td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* Per-job parameter inline editor */
tr.param-row{display:none;}
tr.param-row.show{display:table-row;}
tr.param-row td{padding:8px 12px;background:var(--bg-alt,#1e1e1e);border-bottom:1px solid var(--border,#333);}
.job-param-box{display:flex;gap:8px;align-items:flex-start;}
.job-param-box textarea{flex:1;min-height:80px;max-height:200px;background:#1b1b1b;border:1px solid #333;border-radius:4px;
  color:var(--text,#ddd);font-family:var(--font-mono,monospace);font-size:12px;padding:6px 8px;resize:vertical;outline:none;}
.job-param-box textarea:focus{border-color:var(--accent,#4fc3f7);}
.job-param-box textarea.err{border-color:var(--red,#f48771);}
.job-param-actions{display:flex;flex-direction:column;gap:4px;}
.job-param-actions .btn{padding:3px 10px;font-size:11px;}
.job-param-status{font-size:11px;color:var(--text-dim,#888);margin-top:2px;}
.job-param-status.err{color:var(--red,#f48771);}
.job-param-status.ok{color:var(--green,#81c784);}
.link.param-btn{cursor:pointer;padding:2px 6px;border-radius:3px;}
.link.param-btn:hover{background:rgba(255,255,255,0.08);}
.link.param-btn.has-params{color:var(--accent,#4fc3f7);font-weight:600;}
.link.param-btn.has-job-params{color:var(--red,#f48771);font-weight:600;}
.tpl-saved .chip .save-def{margin-left:5px;color:var(--accent,#4fc3f7);cursor:pointer;font-size:12px;opacity:.7;}
.tpl-saved .chip .save-def:hover{opacity:1;}
/* Resizable log panel — uses a draggable resizer bar instead of CSS resize
   because resize:vertical does not work reliably on flex column children.
   Override ALL conflicting wireframe properties (display:none, max-height:110px). */
.log-resizer{flex:0 0 6px;cursor:ns-resize;background:var(--border,#333);
  border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
.log-resizer:hover,.log-resizer.dragging{background:var(--accent,#4fc3f7);}
.log-resizer.collapsed{cursor:default;background:var(--border,#333);}
.logpanel{display:block !important;flex:0 0 120px;flex-grow:0;flex-shrink:0;
  max-height:none !important;min-height:0;height:120px;overflow:auto;border:none;
  background:#1b1b1b;padding:5px 12px;font-size:11px;color:var(--text-dim);font-family:Consolas,monospace;}
.logpanel.collapsed{flex-basis:0 !important;height:0 !important;padding:0 12px;overflow:hidden;}
.logpanel div{padding:1px 0;}
.logpanel .ok{color:var(--green);} .logpanel .err{color:var(--red);} .logpanel .info{color:var(--blue);}
</style>
</head>
<body>
<div class="app">
  <div class="center">
    <div class="toolbar">
      <div class="search"><span style="color:var(--text-dim)">🔍</span><input id="searchInput" placeholder="${t("webview.html.searchPlaceholder")}" /></div>
      <div class="chips" id="statusChips">
        <span class="chip on" data-st="all">${t("webview.html.chipAll")}</span>
        <span class="chip" data-st="running"><span class="sw" style="background:var(--blue)"></span>Running</span>
        <span class="chip" data-st="success"><span class="sw" style="background:var(--green)"></span>Success</span>
        <span class="chip" data-st="failed"><span class="sw" style="background:var(--red)"></span>Failed</span>
        <span class="chip" data-st="unstable"><span class="sw" style="background:var(--yellow)"></span>Unstable</span>
        <span class="chip" data-st="aborted"><span class="sw" style="background:var(--gray)"></span>Aborted</span>
      </div>
      <div class="divider"></div>
      <div class="autoref"><label><input type="checkbox" id="autoChk" /> ${t("webview.html.autoRefresh")}</label>
        <select id="autoInt"><option value="5">5s</option><option value="10" selected>10s</option><option value="30">30s</option><option value="60">1m</option></select>
      </div>
      <div class="spacer"></div>
      <button class="btn" id="btnParams" title="${t("webview.html.paramsTitle")}">${t("webview.html.paramsBtn")} <span id="paramTplLabel">${t("webview.html.noTpl")}</span> <span id="paramCount" class="pcount">0</span></button>
      <button class="btn primary" id="btnTrigger">${t("webview.html.triggerBtn")}</button>
      <button class="btn danger" id="btnAbort" title="${t("webview.html.abortTitle")}">${t("webview.html.abortBtn")}</button>
      <button class="btn primary icon" id="btnRefresh" title="${t("webview.html.refreshTitle")}">${t("webview.html.refreshBtn")}</button>
      <button class="btn" id="btnTimeout" title="${t("webview.html.timeoutTitle")}">⏱ ${t("webview.html.timeoutBtn")} <span id="timeoutVal">10</span>m</button>
      <button class="btn" id="btnActionsConfig" title="${t("webview.html.actionsConfigTitle")}">⚡ ${t("webview.html.actionsConfigBtn")}</button>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th class="col-check"><input type="checkbox" id="checkAll" /></th>
          <th id="thPipeline" title="${t("webview.html.thNameTitle")}">Pipeline</th><th>${t("webview.html.thStatus")}</th>
          <th title="${t("webview.html.thQueueTitle")}">${t("webview.html.thQueue")}</th>
          <th>${t("webview.html.thDuration")}</th><th>${t("webview.html.thLastRun")}</th>
          <th title="${t("webview.html.thBuildTitle")}">${t("webview.html.thBuild")}</th>
          <th title="${t("webview.html.thParamTitle")}">${t("webview.html.thParam")}</th>
          <th id="thTimeout" title="${t("webview.html.thTimeoutTitle")}">${t("webview.html.thTimeout")}</th>
          <th id="thPrePost" title="${t("webview.html.thActionsToggleTitle")}">${t("webview.html.actionsConfigBtn")}</th>
          <th>${t("webview.html.thActions")}</th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="empty-state" id="emptyState" style="display:none">${t("webview.html.empty")}</div>
    </div>
    <div class="actionbar">
      <span class="sel">${t("webview.html.selected")} <b id="selCount">0</b> / <span id="totalCount">0</span></span>
      <span class="sel logtoggle" id="logToggle">${t("webview.html.logToggle")}</span>
      <div class="spacer"></div>
      <button class="btn" id="btnClearLog">${t("webview.html.clearLog")}</button>
    </div>
    <div class="log-resizer" id="logResizer" title="${t("webview.html.resizerTitle")}"></div>
    <div class="logpanel" id="logPanel"></div>
  </div>
</div>

<div class="overlay" id="paramOverlay">
  <div class="modal wide">
    <h3>${t("webview.html.paramModalTitle")}</h3>
    <div class="body">
      <div class="hint">${t("webview.html.paramModalHint")}</div>
      <div class="tpl-chips">
        <span style="color:var(--text-dim);font-size:11px;align-self:center;">${t("webview.html.tplLabel")}</span>
        <button class="btn sm" id="btnSaveParamTpl" style="margin-left:auto">${t("webview.html.saveTpl")}</button>
      </div>
      <div class="tpl-saved" id="paramTplList"></div>
      <div class="param-split">
        <div class="param-json">
          <div class="pj-head"><span>${t("webview.html.jsonHead")} <span class="tag">${t("webview.html.jsonTag")}</span></span><span class="pj-status ok" id="pjStatus">${t("webview.jsonValid")}</span></div>
          <textarea class="pj-text" id="paramJson" spellcheck="false" placeholder='{ "BRANCH": "main", "ENVIRONMENT": "staging" }'></textarea>
        </div>
        <div class="param-kv">
          <div class="pj-head"><span>${t("webview.html.kvHead")}</span><span class="tag">${t("webview.html.kvTag")}</span></div>
          <div id="kvList"></div>
          <div class="kvfoot"><button class="btn sm" id="btnAddKv">${t("webview.html.addParam")}</button></div>
        </div>
      </div>
    </div>
    <div class="foot">
      <button class="btn" id="btnParamCancel">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnParamSave">${t("webview.html.saveParams")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="paramTplOverlay">
  <div class="modal">
    <h3>${t("webview.html.tplModalTitle")}</h3>
    <div class="body">
      <div class="summary-box" id="paramTplSummary"></div>
      <div class="field"><label>${t("webview.html.tplNameLabel")}</label><input type="text" id="paramTplName" placeholder="${t("webview.html.tplNamePlaceholder")}" /></div>
      <div class="hint">${t("webview.html.tplHint")}</div>
    </div>
    <div class="foot">
      <button class="btn" id="btnParamTplCancel">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnParamTplSave">${t("webview.html.saveTplBtn")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="triggerOverlay">
  <div class="modal">
    <h3>${t("webview.html.triggerModalTitle")}</h3>
    <div class="body">
      <div class="hint">${t("webview.html.triggerHint")}</div>
      <textarea class="prev" id="triggerPreviewText" readonly></textarea>
    </div>
    <div class="foot">
      <button class="btn" id="btnTriggerCancel">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnTriggerConfirm">${t("webview.triggerConfirm")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="timeoutOverlay">
  <div class="modal">
    <h3>${t("webview.html.timeoutModalTitle")}</h3>
    <div class="body">
      <div class="field"><label>${t("webview.html.timeoutModalLabel")}</label><input type="number" id="timeoutInput" min="1" step="1" /> <span style="color:var(--text-dim)">${t("webview.html.timeoutModalUnit")}</span></div>
    </div>
    <div class="foot">
      <button class="btn" id="btnTimeoutCancel">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnTimeoutSave">${t("webview.html.timeoutModalSave")}</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
<script nonce="${nonce}">
${script}
</script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
