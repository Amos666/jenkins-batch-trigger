import * as vscode from "vscode";
import { StateService } from "./state";
import { ActionsConfigFile, ActionConfig, emptyActionsConfig } from "./actionTypes";
import { t } from "./i18n";

/** Inbound messages from the config webview. */
type ConfigMsg =
  | { type: "load" }
  | { type: "save"; config: ActionsConfigFile }
  | { type: "loadState"; pipelineId: string }
  | { type: "saveState"; pipelineId: string; state: string }
  | { type: "resetState"; pipelineId: string }
  | { type: "dryRun"; pipelineId: string; params: Record<string, string> }
  | { type: "listStates" };

/**
 * Singleton Webview panel for configuring pre/post actions.
 * 4 tabs: Pre-actions, Post-actions, State viewer, Dry-run.
 */
export class ActionsConfigPanel {
  private static current: ActionsConfigPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext, state: StateService, focusPipeline?: string): void {
    if (ActionsConfigPanel.current) {
      ActionsConfigPanel.current.panel.reveal(vscode.ViewColumn.Active);
      if (focusPipeline) {
        ActionsConfigPanel.current.panel.webview.postMessage({ type: "focus", pipelineId: focusPipeline });
      }
      return;
    }
    ActionsConfigPanel.current = new ActionsConfigPanel(context, state, focusPipeline);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: StateService,
    private focusPipeline?: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "actionsConfig",
      t("config.title"),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((m: ConfigMsg) => void this.onMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async onMessage(m: ConfigMsg): Promise<void> {
    switch (m.type) {
      case "load": {
        const cfg = await this.state.getActionsConfig();
        this.post({ type: "config", config: cfg, focusPipeline: this.focusPipeline });
        break;
      }
      case "save": {
        await this.state.saveActionsConfig(m.config);
        this.post({ type: "saved" });
        break;
      }
      case "listStates": {
        const ids = await this.state.actionStore.listStatePipelineIds();
        this.post({ type: "stateList", ids });
        break;
      }
      case "loadState": {
        const st = await this.state.actionStore.loadState(m.pipelineId);
        this.post({ type: "stateData", pipelineId: m.pipelineId, state: JSON.stringify(st, null, 2) });
        break;
      }
      case "saveState": {
        try {
          const parsed = JSON.parse(m.state);
          await this.state.actionStore.saveState(m.pipelineId, parsed);
          this.post({ type: "stateSaved", ok: true });
        } catch (e) {
          this.post({ type: "stateSaved", ok: false, error: (e as Error).message });
        }
        break;
      }
      case "resetState": {
        await this.state.actionStore.deleteState(m.pipelineId);
        this.post({ type: "stateReset", pipelineId: m.pipelineId });
        break;
      }
      case "dryRun": {
        const result = await this.state.dryRunPreActions(m.pipelineId, m.params);
        this.post({ type: "dryRunResult", ...result });
        break;
      }
    }
  }

  private post(msg: unknown): void {
    this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    ActionsConfigPanel.current = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private getHtml(): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${this.panel.webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${t("config.title")}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, -apple-system, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh; display: flex; flex-direction: column;
    line-height: 1.5;
  }

  /* ---- Tabs ---- */
  .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); padding: 0 16px; background: var(--vscode-sideBar-background); }
  .tab { padding: 10px 18px; cursor: pointer; border-bottom: 2px solid transparent;
    color: var(--vscode-descriptionForeground); font-size: 13px; transition: color 0.15s, border-color 0.15s; user-select: none; }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .tab:hover:not(.active) { color: var(--vscode-foreground); }

  /* ---- Panels ---- */
  .panel { flex: 1; overflow: auto; padding: 20px; display: none; }
  .panel.active { display: block; }

  /* ---- Sections ---- */
  .section { margin-bottom: 20px; }
  .section-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }

  /* ---- Action cards ---- */
  .action-card {
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid var(--vscode-symbolIcon-variableForeground);
    border-radius: 6px; padding: 14px 16px; margin-bottom: 10px;
    background: var(--vscode-sideBar-background);
    transition: border-color 0.15s;
  }
  .action-card:hover { border-color: var(--vscode-focusBorder); }
  .action-card[data-type="state_read"] { border-left-color: var(--vscode-symbolIcon-variableForeground); }
  .action-card[data-type="regex_extract"] { border-left-color: var(--vscode-symbolIcon-methodForeground); }
  .action-card[data-type="template_render"] { border-left-color: var(--vscode-symbolIcon-fieldForeground); }
  .action-card[data-type="http_request"] { border-left-color: var(--vscode-symbolIcon-interfaceForeground); }
  .action-card[data-type="env_read"] { border-left-color: var(--vscode-symbolIcon-constantForeground); }
  .action-card[data-type="script"] { border-left-color: var(--vscode-symbolIcon-classForeground); }

  .action-card .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .action-card .head .type-badge {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 3px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .action-card .head select {
    background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 3px; padding: 4px 8px; font-size: 12px;
  }
  .action-card .fields { display: grid; grid-template-columns: 130px 1fr; gap: 8px 14px; align-items: start; }
  .action-card .fields label { font-size: 12px; color: var(--vscode-descriptionForeground); padding-top: 5px; }
  .action-card .fields input, .action-card .fields select {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
    padding: 5px 10px; font-size: 13px; width: 100%; outline: none;
    transition: border-color 0.15s;
  }
  .action-card .fields input:focus, .action-card .fields select:focus, .action-card .fields textarea:focus {
    border-color: var(--vscode-focusBorder);
  }
  .action-card .fields input::placeholder { color: var(--vscode-input-placeholderForeground); font-style: italic; }
  .action-card .fields textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
    padding: 8px 10px; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace);
    min-height: 72px; resize: vertical; width: 100%; outline: none; transition: border-color 0.15s;
  }

  /* ---- Add action placeholder ---- */
  .add-card {
    border: 1px dashed var(--vscode-panel-border); border-radius: 6px;
    padding: 14px; text-align: center; cursor: pointer;
    color: var(--vscode-descriptionForeground); font-size: 12px;
    transition: border-color 0.15s, color 0.15s;
  }
  .add-card:hover { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }

  /* ---- Buttons ---- */
  .btn {
    padding: 6px 14px; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn:active { opacity: 0.7; }
  .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); }
  .btn.sm { padding: 3px 10px; font-size: 11px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ---- Toolbar ---- */
  .toolbar { display: flex; gap: 10px; margin-bottom: 14px; align-items: center; }

  /* ---- Enabled pipelines ---- */
  .enabled-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
  .enabled-item input[type="checkbox"] { accent-color: var(--vscode-checkbox-background); }

  /* ---- State editor ---- */
  .state-editor {
    width: 100%; min-height: 300px; resize: vertical;
    background: var(--vscode-textCodeBlock-background); color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border); border-radius: 6px;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    padding: 14px; outline: none; line-height: 1.6; transition: border-color 0.15s;
  }
  .state-editor:focus { border-color: var(--vscode-focusBorder); }
  .state-select {
    flex: 1; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 3px; padding: 5px 10px; font-size: 13px;
  }

  /* ---- Dry run ---- */
  .dry-form { display: grid; grid-template-columns: 130px 1fr; gap: 8px 14px; margin-bottom: 14px; align-items: start; }
  .dry-form label { font-size: 12px; color: var(--vscode-descriptionForeground); padding-top: 5px; }
  .dry-form input, .dry-form textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
    padding: 5px 10px; font-size: 13px; width: 100%; outline: none; transition: border-color 0.15s;
  }
  .dry-form input:focus, .dry-form textarea:focus { border-color: var(--vscode-focusBorder); }
  .dry-form textarea { font-family: var(--vscode-editor-font-family, monospace); min-height: 72px; resize: vertical; font-size: 12px; }
  .dry-result { margin-top: 16px; }
  .dry-result-card {
    border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 14px;
    background: var(--vscode-sideBar-background); margin-bottom: 8px;
  }
  .dry-result-card .label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .dry-result-card .value {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px;
    white-space: pre-wrap; word-break: break-all;
  }
  .dry-result-card .value.ok { border-left: 3px solid var(--vscode-testing-iconPassed); }
  .dry-result-card .value.err { border-left: 3px solid var(--vscode-errorForeground); }
  .dry-log { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; white-space: pre-wrap; }

  /* ---- Footer ---- */
  .footer { padding: 14px 20px; border-top: 1px solid var(--vscode-panel-border);
    display: flex; gap: 10px; justify-content: flex-end; background: var(--vscode-sideBar-background); }

  /* ---- Toast ---- */
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    padding: 8px 20px; border-radius: 4px; font-size: 12px;
    opacity: 0; transition: opacity 0.25s; pointer-events: none; }
  .toast.show { opacity: 1; }

  /* ---- Reduced motion ---- */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body>
