import { JenkinsClient } from "./jenkinsClient";
import { WatchedBuild } from "./actionTypes";
import { t } from "./i18n";

const INITIAL_INTERVAL = 10_000;
const MAX_INTERVAL = 60_000;
const QUEUE_STALE_TIMEOUT = 30 * 60_000; // give up on a build stuck in the queue
const RUNNING_STALE_TIMEOUT = 24 * 60 * 60_000; // safety cap for actively-running builds

export interface BuildCompleteInfo {
  build: WatchedBuild;
  result: string;
  logs: string;
}

/**
 * Single-timer polling for all running builds.
 * Watches triggered builds until completion, then invokes the callback.
 * Exponential backoff: 10s → 30s → 60s (capped). Reset on new watch.
 */
export class BuildPoller {
  private watched = new Map<string, WatchedBuild>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private interval = INITIAL_INTERVAL;
  private polling = false;
  private _failedCount = 0;

  /** Called whenever the watched set changes (for status bar updates). */
  onStatusChange: (() => void) | null = null;
  /** Optional secondary logger for OutputChannel. */
  outputLogger: ((msg: string) => void) | null = null;

  constructor(
    private readonly client: JenkinsClient,
    private readonly onComplete: (info: BuildCompleteInfo) => void,
    private readonly logger: (msg: string) => void
  ) {}

  private log(msg: string): void {
    this.logger(msg);
    this.outputLogger?.(msg);
  }

  /** Start watching a triggered build. */
  watch(pipelineId: string, jobPath: string, queueUrl: string | null, triggerParams: Record<string, string>): void {
    const build: WatchedBuild = {
      pipelineId,
      jobPath,
      buildNumber: null,
      queueUrl,
      triggerParams,
      triggeredAt: Date.now(),
      pollCount: 0,
    };
    this.watched.set(pipelineId, build);
    this.log(t("poller.startWatch", { path: jobPath, queue: queueUrl ? "yes" : "no" }));

    // Reset backoff on new activity.
    this.interval = INITIAL_INTERVAL;
    this.ensureTimer();
    this.onStatusChange?.();
  }

  /**
   * Watch a build whose number is already known (e.g. re-registered at abort
   * time after the original watch was lost to a stale timeout or a reload).
   * Skips queue resolution and polls the build status directly, so post-actions
   * still run when the build reaches any terminal result.
   */
  watchBuild(pipelineId: string, jobPath: string, buildNumber: number, triggerParams: Record<string, string>): void {
    const build: WatchedBuild = {
      pipelineId,
      jobPath,
      buildNumber,
      queueUrl: null,
      triggerParams,
      triggeredAt: Date.now(),
      pollCount: 0,
    };
    this.watched.set(pipelineId, build);
    this.log(t("poller.rewatch", { path: jobPath, n: buildNumber }));

    this.interval = INITIAL_INTERVAL;
    this.ensureTimer();
    this.onStatusChange?.();
  }

  /** Number of currently watched builds. */
  get size(): number {
    return this.watched.size;
  }

  /** Check if a specific pipeline is being watched. */
  isWatching(pipelineId: string): boolean {
    return this.watched.has(pipelineId);
  }

  /** Get all watched builds (for status display). */
  getWatched(): WatchedBuild[] {
    return [...this.watched.values()];
  }

  /** Builds still waiting in the queue (no buildNumber yet). */
  get queuedCount(): number {
    let n = 0;
    for (const b of this.watched.values()) {
      if (b.buildNumber === null) n++;
    }
    return n;
  }

  /** Builds actively running (have a buildNumber). */
  get runningCount(): number {
    let n = 0;
    for (const b of this.watched.values()) {
      if (b.buildNumber !== null) n++;
    }
    return n;
  }

  /** Number of builds that completed with FAILURE result. */
  get failedCount(): number {
    return this._failedCount;
  }

  resetFailedCount(): void {
    this._failedCount = 0;
    this.onStatusChange?.();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.interval);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || this.watched.size === 0) {
      if (this.watched.size === 0) this.stopTimer();
      return;
    }
    this.polling = true;

    try {
      const completed: BuildCompleteInfo[] = [];
      const stale: string[] = [];

      for (const [key, build] of this.watched) {
        build.pollCount++;

        // Check stale timeout. Queued builds expire quickly; running builds are
        // polled until any terminal result so post-actions always run.
        const staleLimit = build.buildNumber === null ? QUEUE_STALE_TIMEOUT : RUNNING_STALE_TIMEOUT;
        if (Date.now() - build.triggeredAt > staleLimit) {
          stale.push(key);
          this.log(t("poller.stale", { path: build.jobPath }));
          continue;
        }

        try {
          // Phase 1: resolve queue item → build number.
          if (build.buildNumber === null) {
            let queueResolved = false;
            if (build.queueUrl) {
              try {
                const qi = await this.client.getQueueItem(build.queueUrl);
                if (qi.executable?.number) {
                  build.buildNumber = qi.executable.number;
                  this.log(t("poller.queueResolved", { path: build.jobPath, n: build.buildNumber }));
                  this.onStatusChange?.();
                  queueResolved = true;
                }
              } catch (e) {
                const msg = (e as Error).message || "";
                // Queue item may have been consumed (build started) and is now 404.
                // Fall back to resolving the build number from the job listing.
                this.log(t("poller.queueLost", { path: build.jobPath, error: msg }));
              }
            }

            if (!queueResolved) {
              // No queue URL or queue item gone — try to find latest build.
              const jobs = await this.client.listJobsInFolder(
                build.jobPath.includes("/") ? build.jobPath.slice(0, build.jobPath.lastIndexOf("/")) : ""
              );
              const job = jobs.find((j) => j.name === build.jobPath);
              if (job && job.buildNumber > 0) {
                build.buildNumber = job.buildNumber;
                this.log(t("poller.foundBuild", { path: build.jobPath, n: build.buildNumber }));
                this.onStatusChange?.();
              }
            }
            continue; // Wait for next poll to check build status.
          }

          // Phase 2: check build status.
          const status = await this.client.getBuildStatus(build.jobPath, build.buildNumber);
          if (!status.building) {
            // Build complete — fetch logs.
            let logs = "";
            try {
              logs = await this.client.getConsoleText(build.jobPath, build.buildNumber);
            } catch (e) {
              this.log(t("poller.logFailed", { path: build.jobPath, n: build.buildNumber, error: (e as Error).message }));
            }
            completed.push({ build, result: status.result || "UNKNOWN", logs });
          }
        } catch (e) {
          this.log(t("poller.pollError", { path: build.jobPath, error: (e as Error).message }));
        }
      }

      // Remove stale builds.
      for (const key of stale) {
        this.watched.delete(key);
      }

      // Process completed builds.
      for (const info of completed) {
        this.watched.delete(info.build.pipelineId);
        if (info.result === "FAILURE") {
          this._failedCount++;
        }
        this.log(t("poller.completed", { path: info.build.jobPath, n: info.build.buildNumber ?? 0, result: info.result }));
        this.onComplete(info);
      }

      if (stale.length > 0 || completed.length > 0) {
        this.onStatusChange?.();
      }

      // Adjust interval: backoff if nothing completed, reset if something did.
      if (completed.length > 0) {
        this.interval = INITIAL_INTERVAL;
      } else {
        this.interval = Math.min(this.interval * 2, MAX_INTERVAL);
      }

      // Restart timer with new interval.
      this.stopTimer();
      if (this.watched.size > 0) {
        this.ensureTimer();
      }
    } finally {
      this.polling = false;
    }
  }

  dispose(): void {
    this.stopTimer();
    this.watched.clear();
  }
}
