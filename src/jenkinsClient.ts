import * as https from "https";
import * as http from "http";
import { Job, JobStatus, TreeNode } from "./types";
import { t } from "./i18n";

/** Live connection settings (read fresh on each call so the user can change them). */
export interface JenkinsSettings {
  url: string; // e.g. https://jenkins.example.com  (no trailing slash)
  username: string;
  apiToken: string;
  trustSelfSignedCert: boolean;
}

export interface JenkinsCredsProvider {
  readSettings(): Promise<JenkinsSettings>;
  writeSettings(settings: Partial<JenkinsSettings>): Promise<void>;
  saveToken(token: string): Promise<void>;
  getProxyUrl(): Promise<string | undefined>;
  shouldUseProxy(url: string): Promise<boolean>;
}

interface RawResp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Real Jenkins REST client.
 *
 * Auth: HTTP Basic with username + API token. API tokens bypass the CSRF crumb
 * requirement, so build triggers work without fetching a crumb.
 *
 * Jenkins job paths are nested inside folders and addressed as
 *   /job/<seg>/job/<seg>/...
 */
export class JenkinsClient {
  private agent: https.Agent | undefined;
  private proxyAgent: http.Agent | https.Agent | undefined;
  private lastProxyUrl: string | undefined;
  private lastTrustSelfSignedCert: boolean | undefined;
  /** Optional logger callback; when set, every request/response is reported. */
  logger: ((msg: string) => void) | undefined;

  constructor(private readonly creds: JenkinsCredsProvider) {}

  private log(msg: string): void {
    if (this.logger) {
      try {
        this.logger(msg);
      } catch {
        /* ignore logger errors */
      }
    }
  }

  /** Throws a friendly error if the connection is not configured. */
  private async requireSettings(): Promise<JenkinsSettings> {
    const s = await this.creds.readSettings();
    if (!s.url || !s.username || !s.apiToken) {
      throw new Error(t("client.notConfigured"));
    }
    return s;
  }

  private getDirectAgent(trustSelfSignedCert: boolean): https.Agent | undefined {
    if (!trustSelfSignedCert) {
      return undefined;
    }
    if (!this.agent) {
      this.agent = new https.Agent({ rejectUnauthorized: false });
    }
    return this.agent;
  }

  /**
   * Build an agent that routes through an HTTP proxy.
   * For HTTPS targets, uses HTTP CONNECT tunneling.
   * For HTTP targets, uses a plain forwarding proxy.
   */
  private async getProxyAgent(
    targetProtocol: string,
    targetUrl: string,
    trustSelfSignedCert: boolean
  ): Promise<http.Agent | https.Agent | undefined> {
    const useProxy = await this.creds.shouldUseProxy(targetUrl);
    if (!useProxy) {
      this.log(t("client.proxyBypass", { url: targetUrl }));
      return undefined;
    }

    const proxyUrl = await this.creds.getProxyUrl();
    if (!proxyUrl) return undefined;

    if (this.proxyAgent && this.lastProxyUrl === proxyUrl && this.lastTrustSelfSignedCert === trustSelfSignedCert) {
      return this.proxyAgent;
    }

    const proxy = new URL(proxyUrl);
    const proxyHost = proxy.hostname;
    const proxyPort = parseInt(proxy.port || (proxy.protocol === "https:" ? "443" : "80"), 10);
    const proxyAuth = proxy.username
      ? `${proxy.username}:${proxy.password}`
      : undefined;

    const makeHttpsOverHttpAgent = (): https.Agent => {
      const createConnection = (
        options: any,
        callback: (err: Error | null, socket?: any) => void
      ) => {
        const targetHost = `${options.hostname || "localhost"}:${options.port || 443}`;
        const req = http.request({
          hostname: proxyHost,
          port: proxyPort,
          method: "CONNECT",
          path: targetHost,
          headers: proxyAuth
            ? { "Proxy-Authorization": "Basic " + Buffer.from(proxyAuth).toString("base64") }
            : undefined,
        });
        req.on("connect", (res, socket) => {
          if (res.statusCode === 200) {
            const tls = require("tls");
            const tlsSocket = tls.connect({
              socket,
              servername: options.hostname,
              rejectUnauthorized: !trustSelfSignedCert,
            });
            callback(null, tlsSocket);
          } else {
            callback(new Error(t("client.proxyConnectFailed", { status: res.statusCode || 0 })));
          }
        });
        req.on("error", (err) => callback(err));
        req.end();
      };
      return new https.Agent({ keepAlive: false, createConnection } as any);
    };

    if (targetProtocol === "https:") {
      this.proxyAgent = makeHttpsOverHttpAgent();
    } else {
      this.proxyAgent = new http.Agent({
        host: proxyHost,
        port: proxyPort,
        keepAlive: false,
      });
    }

    this.lastProxyUrl = proxyUrl;
    this.lastTrustSelfSignedCert = trustSelfSignedCert;
    return this.proxyAgent;
  }

