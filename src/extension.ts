import * as vscode from "vscode";
import { GlobalStore } from "./globalStore";
import { SidebarTreeProvider } from "./treeProvider";
import { WebviewProvider } from "./webviewProvider";
import { StateService } from "./state";
import { JenkinsSettings } from "./jenkinsClient";
import { TreeNode } from "./types";

export function activate(context: vscode.ExtensionContext): void {
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

  const state = new StateService(store, credsProvider, context.extensionUri);
  const tree = new SidebarTreeProvider(state);
  const webview = new WebviewProvider(context, state);
  state.attach(tree, webview);
  let deleteInProgress = false;

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
  status.command = "jenkins-batch-trigger.openSettings";
  context.subscriptions.push(status);
  const updateStatus = async () => {
    const s = await credsProvider.readSettings();
    if (s.url) {
      status.text = `$(server) Jenkins: ${s.url.replace(/^https?:\/\//, "")}`;
      status.tooltip = `${s.username || "?"}@${s.url}`;
    } else {
      status.text = "$(warning) Jenkins: 未配置";
      status.tooltip = "点击配置 Jenkins 连接（URL / 用户名 / API Token）";
    }
    status.show();
  };
  updateStatus();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("jenkinsBatchTrigger")) {
        updateStatus();
      }
    })
  );

  registerCommands(context, state, tree, webview, treeView);

  // Auto-open the batch runner panel on startup.
  webview.show();
}

