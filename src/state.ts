import * as vscode from "vscode";
import { TreeNode, TreeConfig, genId, ParamTemplate, nextId, Job } from "./types";
import { GlobalStore } from "./globalStore";
import { JenkinsClient, JenkinsCredsProvider } from "./jenkinsClient";
import { JobPickerPanel } from "./jobPickerPanel";

/** Snapshot pushed to the webview whenever shared state changes. */
export interface Snapshot {
  selectedNodes: TreeNode[];
  paramTemplates: ParamTemplate[];
}

/**
 * Single source of truth for the user-defined tree + selection.
 * Tree structure is stored in VSCode globalState (shared across workspaces).
 * No server calls happen on startup — only when user explicitly adds/refreshes.
 */
export class StateService {
  private readonly client: JenkinsClient;
  private readonly creds: JenkinsCredsProvider;
  private readonly picker: JobPickerPanel;
  private tree: { refresh(): void } | undefined;
  private webview:
    | {
        pushState(s: Snapshot): void;
        pushFilter(search: string, status: string): void;
        pushLog(msg: string): void;
      }
    | undefined;

  /** The user-defined tree (folders + job references). */
  treeConfig: TreeConfig;
  /** IDs of currently checked job nodes. */
  selected = new Set<string>();
  paramTemplates: ParamTemplate[];

  constructor(
    private readonly store: GlobalStore,
    credsProvider: JenkinsCredsProvider,
    private readonly extensionUri: vscode.Uri
  ) {
    this.treeConfig = store.loadTree();
    this.creds = credsProvider;
    this.client = new JenkinsClient(credsProvider);
    // Forward all Jenkins network activity to the webview log panel.
    this.client.logger = (msg) => this.pushLog(msg);
    this.paramTemplates = store.loadParamTemplates();
    this.picker = new JobPickerPanel();
  }

  attach(tree: { refresh(): void }, webview: { pushState(s: Snapshot): void; pushFilter(search: string, status: string): void; pushLog(msg: string): void }): void {
    this.tree = tree;
    this.webview = webview;
  }

  /** Push a log line to the webview activity log panel. */
  pushLog(msg: string): void {
    this.webview?.pushLog(msg);
  }

  snapshot(): Snapshot {
    const selectedNodes = [...this.selected]
      .map((id) => this.treeConfig.nodes[id])
      .filter((n): n is TreeNode => !!n && n.type === "job");
    return {
      selectedNodes,
      paramTemplates: this.paramTemplates,
    };
  }

  /* ---------------- Jenkins connection ---------------- */

  async readJenkinsUrl(): Promise<{ url: string; username: string }> {
    const s = await this.creds.readSettings();
    return { url: s.url, username: s.username };
  }

  async getConnConfig(): Promise<{ url: string; username: string; trustSelfSignedCert: boolean }> {
    const s = await this.creds.readSettings();
    return { url: s.url, username: s.username, trustSelfSignedCert: s.trustSelfSignedCert };
  }

