import * as vscode from "vscode";
import { getWebviewHtml } from "./webviewHtml";
import { StateService, Snapshot } from "./state";
import { ParamTemplate } from "./types";
import { getWebviewMessages } from "./i18n";

/** Inbound message shapes from the webview. */
type InMsg =
  | { type: "load"; id: number }
  | { type: "trigger"; id: number; data: { nodeIds: string[]; params: Record<string, string>; jobParams?: Record<string, Record<string, string>> } }
  | { type: "abort"; id: number; data: { nodeIds: string[] } }
  | { type: "refresh"; id: number; data: { mode: "all" | "nonTerminal" } }
  | { type: "saveParamTpl"; id: number; data: { name: string; params: [string, string][] } }
  | { type: "deleteParamTpl"; id: number; data: { id: number } }
  | { type: "reorderParamTpl"; id: number; data: { ids: number[] } }
  | { type: "overwriteDefaultTpl"; id: number; data: { params: [string, string][] } }
  | { type: "saveActiveTpl"; data: { name: string } }
  | { type: "togglePre"; id: number; data: { jobPath: string } }
  | { type: "togglePost"; id: number; data: { jobPath: string } }
  | { type: "setPreBatch"; id: number; data: { jobPaths: string[]; enabled: boolean } }
  | { type: "setPostBatch"; id: number; data: { jobPaths: string[]; enabled: boolean } }
  | { type: "openActionsConfig" }
  | { type: "openBuild"; data: { url: string } }
  | { type: "exportLog"; data: { text: string } }
  | { type: "clearSelection" };

interface LoadResult extends Snapshot {
  jenkinsUrl: string;
  username: string;
  activeTpl?: string;
}
interface ActionResult extends Snapshot {
  errors: string[];
}

/**
 * Owns the webview panel (center area — the sidebar is the native tree).
 * Bridges webview messages to StateService and pushes state back.
 * Connection config (URL/token) is handled by the sidebar settings button,
 * NOT in the webview.
 */
export class WebviewProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: StateService
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "jenkinsBatchTrigger",
      "Jenkins Batch Trigger",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    this.panel.webview.html = getWebviewHtml(this.panel.webview, this.context.extensionUri);
    this.panel.webview.onDidReceiveMessage(
      (m: InMsg) => this.onMessage(m),
      undefined,
      this.context.subscriptions
    );
    this.panel.onDidDispose(() => (this.panel = undefined));
  }

  /** Pushed by StateService when shared state changes (tree-initiated). */
  pushState(s: Snapshot): void {
    this.panel?.webview.postMessage({ type: "state", data: s });
  }
  pushFilter(_search: string, _status: string): void {
    // Filter is now webview-local only; no push needed.
  }
  /** Push a log line to the webview activity log panel. */
  pushLog(msg: string): void {
    this.panel?.webview.postMessage({ type: "log", msg });
  }
  /** Push updated i18n messages when language changes. */
  pushLocale(messages: Record<string, string>): void {
    this.panel?.webview.postMessage({ type: "locale", messages });
  }

  private async onMessage(m: InMsg): Promise<void> {
    switch (m.type) {
      case "load": {
        const conn = await this.state.readJenkinsUrl();
        const r: LoadResult = { ...this.state.snapshot(), jenkinsUrl: conn.url, username: conn.username, activeTpl: this.state.loadActiveTpl() };
        this.reply(m.id, r);
        this.panel?.webview.postMessage({ type: "locale", messages: getWebviewMessages() });
        break;
      }
      case "trigger": {
        const { errors } = await this.state.trigger(m.data.nodeIds, m.data.params, m.data.jobParams);
        this.reply(m.id, { ...this.state.snapshot(), errors } as ActionResult);
        break;
      }
      case "abort": {
        const { errors } = await this.state.abort(m.data.nodeIds);
        this.reply(m.id, { ...this.state.snapshot(), errors } as ActionResult);
        break;
      }
      case "refresh": {
        const mode = m.data?.mode === "nonTerminal" ? "nonTerminal" : "all";
        const { errors } = await this.state.refreshSelected(mode);
        this.reply(m.id, { ...this.state.snapshot(), errors } as ActionResult);
        break;
      }
      case "saveParamTpl": {
        this.state.saveParamTemplate(m.data.name, m.data.params);
        this.reply(m.id, this.paramResult());
        break;
      }
      case "deleteParamTpl": {
        this.state.deleteParamTemplate(m.data.id);
        this.reply(m.id, this.paramResult());
        break;
      }
      case "reorderParamTpl": {
        this.state.reorderParamTemplates(m.data.ids);
        this.reply(m.id, this.paramResult());
        break;
      }
      case "overwriteDefaultTpl": {
        this.state.overwriteDefaultTpl(m.data.params);
        this.reply(m.id, this.paramResult());
        break;
      }
      case "saveActiveTpl": {
        this.state.saveActiveTpl(m.data.name);
        break;
      }
      case "togglePre": {
        await this.state.togglePreActions(m.data.jobPath);
        this.reply(m.id, this.state.snapshot());
        break;
      }
      case "togglePost": {
        await this.state.togglePostActions(m.data.jobPath);
        this.reply(m.id, this.state.snapshot());
        break;
      }
      case "setPreBatch": {
        await this.state.setPreEnabled(m.data.jobPaths, m.data.enabled);
        this.reply(m.id, this.state.snapshot());
        break;
      }
      case "setPostBatch": {
        await this.state.setPostEnabled(m.data.jobPaths, m.data.enabled);
        this.reply(m.id, this.state.snapshot());
        break;
      }
      case "openActionsConfig": {
        const { ActionsConfigPanel } = await import("./actionsConfigPanel");
        ActionsConfigPanel.createOrShow(this.context, this.state);
        break;
      }
      case "openBuild":
        if (m.data?.url) {
          void vscode.env.openExternal(vscode.Uri.parse(m.data.url));
        }
        break;
      case "exportLog": {
        const doc = await vscode.workspace.openTextDocument({ content: m.data.text, language: "log" });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const end = doc.lineAt(doc.lineCount - 1).range.end;
        editor.selection = new vscode.Selection(new vscode.Position(0, 0), end);
        editor.revealRange(editor.selection);
        break;
      }
      case "clearSelection":
        this.state.clearSelection();
        break;
    }
  }

  /** Snapshot focusing on param templates. */
  private paramResult(): { paramTemplates: ParamTemplate[] } {
    return { paramTemplates: this.state.paramTemplates };
  }

  private reply(id: number, data: unknown): void {
    if (id > 0) {
      this.panel?.webview.postMessage({ id, data });
    }
  }
}
