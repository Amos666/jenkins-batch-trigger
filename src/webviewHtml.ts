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
  const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "codicon.ttf"));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
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
/* Codicon font (bundled at media/codicon.ttf, loaded via asWebviewUri + CSP font-src) */
@font-face{font-family:"codicon";src:url("${codiconUri}") format("truetype");font-weight:400;font-style:normal;font-display:block;}
.codicon{font-family:"codicon";font-size:14px;line-height:1;display:inline-block;
  -webkit-font-smoothing:antialiased;user-select:none;flex:0 0 auto;}
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
th .col-resizer:hover,th .col-resizer.dragging{background:var(--accent);opacity:0.6;}
td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* Per-job parameter inline editor */
tr.param-row{display:none;}
tr.param-row.show{display:table-row;}
tr.param-row td{padding:8px 12px;background:var(--vscode-editorWidget-background);border-bottom:1px solid var(--hairline);}
.job-param-box{display:flex;gap:8px;align-items:flex-start;}
.job-param-box textarea{flex:1;min-height:80px;max-height:200px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;
  color:var(--vscode-input-foreground);font-family:var(--font-mono);font-size:12px;padding:6px 8px;resize:vertical;
  transition:border-color .12s ease;}
.job-param-box textarea:focus{border-color:var(--vscode-focusBorder);}
.job-param-box textarea.err{border-color:var(--vscode-inputValidation-errorBorder);}
.job-param-actions{display:flex;flex-direction:column;gap:4px;}
.job-param-actions .btn{padding:3px 10px;font-size:11px;}
.job-param-status{font-size:11px;color:var(--text-dim);margin-top:2px;}
.job-param-status.err{color:var(--red);}
.job-param-status.ok{color:var(--green);}
.link.param-btn{cursor:pointer;padding:2px 6px;border-radius:3px;}
.link.param-btn:hover{background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent);}
.link.param-btn.has-params{color:var(--vscode-textLink-foreground);font-weight:600;}
.link.param-btn.has-job-params{color:var(--red);font-weight:600;}
.tpl-saved .chip{cursor:grab;user-select:none;}
.tpl-saved .chip.dragging{opacity:.4;cursor:grabbing;}
.tpl-saved .chip.drop-before{box-shadow:-2px 0 0 0 var(--accent);}
.tpl-saved .chip.drop-after{box-shadow:2px 0 0 0 var(--accent);}
/* Template category tabs: categories render as horizontal tabs (uncategorized
   always first); only the active tab's chips are shown, so the param editor
   below keeps its full height. Tabs sit on a recessed strip with an accent
   underline; templates render as raised cards — so categories and templates
   are visually distinct at a glance. */
#paramTplList{display:block;}
.tpl-tabs{display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto;align-items:flex-end;
  margin:8px 0 0;padding:4px 6px 0;border-radius:4px 4px 0 0;
  background:color-mix(in srgb, var(--vscode-foreground) 4%, transparent);border-bottom:1px solid var(--border);}
.tpl-tab{display:inline-flex;align-items:center;gap:7px;padding:5px 14px;font-size:11px;
  color:var(--text-dim);cursor:pointer;user-select:none;white-space:nowrap;flex:0 0 auto;
  border:1px solid transparent;border-bottom:none;border-radius:3px 3px 0 0;position:relative;top:1px;
  background:color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
  transition:background-color .12s ease,color .12s ease,border-color .12s ease;}
.tpl-tab:hover{color:var(--text);background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent);}
.tpl-tab.on{color:var(--accent);background:color-mix(in srgb, var(--accent) 12%, transparent);font-weight:600;}
.tpl-tab.on::after{content:"";position:absolute;left:-1px;right:-1px;bottom:-2px;height:2px;
  background:var(--accent);}
.tpl-tab .cat-count{color:var(--text-dim);background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
  border-radius:4px;padding:0 7px;font-size:10px;line-height:16px;}
