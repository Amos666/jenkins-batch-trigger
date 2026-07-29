import * as vm from "vm";
import * as https from "https";
import * as http from "http";
import {
  ActionConfig,
  ActionContext,
  ActionResult,
  StateReadAction,
  RegexExtractAction,
  TemplateRenderAction,
  HttpRequestAction,
  EnvReadAction,
  ScriptAction,
} from "./actionTypes";
import { t } from "./i18n";

/* ==================== Path Utilities (zero-dependency lodash replacement) ==================== */

export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") {
      cur[p] = {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/* ==================== Template Resolution ==================== */

/**
 * Resolve ${...} template expressions against the action context.
 * Supported namespaces:
 *   ${trigger.params.X}  — current trigger parameters
 *   ${state.a.b}         — state storage values
 *   ${pipeline_params.X} — mutable pipeline params (pre-action output)
 *   ${env.VAR}           — environment variables
 *   ${pipeline.name}     — pipeline metadata
 *   ${run.prev.id}       — previous run metadata
 */
export function resolveTemplate(template: string, ctx: ActionContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const val = resolveExpr(expr.trim(), ctx);
    return val != null ? String(val) : "";
  });
}

function resolveExpr(expr: string, ctx: ActionContext): unknown {
  const dotIdx = expr.indexOf(".");
  if (dotIdx < 0) {
    return (ctx as any)[expr];
  }
  const ns = expr.slice(0, dotIdx);
  const rest = expr.slice(dotIdx + 1);

  switch (ns) {
    case "trigger":
      return getByPath(ctx.trigger, rest);
    case "state":
      return getByPath(ctx.state, rest);
    case "pipeline_params":
      return getByPath(ctx.pipeline_params, rest);
    case "env":
      return ctx.env[rest];
    case "pipeline":
      return getByPath(ctx.pipeline, rest);
    case "run":
      return getByPath(ctx.run, rest);
    default:
      return getByPath(ctx, expr);
  }
}

/* ==================== Action Engine ==================== */

export class ActionEngine {
  /** Optional secondary logger for OutputChannel. */
  outputLogger: ((msg: string) => void) | null = null;

  constructor(private readonly logger: (msg: string) => void) {}

  private log(msg: string): void {
    this.logger(msg);
    this.outputLogger?.(msg);
  }