<div class="tabs">
  <div class="tab active" data-tab="pre">${t("config.preActions")}</div>
  <div class="tab" data-tab="post">${t("config.postActions")}</div>
  <div class="tab" data-tab="state">${t("config.stateTab")}</div>
  <div class="tab" data-tab="dry">${t("config.dryRun")}</div>
</div>

<div class="panel active" id="panel-pre">
  <div class="section">
    <div class="section-title">Pre-Actions</div>
    <div class="hint">${t("config.preHint")}</div>
    <div id="preList"></div>
    <div class="add-card" id="btnAddPre">${t("config.addPre")}</div>
  </div>
</div>

<div class="panel" id="panel-post">
  <div class="section">
    <div class="section-title">Post-Actions</div>
    <div class="hint">${t("config.postHint")}</div>
    <div id="postList"></div>
    <div class="add-card" id="btnAddPost">${t("config.addPost")}</div>
  </div>
</div>

<div class="panel" id="panel-state">
  <div class="section">
    <div class="section-title">${t("config.stateTitle")}</div>
    <div class="hint">${t("config.stateHint")}</div>
    <div class="toolbar">
      <select id="stateSelect" class="state-select"><option value="">${t("config.selectPipeline")}</option></select>
      <button class="btn sm" id="btnLoadState">${t("config.load")}</button>
      <button class="btn sm danger" id="btnResetState">${t("config.reset")}</button>
    </div>
    <textarea id="stateEditor" class="state-editor" spellcheck="false" placeholder="${t("config.statePlaceholder")}"></textarea>
    <div style="margin-top:10px"><button class="btn primary" id="btnSaveState">${t("config.saveState")}</button></div>
  </div>
