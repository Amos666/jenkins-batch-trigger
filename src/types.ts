/* Shared domain types for the Jenkins Batch Trigger extension. */

/** Build / job status, mapped from Jenkins color + build result. */
export type JobStatus =
  | "running"
  | "success"
  | "failed"
  | "unstable"
  | "aborted"
  | "idle"
  | "unknown";

/** A Jenkins job (returned by the API client). */
export interface Job {
  /** Full Jenkins path, e.g. "order-service/deploy". */
  name: string;
  /** Top-level folder segment of `name`. */
  folder: string;
  status: JobStatus;
  /** Last build number as a string like "#142". */
  build: string;
  /** Duration text, e.g. "2m 13s". */
  dur: string;
  /** Human readable "last run" text. */
  time: string;
  /** Number of builds currently queued. */
  queue: number;
  /** Numeric build number (used for abort + URL). 0 if none. */
  buildNumber: number;
  /** Absolute Jenkins URL of the job. */
  url: string;
}

/** A node in the user-defined tree (stored in VSCode globalState). */
export interface TreeNode {
  /** Unique ID (generated). */
  id: string;
  /** "folder" = container; "job" = reference to a Jenkins pipeline. */
  type: "folder" | "job";
  /** Display name. For folders: user-defined. For jobs: short job name. */
  name: string;
  /** Parent node ID. null for root-level nodes. */
  parentId: string | null;

  // ---- Job-specific fields (only for type === "job") ----

  /** Jenkins full path, e.g. "team-a/deploy-service". Used for API calls. */
  jobPath?: string;
  /** Absolute Jenkins URL of the job. */
  jobUrl?: string;
  /** Top-level folder segment (for grouping in QuickPick). */
  folder?: string;

  // ---- Cached status (refreshed on demand) ----

  status?: JobStatus;
  build?: string;
  dur?: string;
  time?: string;
  buildNumber?: number;
  queue?: number;
}

/** Shape of the global tree config (stored in globalState). */
export interface TreeConfig {
  /** Flat map of all nodes by ID for O(1) lookup. */
  nodes: Record<string, TreeNode>;
  /** IDs of root-level nodes (parentId === null). */
  rootIds: string[];
}

/** A saved parameter set (array of [key, value]). */
export interface ParamTemplate {
  id: number;
  name: string;
  params: [string, string][];
  /** Category name for grouping templates; empty/undefined = uncategorized. */
  category?: string;
}

/** Which occurrence of a regex match to keep during log extraction. */
export type LogExtractStrategy = "first" | "last" | "all";

/** How a log extraction rule derives its value. */
export type LogExtractRuleKind = "regex" | "script";

/** A user-defined rule for extracting values from build console logs. */
export interface LogExtractRule {
  id: number;
  name: string;
  /** Undefined on rules saved before scripts existed; treated as "regex". */
  kind?: LogExtractRuleKind;
  /** JS regex applied line by line (regex kind). */
  pattern?: string;
  /** Sandboxed JS code evaluated against the full log (script kind). */
  code?: string;
  strategy: LogExtractStrategy;
  /** Param key used when writing results back; empty = use rule name. */
  targetKey?: string;
}

/** Extraction result of one rule on one build log. */
export interface LogExtractResult {
  name: string;
  matched: boolean;
  values: string[];
  /** Present when the rule pattern failed to compile. */
  error?: string;
}

/** Create an empty tree config. */
export function emptyTreeConfig(): TreeConfig {
  return { nodes: {}, rootIds: [] };
}

/** Generate a unique node ID. */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Next stable numeric id (for param templates). */
export function nextId(): number {
  return Date.now() + Math.floor(Math.random() * 1000);
}