  async testConnection(settings: {
    url: string;
    username: string;
    apiToken: string;
    trustSelfSignedCert: boolean;
  }): Promise<{ ok: boolean; error?: string; jobCount?: number }> {
    try {
      let apiToken = settings.apiToken;
      if (!apiToken) {
        const current = await this.creds.readSettings();
        apiToken = current.apiToken;
      }
      if (!settings.url || !settings.username || !apiToken) {
        return { ok: false, error: "URL、用户名和 API Token 不能为空" };
      }
      const testProvider: JenkinsCredsProvider = {
        readSettings: async () => ({
          url: settings.url,
          username: settings.username,
          apiToken,
          trustSelfSignedCert: settings.trustSelfSignedCert,
        }),
        writeSettings: this.creds.writeSettings.bind(this.creds),
        saveToken: this.creds.saveToken.bind(this.creds),
        getProxyUrl: this.creds.getProxyUrl.bind(this.creds),
      };
      const testClient = new JenkinsClient(testProvider);
      // Forward test-connection network logs to the webview as well.
      testClient.logger = (msg) => this.pushLog(msg);
      const jobs = await testClient.listJobsInFolder("");
      return { ok: true, jobCount: jobs.length };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async saveConnection(settings: {
    url: string;
    username: string;
    apiToken: string;
    trustSelfSignedCert: boolean;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.creds.writeSettings({
        url: settings.url,
        username: settings.username,
        trustSelfSignedCert: settings.trustSelfSignedCert,
      });
      if (settings.apiToken) {
        await this.creds.saveToken(settings.apiToken);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /* ---------------- tree structure ---------------- */

  private notifyTree(): void {
    this.tree?.refresh();
  }
  private pushWebview(): void {
    this.webview?.pushState(this.snapshot());
  }
  private saveTree(): void {
    this.store.saveTree(this.treeConfig);
  }

  /** Get root-level nodes. */
  getRootNodes(): TreeNode[] {
    return this.treeConfig.rootIds
      .map((id) => this.treeConfig.nodes[id])
      .filter((n): n is TreeNode => !!n);
  }

  /** Get children of a folder node. */
  getChildren(parentId: string | null): TreeNode[] {
    if (parentId === null) {
      return this.getRootNodes();
    }
    return Object.values(this.treeConfig.nodes)
      .filter((n) => n.parentId === parentId)
      .filter((n): n is TreeNode => !!n);
  }

  /** Create a new folder node under a parent (or root if null). */
  addFolder(parentId: string | null, name: string): TreeNode {
    const node: TreeNode = {
      id: genId(),
      type: "folder",
      name,
      parentId,
    };
    this.treeConfig.nodes[node.id] = node;
    if (parentId === null) {
      this.treeConfig.rootIds.push(node.id);
    }
    this.saveTree();
    this.notifyTree();
    return node;
  }

  /** Rename a node. */
  renameNode(id: string, name: string): void {
    const node = this.treeConfig.nodes[id];
    if (!node) return;
    node.name = name;
    this.saveTree();
    this.notifyTree();
  }

  /** Delete a node and all its descendants (cascade). */
  deleteNode(id: string): void {
    this.deleteNodes([id]);
  }

  /** Batch delete multiple nodes (cascade delete for folders). */
  deleteNodes(ids: string[]): void {
    if (ids.length === 0) return;

    // Collect all descendant IDs recursively for each node.
    const toDelete = new Set<string>();
    const collect = (nodeId: string) => {
      toDelete.add(nodeId);
      for (const child of Object.values(this.treeConfig.nodes)) {
        if (child.parentId === nodeId) {
          collect(child.id);
        }
      }
    };
    for (const id of ids) {
      if (this.treeConfig.nodes[id]) {
        collect(id);
      }
    }

    // Remove from selection.
    for (const did of toDelete) {
      this.selected.delete(did);
    }

    // Remove from rootIds if root-level.
    this.treeConfig.rootIds = this.treeConfig.rootIds.filter((rid) => !toDelete.has(rid));

    // Delete all nodes.
    for (const did of toDelete) {
      delete this.treeConfig.nodes[did];
    }

    this.saveTree();
    this.notifyTree();
    this.pushWebview();
  }

  /**
   * Add job nodes under a parent folder.
   * User inputs a Jenkins pipeline path → fetch jobs under that path → tree-style picker.
   * Selected jobs are added as child nodes of the parent folder.
   */
  async addJobNodes(parentId: string | null): Promise<void> {
    // 1. Ask user for Jenkins folder path.
    const folderPath = await vscode.window.showInputBox({
      prompt: "输入 Jenkins pipeline 路径（留空获取根目录所有 job）",
      placeHolder: "例如：team-a 或 team-a/sub-team",
      ignoreFocusOut: true,
    });
    if (folderPath === undefined) return;

    // 2. Fetch jobs under that path from Jenkins server.
    let jobs;
    try {
      jobs = await this.client.listJobsInFolder(folderPath.trim());
    } catch (e) {
      void vscode.window.showErrorMessage(
        `从 Jenkins 获取路径「${folderPath}」下的 job 失败：${(e as Error).message}`
      );
      return;
    }
    if (!jobs.length) {
      void vscode.window.showInformationMessage(`路径「${folderPath || "根目录"}」下没有可用的 job。`);
      return;
    }

    // 3. Open a dedicated picker panel with tree-style layout + search filter.
    const selectedJobs = await this.picker.show(jobs, folderPath.trim(), this.extensionUri);
    if (!selectedJobs || selectedJobs.length === 0) return;

    // 4. Create job nodes under the parent, preserving the sub-folder hierarchy.
    // The input folderPath is the "root" of this batch; relative sub-paths
    // become user-defined folder nodes in the sidebar tree.
    const basePath = folderPath.trim();
    const folderCache = new Map<string, string>(); // relativePath -> nodeId

    /**
     * Get or create a folder node for a relative path like "sub-team/deep".
     * Returns the node ID of the deepest folder.
     */
    const getOrCreateFolder = (relativePath: string): string | null => {
      if (!relativePath) return parentId;
      if (folderCache.has(relativePath)) return folderCache.get(relativePath)!;

      const parts = relativePath.split("/");
      let curParentId = parentId;
      let builtPath = "";

      for (const part of parts) {
        builtPath = builtPath ? `${builtPath}/${part}` : part;
        if (folderCache.has(builtPath)) {
          curParentId = folderCache.get(builtPath)!;
          continue;
        }
        // Check if a folder with this name already exists under the current parent.
        const existing = Object.values(this.treeConfig.nodes).find(
          (n) => n.type === "folder" && n.parentId === curParentId && n.name === part
        );
        if (existing) {
          folderCache.set(builtPath, existing.id);
          curParentId = existing.id;
          continue;
        }
        // Create new folder node.
        const folderNode: TreeNode = {
          id: genId(),
          type: "folder",
          name: part,
          parentId: curParentId,
        };
        this.treeConfig.nodes[folderNode.id] = folderNode;
        if (curParentId === null) {
          this.treeConfig.rootIds.push(folderNode.id);
        }
        folderCache.set(builtPath, folderNode.id);
        curParentId = folderNode.id;
      }

      return curParentId;
    };

    let added = 0;
    for (const job of selectedJobs) {
      const shortName = job.name.split("/").pop() || job.name;

      // Compute relative path from basePath.
      let relativeFolder = "";
      if (basePath && job.name.startsWith(basePath + "/")) {
        const rest = job.name.slice(basePath.length + 1);
        const slashIdx = rest.lastIndexOf("/");
        if (slashIdx > 0) {
          relativeFolder = rest.slice(0, slashIdx);
        }
      } else if (!basePath) {
        // Base is root — the folder is the path without the job name.
        const slashIdx = job.name.lastIndexOf("/");
        if (slashIdx > 0) {
          relativeFolder = job.name.slice(0, slashIdx);
        }
      }

      const jobParentId = getOrCreateFolder(relativeFolder);
      const node: TreeNode = {
        id: genId(),
        type: "job",
        name: shortName,
        parentId: jobParentId,
        jobPath: job.name,
        jobUrl: job.url,
        folder: job.folder,
        status: job.status,
        build: job.build,
        dur: job.dur,
        time: job.time,
        buildNumber: job.buildNumber,
        queue: job.queue,
      };
      this.treeConfig.nodes[node.id] = node;
      if (jobParentId === null) {
        this.treeConfig.rootIds.push(node.id);
      }
      added++;
    }

    this.saveTree();
    this.notifyTree();
    void vscode.window.showInformationMessage(`已添加 ${added} 个 job 节点。`);
  }

  /* ---------------- selection ---------------- */

  toggleSelect(nodeId: string, value: boolean): void {
    if (value) {
      this.selected.add(nodeId);
    } else {
      this.selected.delete(nodeId);
    }
    this.notifyTree();
    this.pushWebview();
  }

  /** Select/deselect all job nodes under a folder (recursive). */
  selectFolder(folderId: string, value: boolean): void {
    const collectJobs = (parentId: string): string[] => {
      const ids: string[] = [];
      for (const node of Object.values(this.treeConfig.nodes)) {
        if (node.parentId === parentId) {
          if (node.type === "job") {
            ids.push(node.id);
          } else if (node.type === "folder") {
            ids.push(...collectJobs(node.id));
          }
        }
      }
      return ids;
    };

    const jobIds = collectJobs(folderId);
    for (const id of jobIds) {
      if (value) {
        this.selected.add(id);
      } else {
        this.selected.delete(id);
      }
    }
    this.notifyTree();
    this.pushWebview();
  }

  clearSelection(): void {
    this.selected.clear();
    this.notifyTree();
    this.pushWebview();
  }

  /** Get selected job nodes. */
  getSelectedJobs(): TreeNode[] {
    return [...this.selected]
      .map((id) => this.treeConfig.nodes[id])
      .filter((n): n is TreeNode => !!n && n.type === "job");
  }

  /* ---------------- refresh status ---------------- */

  /**
   * Refresh status of all selected job nodes.
   * @param mode "all" (default) refresh every selected job;
   *             "nonTerminal" only refresh jobs whose status is not terminal
   *             (i.e. running, queued, unknown). Terminal states
   *             (success/failed/aborted) are skipped to save requests.
   */
  async refreshSelected(mode: "all" | "nonTerminal" = "all"): Promise<{ errors: string[] }> {
    const allJobs = this.getSelectedJobs();
    if (allJobs.length === 0) {
      return { errors: [] };
    }
    // Terminal statuses that don't need re-querying during auto-refresh.
    const TERMINAL = new Set(["success", "failed", "aborted"]);
    const jobs =
      mode === "nonTerminal"
        ? allJobs.filter((j) => !TERMINAL.has(j.status || "unknown"))
        : allJobs;
    if (jobs.length === 0) {
      return { errors: [] };
    }
    try {
      const updates = await this.client.refreshJobNodes(jobs);
      for (const node of jobs) {
        if (!node.jobPath) continue;
        const update = updates.get(node.jobPath);
        if (update) {
          Object.assign(node, update);
        }
      }
      this.saveTree();
      this.notifyTree();
      this.pushWebview();
      return { errors: [] };
    } catch (e) {
      return { errors: [(e as Error).message] };
    }
  }

  /** Refresh status of all job nodes under a specific folder node (recursive). */
  async refreshNodeStatus(folderId: string): Promise<void> {
    const collectJobs = (parentId: string): TreeNode[] => {
      const jobs: TreeNode[] = [];
      for (const node of Object.values(this.treeConfig.nodes)) {
        if (node.parentId === parentId) {
          if (node.type === "job") {
            jobs.push(node);
          } else if (node.type === "folder") {
            jobs.push(...collectJobs(node.id));
          }
        }
      }
      return jobs;
    };

    const jobsToRefresh = collectJobs(folderId);
    if (jobsToRefresh.length === 0) {
      void vscode.window.showInformationMessage("该节点下没有 job 可刷新。");
      return;
    }

    try {
      const updates = await this.client.refreshJobNodes(jobsToRefresh);
      for (const node of jobsToRefresh) {
        if (!node.jobPath) continue;
        const update = updates.get(node.jobPath);
        if (update) {
          Object.assign(node, update);
        }
      }
      this.saveTree();
      this.notifyTree();
      this.pushWebview();
      void vscode.window.showInformationMessage(`已刷新 ${jobsToRefresh.length} 个 job 的状态。`);
    } catch (e) {
      void vscode.window.showErrorMessage(`刷新状态失败：${(e as Error).message}`);
    }
  }

  /* ---------------- param templates ---------------- */

  saveParamTemplate(name: string, params: [string, string][]): void {
    const existing = this.paramTemplates.find((t) => t.name === name);
    if (existing) {
      existing.params = params;
    } else {
      this.paramTemplates.push({ id: nextId(), name, params });
    }
    this.store.saveParamTemplates(this.paramTemplates);
    this.notifyTree();
  }

  deleteParamTemplate(id: number): void {
    if (id === 0) return;
    this.paramTemplates = this.paramTemplates.filter((t) => t.id !== id);
    this.store.saveParamTemplates(this.paramTemplates);
    this.notifyTree();
  }

  /* ---------------- Jenkins actions (webview rpc) ---------------- */

  async trigger(
    nodeIds: string[],
    params: Record<string, string>,
    jobParamsMap?: Record<string, Record<string, string>>
  ): Promise<{ errors: string[] }> {
    const errors: string[] = [];
    for (const id of nodeIds) {
      const node = this.treeConfig.nodes[id];
      if (!node || node.type !== "job" || !node.jobPath) {
        errors.push(`未知 job: ${id}`);
        continue;
      }
      // Per-job params take priority over the global batch params.
      const effectiveParams = (jobParamsMap && jobParamsMap[id]) || params;
      try {
        await this.client.triggerBuild(node.jobPath, effectiveParams);
      } catch (e) {
        errors.push(`${node.name}: ${(e as Error).message}`);
      }
    }
    // Refresh status of triggered jobs.
    const triggeredNodes = nodeIds
      .map((id) => this.treeConfig.nodes[id])
      .filter((n): n is TreeNode => !!n && n.type === "job");
    if (triggeredNodes.length > 0) {
      try {
        const updates = await this.client.refreshJobNodes(triggeredNodes);
        for (const node of triggeredNodes) {
          if (!node.jobPath) continue;
          const update = updates.get(node.jobPath);
          if (update) {
            Object.assign(node, update);
          }
        }
        this.saveTree();
      } catch {
        // Status refresh failure is non-fatal.
      }
    }
    this.notifyTree();
    return { errors };
  }

  async abort(nodeIds: string[]): Promise<{ errors: string[] }> {
    const errors: string[] = [];
    for (const id of nodeIds) {
      const node = this.treeConfig.nodes[id];
      if (!node || node.type !== "job" || !node.jobPath) continue;
      if (node.status !== "running" || !node.buildNumber) continue;
      try {
        await this.client.abortBuild(node.jobPath, node.buildNumber);
      } catch (e) {
        errors.push(`${node.name}: ${(e as Error).message}`);
      }
    }
    // Refresh status.
    const abortedNodes = nodeIds
      .map((id) => this.treeConfig.nodes[id])
      .filter((n): n is TreeNode => !!n && n.type === "job");
    if (abortedNodes.length > 0) {
      try {
        const updates = await this.client.refreshJobNodes(abortedNodes);
        for (const node of abortedNodes) {
          if (!node.jobPath) continue;
          const update = updates.get(node.jobPath);
          if (update) {
            Object.assign(node, update);
          }
        }
        this.saveTree();
      } catch {
        // Non-fatal.
      }
    }
    this.notifyTree();
    return { errors };
  }
}
