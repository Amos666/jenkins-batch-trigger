import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

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
      <div class="search"><span style="color:var(--text-dim)">🔍</span><input id="searchInput" placeholder="按名称/folder 筛选 pipeline…" /></div>
      <div class="chips" id="statusChips">
        <span class="chip on" data-st="all">全部</span>
        <span class="chip" data-st="running"><span class="sw" style="background:var(--blue)"></span>Running</span>
        <span class="chip" data-st="success"><span class="sw" style="background:var(--green)"></span>Success</span>
        <span class="chip" data-st="failed"><span class="sw" style="background:var(--red)"></span>Failed</span>
        <span class="chip" data-st="unstable"><span class="sw" style="background:var(--yellow)"></span>Unstable</span>
        <span class="chip" data-st="aborted"><span class="sw" style="background:var(--gray)"></span>Aborted</span>
      </div>
      <div class="divider"></div>
      <div class="autoref"><label><input type="checkbox" id="autoChk" /> 自动刷新</label>
        <select id="autoInt"><option value="5">5s</option><option value="10" selected>10s</option><option value="30">30s</option><option value="60">1m</option></select>
      </div>
      <div class="spacer"></div>
      <button class="btn" id="btnParams" title="点击配置批量触发参数">⚙ 参数 · <span id="paramTplLabel">未应用模板</span> <span id="paramCount" class="pcount">0</span></button>
      <button class="btn primary" id="btnTrigger">▶ 批量触发</button>
      <button class="btn danger" id="btnAbort" title="中止选中的运行中 pipeline">⏹ 批量中止</button>
      <button class="btn primary icon" id="btnRefresh" title="立即刷新状态">⟳ 刷新</button>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th class="col-check"><input type="checkbox" id="checkAll" /></th>
          <th>Pipeline</th><th>状态</th>
          <th title="该 job 当前在 Jenkins 构建队列中等待的数量">队列</th>
          <th>上次构建</th><th>耗时</th><th>最近运行</th>
          <th title="点击在浏览器打开该次构建的真实页面">当前构建</th>
          <th title="点击展开编辑该 job 的专属参数（优先于批量参数）">参数</th>
          <th>操作</th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="empty-state" id="emptyState" style="display:none">没有匹配的 pipeline</div>
    </div>
    <div class="actionbar">
      <span class="sel">已选 <b id="selCount">0</b> / <span id="totalCount">0</span></span>
      <span class="sel logtoggle" id="logToggle">▾ 活动日志</span>
      <div class="spacer"></div>
      <button class="btn" id="btnClearLog">清除日志</button>
    </div>
    <div class="log-resizer" id="logResizer" title="拖拽调整日志面板高度"></div>
    <div class="logpanel" id="logPanel"></div>
  </div>
</div>

<!-- 参数编辑 Modal（左 JSON 权威 + 右 KV 速编） -->
<div class="overlay" id="paramOverlay">
  <div class="modal wide">
    <h3>⚙ 批量触发参数</h3>
    <div class="body">
      <div class="hint">左侧 <b>JSON</b> 为<strong>最终下发参数</strong>（可直接编辑，触发以此为准）；右侧键值对速编用于辅助构建，改动实时同步到左侧。模板可一键填充。</div>
      <div class="tpl-chips">
        <span style="color:var(--text-dim);font-size:11px;align-self:center;">参数模板：</span>
        <button class="btn sm" id="btnSaveParamTpl" style="margin-left:auto">＋ 存为模板</button>
      </div>
      <div class="tpl-saved" id="paramTplList"></div>
      <div class="param-split">
        <div class="param-json">
          <div class="pj-head"><span>最终参数 (JSON) <span class="tag">· 触发以此为准</span></span><span class="pj-status ok" id="pjStatus">✓ 有效</span></div>
          <textarea class="pj-text" id="paramJson" spellcheck="false" placeholder='{ "BRANCH": "main", "ENVIRONMENT": "staging" }'></textarea>
        </div>
        <div class="param-kv">
          <div class="pj-head"><span>键值对速编</span><span class="tag">· 辅助</span></div>
          <div id="kvList"></div>
          <div class="kvfoot"><button class="btn sm" id="btnAddKv">+ 添加参数</button></div>
        </div>
      </div>
    </div>
    <div class="foot">
      <button class="btn" id="btnParamCancel">取消</button>
      <button class="btn primary" id="btnParamSave">保存参数</button>
    </div>
  </div>
</div>

<!-- 保存参数模板 Modal -->
<div class="overlay" id="paramTplOverlay">
  <div class="modal">
    <h3>＋ 保存参数模板</h3>
    <div class="body">
      <div class="summary-box" id="paramTplSummary"></div>
      <div class="field"><label>模板名称</label><input type="text" id="paramTplName" placeholder="例如：生产部署 / 灰度发布" /></div>
      <div class="hint">保存当前参数键值对为模板，后续在「参数」弹窗中可一键套用或删除。</div>
    </div>
    <div class="foot">
      <button class="btn" id="btnParamTplCancel">取消</button>
      <button class="btn primary" id="btnParamTplSave">保存模板</button>
    </div>
  </div>
</div>

<!-- 触发参数预览 / 确认 Modal -->
<div class="overlay" id="triggerOverlay">
  <div class="modal">
    <h3>▶ 确认批量触发</h3>
    <div class="body">
      <div class="hint">以下为本次触发将下发的<strong>真实参数</strong>与目标 pipeline，请确认无误后点击「确认触发」。</div>
      <textarea class="prev" id="triggerPreviewText" readonly></textarea>
    </div>
    <div class="foot">
      <button class="btn" id="btnTriggerCancel">取消</button>
      <button class="btn primary" id="btnTriggerConfirm">确认触发</button>
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
