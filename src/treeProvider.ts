import * as vscode from "vscode";
import { TreeNode } from "./types";
import { StateService } from "./state";
import { t } from "./i18n";

/**
 * Native VSCode sidebar tree showing the user-defined folder/job structure.
 * - Folder nodes: collapsible, support right-click add subfolder/add job/rename/delete.
 * - Job nodes: leaf, show cached status, checkbox for selection.
 *
 * The tree data comes entirely from globalState (no server calls on load).
 */
export class SidebarTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null>();
  readonly onDidChangeTreeData = this.emitter.event;

  /**
   * Display level per job node ID for cycling name display on double-click.
   * 0 = job name only, 1 = parent/job, 2 = grandparent/parent/job, then cycles back.
   */
  private displayLevels = new Map<string, number>();

  constructor(private readonly state: StateService) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Cycle the display level for a job node (0 → 1 → 2 → 0 …). */
  cycleDisplayName(nodeId: string): void {
    const cur = this.displayLevels.get(nodeId) || 0;
    this.displayLevels.set(nodeId, (cur + 1) % 3);
    this.emitter.fire(undefined);
  }

  /** Build a display label for a job node based on its display level. */
  private getJobDisplayLabel(element: TreeNode): string {
    const level = this.displayLevels.get(element.id) || 0;
    if (level === 0) {
      return element.name;
    }
    // Walk up the parent chain to collect ancestor folder names.
    const ancestors: string[] = [];
    let parentId = element.parentId;
    while (parentId) {
      const parent = this.state.treeConfig.nodes[parentId];
      if (!parent) break;
      ancestors.unshift(parent.name);
      parentId = parent.parentId;
    }
    if (level === 1) {
      // Show immediate parent + job name.
      const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : "";
      return parent ? `${parent}/${element.name}` : element.name;
    }
    // level === 2: show up to 2 ancestors + job name.
    const prefix = ancestors.slice(-2);
    return prefix.length > 0 ? `${prefix.join("/")}/${element.name}` : element.name;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === "folder") {
      const children = this.state.getChildren(element.id);
      const jobCount = this.countJobsRecursive(element.id);
      const selCount = this.countSelectedJobs(element.id);
      const item = new vscode.TreeItem(
        element.name,
        children.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${selCount}/${jobCount}`;
      item.iconPath = new vscode.ThemeIcon("folder");
      item.tooltip = new vscode.MarkdownString(
        `$(folder) **${element.name}**\n\n` +
        t("tree.folderTip", { jobs: jobCount, sel: selCount })
      );
      item.contextValue = "folder";
      item.id = element.id;
      item.checkboxState =
        jobCount > 0 && selCount === jobCount
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked;
      return item;
    }

    // Job node — simple icon, no status display (status is shown in the webview).
    const displayLabel = this.getJobDisplayLabel(element);
    const item = new vscode.TreeItem(
      displayLabel,
      vscode.TreeItemCollapsibleState.None
    );

    item.iconPath = new vscode.ThemeIcon("rocket");
    item.tooltip = element.jobPath || element.name;
    item.contextValue = "job";

    item.checkboxState = this.state.selected.has(element.id)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.id = element.id;
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.state.getRootNodes();
    }
    if (element.type === "folder") {
      return this.state.getChildren(element.id);
    }
    return [];
  }

  /** Handle checkbox toggles from the TreeView. */
  handleCheckbox(node: TreeNode, state: vscode.TreeItemCheckboxState): void {
    const checked = state === vscode.TreeItemCheckboxState.Checked;
    if (node.type === "folder") {
      // Cascade guard: if the event state matches the folder's current
      // computed state, this is likely a spurious event triggered by
      // getTreeItem re-rendering (not a real user click). Skip to prevent
      // unwanted cascading that would deselect all jobs when a single job
      // is unchecked.
      const selCount = this.countSelectedJobs(node.id);
      const jobCount = this.countJobsRecursive(node.id);
      const allSelected = jobCount > 0 && selCount === jobCount;
      if (checked === allSelected) return;
      this.state.selectFolder(node.id, checked);
    } else {
      this.state.toggleSelect(node.id, checked);
      this.refresh();
    }
  }

  /** Count all job nodes under a folder (recursive). */
  private countJobsRecursive(folderId: string): number {
    let count = 0;
    for (const node of Object.values(this.state.treeConfig.nodes)) {
      if (node.parentId === folderId) {
        if (node.type === "job") {
          count++;
        } else if (node.type === "folder") {
          count += this.countJobsRecursive(node.id);
        }
      }
    }
    return count;
  }

  /** Count selected job nodes under a folder (recursive). */
  private countSelectedJobs(folderId: string): number {
    let count = 0;
    for (const node of Object.values(this.state.treeConfig.nodes)) {
      if (node.parentId === folderId) {
        if (node.type === "job" && this.state.selected.has(node.id)) {
          count++;
        } else if (node.type === "folder") {
          count += this.countSelectedJobs(node.id);
        }
      }
    }
    return count;
  }
}
