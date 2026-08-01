/* Extract the inline webview <script> from ActionsConfigPanel.getHtml() and write it to disk for `node --check`. */
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "vscode") return require.resolve("./vscode-stub-panel.js");
  return origResolve.call(this, request, ...args);
};

const vscode = require("vscode");
const { ActionsConfigPanel } = require("./out/actionsConfigPanel.js");

const fakeContext = { extensionUri: { fsPath: "/tmp/ext" } };
const fakeState = {};
// Constructor is TS-private but plain JS at runtime.
const panel = new ActionsConfigPanel(fakeContext, fakeState);

const html = vscode.__created.panels[0].webview.html;
const m = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
if (!m) {
  console.error("No inline script found in panel HTML");
  process.exit(1);
}
require("fs").writeFileSync("/tmp/panel-inline.js", m[1]);
console.log("Extracted inline script: " + m[1].length + " chars -> /tmp/panel-inline.js");
console.log("HTML length: " + html.length);