function registerCommands(
  context: vscode.ExtensionContext,
  state: StateService,
  tree: SidebarTreeProvider,
  webview: WebviewProvider,
  treeView: vscode.TreeView<TreeNode>
): void {
  let deleteInProgress = false;
  const subs = [
    vscode.commands.registerCommand("jenkins-batch-trigger.open", () => webview.show()),

    // ---- Sidebar filter ----

    vscode.commands.registerCommand("jenkins-batch-trigger.filterTree", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "输入过滤关键词（名称或路径）",
        value: state.filterText,
        placeHolder: "例如：deploy、team-a",
        ignoreFocusOut: true,
      });
      if (value !== undefined) {
        state.setFilter(value);
        treeView.description = value ? `过滤: ${value}` : undefined;
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.clearFilter", () => {
      state.setFilter("");
      treeView.description = undefined;
    }),

    // ---- Tree structure commands ----

    // Create a top-level folder (right-click on empty sidebar area).
    vscode.commands.registerCommand("jenkins-batch-trigger.addRootFolder", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "新建文件夹名称",
        placeHolder: "例如：支付线 / 每日发版",
        ignoreFocusOut: true,
      });
      if (name) {
        state.addFolder(null, name);
      }
    }),

    // Create a sub-folder (right-click on a folder node).
    vscode.commands.registerCommand("jenkins-batch-trigger.addSubFolder", async (node: TreeNode) => {
      const name = await vscode.window.showInputBox({
        prompt: `在「${node.name}」下新建子文件夹`,
        placeHolder: "输入文件夹名称",
        ignoreFocusOut: true,
      });
      if (name) {
        state.addFolder(node.id, name);
      }
    }),

    // Add job nodes (right-click on a folder node or root).
    vscode.commands.registerCommand("jenkins-batch-trigger.addJobNodes", async (node?: TreeNode) => {
      // node is undefined when triggered from view title; create at root level.
      const parentId = node && node.type === "folder" ? node.id : null;
      await state.addJobNodes(parentId);
    }),

    // Rename a node.
    vscode.commands.registerCommand("jenkins-batch-trigger.renameNode", async (node: TreeNode) => {
      const name = await vscode.window.showInputBox({
        prompt: "重命名",
        value: node.name,
        ignoreFocusOut: true,
      });
      if (name) {
        state.renameNode(node.id, name);
      }
    }),

    // Delete node(s). Uses treeView.selection to get all selected nodes so that
    // multi-select delete only confirms once instead of once per node.
    vscode.commands.registerCommand("jenkins-batch-trigger.deleteNode", async () => {
      if (deleteInProgress) return;
      const nodes = treeView.selection;
      if (nodes.length === 0) return;

      deleteInProgress = true;
      try {
        const ids = nodes.map((n) => n.id);
        const names = nodes.map((n) => n.name);
        const msg = nodes.length === 1
          ? `确定删除「${names[0]}」？`
          : `确定删除选中的 ${nodes.length} 个节点（${names.slice(0, 3).join("、")}${names.length > 3 ? "…" : ""}）？`;
        const confirmed = await vscode.window.showWarningMessage(msg, "删除", "取消");
        if (confirmed === "删除") {
          state.deleteNodes(ids);
        }
      } finally {
        deleteInProgress = false;
      }
    }),

    // Delete all currently checked (selected) job nodes.
    vscode.commands.registerCommand("jenkins-batch-trigger.deleteSelectedNodes", async () => {
      const selectedIds = [...state.selected];
      if (selectedIds.length === 0) {
        void vscode.window.showInformationMessage("当前没有选中的节点。");
        return;
      }
      const msg = `确定删除 ${selectedIds.length} 个选中的节点？`;
      const confirmed = await vscode.window.showWarningMessage(msg, "删除", "取消");
      if (confirmed === "删除") {
        state.deleteNodes(selectedIds);
      }
    }),

    // Refresh status of all jobs under a folder.
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

    vscode.commands.registerCommand("jenkins-batch-trigger.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "jenkinsBatchTrigger")
    ),

    vscode.commands.registerCommand("jenkins-batch-trigger.setApiToken", async () => {
      const token = await vscode.window.showInputBox({
        prompt: "输入 Jenkins API Token",
        password: true,
        placeHolder: "在 Jenkins → Configure User → API Token 中生成",
        ignoreFocusOut: true,
      });
      if (token !== undefined) {
        await context.secrets.store("apiToken", token);
        void vscode.window.showInformationMessage("Jenkins API Token 已保存（SecretStorage）。");
      }
    }),

    vscode.commands.registerCommand("jenkins-batch-trigger.configConn", async () => {
      const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
      const curUrl = cfg.get<string>("jenkinsUrl") || "";
      const curUser = cfg.get<string>("username") || "";

      // 1. Jenkins URL
      const url = await vscode.window.showInputBox({
        prompt: "Jenkins 服务器地址",
        value: curUrl,
        placeHolder: "https://jenkins.example.com（不要带末尾斜杠）",
        ignoreFocusOut: true,
      });
      if (url === undefined) return;
      await cfg.update("jenkinsUrl", url.trim(), vscode.ConfigurationTarget.Global);

      // 2. Username
      const username = await vscode.window.showInputBox({
        prompt: "Jenkins 用户名",
        value: curUser,
        placeHolder: "登录用户名",
        ignoreFocusOut: true,
      });
      if (username === undefined) return;
      await cfg.update("username", username.trim(), vscode.ConfigurationTarget.Global);

      // 3. API Token
      const token = await vscode.window.showInputBox({
        prompt: "Jenkins API Token",
        password: true,
        placeHolder: "在 Jenkins → Configure User → API Token 中生成",
        ignoreFocusOut: true,
      });
      if (token === undefined) return;
      if (token) {
        await context.secrets.store("apiToken", token);
      }

      // 4. Trust self-signed cert
      const trustCert = await vscode.window.showQuickPick(
        ["否", "是"],
        { title: "信任自签名证书？（内网 Jenkins 常用）", ignoreFocusOut: true }
      );
      if (trustCert) {
        await cfg.update("trustSelfSignedCert", trustCert === "是", vscode.ConfigurationTarget.Global);
      }

      void vscode.window.showInformationMessage("Jenkins 连接配置已保存。");
    }),

    // Clear selection.
    vscode.commands.registerCommand("jenkins-batch-trigger.clearSelection", () => {
      state.clearSelection();
    }),
  ];
  context.subscriptions.push(...subs);
}

export function deactivate(): void {
  /* nothing to clean up */
}