  private async req(
    method: string,
    urlPath: string,
    opts: { query?: Record<string, string>; body?: string; raw?: boolean } = {}
  ): Promise<RawResp> {
    const s = await this.requireSettings();
    const base = s.url.replace(/\/+$/, "");
    const search = opts.query ? "?" + new URLSearchParams(opts.query).toString() : "";
    const fullUrl = base + urlPath + search;
    // Log outgoing request with method, URL, and optional body (params).
    const bodyInfo = opts.body ? ` body=${opts.body}` : "";
    this.log(`→ ${method} ${fullUrl}${bodyInfo}`);
    return this.doRequest(method, fullUrl, s, opts.body, 0);
  }

  /** Actually perform an HTTP request with redirect-following, timeout, and friendly errors. */
  private async doRequest(
    method: string,
    fullUrl: string,
    s: JenkinsSettings,
    body: string | undefined,
    redirects: number
  ): Promise<RawResp> {
    const u = new URL(fullUrl);
    const lib = u.protocol === "https:" ? https : http;
    const auth = "Basic " + Buffer.from(`${s.username}:${s.apiToken}`).toString("base64");
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }

    const proxyAgent = await this.getProxyAgent(u.protocol, fullUrl, s.trustSelfSignedCert);
    const agent = proxyAgent || this.getDirectAgent(s.trustSelfSignedCert);

    return new Promise<RawResp>((resolve, reject) => {
      let reqOptions: http.RequestOptions | https.RequestOptions = {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        agent: agent as any,
        timeout: 30000,
      };

      const req = lib.request(reqOptions, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
            const loc = res.headers.location;
            const location = Array.isArray(loc) ? loc[0] : loc;
            if (location) {
              const nextUrl = location.startsWith("http")
                ? location
                : new URL(location, fullUrl).href;
              this.log(`↪ ${status} redirect → ${nextUrl}`);
              void this.doRequest("GET", nextUrl, s, undefined, redirects + 1).then(resolve, reject);
              return;
            }
          }
          const preview = data.length > 200 ? data.slice(0, 200) + "…" : data;
          this.log(`← ${status} ${fullUrl} (${data.length}B) ${preview}`);
          resolve({ status, headers: res.headers, body: data });
        });
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        const msg = err.message || "";
        const code = err.code || "";
        this.log(`✗ ${method} ${fullUrl} error: ${code || msg}`);

