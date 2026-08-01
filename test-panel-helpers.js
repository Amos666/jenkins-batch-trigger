/* Execute the extracted panel inline script in a sandbox and unit-test its helper functions. */
const fs = require("fs");
const vm = require("vm");

const src =
  fs.readFileSync("/tmp/panel-inline.js", "utf8") +
  "\n;globalThis.__TYPE_FIELDS = TYPE_FIELDS; globalThis.__TYPE_DEFAULTS = TYPE_DEFAULTS;";

function stubEl() {
  return {
    addEventListener() {},
    value: "",
    innerHTML: "",
    textContent: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    appendChild() {},
  };
}

const sandbox = {
  console,
  document: {
    querySelectorAll() { return []; },
    getElementById() { return stubEl(); },
    createElement() { return stubEl(); },
  },
  window: { addEventListener() {} },
  acquireVsCodeApi() { return { postMessage() {} }; },
  setTimeout() {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "panel-inline.js" });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

const g = sandbox;

console.log("\n== getPath / setPath ==");
let obj = { a: { b: { c: "x" } } };
check("getPath nested", g.getPath(obj, "a.b.c") === "x");
check("getPath missing -> undefined", g.getPath(obj, "a.zzz.c") === undefined);
g.setPath(obj, "a.b.d", "y");
check("setPath nested existing", obj.a.b.d === "y");
g.setPath(obj, "p.q.r", "z");
check("setPath creates intermediates", obj.p && obj.p.q && obj.p.q.r === "z");

console.log("\n== headersToText / textToHeaders ==");
const htxt = g.headersToText({ "Content-Type": "application/json", "X-Token": "abc" });
check("headersToText", htxt === "Content-Type: application/json\nX-Token: abc", JSON.stringify(htxt));
const hobj = g.textToHeaders("Content-Type: application/json\nX-Token: abc\n\nbadline\n  Spaced :  v  ");
check("textToHeaders parses", hobj["Content-Type"] === "application/json" && hobj["X-Token"] === "abc", JSON.stringify(hobj));
check("textToHeaders skips invalid", !("badline" in hobj), JSON.stringify(hobj));
check("textToHeaders trims", hobj["Spaced"] === "v", JSON.stringify(hobj));
check("headersToText(null) empty", g.headersToText(null) === "");

console.log("\n== normalizeAction ==");
const cleaned1 = g.normalizeAction({ type: "http_request", url: "u", method: "POST", headers: {}, body: "", extract: { pattern: "", target: "" }, on_error: "fail" });
check("drops empty headers", !("headers" in cleaned1), JSON.stringify(cleaned1));
check("drops empty body", !("body" in cleaned1), JSON.stringify(cleaned1));
check("drops incomplete extract", !("extract" in cleaned1), JSON.stringify(cleaned1));

const cleaned2 = g.normalizeAction({ type: "http_request", url: "u", method: "POST", headers: { A: "1" }, body: "{}", extract: { pattern: "p", target: "state.x" }, on_error: "fail" });
check("keeps populated headers", cleaned2.headers && cleaned2.headers.A === "1", JSON.stringify(cleaned2));
check("keeps populated body", cleaned2.body === "{}", JSON.stringify(cleaned2));
check("keeps complete extract", cleaned2.extract && cleaned2.extract.pattern === "p", JSON.stringify(cleaned2));

const cleaned3 = g.normalizeAction({ type: "http_request", url: "u", extract: { pattern: "only-pattern", target: "" } });
check("drops extract missing target", !("extract" in cleaned3), JSON.stringify(cleaned3));

const other = g.normalizeAction({ type: "state_read", key: "k", target: "t" });
check("non-http untouched", other.type === "state_read" && other.key === "k", JSON.stringify(other));

console.log("\n== TYPE_FIELDS / TYPE_DEFAULTS wiring ==");
const httpFields = g.__TYPE_FIELDS.http_request.map((f) => f[0]);
check("http_request exposes headers", httpFields.includes("headers"), JSON.stringify(httpFields));
check("http_request exposes body", httpFields.includes("body"), JSON.stringify(httpFields));
check("http_request exposes extract.pattern", httpFields.includes("extract.pattern"), JSON.stringify(httpFields));
check("http_request exposes extract.target", httpFields.includes("extract.target"), JSON.stringify(httpFields));
check("http_request default method GET", g.__TYPE_DEFAULTS.http_request.method === "GET");
check("regex default strategy first", g.__TYPE_DEFAULTS.regex_extract.strategy === "first");

console.log("\nRESULT: passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
