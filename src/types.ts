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