        let friendlyMsg: string;
        if (msg.includes("self-signed") || msg.includes("SELF_SIGNED_CERT") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "CERT_HAS_EXPIRED") {
          friendlyMsg = t("client.sslError", { detail: code || msg });
        } else if (code === "ENOTFOUND") {
          friendlyMsg = t("client.dnsNotFound", { host: u.host });
        } else if (code === "ECONNREFUSED") {
          friendlyMsg = t("client.connRefused", { host: u.host });
        } else if (code === "ETIMEDOUT" || code === "ECONNRESET") {
          friendlyMsg = code === "ECONNRESET" ? t("client.connReset", { host: u.host }) : t("client.connTimeout", { host: u.host });
        } else if (code === "EAI_AGAIN") {
          friendlyMsg = t("client.dnsAgain", { host: u.host });
        } else if (msg.includes("代理") || msg.includes("proxy") || msg.includes("PROXY")) {
          friendlyMsg = t("client.proxyFailed", { msg });
        } else {
          friendlyMsg = t("client.networkError", { code: code || "unknown", msg });
        }
        reject(new Error(friendlyMsg));
      });

      req.on("timeout", () => {
        this.log(`✗ ${method} ${fullUrl} timeout (30s)`);
        req.destroy(new Error(t("client.requestTimeout", { host: u.host })));
      });

      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }

  private async reqJson<T>(method: string, urlPath: string, query?: Record<string, string>): Promise<T> {
    const r = await this.req(method, urlPath, { query });
    if (r.status === 401 || r.status === 403) {
      throw new Error(t("client.authFailed", { status: r.status }));
    }
    if (r.status === 503) {
      throw new Error(t("client.proxy503"));
    }
    if (r.status >= 300 && r.status < 400) {
      throw new Error(t("client.redirect", { status: r.status }));
    }
    if (r.status >= 400) {
      throw new Error(t("client.httpError", { method, path: urlPath, status: r.status, body: r.body.slice(0, 300) }));
    }
    if (!r.body || !r.body.trim()) {
      throw new Error(t("client.emptyResponse", { path: urlPath, status: r.status }));
    }
    try {
      return JSON.parse(r.body) as T;
    } catch (e) {
      const isHtml = r.body.trimStart().startsWith("<");
      throw new Error(
        isHtml
          ? t("client.htmlResponse", { path: urlPath, status: r.status })
          : t("client.notJson", { path: urlPath, status: r.status, body: r.body.slice(0, 200) })
      );
    }
  }

  /** Build the Jenkins path segments for a fullName like "folder/sub/job". */
  static jobPath(fullName: string): string {
    return fullName
      .split("/")
      .map(encodeURIComponent)
      .join("/job/");
  }

  /**
   * List all buildable jobs (recursing into folders) with last-build + queue info.
   * One request using a recursive tree query.
   */
  async listAllJobs(): Promise<Job[]> {
    const fields =
      "name,fullName,url,color,buildable,lastBuild[number,building,result,duration,timestamp,url],queueItem[id]";
    const tree = `jobs[${nest(fields, 5)}]`;
    const root = await this.reqJson<{ jobs?: any[] }>("GET", "/api/json", { tree });
    const flat: any[] = [];
    const walk = (items: any[] | undefined): void => {
      if (!items) {
        return;
      }
      for (const it of items) {
        if (it && it.buildable === true) {
          flat.push(it);
        }
        if (it && Array.isArray(it.jobs)) {
          walk(it.jobs);
        }
      }
    };
    walk(root.jobs);
    const queueMap = await this.getQueueMap();
    return flat.map((j) => mapJob(j, queueMap));
  }

  /** Count queued items per job fullName. */
  private async getQueueMap(): Promise<Map<string, number>> {
    try {
      const q = await this.reqJson<{ items?: { task?: { fullName?: string } }[] }>(
        "GET",
        "/queue/api/json",
        { tree: "items[id,task[fullName]]" }
      );
      const m = new Map<string, number>();
      for (const it of q.items || []) {
        const fn = it.task?.fullName;
        if (fn) {
          m.set(fn, (m.get(fn) || 0) + 1);
        }
      }
      return m;
    } catch {
      return new Map();
    }
  }

  /**
   * List buildable jobs under a specific Jenkins folder path.
   * Only fetches jobs within that folder (recursive), not all jobs on the server.
   * @param folderPath e.g. "team-a" or "team-a/sub-team" or "" for root
   */
  async listJobsInFolder(folderPath: string): Promise<Job[]> {
    // Convert "team-a/sub" → "/job/team-a/job/sub"
    const basePath = folderPath
      ? "/job/" + folderPath.split("/").map(encodeURIComponent).join("/job/")
      : "";

    const fields =
      "name,fullName,url,color,buildable,lastBuild[number,building,result,duration,timestamp,url],queueItem[id]";
    const tree = `jobs[${nest(fields, 5)}]`;
    const root = await this.reqJson<{ jobs?: any[] }>("GET", basePath + "/api/json", { tree });
    const flat: any[] = [];
    const walk = (items: any[] | undefined): void => {
      if (!items) return;
      for (const it of items) {
        if (it && it.buildable === true) {
          flat.push(it);
        }
        if (it && Array.isArray(it.jobs)) {
          walk(it.jobs);
        }
      }
    };
    walk(root.jobs);

    // Fetch queue info for these specific jobs.
    const queueMap = await this.getQueueMap();
    return flat.map((j) => mapJob(j, queueMap));
  }

  /**
   * Refresh status for a list of job nodes (by their Jenkins paths).
   * Fetches each job's last build info individually (or in batch if same folder).
   * Returns updated status info keyed by jobPath.
   */
  async refreshJobNodes(nodes: TreeNode[]): Promise<Map<string, Partial<TreeNode>>> {
    const result = new Map<string, Partial<TreeNode>>();
    if (nodes.length === 0) return result;

    // Group by parent folder to batch-fetch.
    const byFolder = new Map<string, string[]>();
    for (const node of nodes) {
      if (node.type !== "job" || !node.jobPath) continue;
      const parts = node.jobPath.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      const arr = byFolder.get(folder) || [];
      arr.push(node.jobPath);
      byFolder.set(folder, arr);
    }

    for (const [folder, paths] of byFolder) {
      try {
        const jobs = await this.listJobsInFolder(folder);
        const byName = new Map(jobs.map((j) => [j.name, j]));
        for (const path of paths) {
          const fresh = byName.get(path);
          if (fresh) {
            result.set(path, {
              status: fresh.status,
              build: fresh.build,
              dur: fresh.dur,
              time: fresh.time,
              buildNumber: fresh.buildNumber,
              queue: fresh.queue,
            });
          } else {
            result.set(path, { status: "unknown" });
          }
        }
      } catch {
        // If folder fetch fails, mark jobs as unknown.
        for (const path of paths) {
          result.set(path, { status: "unknown" });
        }
      }
    }

    return result;
  }

  /** Trigger a build with parameters. Returns the queue-item location URL if present. */
  async triggerBuild(fullName: string, params: Record<string, string>): Promise<string | undefined> {
    const hasParams = Object.keys(params).length > 0;
    const path = `/job/${JenkinsClient.jobPath(fullName)}/${
      hasParams ? "buildWithParameters" : "build"
    }`;
    const body = hasParams ? new URLSearchParams(params).toString() : undefined;
    const r = await this.req("POST", path, { body });
    if (r.status >= 400) {
      throw new Error(t("client.triggerFailed", { name: fullName, status: r.status, body: r.body.slice(0, 200) }));
    }
    const loc = r.headers["location"];
    return Array.isArray(loc) ? loc[0] : loc;
  }

  /** Abort a running build by its number. */
  async abortBuild(fullName: string, buildNumber: number): Promise<void> {
    const path = `/job/${JenkinsClient.jobPath(fullName)}/${buildNumber}/stop`;
    const r = await this.req("POST", path);
    if (r.status >= 400 && r.status !== 404) {
      throw new Error(t("client.abortFailed", { name: fullName, build: buildNumber, status: r.status }));
    }
  }

  /** Get build status for polling completion. */
  async getBuildStatus(
    fullName: string,
    buildNumber: number
  ): Promise<{ result: string | null; building: boolean; duration: number; timestamp: number }> {
    const path = `/job/${JenkinsClient.jobPath(fullName)}/${buildNumber}/api/json`;
    return this.reqJson("GET", path, { tree: "result,building,duration,timestamp" });
  }

  /** Get console log text for a build (plain text, not JSON). */
  async getConsoleText(fullName: string, buildNumber: number): Promise<string> {
    const path = `/job/${JenkinsClient.jobPath(fullName)}/${buildNumber}/consoleText`;
    const r = await this.req("GET", path);
    if (r.status >= 400) {
      throw new Error(t("client.logFailed", { name: fullName, build: buildNumber, status: r.status }));
    }
    return r.body;
  }

  /** Resolve a queue item URL to get the executable build number. */
  async getQueueItem(queueUrl: string): Promise<{ executable?: { number: number } }> {
    const u = new URL(queueUrl);
    const apiPath = u.pathname.replace(/\/+$/, "") + "/api/json";
    return this.reqJson("GET", apiPath, { tree: "executable[number]" });
  }

  /** Refresh status for the given cached jobs (re-lists all, returns the subset). */
  async refreshJobs(cached: Job[]): Promise<Job[]> {
    const fresh = await this.listAllJobs();
    const byName = new Map(fresh.map((j) => [j.name, j]));
    return cached.map((c) => {
      const f = byName.get(c.name);
      return f || c;
    });
  }
}