  /**
   * Execute pre-actions sequentially.
   * Returns ok=false if any action fails (caller should skip trigger).
   * Mutates ctx.pipeline_params with injected values.
   */
  async executePreActions(
    actions: ActionConfig[],
    ctx: ActionContext
  ): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.log(`[pre ${i + 1}/${actions.length}] ${action.type} → ${"target" in action ? action.target : "—"}`);
      const result = await this.executeAction(action, ctx);
      if (!result.ok) {
        const msg = t("action.preFailed", { n: i + 1, type: action.type, error: result.error || "" });
        this.log(`✗ ${msg}`);
        errors.push(msg);
        return { ok: false, errors };
      }
      this.log(t("action.preOk", { n: i + 1 }));
    }
    return { ok: true, errors: [] };
  }

  /**
   * Execute post-actions sequentially.
   * State writes are buffered in ctx.state; caller commits only if all succeed.
   * Returns ok=false if any action fails (caller should NOT commit state).
   */
  async executePostActions(
    actions: ActionConfig[],
    ctx: ActionContext
  ): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.log(`[post ${i + 1}/${actions.length}] ${action.type} → ${"target" in action ? action.target : "—"}`);
      const result = await this.executeAction(action, ctx);
      if (!result.ok) {
        const msg = t("action.postFailed", { n: i + 1, type: action.type, error: result.error || "" });
        this.log(`✗ ${msg}`);
        errors.push(msg);
        return { ok: false, errors };
      }
      this.log(t("action.postOk", { n: i + 1 }));
    }
    return { ok: true, errors: [] };
  }

  private async executeAction(action: ActionConfig, ctx: ActionContext): Promise<ActionResult> {
    switch (action.type) {
      case "state_read":
        return this.execStateRead(action, ctx);
      case "regex_extract":
        return this.execRegexExtract(action, ctx);
      case "template_render":
        return this.execTemplateRender(action, ctx);
      case "http_request":
        return this.execHttpRequest(action, ctx);
      case "env_read":
        return this.execEnvRead(action, ctx);
      case "script":
        return this.execScript(action, ctx);
      default:
        return { ok: false, error: t("action.unknownType", { type: (action as any).type }) };
    }
  }

  /* ---- state_read ---- */
  private execStateRead(action: StateReadAction, ctx: ActionContext): ActionResult {
    const rawKey = action.key;
    const key = resolveTemplate(rawKey, ctx);
    this.log(`[state_read] key: "${rawKey}" → "${key}"`);
    const value = getByPath(ctx.state, key);

    if (value === undefined || value === null || value === "") {
      switch (action.on_missing) {
        case "fail":
          return { ok: false, error: t("action.stateKeyMissing", { key }) };
        case "fallback":
          this.applyTarget(action.target, action.fallback ?? "", ctx);
          return { ok: true, values: { [action.target]: action.fallback ?? "" } };
        case "skip":
        default:
          this.log(t("action.stateKeySkip", { key }));
          return { ok: true };
      }
    }

    this.applyTarget(action.target, String(value), ctx);
    this.log(t("action.stateRead", { key, value: String(value).slice(0, 80) }));
    return { ok: true, values: { [action.target]: value } };
  }

  /* ---- regex_extract ---- */
  private execRegexExtract(action: RegexExtractAction, ctx: ActionContext): ActionResult {
    const source = ctx.pipeline_logs || "";
    if (!source) {
      if (action.on_no_match === "fail") {
        return { ok: false, error: t("action.logsEmpty") };
      }
      return { ok: true };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(action.pattern, "g");
    } catch (e) {
      return { ok: false, error: t("action.regexInvalid", { error: (e as Error).message }) };
    }

    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
      matches.push(m[0]);
      if (action.strategy === "first") break;
    }

    if (matches.length > 0) {
      this.log(t("action.regexMatches", { pattern: action.pattern, n: matches.length }));
    }

    if (matches.length === 0) {
      switch (action.on_no_match) {
        case "fail":
          return { ok: false, error: t("action.regexNoMatch", { pattern: action.pattern }) };
        case "warn":
          this.log(t("action.regexNoMatchWarn", { pattern: action.pattern }));
          return { ok: true };
        case "skip":
        default:
          return { ok: true };
      }
    }

    const value = action.strategy === "last" ? matches[matches.length - 1] : matches[0];
    const rawTarget = action.target;
    const target = resolveTemplate(rawTarget, ctx);
    this.log(`[regex_extract] target: "${rawTarget}" → "${target}"`);

    if (target.startsWith("state.")) {
      setByPath(ctx.state, target.slice("state.".length), value);
    } else {
      this.applyTarget(target, value, ctx);
    }

    this.log(t("action.extracted", { value, target }));
    return { ok: true, values: { [target]: value } };
  }

  /* ---- template_render ---- */
  private execTemplateRender(action: TemplateRenderAction, ctx: ActionContext): ActionResult {
    const rendered = resolveTemplate(action.template, ctx);
    this.applyTarget(action.target, rendered, ctx);
    this.log(t("action.rendered", { template: action.template, rendered }));
    return { ok: true, values: { [action.target]: rendered } };
  }

  /* ---- http_request ---- */
  private async execHttpRequest(action: HttpRequestAction, ctx: ActionContext): Promise<ActionResult> {
    const url = resolveTemplate(action.url, ctx);
    const method = action.method || "GET";

    const headers: Record<string, string> = {};
    if (action.headers) {
      for (const [k, v] of Object.entries(action.headers)) {
        headers[k] = resolveTemplate(v, ctx);
      }
    }

    try {
      const { status, body } = await this.httpRequest(
        url,
        method,
        headers,
        action.body ? resolveTemplate(action.body, ctx) : undefined
      );
      this.log(t("action.httpOk", { method, url, status, len: body.length }));

      if (action.extract) {
        const regex = new RegExp(action.extract.pattern);
        const m = regex.exec(body);
        if (m) {
          const target = resolveTemplate(action.extract.target, ctx);
          if (target.startsWith("state.")) {
            setByPath(ctx.state, target.slice("state.".length), m[0]);
          } else {
            this.applyTarget(target, m[0], ctx);
          }
          this.log(t("action.httpExtract", { value: m[0], target }));
        }
      } else if (action.target) {
        const target = resolveTemplate(action.target, ctx);
        if (target.startsWith("state.")) {
          setByPath(ctx.state, target.slice("state.".length), body);
        } else {
          this.applyTarget(target, body, ctx);
        }
      }

      return { ok: true };
    } catch (e) {
      const msg = t("action.httpFailed", { method, url, error: (e as Error).message });
      switch (action.on_error) {
        case "fail":
          return { ok: false, error: msg };
        case "warn":
          this.log(t("action.warnOnly", { msg }));
          return { ok: true };
        case "skip":
        default:
          return { ok: true };
      }
    }
  }

  private httpRequest(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method,
          headers: { ...headers, ...(body ? { "Content-Length": String(Buffer.byteLength(body)) } : {}) },
          timeout: 30000,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            const status = res.statusCode || 0;
            if (status >= 400) {
              reject(new Error(`HTTP ${status}`));
            } else {
              resolve({ status, body: data });
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      if (body) req.write(body);
      req.end();
    });
  }

  /* ---- env_read ---- */
  private execEnvRead(action: EnvReadAction, ctx: ActionContext): ActionResult {
    const value = ctx.env[action.var];
    if (value === undefined || value === "") {
      switch (action.on_missing) {
        case "fail":
          return { ok: false, error: t("action.envMissing", { var: action.var }) };
        case "fallback":
          this.applyTarget(action.target, action.fallback ?? "", ctx);
          return { ok: true };
        case "skip":
        default:
          return { ok: true };
      }
    }
    this.applyTarget(action.target, value, ctx);
    this.log(t("action.envRead", { var: action.var, value: value.slice(0, 40) }));
    return { ok: true, values: { [action.target]: value } };
  }

  /* ---- script (sandboxed) ---- */
  private execScript(action: ScriptAction, ctx: ActionContext): ActionResult {
    try {
      const sandbox = {
        ctx: {
          params: { ...ctx.trigger.params },
          state: JSON.parse(JSON.stringify(ctx.state)),
          logs: ctx.pipeline_logs,
          set: (key: string, value: unknown) => {
            setByPath(ctx.state, key, value);
          },
        },
      };
      vm.runInNewContext(action.code, sandbox, { timeout: 5000, filename: "action-script.js" });
      this.log(t("action.scriptOk"));
      return { ok: true };
    } catch (e) {
      const msg = t("action.scriptFailed", { error: (e as Error).message });
      switch (action.on_error) {
        case "fail":
          return { ok: false, error: msg };
        case "warn":
          this.log(t("action.warnOnly", { msg }));
          return { ok: true };
        case "skip":
        default:
          return { ok: true };
      }
    }
  }

  /* ---- target application ---- */
  private applyTarget(target: string, value: string, ctx: ActionContext): void {
    if (target.startsWith("pipeline_params.")) {
      const key = target.slice("pipeline_params.".length);
      ctx.pipeline_params[key] = value;
    } else if (target.startsWith("state.")) {
      setByPath(ctx.state, target.slice("state.".length), value);
    }
  }
}
