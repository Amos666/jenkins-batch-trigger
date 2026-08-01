class Disposable {
  constructor(fn) { this._fn = fn; }
  dispose() { if (this._fn) this._fn(); }
}
const created = { panels: [] };
function createWebviewPanel(viewType, title, column, opts) {
  const panel = {
    viewType, title, column, opts,
    iconPath: undefined,
    webview: {
      html: "",
      cspSource: "vscode-webview://fake",
      onDidReceiveMessage(fn) { return new Disposable(() => {}); },
      postMessage(msg) { return Promise.resolve(true); },
    },
    onDidDispose(fn) { return new Disposable(() => {}); },
    reveal() {},
    dispose() {},
  };
  created.panels.push(panel);
  return panel;
}
module.exports = {
  Disposable,
  __created: created,
  workspace: { getConfiguration: () => ({ get: () => "zh" }) },
  window: { createWebviewPanel },
  ViewColumn: { Active: -1, One: 1, Two: 2 },
  Uri: { joinPath: (...parts) => ({ fsPath: parts.map((p) => p.fsPath || p).join("/") }) },
};
