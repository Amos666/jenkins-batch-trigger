/* Type definitions for the Pipeline Pre/Post Action system. */

/* ==================== Action Config Types ==================== */

export type ActionType =
  | "state_read"
  | "regex_extract"
  | "template_render"
  | "http_request"
  | "env_read"
  | "script";

export interface StateReadAction {
  type: "state_read";
  /** Key to read from state (supports ${...} templates). e.g. "chg_id.${trigger.params.param1}" */
  key: string;
  /** Injection target. e.g. "pipeline_params.param2" */
  target: string;
  /** Behavior when key is missing. */
  on_missing: "skip" | "fail" | "fallback";
  /** Fallback value when on_missing is "fallback". */
  fallback?: string;
}

export interface RegexExtractAction {
  type: "regex_extract";
  /** Data source to extract from. */
  source: "pipeline_logs";
  /** Regular expression pattern (supports named groups). */
  pattern: string;
  /** Target path to write extracted value. e.g. "state.chg_id.${trigger.params.param1}" */
  target: string;
  /** Match strategy. */
  strategy: "first" | "last" | "all";
  /** Behavior when no match found. */
  on_no_match: "warn" | "fail" | "skip";
}

export interface TemplateRenderAction {
  type: "template_render";
  /** Template string with ${...} placeholders. */
  template: string;
  /** Target path for the rendered result. */
  target: string;
}

export interface HttpRequestAction {
  type: "http_request";
  /** URL (supports ${...} templates). */
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Optional: extract from response body via regex and write to target. */
  extract?: { pattern: string; target: string };
  /** Target path for the full response body (if no extract). */
  target?: string;
  on_error: "fail" | "warn" | "skip";
}

export interface EnvReadAction {
  type: "env_read";
  /** Environment variable name. */
  var: string;
  /** Target path. */
  target: string;
  on_missing: "skip" | "fail" | "fallback";
  fallback?: string;
}

export interface ScriptAction {
  type: "script";
  /** Sandboxed JS code. Only ctx.state / ctx.logs / ctx.params / ctx.set available. */
  code: string;
  on_error: "fail" | "warn" | "skip";
}

export type ActionConfig =
  | StateReadAction
  | RegexExtractAction
  | TemplateRenderAction
  | HttpRequestAction
  | EnvReadAction
  | ScriptAction;

/* ==================== Config File ==================== */

export interface ActionsConfigFile {
  /** jobPath values of pipelines that have PRE actions enabled. */
  pre_enabled_pipelines: string[];
  /** jobPath values of pipelines that have POST actions enabled. */
  post_enabled_pipelines: string[];
  /** Shared pre-actions applied to all pre-enabled pipelines. */
  pre_actions: ActionConfig[];
  /** Shared post-actions applied to all post-enabled pipelines. */
  post_actions: ActionConfig[];
}

export function emptyActionsConfig(): ActionsConfigFile {
  return { pre_enabled_pipelines: [], post_enabled_pipelines: [], pre_actions: [], post_actions: [] };
}

/* ==================== State File ==================== */

export interface StateFile {
  version: number;
  updated_at: string;
  last_run_id: string;
  [bucket: string]: unknown;
}

export function emptyState(): StateFile {
  return { version: 1, updated_at: "", last_run_id: "" };
}

/* ==================== Runtime Context ==================== */

export interface ActionContext {
  trigger: { params: Record<string, string> };
  pipeline_logs: string;
  state: Record<string, unknown>;
  /** Mutable during pre-actions; injected into trigger params. */
  pipeline_params: Record<string, string>;
  env: Record<string, string | undefined>;
  pipeline: { name: string; jobPath: string };
  run: { prev: { id: string } };
}

/* ==================== Watched Build (Poller) ==================== */

export interface WatchedBuild {
  /** jobPath, used as unique key. */
  pipelineId: string;
  jobPath: string;
  /** Null while still in queue. */
  buildNumber: number | null;
  /** Queue item URL from triggerBuild Location header. */
  queueUrl: string | null;
  /** Trigger params at watch time (needed for post-action templates). */
  triggerParams: Record<string, string>;
  triggeredAt: number;
  pollCount: number;
}

/* ==================== Action Result ==================== */

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Values extracted/written by this action. */
  values?: Record<string, unknown>;
}