function nest(fields: string, depth: number): string {
  if (depth <= 0) {
    return fields;
  }
  return `${fields},jobs[${nest(fields, depth - 1)}]`;
}

function colorToStatus(color?: string, lastBuild?: { building?: boolean }): JobStatus {
  if (!color) {
    return "idle";
  }
  if (color.includes("anime") || lastBuild?.building) {
    return "running";
  }
  if (color.startsWith("blue")) {
    return "success";
  }
  if (color.startsWith("red")) {
    return "failed";
  }
  if (color.startsWith("yellow")) {
    return "unstable";
  }
  if (color.startsWith("aborted")) {
    return "aborted";
  }
  return "idle";
}

function humanDur(ms: number): string {
  if (!ms || ms <= 0) {
    return "—";
  }
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

function humanTime(ts: number): string {
  if (!ts) {
    return "—";
  }
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) {
    return t("time.justNow");
  }
  if (min < 60) {
    return t("time.minutesAgo", { n: min });
  }
  const h = Math.floor(min / 60);
  if (h < 24) {
    return t("time.hoursAgo", { n: h });
  }
  const d = Math.floor(h / 24);
  if (d < 7) {
    return t("time.daysAgo", { n: d });
  }
  return new Date(ts).toLocaleDateString();
}

function mapJob(j: any, queueMap: Map<string, number>): Job {
  const fullName: string = j.fullName || j.name;
  const folder = fullName.split("/")[0] || "root";
  const lb = j.lastBuild;
  const status = colorToStatus(j.color, lb);
  const buildNumber = lb && typeof lb.number === "number" ? lb.number : 0;
  const build = buildNumber ? "#" + buildNumber : "—";
  const dur = lb && lb.duration ? humanDur(lb.duration) : status === "running" ? "—" : "—";
  const time = lb && lb.timestamp ? humanTime(lb.timestamp) : "—";
  return {
    name: fullName,
    folder,
    status,
    build,
    dur,
    time,
    queue: queueMap.get(fullName) || 0,
    buildNumber,
    url: typeof j.url === "string" ? j.url : "",
  };
}