</div>

<div class="panel" id="panel-dry">
  <div class="section">
    <div class="section-title">${t("config.dryTitle")}</div>
    <div class="hint">${t("config.dryHint")}</div>
    <div class="dry-form">
      <label>${t("config.dryPipeline")}</label>
      <input id="dryPipeline" placeholder="${t("config.dryPipelinePlaceholder")}" />
      <label>${t("config.dryParams")}</label>
      <textarea id="dryParams" spellcheck="false">{"param1": "pr1"}</textarea>
    </div>
    <button class="btn primary" id="btnDryRun">${t("config.dryRunBtn")}</button>
    <div class="dry-result" id="dryResult" style="display:none"></div>
  </div>
</div>

<div class="footer">
  <button class="btn primary" id="btnSave">${t("config.save")}</button>
</div>
<div class="toast" id="toast"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const I18N = {
  typeStateRead: ${JSON.stringify(t("config.typeStateRead"))},
  typeRegexExtract: ${JSON.stringify(t("config.typeRegexExtract"))},
  typeTemplateRender: ${JSON.stringify(t("config.typeTemplateRender"))},
  typeHttpRequest: ${JSON.stringify(t("config.typeHttpRequest"))},
  typeEnvRead: ${JSON.stringify(t("config.typeEnvRead"))},
  typeScript: ${JSON.stringify(t("config.typeScript"))},
  deleteBtn: ${JSON.stringify(t("config.delete"))},
  noEnabled: ${JSON.stringify(t("config.noEnabledShort"))},
  saved: ${JSON.stringify(t("config.saved"))},
  stateSaved: ${JSON.stringify(t("config.stateSaved"))},
  stateReset: ${JSON.stringify(t("config.stateReset"))},
  saveFailed: ${JSON.stringify(t("config.saveFailed"))},
  dryNoPipeline: ${JSON.stringify(t("config.dryNoPipeline"))},
  dryBadJson: ${JSON.stringify(t("config.dryBadJson"))},
  running: ${JSON.stringify(t("config.running"))},
  dryRunBtn: ${JSON.stringify(t("config.dryRunBtn"))},
  selectPipeline: ${JSON.stringify(t("config.selectPipeline"))},
  renderResult: ${JSON.stringify(t("config.renderResult"))},
  errors: ${JSON.stringify(t("config.errors"))},
  fieldKey: ${JSON.stringify(t("config.fieldKey"))},
  fieldTarget: ${JSON.stringify(t("config.fieldTarget"))},
  fieldOnMissing: ${JSON.stringify(t("config.fieldOnMissing"))},
  fieldFallback: ${JSON.stringify(t("config.fieldFallback"))},
  fieldSource: ${JSON.stringify(t("config.fieldSource"))},
  fieldPattern: ${JSON.stringify(t("config.fieldPattern"))},
  fieldTargetTpl: ${JSON.stringify(t("config.fieldTargetTpl"))},
  fieldStrategy: ${JSON.stringify(t("config.fieldStrategy"))},
  fieldOnNoMatch: ${JSON.stringify(t("config.fieldOnNoMatch"))},
  fieldTemplate: ${JSON.stringify(t("config.fieldTemplate"))},
  fieldUrl: ${JSON.stringify(t("config.fieldUrl"))},
  fieldMethod: ${JSON.stringify(t("config.fieldMethod"))},
  fieldOnError: ${JSON.stringify(t("config.fieldOnError"))},
  fieldVar: ${JSON.stringify(t("config.fieldVar"))},
  fieldCode: ${JSON.stringify(t("config.fieldCode"))},
};
let config = { enabled_pipelines: [], pre_actions: [], post_actions: [] };

