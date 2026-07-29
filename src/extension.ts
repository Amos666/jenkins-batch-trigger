import * as vscode from "vscode";
import { GlobalStore } from "./globalStore";
import { SidebarTreeProvider } from "./treeProvider";
import { WebviewProvider } from "./webviewProvider";
import { StateService } from "./state";
import { JenkinsSettings } from "./jenkinsClient";
import { TreeNode } from "./types";
import { initI18n, t, setLocale, onLocaleChange, getWebviewMessages } from "./i18n";
import { Locale } from "./i18n/types";

export function activate(context: vscode.ExtensionContext): void {
  initI18n();

  const store = new GlobalStore(context);

  const credsProvider = {
    async readSettings(): Promise<JenkinsSettings> {
      const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
      return {
        url: cfg.get<string>("jenkinsUrl") || "",
        username: cfg.get<string>("username") || "",
        trustSelfSignedCert: cfg.get<boolean>("trustSelfSignedCert") || false,
        apiToken: (await context.secrets.get("apiToken")) || "",
      };
    },
    async writeSettings(settings: Partial<JenkinsSettings>): Promise<void> {
      const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
      if (settings.url !== undefined) {
        await cfg.update("jenkinsUrl", settings.url, vscode.ConfigurationTarget.Global);
      }
      if (settings.username !== undefined) {
        await cfg.update("username", settings.username, vscode.ConfigurationTarget.Global);
      }
      if (settings.trustSelfSignedCert !== undefined) {
        await cfg.update("trustSelfSignedCert", settings.trustSelfSignedCert, vscode.ConfigurationTarget.Global);
      }
    },
    async saveToken(token: string): Promise<void> {
      await context.secrets.store("apiToken", token);
    },
    async getProxyUrl(): Promise<string | undefined> {
      const httpCfg = vscode.workspace.getConfiguration("http");
      const proxy = httpCfg.get<string>("proxy");
      if (!proxy) {
        return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || process.env.https_proxy || undefined;
      }
      return proxy || undefined;
    },
    async shouldUseProxy(url: string): Promise<boolean> {
      const httpCfg = vscode.workspace.getConfiguration("http");
      const excludeUrls = httpCfg.get<string[]>("proxyExcludeUrls") || [];
      for (const pattern of excludeUrls) {
        try {
          if (pattern.startsWith("*") || pattern.includes("*")) {
            const regexPattern = pattern.replace(/\*/g, ".*");
            if (new RegExp(regexPattern, "i").test(url)) {
              return false;
            }
          } else if (url.includes(pattern)) {
            return false;
          }
        } catch {
          /* ignore regex errors */
        }
      }
      const noProxyEnv = process.env.NO_PROXY || process.env.no_proxy || "";
      for (const pattern of noProxyEnv.split(",").map((s) => s.trim())) {
        if (!pattern) continue;
        if (pattern.startsWith("*") || pattern.includes("*")) {
          const regexPattern = pattern.replace(/\*/g, ".*");
          if (new RegExp(regexPattern, "i").test(url)) {
            return false;
          }
        } else if (url.includes(pattern)) {
          return false;
        }
      }
      return true;
    },
  };

  const state = new StateService(store, credsProvider, context.extensionUri, context.globalStorageUri);
  const tree = new SidebarTreeProvider(state);
  const webview = new WebviewProvider(context, state);
  state.attach(tree, webview);

  // Native sidebar tree (with checkboxes + multi-select for batch delete).
  const treeView = vscode.window.createTreeView<TreeNode>("jenkins-batch-trigger.explorer", {
    treeDataProvider: tree,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    treeView.onDidChangeCheckboxState((e) => {
      for (const [node, st] of e.items) {
        tree.handleCheckbox(node, st);
      }
    })
  );

  // Double-click detection on job nodes: cycle display name format.
  let lastClickTime = 0;
  let lastClickId = "";
  context.subscriptions.push(
    treeView.onDidChangeSelection((e) => {
      const now = Date.now();
      if (e.selection.length > 0) {
        webview.show();
      }
      if (e.selection.length === 1) {
        const node = e.selection[0];
        if (node.type === "job" && node.id === lastClickId && now - lastClickTime < 500) {
          tree.cycleDisplayName(node.id);
          lastClickTime = 0;
          lastClickId = "";
        } else {
          lastClickTime = now;
          lastClickId = node.id;
        }
      }
    })
  );

  // Status bar: connection indicator.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "jenkins-batch-trigger.configConn";
  context.subscriptions.push(status);
  const updateStatus = async () => {
    const s = await credsProvider.readSettings();
    if (s.url) {
      status.text = `$(server) Jenkins: ${s.url.replace(/^https?:\/\//, "")}`;
      status.tooltip = `${s.username || "?"}@${s.url}`;
    } else {
      status.text = t("status.notConfigured");
      status.tooltip = t("status.notConfiguredTip");
    }
    status.show();
  };
  updateStatus();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("jenkinsBatchTrigger")) {
        updateStatus();
      }
      if (e.affectsConfiguration("jenkinsBatchTrigger.language")) {
        const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
        setLocale((cfg.get<string>("language") as Locale) || "zh");
      }
    })
  );

  // OutputChannel for action/poller logs.
  const actionOutput = vscode.window.createOutputChannel("Pipeline Actions");
  context.subscriptions.push(actionOutput);
  state.poller.outputLogger = (msg) => actionOutput.appendLine(msg);
  state.actionEngine.outputLogger = (msg) => actionOutput.appendLine(msg);
  state.outputLogger = (msg) => actionOutput.appendLine(msg);

  // Pipeline runtime status bar.
  const pipelineStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  pipelineStatus.command = "jenkins-batch-trigger.showActionOutput";
  context.subscriptions.push(pipelineStatus);

  const updatePipelineStatus = () => {
    const p = state.poller;
    const running = p.runningCount;
    const queued = p.queuedCount;
    const failed = p.failedCount;

    if (running === 0 && queued === 0 && failed === 0) {
      pipelineStatus.text = t("status.ready");
      pipelineStatus.tooltip = t("status.readyTip");
    } else {
      const parts: string[] = [];
      if (running > 0) parts.push(t("status.running", { n: running }));
      if (queued > 0) parts.push(t("status.queued", { n: queued }));
      if (failed > 0) parts.push(t("status.failed", { n: failed }));
      const icon = failed > 0 ? "$(error)" : "$(sync~spin)";
      pipelineStatus.text = `${icon} Pipeline: ${parts.join(" / ")}`;
      pipelineStatus.tooltip = t("status.tooltip", { running, queued, failed });
    }
    pipelineStatus.show();
  };

  state.poller.onStatusChange = updatePipelineStatus;
  updatePipelineStatus();

  // Propagate locale changes to all UI surfaces.
  context.subscriptions.push(
    onLocaleChange(() => {
      tree.refresh();
      void updateStatus();
      updatePipelineStatus();
      webview.pushLocale(getWebviewMessages());
    })
  );

  registerCommands(context, state, tree, webview, treeView, actionOutput);

  // Auto-open the batch runner panel on startup.
  webview.show();
}

