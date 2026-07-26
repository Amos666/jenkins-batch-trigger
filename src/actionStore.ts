import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ActionsConfigFile, StateFile, emptyActionsConfig, emptyState } from "./actionTypes";

/**
 * File-based storage for the action system.
 * Uses context.globalStorageUri (cross-workspace shared, pure JSON files).
 * All writes are atomic: write to .tmp then fs.rename.
 */
export class ActionStore {
  private readonly baseDir: string;
  private readonly statesDir: string;
  private readonly configFile: string;

  constructor(globalStorageUri: vscode.Uri) {
    this.baseDir = globalStorageUri.fsPath;
    this.statesDir = path.join(this.baseDir, "states");
    this.configFile = path.join(this.baseDir, "default-config.json");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.statesDir, { recursive: true });
  }

  /* ---------------- config ---------------- */

  async loadConfig(): Promise<ActionsConfigFile> {
    try {
      const raw = await fs.promises.readFile(this.configFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<ActionsConfigFile>;
      return {
        enabled_pipelines: parsed.enabled_pipelines ?? [],
        pre_actions: parsed.pre_actions ?? [],
        post_actions: parsed.post_actions ?? [],
      };
    } catch {
      return emptyActionsConfig();
    }
  }

  async saveConfig(cfg: ActionsConfigFile): Promise<void> {
    await this.atomicWrite(this.configFile, JSON.stringify(cfg, null, 2));
  }

  /* ---------------- per-pipeline state ---------------- */

  private stateFilePath(pipelineId: string): string {
    const sanitized = pipelineId.replace(/[/\\:*?"<>|]/g, "__");
    return path.join(this.statesDir, sanitized + ".json");
  }

  async loadState(pipelineId: string): Promise<StateFile> {
    try {
      const raw = await fs.promises.readFile(this.stateFilePath(pipelineId), "utf8");
      return JSON.parse(raw) as StateFile;
    } catch {
      return emptyState();
    }
  }

  async saveState(pipelineId: string, state: StateFile): Promise<void> {
    state.updated_at = new Date().toISOString();
    await this.atomicWrite(this.stateFilePath(pipelineId), JSON.stringify(state, null, 2));
  }

  /** Deep-clone the current state for rollback purposes. Returns null if no state exists. */
  async snapshotState(pipelineId: string): Promise<StateFile | null> {
    try {
      const raw = await fs.promises.readFile(this.stateFilePath(pipelineId), "utf8");
      return JSON.parse(raw) as StateFile;
    } catch {
      return null;
    }
  }

  /** List all pipeline IDs that have state files. */
  async listStatePipelineIds(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.statesDir);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "").replace(/__/g, "/"));
    } catch {
      return [];
    }
  }

  /** Delete a pipeline's state file. */
  async deleteState(pipelineId: string): Promise<void> {
    try {
      await fs.promises.unlink(this.stateFilePath(pipelineId));
    } catch {
      /* ignore if not exists */
    }
  }

  /* ---------------- atomic write ---------------- */

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + ".tmp";
    await fs.promises.writeFile(tmp, data, "utf8");
    await fs.promises.rename(tmp, filePath);
  }
}