/* ---- Tabs ---- */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('panel-' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'state') vscode.postMessage({ type: 'listStates' });
}));

/* ---- Toast ---- */
function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2000); }

/* ---- Action type metadata ---- */
const ACTION_TYPES = ['state_read','regex_extract','template_render','http_request','env_read','script'];
const TYPE_LABELS = { state_read:I18N.typeStateRead, regex_extract:I18N.typeRegexExtract, template_render:I18N.typeTemplateRender, http_request:I18N.typeHttpRequest, env_read:I18N.typeEnvRead, script:I18N.typeScript };
const TYPE_FIELDS = {
  state_read: [['key',I18N.fieldKey],['target',I18N.fieldTarget],['on_missing',I18N.fieldOnMissing,'select:skip,fail,fallback'],['fallback',I18N.fieldFallback]],
  regex_extract: [['source',I18N.fieldSource,'select:pipeline_logs'],['pattern',I18N.fieldPattern],['target',I18N.fieldTargetTpl],['strategy',I18N.fieldStrategy,'select:first,last,all'],['on_no_match',I18N.fieldOnNoMatch,'select:warn,fail,skip']],
  template_render: [['template',I18N.fieldTemplate],['target',I18N.fieldTarget]],
  http_request: [['url',I18N.fieldUrl],['method',I18N.fieldMethod,'select:GET,POST'],['target',I18N.fieldTarget],['on_error',I18N.fieldOnError,'select:fail,warn,skip']],
  env_read: [['var',I18N.fieldVar],['target',I18N.fieldTarget],['on_missing',I18N.fieldOnMissing,'select:skip,fail,fallback'],['fallback',I18N.fieldFallback]],
  script: [['code',I18N.fieldCode,'textarea'],['on_error',I18N.fieldOnError,'select:fail,warn,skip']],
};

function renderActions(list, containerId) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  list.forEach((action, i) => {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.dataset.type = action.type;
    const fields = TYPE_FIELDS[action.type] || [];
    let fieldsHtml = fields.map(([key, label, kind]) => {
      const val = action[key] || '';
      if (kind === 'textarea') return '<label>'+esc(label)+'</label><textarea data-field="'+key+'" spellcheck="false">'+esc(val)+'</textarea>';
      if (kind && kind.startsWith('select:')) {
        const opts = kind.slice(7).split(',').map(o => '<option value="'+o+'"'+(val===o?' selected':'')+'>'+o+'</option>').join('');
        return '<label>'+esc(label)+'</label><select data-field="'+key+'">'+opts+'</select>';
      }
      return '<label>'+esc(label)+'</label><input data-field="'+key+'" value="'+esc(val)+'" placeholder="'+esc(label)+'" />';
    }).join('');
    card.innerHTML =
      '<div class="head">' +
        '<span class="type-badge">'+(TYPE_LABELS[action.type]||action.type)+'</span>' +
        '<select class="type-sel" data-idx="'+i+'">' +
          ACTION_TYPES.map(t => '<option value="'+t+'"'+(action.type===t?' selected':'')+'>'+t+'</option>').join('') +
        '</select>' +
        '<span style="flex:1"></span>' +
        '<button class="btn sm danger" data-del="'+i+'">'+I18N.deleteBtn+'</button>' +
      '</div>' +
      '<div class="fields">'+fieldsHtml+'</div>';
    box.appendChild(card);
    card.querySelector('.type-sel').addEventListener('change', (e) => {
      list[i] = { type: e.target.value };
      renderActions(list, containerId);
    });
    card.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => { list[i][el.dataset.field] = el.value; });
      el.addEventListener('change', () => { list[i][el.dataset.field] = el.value; });
    });
    card.querySelector('[data-del]').addEventListener('click', () => { list.splice(i, 1); renderActions(list, containerId); });
  });
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