function registerCommands(
  context: vscode.ExtensionContext,
  state: StateService,
  tree: SidebarTreeProvider,
  webview: WebviewProvider,
  treeView: vscode.TreeView<TreeNode>,
  actionOutput: vscode.OutputChannel
): void {
  let deleteInProgress = false;
  const subs = [
    vscode.commands.registerCommand("jenkins-batch-trigger.open", () => webview.show()),

    // ---- Sidebar filter ----

    vscode.commands.registerCommand("jenkins-batch-trigger.filterTree", async () => {
      const value = await vscode.window.showInputBox({
        prompt: t("cmd.filterPrompt"),
        value: state.filterText,
        placeHolder: t("cmd.filterPlaceholder"),
        ignoreFocusOut: true,
      });
      if (value !== undefined) {
        state.setFilter(value);
        treeView.description = value ? t("cmd.filterDesc", { value }) : undefined;
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.clearFilter", () => {
      state.setFilter("");
      treeView.description = undefined;
    }),

    // ---- Tree structure commands ----

    vscode.commands.registerCommand("jenkins-batch-trigger.addRootFolder", async () => {
      const name = await vscode.window.showInputBox({
        prompt: t("cmd.newFolderPrompt"),
        placeHolder: t("cmd.newFolderPlaceholder"),
        ignoreFocusOut: true,
      });
      if (name) {
        state.addFolder(null, name);
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.addSubFolder", async (node: TreeNode) => {
      const name = await vscode.window.showInputBox({
        prompt: t("cmd.newSubFolderPrompt", { name: node.name }),
        placeHolder: t("cmd.newSubFolderPlaceholder"),
        ignoreFocusOut: true,
      });
      if (name) {
        state.addFolder(node.id, name);
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.addJobNodes", async (node?: TreeNode) => {
      const parentId = node && node.type === "folder" ? node.id : null;
      await state.addJobNodes(parentId);
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.renameNode", async (node: TreeNode) => {
      const name = await vscode.window.showInputBox({
        prompt: t("cmd.renamePrompt"),
        value: node.name,
        ignoreFocusOut: true,
      });
      if (name) {
        state.renameNode(node.id, name);
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.deleteNode", async () => {
      if (deleteInProgress) return;
      const nodes = treeView.selection;
      if (nodes.length === 0) return;

      deleteInProgress = true;
      try {
        const ids = nodes.map((n) => n.id);
        const names = nodes.map((n) => n.name);
        const msg = nodes.length === 1
          ? t("cmd.deleteOne", { name: names[0] })
          : t("cmd.deleteMany", { count: nodes.length, names: names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "") });
        const confirmed = await vscode.window.showWarningMessage(msg, t("cmd.deleteBtn"), t("cmd.cancelBtn"));
        if (confirmed === t("cmd.deleteBtn")) {
          state.deleteNodes(ids);
        }
      } finally {
        deleteInProgress = false;
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.deleteSelectedNodes", async () => {
      const selectedIds = [...state.selected];
      if (selectedIds.length === 0) {
        void vscode.window.showInformationMessage(t("cmd.noSelection"));
        return;
      }
      const msg = t("cmd.deleteSelected", { count: selectedIds.length });
      const confirmed = await vscode.window.showWarningMessage(msg, t("cmd.deleteBtn"), t("cmd.cancelBtn"));
      if (confirmed === t("cmd.deleteBtn")) {
        state.deleteNodes(selectedIds);
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.refreshNode", async (node: TreeNode) => {
      if (node.type === "folder") {
        await state.refreshNodeStatus(node.id);
      }
    }),

    // ---- Job actions ----

    vscode.commands.registerCommand("jenkins-batch-trigger.openBuild", (url?: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),

    // ---- Settings ----

    vscode.commands.registerCommand("jenkins-batch-trigger.openSettings", async () => {
      const { SettingsPanel } = await import("./settingsPanel");
      SettingsPanel.createOrShow(context, state);
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.setApiToken", async () => {
      const token = await vscode.window.showInputBox({
        prompt: t("cmd.tokenPrompt"),
        password: true,
        placeHolder: t("cmd.tokenPlaceholder"),
        ignoreFocusOut: true,
      });
      if (token !== undefined) {
        await context.secrets.store("apiToken", token);
        void vscode.window.showInformationMessage(t("cmd.tokenSaved"));
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.configConn", async () => {
      const { SettingsPanel } = await import("./settingsPanel");
      SettingsPanel.createOrShow(context, state);
    }),

    // Clear selection.
    vscode.commands.registerCommand("jenkins-batch-trigger.clearSelection", () => {
      state.clearSelection();
    }),

    // ---- Action system ----

    vscode.commands.registerCommand("jenkins-batch-trigger.showActionOutput", () => {
      actionOutput.show(true);
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.togglePreActions", async (node: TreeNode) => {
      if (!node || node.type !== "job" || !node.jobPath) return;
      const enabled = await state.togglePreActions(node.jobPath);
      void vscode.window.showInformationMessage(
        enabled ? t("cmd.preActionsEnabled", { name: node.name }) : t("cmd.preActionsDisabled", { name: node.name })
      );
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.togglePostActions", async (node: TreeNode) => {
      if (!node || node.type !== "job" || !node.jobPath) return;
      const enabled = await state.togglePostActions(node.jobPath);
      void vscode.window.showInformationMessage(
        enabled ? t("cmd.postActionsEnabled", { name: node.name }) : t("cmd.postActionsDisabled", { name: node.name })
      );
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.openActionsConfig", async (node?: TreeNode) => {
      const { ActionsConfigPanel } = await import("./actionsConfigPanel");
      ActionsConfigPanel.createOrShow(context, state, node?.jobPath);
    }),
  ];
  context.subscriptions.push(...subs);

  // Dispose the build poller on deactivation.
  context.subscriptions.push({ dispose: () => state.poller.dispose() });
}

export function deactivate(): void {
  /* nothing to clean up */
}