.tpl-tab.on .cat-count{color:var(--vscode-button-foreground);background:var(--accent);}
.tpl-tab .cat-del{color:var(--red);cursor:pointer;font-size:11px;padding:0 2px;opacity:.7;}
.tpl-tab .cat-del:hover{opacity:1;}
/* Drag a tab horizontally to reorder categories; drop a chip onto a tab to
   move it to that category (other categories are hidden behind their tabs). */
.tpl-tab.cat-draggable{cursor:grab;}
.tpl-tab.cat-draggable:active{cursor:grabbing;}
.tpl-tab.dragging{opacity:.5;}
.tpl-tab.drop-hover{color:var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent);
  box-shadow:inset 0 0 0 1px var(--accent);}
.tpl-tab.drop-before{box-shadow:-2px 0 0 0 var(--accent);}
.tpl-tab.drop-after{box-shadow:2px 0 0 0 var(--accent);}
.tpl-tabpanel{display:flex;gap:8px;flex-wrap:wrap;align-items:center;
  padding:10px 2px;min-height:42px;margin:0 0 12px;}
.tpl-tabpanel .hint{margin:0;}
/* Template chips: card-style so they read as "templates", not mini-tabs. */
#paramTplList .chip{background:color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-foreground) 16%, transparent);border-radius:4px;
  padding:4px 12px;font-size:12px;color:var(--text);line-height:16px;
  transition:border-color .12s,background .12s,color .12s;}
#paramTplList .chip.default{border-style:dashed;border-color:color-mix(in srgb, var(--vscode-foreground) 22%, transparent);}
#paramTplList .chip:hover{border-color:var(--accent);color:var(--text);background:color-mix(in srgb, var(--accent) 8%, transparent);}
#paramTplList .chip.on{border-color:var(--accent);color:var(--accent);font-weight:600;
  background:color-mix(in srgb, var(--accent) 16%, transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);}
/* Param modal: 4-corner resize + drag-by-title move (replaces this modal's
   native bottom-right-only resize; other .modal.wide dialogs keep it). */
#paramOverlay .modal.wide{resize:none;}
#paramOverlay .modal.wide > h3{cursor:move;}
#paramOverlay .modal.wide > h3:active{cursor:grabbing;}
.rz-corner{position:absolute;width:16px;height:16px;z-index:10;}
.rz-corner::after{content:"";position:absolute;width:6px;height:6px;border-radius:2px;
  background:var(--text-dim);opacity:.35;}
.rz-corner:hover::after{opacity:1;background:var(--accent);}
.rz-nw{top:0;left:0;cursor:nwse-resize;}
.rz-nw::after{top:5px;left:5px;}
.rz-ne{top:0;right:0;cursor:nesw-resize;}
.rz-ne::after{top:5px;right:5px;}
.rz-sw{bottom:0;left:0;cursor:nesw-resize;}
.rz-sw::after{bottom:5px;left:5px;}
.rz-se{bottom:0;right:0;cursor:nwse-resize;}
.rz-se::after{bottom:5px;right:5px;}
/* Log extract: rule chips reuse .tpl-saved/.chip; small edit/delete marks. */
#leRuleList .chip .del,#leRuleList .chip .edit{margin-left:5px;cursor:pointer;font-size:11px;}
#leRuleList .chip .del{color:var(--red);}
#leRuleList .chip .edit{color:var(--text-dim);}
#leRuleList .chip .del:hover,#leRuleList .chip .edit:hover{opacity:1;}
/* Log extract: target list */
.le-targets{max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:3px;
  background:var(--vscode-input-background);margin-bottom:10px;}
.le-target-row{display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:12px;
  border-bottom:1px solid var(--hairline);}
