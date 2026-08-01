/* Runtime verification for action engine: http_request body/headers/extract + regex strategies. */
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "vscode") return require.resolve("./vscode-stub.js");
  return origResolve.call(this, request, ...args);
};

const http = require("http");
const { ActionEngine } = require("./out/actionEngine.js");

function mkCtx(over = {}) {
  return Object.assign({
    trigger: { params: { pr1: "v1" } },
    pipeline_logs: "",
    state: {},
    pipeline_params: {},
    env: {},
    pipeline: { name: "demo", jobPath: "folder/demo" },
    run: { prev: { id: "41" } },
  }, over);
}

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

async function withServer(handler, fn) {
  const srv = http.createServer(handler);
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const port = srv.address().port;
  try { await fn(port); } finally { srv.close(); }
}

async function main() {
  const logs = [];
  const engine = new ActionEngine((m) => logs.push(m));

  console.log("\n== regex_extract strategy ==");
  const logsText = "id=AAA111 done\nid=BBB222 done\nid=CCC333 done";
  for (const [strategy, expected] of [
    ["first", "id=AAA111"],
    ["last", "id=CCC333"],
    ["all", "id=AAA111\nid=BBB222\nid=CCC333"],
  ]) {
    const ctx = mkCtx({ pipeline_logs: logsText });
    const r = await engine.executePostActions(
      [{ type: "regex_extract", source: "pipeline_logs", pattern: "id=[A-Z]+\\d+", target: "state.got", strategy, on_no_match: "fail" }],
      ctx
    );
    check("strategy=" + strategy + " ok", r.ok, JSON.stringify(r.errors));
    check("strategy=" + strategy + " value", ctx.state.got === expected, "got=" + JSON.stringify(ctx.state.got));
  }

  console.log("\n== http_request GET + target ==");
  await withServer((req, res) => { res.setHeader("Content-Type", "text/plain"); res.end("hello-body"); }, async (port) => {
    const ctx = mkCtx();
    const r = await engine.executePreActions(
      [{ type: "http_request", url: "http://127.0.0.1:" + port + "/x", method: "GET", target: "pipeline_params.out", on_error: "fail" }],
      ctx
    );
    check("GET ok", r.ok, JSON.stringify(r.errors));
    check("GET body -> pipeline_params.out", ctx.pipeline_params.out === "hello-body", "got=" + ctx.pipeline_params.out);
  });

  console.log("\n== http_request POST body + headers (echo) ==");
  await withServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ method: req.method, ct: req.headers["content-type"], auth: req.headers["x-token"], body: data }));
    });
  }, async (port) => {
    const ctx = mkCtx();
    const r = await engine.executePreActions(
      [{
        type: "http_request",
        url: "http://127.0.0.1:" + port + "/api",
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Token": "tok-${trigger.params.pr1}" },
        body: '{"name":"${trigger.params.pr1}"}',
        target: "state.resp",
        on_error: "fail",
      }],
      ctx
    );
    check("POST ok", r.ok, JSON.stringify(r.errors));
    let echoed = {};
    try { echoed = JSON.parse(ctx.state.resp || "{}"); } catch (e) {}
    check("POST method echoed", echoed.method === "POST", JSON.stringify(echoed));
    check("POST content-type header sent", echoed.ct === "application/json", JSON.stringify(echoed));
    check("POST header template resolved", echoed.auth === "tok-v1", JSON.stringify(echoed));
    check("POST body template resolved", echoed.body === '{"name":"v1"}', JSON.stringify(echoed));
  });

  console.log("\n== http_request extract.pattern/target ==");
  await withServer((req, res) => { res.end("build result: CHG-98765 ok"); }, async (port) => {
    const ctx = mkCtx();
    const r = await engine.executePostActions(
      [{
        type: "http_request",
        url: "http://127.0.0.1:" + port + "/",
        method: "GET",
        extract: { pattern: "CHG-\\d+", target: "state.chg.${trigger.params.pr1}" },
        on_error: "fail",
      }],
      ctx
    );
    check("extract ok", r.ok, JSON.stringify(r.errors));
    check("extract -> state.chg.v1", ctx.state.chg && ctx.state.chg.v1 === "CHG-98765", JSON.stringify(ctx.state));
  });

  console.log("\n== http_request on_error handling ==");
  // Unreachable port -> connection refused
  const ctxFail = mkCtx();
  const rFail = await engine.executePreActions(
    [{ type: "http_request", url: "http://127.0.0.1:1/", method: "GET", on_error: "fail" }],
    ctxFail
  );
  check("on_error=fail returns not-ok", rFail.ok === false);
  const ctxWarn = mkCtx();
  const rWarn = await engine.executePreActions(
    [{ type: "http_request", url: "http://127.0.0.1:1/", method: "GET", on_error: "warn" }],
    ctxWarn
  );
  check("on_error=warn returns ok", rWarn.ok === true);

  console.log("\nRESULT: passed=" + passed + " failed=" + failed);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
