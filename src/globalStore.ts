import * as vscode from "vscode";
import { TreeConfig, emptyTreeConfig, ParamTemplate } from "./types";

const KEY_TREE = "jenkinsBatchTrigger.tree";
const KEY_PARAMS = "jenkinsBatchTrigger.paramTemplates";
const KEY_ACTIVE_TPL = "jenkinsBatchTrigger.activeTpl";

/**
 * Global storage backed by VSCode globalState.
 * The tree config (folders + job references) is shared across all workspaces.
 */
export class GlobalStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /* ---------------- tree config ---------------- */

  loadTree(): TreeConfig {
    const raw = this.context.globalState.get<TreeConfig>(KEY_TREE);
    if (!raw || !raw.nodes) {
      return emptyTreeConfig();
    }
    return raw;
  }

  saveTree(config: TreeConfig): void {
    this.context.globalState.update(KEY_TREE, config);
  }

  /* ---------------- param templates ---------------- */

  loadParamTemplates(): ParamTemplate[] {
    let templates = this.context.globalState.get<ParamTemplate[]>(KEY_PARAMS) || [];
    if (templates.length === 0) {
      templates = [{
        id: 0,
        name: "default",
        params: [["BRANCH", "main"], ["ENVIRONMENT", "staging"]]
      }];
      this.saveParamTemplates(templates);
    }
    return templates;
  }

  saveParamTemplates(templates: ParamTemplate[]): void {
    this.context.globalState.update(KEY_PARAMS, templates);
  }

  /* ---------------- active param template ---------------- */

  loadActiveTpl(): string | undefined {
    return this.context.globalState.get<string>(KEY_ACTIVE_TPL);
  }

  saveActiveTpl(name: string | undefined): void {
    this.context.globalState.update(KEY_ACTIVE_TPL, name);
  }
}