.le-target-row:last-child{border-bottom:none;}
.le-target-row.disabled{opacity:.55;}
.le-target-row .tname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.le-target-row .tbuild{color:var(--text-dim);font-family:var(--font-mono);font-size:11px;}
.le-target-row .tstatus{font-size:10px;padding:1px 7px;border-radius:4px;background:color-mix(in srgb, var(--vscode-foreground) 6%, transparent);color:var(--text-dim);}
.le-target-row .tstatus.warn{color:var(--red);}
/* Log extract: result table */
.le-result-wrap{max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:3px;margin-bottom:10px;}
.le-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:auto;}
.le-table th,.le-table td{padding:5px 10px;border-bottom:1px solid var(--hairline);
  text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;}
.le-table th{position:sticky;top:0;background:var(--sidebar);color:var(--text-dim);
  font-weight:600;font-size:11px;z-index:1;}
.le-table tbody tr:hover{background:var(--vscode-list-hoverBackground);}
.le-table td.nomatch{color:var(--text-dim);font-style:italic;}
.le-table td.err{color:var(--red);}
.le-table td.val{font-family:var(--font-mono);color:var(--green);}
/* Log extract: the "#" column shows the real build address (clickable → browser). */
.le-table td.tbuild{font-family:var(--font-mono);font-size:11px;max-width:280px;}
.le-table td.tbuild .le-blink{color:var(--vscode-textLink-foreground);cursor:pointer;
  text-decoration:underline dotted;text-underline-offset:2px;}
.le-table td.tbuild .le-blink:hover{color:var(--vscode-textLink-activeForeground);}
/* Log extract: write-back area */
.le-writeback{border-top:1px dashed var(--border);padding-top:8px;font-size:12px;}
.le-writeback label{cursor:pointer;}
.le-wb-row{display:flex;gap:14px;align-items:center;margin:8px 0;color:var(--text-dim);flex-wrap:wrap;}
.le-wb-row label{cursor:pointer;color:var(--text);}
.le-wb-preview{background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;
  padding:7px 10px;font-size:11px;color:var(--text-dim);max-height:120px;overflow:auto;
  font-family:var(--font-mono);line-height:1.7;margin-top:4px;}
.le-wb-preview .wb-skip{font-style:italic;}
.le-wb-preview .wb-conflict{color:var(--yellow);}
.le-progress{color:var(--text-dim);font-size:12px;align-self:center;margin-right:8px;}
.le-rule-err{color:var(--red);font-size:11px;margin-top:6px;}
.btn:disabled{opacity:.45;cursor:not-allowed;}
.le-kind-row{display:flex;gap:18px;align-items:center;}
.le-kind-row label{display:flex;gap:5px;align-items:center;cursor:pointer;color:var(--text);}
#leRuleCode{width:100%;box-sizing:border-box;font-family:var(--font-mono);
  font-size:12px;line-height:1.6;resize:vertical;min-height:110px;
  background:var(--vscode-textCodeBlock-background);color:var(--text);border:1px solid var(--vscode-input-border,transparent);
  border-radius:3px;padding:7px 10px;transition:border-color .12s ease;}
#leRuleCode:focus{border-color:var(--vscode-focusBorder);}
#leRuleList .chip .kind{font-family:var(--font-mono);font-weight:700;
  color:var(--blue);background:color-mix(in srgb, var(--blue) 14%, transparent);border-radius:3px;padding:0 4px;
  margin-right:3px;font-size:11px;}
/* Resizable log panel — uses a draggable resizer bar instead of CSS resize
   because resize:vertical does not work reliably on flex column children.
   Override ALL conflicting wireframe properties (display:none, max-height:110px). */
