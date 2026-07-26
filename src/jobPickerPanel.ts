import * as vscode from "vscode";
import { Job } from "./types";
import { t } from "./i18n";

/**
 * A dedicated WebviewPanel for picking jobs from a Jenkins folder.
 * Shows a tree-style layout with search filter, checkboxes, and confirm/cancel.
 * Much more usable than QuickPick for thousands of jobs.
 */
export class JobPickerPanel {
  private panel: vscode.WebviewPanel | undefined;
  private selectedJobs = new Map<string, Job>(); // fullName -> Job
  private allJobs: Job[] = [];
  private resolveFn: ((jobs: Job[] | undefined) => void) | undefined;

  /**
   * Show the picker panel and return selected jobs when user confirms.
   * Returns undefined if user cancels.
   */
  async show(
    jobs: Job[],
    folderPath: string,
    extensionUri: vscode.Uri
  ): Promise<Job[] | undefined> {
    this.allJobs = jobs;
    this.selectedJobs.clear();

    return new Promise<Job[] | undefined>((resolve) => {
      this.resolveFn = resolve;

      this.panel = vscode.window.createWebviewPanel(
        "jobPicker",
        `${t("picker.title")}${folderPath ? " · " + folderPath : ""}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
        }
      );

      this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon.svg");
      this.panel.webview.html = this.getHtml(folderPath, this.panel.webview);

      this.panel.webview.onDidReceiveMessage(
        (msg) => this.onMessage(msg),
        undefined,
        []
      );

      this.panel.onDidDispose(() => {
        if (this.resolveFn) {
          this.resolveFn(undefined);
          this.resolveFn = undefined;
        }
      });
    });
  }

  private onMessage(msg: any): void {
    switch (msg.type) {
      case "ready":
        // Send job data to the webview.
        this.panel?.webview.postMessage({
          type: "jobs",
          data: this.allJobs.map((j) => ({
            name: j.name,
            shortName: j.name.split("/").pop() || j.name,
            status: j.status,
            build: j.build,
          })),
        });
        break;
      case "toggle":
        if (msg.checked) {
          const job = this.allJobs.find((j) => j.name === msg.fullName);
          if (job) this.selectedJobs.set(msg.fullName, job);
        } else {
          this.selectedJobs.delete(msg.fullName);
        }
        this.updateCount();
        break;
      case "toggleFolder": {
        // Toggle all jobs under a folder (respecting search filter).
        const folderPrefix = msg.folder;
        const search = (msg.search || "").toLowerCase().trim();
        const folderJobs = this.allJobs.filter(
          (j) => (j.name.startsWith(folderPrefix + "/") || j.folder === folderPrefix) &&
                 (!search || j.name.toLowerCase().includes(search) || (j.name.split("/").pop() || "").toLowerCase().includes(search))
        );
        if (msg.checked) {
          for (const j of folderJobs) {
            this.selectedJobs.set(j.name, j);
          }
        } else {
          for (const j of folderJobs) {
            this.selectedJobs.delete(j.name);
          }
        }
        this.updateCount();
        break;
      }
      case "selectAll": {
        // Select all jobs respecting the current search filter.
        const search = (msg.search || "").toLowerCase().trim();
        if (msg.checked) {
          for (const j of this.allJobs) {
            if (!search || j.name.toLowerCase().includes(search) || (j.name.split("/").pop() || "").toLowerCase().includes(search)) {
              this.selectedJobs.set(j.name, j);
            }
          }
        } else {
          this.selectedJobs.clear();
        }
        this.updateCount();
        break;
      }
      case "confirm":
        if (this.resolveFn) {
          this.resolveFn([...this.selectedJobs.values()]);
          this.resolveFn = undefined;
        }
        this.panel?.dispose();
        break;
      case "cancel":
        if (this.resolveFn) {
          this.resolveFn(undefined);
          this.resolveFn = undefined;
        }
        this.panel?.dispose();
        break;
    }
  }

  private updateCount(): void {
    this.panel?.webview.postMessage({
      type: "count",
      count: this.selectedJobs.size,
    });
  }

  private getHtml(folderPath: string, webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${t("picker.title")}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, -apple-system, sans-serif);
    font-size: 13px;
    color: var(--vscode-foreground, #333);
    background: var(--vscode-editor-background, #fff);
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-panel-border, #ddd);
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .header h2 {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .search-box {
    flex: 1;
    min-width: 200px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-input-border, #ccc);
    background: var(--vscode-input-background, #fff);
    color: var(--vscode-input-foreground, #333);
    border-radius: 3px;
    font-size: 13px;
    outline: none;
  }
  .search-box:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }
  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .count-badge {
    background: var(--vscode-badge-background, #007acc);
    color: var(--vscode-badge-foreground, #fff);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .tree-container {
    flex: 1;
    overflow: auto;
    padding: 8px 0;
  }
  .tree-item {
    display: flex;
    align-items: center;
    padding: 3px 8px 3px 0;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    line-height: 22px;
  }
  .tree-item:hover {
    background: var(--vscode-list-hoverBackground, rgba(0,0,0,0.04));
  }
  .tree-item.folder {
    font-weight: 600;
    color: var(--vscode-foreground, #333);
  }
  .tree-item.job {
    color: var(--vscode-foreground, #333);
  }
  .tree-item.hidden {
    display: none;
  }
  .tree-item .indent {
    display: inline-block;
    flex-shrink: 0;
  }
  .tree-item .toggle {
    display: inline-block;
    width: 16px;
    text-align: center;
    color: var(--vscode-foreground, #666);
    font-size: 10px;
    cursor: pointer;
  }
  .tree-item .checkbox {
    margin-right: 6px;
    width: 14px;
    height: 14px;
    accent-color: var(--vscode-checkbox-background, #007acc);
  }
  .tree-item .icon {
    margin-right: 4px;
    font-size: 14px;
  }
  .tree-item .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-item .status {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    margin-left: 8px;
  }
  .s-running { background: rgba(0,122,255,0.15); color: #007acc; }
  .s-success { background: rgba(40,167,69,0.15); color: #28a745; }
  .s-failed { background: rgba(220,53,69,0.15); color: #dc3545; }
  .s-unstable { background: rgba(255,193,7,0.15); color: #d9a300; }
  .s-aborted { background: rgba(108,117,125,0.15); color: #6c757d; }
  .s-idle, .s-unknown { background: rgba(108,117,125,0.1); color: #999; }
  .tree-item .build-info {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    margin-left: 8px;
  }
  .footer {
    padding: 10px 16px;
    border-top: 1px solid var(--vscode-panel-border, #ddd);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--vscode-editor-background, #fff);
  }
  .footer-info {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888);
  }
  .footer-actions {
    display: flex;
    gap: 8px;
  }
  .btn {
    padding: 6px 16px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, #5a5d5e);
    color: var(--vscode-button-secondaryForeground, #fff);
    border-radius: 3px;
    cursor: pointer;
    font-size: 13px;
    border: none;
  }
  .btn:hover {
    opacity: 0.9;
  }
  .btn.primary {
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, #fff);
  }
  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--vscode-descriptionForeground, #888);
  }
</style>
</head>
<body>

<div class="header">
  <h2>${t("picker.title")}${folderPath ? "（" + folderPath + "）" : ""}</h2>
  <input class="search-box" id="search" placeholder="${t("picker.searchPlaceholder")}" autofocus />
  <div class="header-actions">
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
      <input type="checkbox" id="selectAll" class="checkbox" /> ${t("picker.selectAll")}
    </label>
    <span class="count-badge" id="countBadge">${t("picker.selected", { n: 0 })}</span>
  </div>
</div>

<div class="tree-container" id="treeContainer">
  <div class="empty" id="loadingHint">${t("picker.loading")}</div>
</div>

<div class="footer">
  <div class="footer-info" id="footerInfo">${t("picker.total", { n: 0 })}</div>
  <div class="footer-actions">
    <button class="btn" id="btnCancel">${t("picker.cancel")}</button>
    <button class="btn primary" id="btnConfirm" disabled>${t("picker.confirm")}</button>
  </div>
</div>

<script nonce="${nonce}">
// IMPORTANT: acquireVsCodeApi must be called ONCE and BEFORE any code that
// uses it (including event listener closures). Declaring it first avoids any
// temporal-dead-zone (TDZ) surprises when listeners fire.
const vscode = acquireVsCodeApi();

const STATUS_CLASS = {
  running: "s-running", success: "s-success", failed: "s-failed",
  unstable: "s-unstable", aborted: "s-aborted", idle: "s-idle", unknown: "s-unknown"
};
const STATUS_LABEL = {
  running: "Running", success: "Success", failed: "Failed",
  unstable: "Unstable", aborted: "Aborted", idle: "Idle", unknown: "—"
};

let allJobs = [];
let folderTree = null;
let collapsedFolders = new Set();
let selectedNames = new Set();

// Build a nested tree from flat job list.
function buildTree(jobs) {
  const root = { name: "", children: new Map(), jobs: [], expanded: true };
  for (const job of jobs) {
    const parts = job.name.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cur.children.has(part)) {
        const path = parts.slice(0, i + 1).join("/");
        cur.children.set(part, { name: part, path, children: new Map(), jobs: [], expanded: true, parent: cur });
      }
      cur = cur.children.get(part);
    }
    cur.jobs.push(job);
  }
  return root;
}

// Render the tree as HTML.
function renderTree() {
  const container = document.getElementById("treeContainer");
  const search = document.getElementById("search").value.toLowerCase().trim();
  container.innerHTML = "";

  if (allJobs.length === 0) {
    container.innerHTML = '<div class="empty">${t("picker.empty")}</div>';
    return;
  }

  const html = [];
  const walk = (node, depth) => {
    // Render folders first (sorted), then jobs (sorted).
    const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    const jobs = node.jobs.slice().sort((a, b) => a.shortName.localeCompare(b.shortName));

    for (const folder of folders) {
      // Check if this folder has any matching jobs (for search filtering).
      const hasMatch = !search || folderMatchesSearch(folder, search);
      if (!hasMatch) continue;

      const isCollapsed = collapsedFolders.has(folder.path);
      const folderJobCount = countJobsInFolder(folder);
      const allSelected = areAllJobsSelected(folder);
      const paddingLeft = depth * 20 + 8;

      html.push('<div class="tree-item folder" data-folder="' + escapeAttr(folder.path) + '" style="padding-left:' + paddingLeft + 'px">');
      html.push('<span class="toggle">' + (isCollapsed ? '▶' : '▼') + '</span>');
      html.push('<input type="checkbox" class="checkbox folder-check" data-folder="' + escapeAttr(folder.path) + '"' + (allSelected ? ' checked' : '') + ' />');
      html.push('<span class="icon">📁</span>');
      html.push('<span class="name">' + escapeHtml(folder.name) + '</span>');
      html.push('<span class="build-info">' + folderJobCount + ' jobs</span>');
      html.push('</div>');

      if (!isCollapsed) {
        walk(folder, depth + 1);
      }
    }

    for (const job of jobs) {
      if (search && !job.name.toLowerCase().includes(search) && !job.shortName.toLowerCase().includes(search)) continue;
      const paddingLeft = depth * 20 + 8;
      const st = job.status || "unknown";
      html.push('<div class="tree-item job" data-fullname="' + escapeAttr(job.name) + '" style="padding-left:' + paddingLeft + 'px">');
      html.push('<span class="toggle"></span>');
      html.push('<input type="checkbox" class="checkbox job-check" data-fullname="' + escapeAttr(job.name) + '"' + (isSelected(job.name) ? ' checked' : '') + ' />');
      html.push('<span class="icon">🔹</span>');
      html.push('<span class="name">' + escapeHtml(job.shortName) + '</span>');
      html.push('<span class="status ' + (STATUS_CLASS[st] || 's-unknown') + '">' + (STATUS_LABEL[st] || '—') + '</span>');
      if (job.build) html.push('<span class="build-info">' + escapeHtml(job.build) + '</span>');
      html.push('</div>');
    }
  };

  walk(folderTree, 0);
  container.innerHTML = html.join("");

  // Bind events.
  container.querySelectorAll('.toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = el.closest('.tree-item');
      const folderPath = item.dataset.folder;
      if (folderPath) {
        if (collapsedFolders.has(folderPath)) {
          collapsedFolders.delete(folderPath);
        } else {
          collapsedFolders.add(folderPath);
        }
        renderTree();
      }
    });
  });

  container.querySelectorAll('.folder-check').forEach(el => {
    el.addEventListener('change', (e) => {
      e.stopPropagation();
      const folderPath = el.dataset.folder;
      const checked = el.checked;
      const search = getSearch();
      // Only select/deselect jobs that match the current search filter.
      const folderJobs = allJobs.filter(
        (j) => (j.name === folderPath || j.name.startsWith(folderPath + "/")) && matchesSearch(j, search)
      );
      if (checked) {
        for (const j of folderJobs) selectedNames.add(j.name);
      } else {
        for (const j of folderJobs) selectedNames.delete(j.name);
      }
      vscode.postMessage({ type: 'toggleFolder', folder: folderPath, checked, search });
      updateCount();
      renderTree();
    });
  });

  container.querySelectorAll('.job-check').forEach(el => {
    el.addEventListener('change', (e) => {
      e.stopPropagation();
      const fullName = el.dataset.fullname;
      const checked = el.checked;
      // Update local state immediately so renderTree() preserves checkbox state.
      if (checked) {
        selectedNames.add(fullName);
      } else {
        selectedNames.delete(fullName);
      }
      vscode.postMessage({ type: 'toggle', fullName, checked });
      updateCount();
      updateFolderChecks();
    });
  });
}

function folderMatchesSearch(folder, search) {
  // Check if any job under this folder matches.
  for (const job of folder.jobs) {
    if (job.name.toLowerCase().includes(search) || job.shortName.toLowerCase().includes(search)) return true;
  }
  for (const child of folder.children.values()) {
    if (folderMatchesSearch(child, search)) return true;
  }
  return false;
}

function countJobsInFolder(folder) {
  let count = folder.jobs.length;
  for (const child of folder.children.values()) {
    count += countJobsInFolder(child);
  }
  return count;
}

function areAllJobsSelected(folder) {
  for (const job of folder.jobs) {
    if (!isSelected(job.name)) return false;
  }
  for (const child of folder.children.values()) {
    if (!areAllJobsSelected(child)) return false;
  }
  return folder.jobs.length > 0 || [...folder.children.values()].some(c => countJobsInFolder(c) > 0);
}

function isSelected(fullName) {
  return selectedNames.has(fullName);
}

function updateCount() {
  document.getElementById('countBadge').textContent = '${t("picker.selected", { n: "" })}'.replace('{n}', selectedNames.size);
  document.getElementById('btnConfirm').disabled = selectedNames.size === 0;
}

// Find a folder node in the tree by its path (e.g. "team-a/sub").
function findFolderByPath(path) {
  if (!path) return folderTree;
  const parts = path.split("/");
  let cur = folderTree;
  for (const part of parts) {
    cur = cur.children.get(part);
    if (!cur) return null;
  }
  return cur;
}

// Update only the folder checkboxes without re-rendering the whole tree.
// This avoids replacing the job checkbox the user just clicked.
function updateFolderChecks() {
  document.querySelectorAll('.folder-check').forEach(el => {
    const folderPath = el.dataset.folder;
    const folder = findFolderByPath(folderPath);
    if (folder) {
      el.checked = areAllJobsSelected(folder);
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// Search input.
document.getElementById('search').addEventListener('input', renderTree);

// Helper: get current search term.
function getSearch() {
  return document.getElementById('search').value.toLowerCase().trim();
}

// Helper: check if a job matches the current search filter.
function matchesSearch(job, search) {
  if (!search) return true;
  return job.name.toLowerCase().includes(search) || job.shortName.toLowerCase().includes(search);
}

// Select all (only filtered/visible jobs).
document.getElementById('selectAll').addEventListener('change', (e) => {
  const checked = e.target.checked;
  const search = getSearch();
  vscode.postMessage({ type: 'selectAll', checked, search });
  if (checked) {
    for (const job of allJobs) {
      if (matchesSearch(job, search)) selectedNames.add(job.name);
    }
  } else {
    selectedNames.clear();
  }
  updateCount();
  renderTree();
});

// Footer buttons.
document.getElementById('btnCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});
document.getElementById('btnConfirm').addEventListener('click', () => {
  vscode.postMessage({ type: 'confirm' });
});

// Listen for messages from extension.
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'jobs') {
    allJobs = m.data;
    folderTree = buildTree(allJobs);
    document.getElementById('loadingHint').style.display = 'none';
    document.getElementById('footerInfo').textContent = '${t("picker.total", { n: "" })}'.replace('{n}', allJobs.length);
    renderTree();
  } else if (m.type === 'count') {
    // Sync selection state from extension.
    // The extension sends count; we don't need to do anything special here
    // since we track selection locally too.
  }
});

// Notify extension that we're ready to receive job data.
vscode.postMessage({ type: 'ready' });
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
