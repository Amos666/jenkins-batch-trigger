import * as vscode from "vscode";
import { StateService } from "./state";
import { t, setLocale, getLocale } from "./i18n";
import { Locale } from "./i18n/types";

type SettingsMsg =
  | { type: "load" }
  | { type: "test"; settings: { url: string; username: string; apiToken: string; trustSelfSignedCert: boolean } }
  | { type: "save"; settings: { url: string; username: string; apiToken: string; trustSelfSignedCert: boolean; language: string } };

export class SettingsPanel {
  private static current: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext, state: StateService): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    SettingsPanel.current = new SettingsPanel(context, state);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: StateService
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "jenkinsSettings",
      t("settings.title"),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((m: SettingsMsg) => void this.onMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async onMessage(m: SettingsMsg): Promise<void> {
    switch (m.type) {
      case "load": {
        const conn = await this.state.readJenkinsUrl();
        const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
        const hasToken = !!(await this.context.secrets.get("apiToken"));
        const trustCert = cfg.get<boolean>("trustSelfSignedCert") || false;
        const language = cfg.get<string>("language") || "zh";
        this.panel.webview.postMessage({
          type: "settings",
          data: { url: conn.url, username: conn.username, hasToken, trustSelfSignedCert: trustCert, language },
        });
        break;
      }
      case "test": {
        this.panel.webview.postMessage({ type: "testing" });
        const result = await this.state.testConnection(m.settings);
        this.panel.webview.postMessage({ type: "testResult", ...result });
        break;
      }
      case "save": {
        const { language, ...connSettings } = m.settings;
        const result = await this.state.saveConnection(connSettings);
        if (result.ok && language) {
          const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
          await cfg.update("language", language, vscode.ConfigurationTarget.Global);
          setLocale(language as Locale);
        }
        this.panel.webview.postMessage({ type: "saved", ...result });
        break;
      }
    }
  }

  private dispose(): void {
    SettingsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root {
  --bg: var(--vscode-editor-background);
  --fg: var(--vscode-editor-foreground);
  --input-bg: var(--vscode-input-background);
  --input-fg: var(--vscode-input-foreground);
  --input-border: var(--vscode-input-border, #444);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --btn2-bg: var(--vscode-button-secondaryBackground);
  --btn2-fg: var(--vscode-button-secondaryForeground);
  --btn2-hover: var(--vscode-button-secondaryHoverBackground);
  --focus: var(--vscode-focusBorder);
  --desc: var(--vscode-descriptionForeground);
  --err: var(--vscode-errorForeground);
  --ok: var(--vscode-testing-iconPassed, #4caf50);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--fg); background: var(--bg); padding: 24px 32px; max-width: 560px; }
h1 { font-size: 16px; font-weight: 600; margin-bottom: 20px; }
.field { margin-bottom: 16px; }
.field label { display: block; font-weight: 500; margin-bottom: 4px; }
.field .hint { font-size: 11px; color: var(--desc); margin-top: 2px; }
input[type="text"], input[type="password"], select {
  width: 100%; padding: 6px 8px; font-size: 13px;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: 3px;
  outline: none;
}
input:focus, select:focus { border-color: var(--focus); }
.checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.checkbox-row input { width: auto; }
.checkbox-row label { font-weight: 400; margin: 0; }
.actions { display: flex; gap: 10px; margin-top: 20px; }
button {
  padding: 7px 16px; font-size: 13px; border: none; border-radius: 3px; cursor: pointer;
}
button.primary { background: var(--btn-bg); color: var(--btn-fg); }
button.primary:hover { background: var(--btn-hover); }
button.secondary { background: var(--btn2-bg); color: var(--btn2-fg); }
button.secondary:hover { background: var(--btn2-hover); }
button:disabled { opacity: 0.5; cursor: default; }
#result { margin-top: 16px; padding: 10px 12px; border-radius: 4px; display: none; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
#result.ok { display: block; background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
#result.err { display: block; background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
#result.info { display: block; color: var(--desc); }
</style>
</head>
<body>
<h1>${t("settings.title")}</h1>

<div class="field">
  <label>${t("settings.url")}</label>
  <input type="text" id="url" placeholder="${t("settings.urlPlaceholder")}">
</div>

<div class="field">
  <label>${t("settings.username")}</label>
  <input type="text" id="username" placeholder="${t("settings.usernamePlaceholder")}">
</div>

<div class="field">
  <label>${t("settings.token")}</label>
  <input type="password" id="token" placeholder="${t("settings.tokenPlaceholder")}">
  <div class="hint">${t("settings.tokenHint")}</div>
</div>

<div class="checkbox-row">
  <input type="checkbox" id="trustCert">
  <label for="trustCert">${t("settings.trustCert")}</label>
</div>

<div class="field">
  <label>${t("settings.language")}</label>
  <select id="language">
    <option value="zh">中文</option>
    <option value="en">English</option>
  </select>
</div>

<div class="actions">
  <button class="secondary" id="testBtn">${t("settings.testBtn")}</button>
  <button class="primary" id="saveBtn">${t("settings.saveBtn")}</button>
</div>

<div id="result"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

function post(type, extra) { vscode.postMessage({ type, ...extra }); }

function getSettings() {
  return {
    url: $("url").value.trim(),
    username: $("username").value.trim(),
    apiToken: $("token").value,
    trustSelfSignedCert: $("trustCert").checked,
  };
}

function showResult(cls, msg) {
  const el = $("result");
  el.className = cls;
  el.textContent = msg;
}

$("testBtn").addEventListener("click", () => {
  $("testBtn").disabled = true;
  showResult("info", ${JSON.stringify(t("settings.testing"))});
  post("test", { settings: getSettings() });
});

$("saveBtn").addEventListener("click", () => {
  $("saveBtn").disabled = true;
  post("save", { settings: { ...getSettings(), language: $("language").value } });
});

window.addEventListener("message", (e) => {
  const m = e.data;
  switch (m.type) {
    case "settings": {
      $("url").value = m.data.url || "";
      $("username").value = m.data.username || "";
      $("trustCert").checked = !!m.data.trustSelfSignedCert;
      $("language").value = m.data.language || "zh";
      if (m.data.hasToken) {
        $("token").placeholder = "•••••••• (" + ${JSON.stringify(t("settings.tokenHint"))} + ")";
      }
      break;
    }
    case "testing":
      showResult("info", ${JSON.stringify(t("settings.testing"))});
      break;
    case "testResult": {
      $("testBtn").disabled = false;
      if (m.ok) {
        showResult("ok", ${JSON.stringify(t("settings.testOk", { count: "" }))}.replace("{count}", m.jobCount));
      } else {
        showResult("err", ${JSON.stringify(t("settings.testFailed", { error: "" }))}.replace("{error}", m.error || "unknown"));
      }
      break;
    }
    case "saved": {
      $("saveBtn").disabled = false;
      if (m.ok) {
        showResult("ok", ${JSON.stringify(t("settings.saved"))});
      } else {
        showResult("err", ${JSON.stringify(t("settings.saveFailed", { error: "" }))}.replace("{error}", m.error || "unknown"));
      }
      break;
    }
  }
});

post("load");
</script>
</body>
</html>`;
  }
}