.log-resizer{flex:0 0 6px;cursor:ns-resize;background:var(--border);
  border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
.log-resizer:hover,.log-resizer.dragging{background:var(--accent);}
.log-resizer.collapsed{cursor:default;background:var(--border);}
.logpanel{display:block !important;flex:0 0 120px;flex-grow:0;flex-shrink:0;
  max-height:none !important;min-height:0;height:120px;overflow:auto;border:none;
  background:var(--bg);padding:5px 12px;font-size:11px;color:var(--text-dim);font-family:var(--font-mono);}
.logpanel.collapsed{flex-basis:0 !important;height:0 !important;padding:0 12px;overflow:hidden;}
.logpanel div{padding:1px 0;}
.logpanel .ok{color:var(--green);} .logpanel .err{color:var(--red);} .logpanel .info{color:var(--blue);}
</style>
</head>
<body>
<div class="app">
  <div class="center">
    <div class="toolbar">
      <div class="search"><span class="codicon codicon-search" aria-hidden="true" style="color:var(--text-dim)"></span><input id="searchInput" data-i18n-placeholder="webview.html.searchPlaceholder" placeholder="${t("webview.html.searchPlaceholder")}" /></div>
      <div class="chips" id="statusChips">
        <span class="chip on" data-st="all" data-i18n="webview.html.chipAll">${t("webview.html.chipAll")}</span>
        <span class="chip" data-st="running"><span class="sw" style="background:var(--blue)"></span><span data-i18n="webview.status.running">${t("webview.status.running")}</span></span>
        <span class="chip" data-st="success"><span class="sw" style="background:var(--green)"></span><span data-i18n="webview.status.success">${t("webview.status.success")}</span></span>
        <span class="chip" data-st="failed"><span class="sw" style="background:var(--red)"></span><span data-i18n="webview.status.failed">${t("webview.status.failed")}</span></span>
      </div>
      <div class="divider"></div>
      <div class="autoref"><label><input type="checkbox" id="autoChk" checked /> <span data-i18n="webview.html.autoRefresh">${t("webview.html.autoRefresh")}</span></label>
        <select id="autoInt"><option value="5">5s</option><option value="10">10s</option><option value="30">30s</option><option value="60" selected>1m</option><option value="180">3m</option><option value="300">5m</option></select>
      </div>
      <div class="spacer"></div>
      <button class="btn" id="btnParams" data-i18n-title="webview.html.paramsTitle" title="${t("webview.html.paramsTitle")}"><span class="codicon codicon-settings-gear" aria-hidden="true"></span> <span data-i18n="webview.html.paramsBtn">${t("webview.html.paramsBtn")}</span> <span id="paramTplLabel">${t("webview.html.noTpl")}</span> <span id="paramCount" class="pcount">0</span></button>
      <button class="btn primary" id="btnTrigger"><span class="codicon codicon-play" aria-hidden="true"></span> <span data-i18n="webview.html.triggerBtn">${t("webview.html.triggerBtn")}</span></button>
      <button class="btn danger" id="btnAbort" data-i18n-title="webview.html.abortTitle" title="${t("webview.html.abortTitle")}"><span class="codicon codicon-debug-stop" aria-hidden="true"></span> <span data-i18n="webview.html.abortBtn">${t("webview.html.abortBtn")}</span></button>
      <button class="btn primary icon" id="btnRefresh" data-i18n-title="webview.html.refreshTitle" title="${t("webview.html.refreshTitle")}"><span class="codicon codicon-refresh" aria-hidden="true"></span> <span data-i18n="webview.html.refreshBtn">${t("webview.html.refreshBtn")}</span></button>
      <button class="btn" id="btnTimeout" data-i18n-title="webview.html.timeoutTitle" title="${t("webview.html.timeoutTitle")}"><span class="codicon codicon-clock" aria-hidden="true"></span> <span data-i18n="webview.html.timeoutBtn">${t("webview.html.timeoutBtn")}</span> <span id="timeoutVal">10</span>m</button>
      <button class="btn" id="btnActionsConfig" data-i18n-title="webview.html.actionsConfigTitle" title="${t("webview.html.actionsConfigTitle")}"><span class="codicon codicon-zap" aria-hidden="true"></span> <span data-i18n="webview.html.actionsConfigBtn">${t("webview.html.actionsConfigBtn")}</span></button>
      <button class="btn" id="btnLogExtract" data-i18n-title="webview.html.leTitle" title="${t("webview.html.leTitle")}"><span class="codicon codicon-search" aria-hidden="true"></span> <span data-i18n="webview.html.leBtn">${t("webview.html.leBtn")}</span></button>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th class="col-check"><input type="checkbox" id="checkAll" /></th>
          <th id="thPipeline" data-i18n-title="webview.html.thNameTitle" title="${t("webview.html.thNameTitle")}"><span data-i18n="webview.html.thPipeline">${t("webview.html.thPipeline")}</span></th><th><span data-i18n="webview.html.thStatus">${t("webview.html.thStatus")}</span></th>
          <th data-i18n-title="webview.html.thQueueTitle" title="${t("webview.html.thQueueTitle")}"><span data-i18n="webview.html.thQueue">${t("webview.html.thQueue")}</span></th>
          <th><span data-i18n="webview.html.thDuration">${t("webview.html.thDuration")}</span></th><th><span data-i18n="webview.html.thLastRun">${t("webview.html.thLastRun")}</span></th>
          <th data-i18n-title="webview.html.thBuildTitle" title="${t("webview.html.thBuildTitle")}"><span data-i18n="webview.html.thBuild">${t("webview.html.thBuild")}</span></th>
          <th data-i18n-title="webview.html.thParamTitle" title="${t("webview.html.thParamTitle")}"><span data-i18n="webview.html.thParam">${t("webview.html.thParam")}</span></th>
          <th id="thTimeout" data-i18n-title="webview.html.thTimeoutTitle" title="${t("webview.html.thTimeoutTitle")}"><span data-i18n="webview.html.thTimeout">${t("webview.html.thTimeout")}</span></th>
          <th id="thPre" data-i18n-title="webview.html.thPreTitle" title="${t("webview.html.thPreTitle")}"><span data-i18n="webview.html.thPre">${t("webview.html.thPre")}</span></th>
          <th id="thPost" data-i18n-title="webview.html.thPostTitle" title="${t("webview.html.thPostTitle")}"><span data-i18n="webview.html.thPost">${t("webview.html.thPost")}</span></th>
          <th><span data-i18n="webview.html.thActions">${t("webview.html.thActions")}</span></th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="empty-state" id="emptyState" style="display:none"><span class="codicon codicon-search" aria-hidden="true"></span> <span class="empty-text" data-i18n="webview.html.empty">${t("webview.html.empty")}</span></div>
    </div>
    <div class="actionbar">
      <span class="sel"><span data-i18n="webview.html.selected">${t("webview.html.selected")}</span> <b id="selCount">0</b> / <span id="totalCount">0</span></span>
      <span class="sel logtoggle" id="logToggle">${t("webview.html.logToggle")}</span>
      <div class="spacer"></div>
      <button class="btn" id="btnExportLog" data-i18n-title="webview.html.exportLog" data-i18n="webview.html.exportLog" title="${t("webview.html.exportLog")}">${t("webview.html.exportLog")}</button>
      <button class="btn" id="btnClearLog" data-i18n="webview.html.clearLog">${t("webview.html.clearLog")}</button>
    </div>
    <div class="log-resizer" id="logResizer" data-i18n-title="webview.html.resizerTitle" title="${t("webview.html.resizerTitle")}"></div>
    <div class="logpanel" id="logPanel"></div>
  </div>
</div>

<div class="overlay" id="paramOverlay">
  <div class="modal wide">
    <h3><span class="codicon codicon-settings-gear" aria-hidden="true"></span><span data-i18n="webview.html.paramModalTitle">${t("webview.html.paramModalTitle")}</span></h3>
    <div class="body">
      <div class="hint" data-i18n="webview.html.paramModalHint">${t("webview.html.paramModalHint")}</div>
      <div class="tpl-chips">
        <span style="color:var(--text-dim);font-size:11px;align-self:center;" data-i18n="webview.html.tplLabel">${t("webview.html.tplLabel")}</span>
        <button class="btn sm" id="btnUpdateParamTpl" style="margin-left:auto" title="${t("webview.html.updateTplTitle")}" data-i18n="webview.html.updateTpl">${t("webview.html.updateTpl")}</button>
        <button class="btn sm" id="btnSaveParamTpl" data-i18n="webview.html.saveTpl">${t("webview.html.saveTpl")}</button>
        <button class="btn sm" id="btnNewTplCat" data-i18n-title="webview.html.newCatTitle" data-i18n="webview.html.newCat" title="${t("webview.html.newCatTitle")}">${t("webview.html.newCat")}</button>
      </div>
      <div class="tpl-saved" id="paramTplList"></div>
      <div class="param-split">
        <div class="param-json">
          <div class="pj-head"><span><span data-i18n="webview.html.jsonHead">${t("webview.html.jsonHead")}</span> <span class="tag" data-i18n="webview.html.jsonTag">${t("webview.html.jsonTag")}</span></span><span class="pj-status ok" id="pjStatus">${t("webview.jsonValid")}</span></div>
          <textarea class="pj-text" id="paramJson" spellcheck="false" placeholder='{ "BRANCH": "main", "ENVIRONMENT": "staging" }'></textarea>
        </div>
        <div class="param-kv">
          <div class="pj-head"><span data-i18n="webview.html.kvHead">${t("webview.html.kvHead")}</span><span class="tag" data-i18n="webview.html.kvTag">${t("webview.html.kvTag")}</span></div>
          <div id="kvList"></div>
          <div class="kvfoot"><button class="btn sm" id="btnAddKv" data-i18n="webview.html.addParam">${t("webview.html.addParam")}</button></div>
        </div>
      </div>
    </div>
    <div class="foot">
      <button class="btn" id="btnParamCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnParamSave" data-i18n="webview.html.saveParams">${t("webview.html.saveParams")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="paramTplOverlay">
  <div class="modal">
    <h3 data-i18n="webview.html.tplModalTitle">${t("webview.html.tplModalTitle")}</h3>
    <div class="body">
      <div class="summary-box" id="paramTplSummary"></div>
      <div class="field"><label data-i18n="webview.html.tplNameLabel">${t("webview.html.tplNameLabel")}</label><input type="text" id="paramTplName" data-i18n-placeholder="webview.html.tplNamePlaceholder" placeholder="${t("webview.html.tplNamePlaceholder")}" /></div>
      <div class="hint" data-i18n="webview.html.tplHint">${t("webview.html.tplHint")}</div>
    </div>
    <div class="foot">
      <button class="btn" id="btnParamTplCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnParamTplSave" data-i18n="webview.html.saveTplBtn">${t("webview.html.saveTplBtn")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="tplCatOverlay">
  <div class="modal">
    <h3 data-i18n="webview.html.catModalTitle">${t("webview.html.catModalTitle")}</h3>
    <div class="body">
      <div class="field"><label data-i18n="webview.html.catNameLabel">${t("webview.html.catNameLabel")}</label><input type="text" id="tplCatName" data-i18n-placeholder="webview.html.catNamePlaceholder" placeholder="${t("webview.html.catNamePlaceholder")}" /></div>
      <div class="hint" data-i18n="webview.html.catHint">${t("webview.html.catHint")}</div>
    </div>
    <div class="foot">
      <button class="btn" id="btnTplCatCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnTplCatSave" data-i18n="webview.html.saveCatBtn">${t("webview.html.saveCatBtn")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="logExtractOverlay">
  <div class="modal wide">
    <h3 data-i18n="webview.html.leModalTitle">${t("webview.html.leModalTitle")}</h3>
    <div class="body">
      <div class="tpl-chips">
        <span style="color:var(--text-dim);font-size:11px;align-self:center;" data-i18n="webview.html.leRuleLabel">${t("webview.html.leRuleLabel")}</span>
        <button class="btn sm" id="btnLeNewRule" style="margin-left:auto" data-i18n="webview.html.leNewRule">${t("webview.html.leNewRule")}</button>
      </div>
      <div class="tpl-saved" id="leRuleList"></div>
      <div class="pj-head"><span data-i18n="webview.html.leTargetHead">${t("webview.html.leTargetHead")}</span><span class="tag" id="leTargetCount">0</span></div>
      <div class="le-targets" id="leTargetList"></div>
      <div id="leResultWrap" style="display:none">
        <div class="pj-head"><span data-i18n="webview.html.leResultHead">${t("webview.html.leResultHead")}</span><span class="tag" id="leSummary"></span></div>
        <div class="le-result-wrap"><table class="le-table"><thead id="leResultHead"></thead><tbody id="leResultBody"></tbody></table></div>
      </div>
      <div class="le-writeback">
        <label><input type="checkbox" id="leWriteBackChk" /> <span data-i18n="webview.html.leWriteBack">${t("webview.html.leWriteBack")}</span></label>
        <div id="leWriteBackOpts" style="display:none">
          <div class="le-wb-row">
            <span data-i18n="webview.html.leWbMode">${t("webview.html.leWbMode")}</span>
            <label><input type="radio" name="leWbMode" value="job" checked /> <span data-i18n="webview.html.leWbJob">${t("webview.html.leWbJob")}</span></label>
            <label><input type="radio" name="leWbMode" value="global" id="leWbGlobalRadio" /> <span data-i18n="webview.html.leWbGlobal">${t("webview.html.leWbGlobal")}</span></label>
          </div>
          <div class="hint" data-i18n="webview.html.leWbMergeHint">${t("webview.html.leWbMergeHint")}</div>
          <div class="le-wb-preview" id="leWbPreview"></div>
        </div>
      </div>
    </div>
    <div class="foot">
      <span class="le-progress" id="leProgress" style="display:none"></span>
      <div class="spacer"></div>
      <button class="btn" id="btnLeClose" data-i18n="webview.closeBtn">${t("webview.closeBtn")}</button>
      <button class="btn" id="btnLeCancel" style="display:none" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn" id="btnLeCopy" style="display:none" data-i18n="webview.html.leCopy">${t("webview.html.leCopy")}</button>
      <button class="btn" id="btnLeExport" style="display:none" data-i18n="webview.html.leExport" data-i18n-title="webview.html.leExportTitle">${t("webview.html.leExport")}</button>
      <button class="btn" id="btnLeExportJson" style="display:none" data-i18n="webview.html.leExportJson">${t("webview.html.leExportJson")}</button>
      <button class="btn" id="btnLeWriteBack" style="display:none" data-i18n="webview.html.leWriteBackBtn">${t("webview.html.leWriteBackBtn")}</button>
      <button class="btn primary" id="btnLeStart" data-i18n="webview.html.leStart">${t("webview.html.leStart")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="leRuleOverlay">
  <div class="modal">
    <h3 data-i18n="webview.html.leRuleModalTitle">${t("webview.html.leRuleModalTitle")}</h3>
    <div class="body">
      <div class="field"><label data-i18n="webview.html.leRuleName">${t("webview.html.leRuleName")}</label><input type="text" id="leRuleName" data-i18n-placeholder="webview.html.leRuleNamePh" placeholder="${t("webview.html.leRuleNamePh")}" /></div>
      <div class="field"><label data-i18n="webview.html.leRuleKind">${t("webview.html.leRuleKind")}</label>
        <div class="le-kind-row">
          <label><input type="radio" name="leRuleKind" value="regex" checked /> <span data-i18n="webview.html.leKindRegex">${t("webview.html.leKindRegex")}</span></label>
          <label><input type="radio" name="leRuleKind" value="script" /> <span data-i18n="webview.html.leKindScript">${t("webview.html.leKindScript")}</span></label>
        </div>
      </div>
      <div id="leRegexFields">
        <div class="field"><label data-i18n="webview.html.leRulePattern">${t("webview.html.leRulePattern")}</label><input type="text" id="leRulePattern" data-i18n-placeholder="webview.html.leRulePatternPh" placeholder="${t("webview.html.leRulePatternPh")}" spellcheck="false" /></div>
        <div class="hint" data-i18n="webview.html.leRulePatternHint">${t("webview.html.leRulePatternHint")}</div>
        <div class="field"><label data-i18n="webview.html.leRuleStrategy">${t("webview.html.leRuleStrategy")}</label>
          <select id="leRuleStrategy">
            <option value="first" data-i18n="webview.html.leStrategyFirst">${t("webview.html.leStrategyFirst")}</option>
            <option value="last" selected data-i18n="webview.html.leStrategyLast">${t("webview.html.leStrategyLast")}</option>
            <option value="all" data-i18n="webview.html.leStrategyAll">${t("webview.html.leStrategyAll")}</option>
          </select>
        </div>
      </div>
      <div id="leScriptFields" style="display:none">
        <div class="field"><label data-i18n="webview.html.leRuleCode">${t("webview.html.leRuleCode")}</label><textarea id="leRuleCode" rows="7" spellcheck="false" data-i18n-placeholder="webview.html.leRuleCodePh" placeholder="${t("webview.html.leRuleCodePh")}"></textarea></div>
        <div class="hint" data-i18n="webview.html.leRuleCodeHint">${t("webview.html.leRuleCodeHint")}</div>
      </div>
      <div class="field"><label data-i18n="webview.html.leRuleTargetKey">${t("webview.html.leRuleTargetKey")}</label><input type="text" id="leRuleTargetKey" data-i18n-placeholder="webview.html.leRuleTargetKeyPh" placeholder="${t("webview.html.leRuleTargetKeyPh")}" spellcheck="false" /></div>
      <div class="hint" data-i18n="webview.html.leRuleTargetKeyHint">${t("webview.html.leRuleTargetKeyHint")}</div>
      <div class="le-rule-err" id="leRuleErr" style="display:none"></div>
    </div>
    <div class="foot">
      <button class="btn" id="btnLeRuleCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnLeRuleSave" data-i18n="webview.html.leRuleSaveBtn">${t("webview.html.leRuleSaveBtn")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="leConfirmOverlay">
  <div class="modal">
    <h3 data-i18n="webview.html.leConfirmTitle">${t("webview.html.leConfirmTitle")}</h3>
    <div class="body">
      <div class="summary-box" id="leConfirmSummary"></div>
    </div>
    <div class="foot">
      <button class="btn" id="btnLeConfirmCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnLeConfirmOk" data-i18n="webview.html.leConfirmOk">${t("webview.html.leConfirmOk")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="triggerOverlay">
  <div class="modal">
    <h3><span class="codicon codicon-play" aria-hidden="true"></span><span data-i18n="webview.html.triggerModalTitle">${t("webview.html.triggerModalTitle")}</span></h3>
    <div class="body">
      <div class="hint" data-i18n="webview.html.triggerHint">${t("webview.html.triggerHint")}</div>
      <textarea class="prev" id="triggerPreviewText" readonly></textarea>
    </div>
    <div class="foot">
      <button class="btn" id="btnTriggerCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnTriggerConfirm" data-i18n="webview.triggerConfirm">${t("webview.triggerConfirm")}</button>
    </div>
  </div>
</div>

<div class="overlay" id="timeoutOverlay">
  <div class="modal">
    <h3><span class="codicon codicon-clock" aria-hidden="true"></span><span data-i18n="webview.html.timeoutModalTitle">${t("webview.html.timeoutModalTitle")}</span></h3>
    <div class="body">
      <div class="field"><label data-i18n="webview.html.timeoutModalLabel">${t("webview.html.timeoutModalLabel")}</label><input type="number" id="timeoutInput" min="1" step="1" /> <span style="color:var(--text-dim)" data-i18n="webview.html.timeoutModalUnit">${t("webview.html.timeoutModalUnit")}</span></div>
    </div>
    <div class="foot">
      <button class="btn" id="btnTimeoutCancel" data-i18n="webview.cancelBtn">${t("webview.cancelBtn")}</button>
      <button class="btn primary" id="btnTimeoutSave" data-i18n="webview.html.timeoutModalSave">${t("webview.html.timeoutModalSave")}</button>
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