document.getElementById('btnAddPre').addEventListener('click', () => { config.pre_actions.push({ type: 'state_read', key: '', target: 'pipeline_params.', on_missing: 'skip' }); renderActions(config.pre_actions, 'preList'); });
document.getElementById('btnAddPost').addEventListener('click', () => { config.post_actions.push({ type: 'regex_extract', source: 'pipeline_logs', pattern: '', target: 'state.', strategy: 'first', on_no_match: 'warn' }); renderActions(config.post_actions, 'postList'); });

/* ---- Save ---- */
document.getElementById('btnSave').addEventListener('click', () => { vscode.postMessage({ type: 'save', config }); });

/* ---- State tab ---- */
document.getElementById('btnLoadState').addEventListener('click', () => {
  const id = document.getElementById('stateSelect').value;
  if (id) vscode.postMessage({ type: 'loadState', pipelineId: id });
});
document.getElementById('btnSaveState').addEventListener('click', () => {
  const id = document.getElementById('stateSelect').value;
  if (id) vscode.postMessage({ type: 'saveState', pipelineId: id, state: document.getElementById('stateEditor').value });
});
document.getElementById('btnResetState').addEventListener('click', () => {
  const id = document.getElementById('stateSelect').value;
  if (id) vscode.postMessage({ type: 'resetState', pipelineId: id });
});

/* ---- Dry run ---- */
document.getElementById('btnDryRun').addEventListener('click', () => {
  const pipelineId = document.getElementById('dryPipeline').value.trim();
  if (!pipelineId) { toast(I18N.dryNoPipeline); return; }
  let params = {};
  try { params = JSON.parse(document.getElementById('dryParams').value || '{}'); } catch(e) { toast(I18N.dryBadJson); return; }
  const btn = document.getElementById('btnDryRun');
  btn.disabled = true; btn.textContent = I18N.running;
  vscode.postMessage({ type: 'dryRun', pipelineId, params });
});

/* ---- Messages from extension ---- */
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'config') {
    config = m.config;
    renderActions(config.pre_actions, 'preList');
    renderActions(config.post_actions, 'postList');
    if (m.focusPipeline) document.getElementById('dryPipeline').value = m.focusPipeline;
  } else if (m.type === 'saved') { toast(I18N.saved); }
  else if (m.type === 'stateList') {
    const sel = document.getElementById('stateSelect');
    sel.innerHTML = '<option value="">'+I18N.selectPipeline+'</option>' + m.ids.map(id => '<option value="'+esc(id)+'">'+esc(id)+'</option>').join('');
  } else if (m.type === 'stateData') { document.getElementById('stateEditor').value = m.state; }
  else if (m.type === 'stateSaved') { toast(m.ok ? I18N.stateSaved : I18N.saveFailed.replace('{error}', m.error||'')); }
  else if (m.type === 'stateReset') { document.getElementById('stateEditor').value = ''; toast(I18N.stateReset); }
  else if (m.type === 'dryRunResult') {
    const btn = document.getElementById('btnDryRun');
    btn.disabled = false; btn.textContent = I18N.dryRunBtn;
    const box = document.getElementById('dryResult');
    box.style.display = 'block';
    let html = '<div class="section-title" style="margin-bottom:10px">'+I18N.renderResult+'</div>';
    const params = m.params || {};
    for (const [k, v] of Object.entries(params)) {
      html += '<div class="dry-result-card"><div class="label">'+esc(k)+'</div><div class="value ok">'+esc(String(v))+'</div></div>';
    }
    if (m.errors && m.errors.length) {
      html += '<div class="dry-result-card"><div class="label">'+I18N.errors+'</div><div class="value err">'+m.errors.map(esc).join('\\n')+'</div></div>';
    }
    if (m.logs && m.logs.length) {
      html += '<div class="dry-log">'+m.logs.map(esc).join('\\n')+'</div>';
    }
    box.innerHTML = html;
  }
  else if (m.type === 'focus') { document.getElementById('dryPipeline').value = m.pipelineId; }
});

vscode.postMessage({ type: 'load' });
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
