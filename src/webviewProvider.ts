import * as vscode from "vscode";
import { getWebviewHtml } from "./webviewHtml";
import { StateService, Snapshot } from "./state";
import { ParamTemplate } from "./types";

/** Inbound message shapes from the webview. */
type InMsg =
  | { type: "load"; id: number }
  | { type: "trigger"; id: number; data: { nodeIds: string[]; params: Record<string, string>; jobParams?: Record<string, Record<string, string>> } }
  | { type: "abort"; id: number; data: { nodeIds: string[] } }
  | { type: "refresh"; id: number; data: { mode: "all" | "nonTerminal" } }
  | { type: "saveParamTpl"; id: number; data: { name: string; params: [string, string][] } }
  | { type: "deleteParamTpl"; id: number; data: { id: number } }
  | { type: "openBuild"; data: { url: string } }
  | { type: "clearSelection" };

interface LoadResult extends Snapshot {
  jenkinsUrl: string;
  username: string;
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

  private async onMessage(m: InMsg): Promise<void> {
    switch (m.type) {
      case "load": {
        const conn = await this.state.readJenkinsUrl();
        const r: LoadResult = { ...this.state.snapshot(), jenkinsUrl: conn.url, username: conn.username };
        this.reply(m.id, r);
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
      case "openBuild":
        if (m.data?.url) {
          void vscode.env.openExternal(vscode.Uri.parse(m.data.url));
        }
        break;
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
