# Jenkins Pipeline Batch Trigger (VSCode Extension)

Batch-trigger Jenkins pipelines with custom parameters, monitor realtime build status,
group / filter jobs, and abort in bulk — all from a VSCode webview.

## Features

- **Batch trigger** multiple pipelines with a shared parameter set (JSON editor + KV quick-edit).
- **Realtime status** (Running / Success / Failed / Unstable / Aborted) with manual + auto refresh.
- **Batch abort** running builds.
- **Groups & templates**: save selections as named groups; save filter conditions as templates;
  save parameter sets as parameter templates. Same pipeline may belong to multiple groups
  (webview deduplicates).
- **Queue & build link**: per-job queue count + clickable link to the real Jenkins build page.
- **Local-first data**: all selections / groups / templates live in `.jenkins-batch-trigger`
  (workspace root). Jenkins is only queried on "Add group from Jenkins" and on refresh/trigger.

## Setup

1. Configure the connection (Command Palette → `Jenkins: Open Settings`):
   - `jenkinsBatchTrigger.jenkinsUrl` — Jenkins root URL.
   - `jenkinsBatchTrigger.username` — Jenkins username.
2. Set your API token: Command Palette → `Jenkins: Set API Token`
   (stored securely in VSCode SecretStorage). Generate one in Jenkins →
   *Configure User → API Token*.
3. Open the runner: Activity Bar → *Jenkins Batch* → *Open Batch Runner*.

## Build

```bash
npm install
npm run compile
```

Press <kbd>F5</kbd> in VSCode to launch an Extension Development Host with the plugin loaded.

## Data file

`.jenkins-batch-trigger` (workspace root) caches synced jobs, groups, filters and param
templates. Safe to commit or share across a team.
