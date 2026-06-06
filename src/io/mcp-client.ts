import { spawn, type ChildProcess } from "node:child_process";
import { basename, join } from "node:path";
import { type LogWriter, openMcpStderrLog } from "./mcp-stderr-log";
import { runtimeStateHome } from "./runtime-state-home";

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export interface McpToolCallResult {
  readonly content: ReadonlyArray<{ type: string; text?: string; data?: string; mimeType?: string }>;
  readonly isError?: boolean;
}

export interface McpClientOpts {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly callTimeoutMs?: number;
  readonly initializeTimeoutMs?: number;
  /** Max bytes to buffer from server stdout before failing the client. Default 50MB. */
  readonly maxResponseBytes?: number;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

export class McpClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly callTimeoutMs: number;
  private readonly initializeTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private buf = "";
  private connected = false;
  private closed = false;
  private stderrLog: LogWriter | null = null;

  constructor(private readonly opts: McpClientOpts) {
    this.callTimeoutMs = opts.callTimeoutMs ?? 10_000;
    this.initializeTimeoutMs = opts.initializeTimeoutMs ?? 5_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 50 * 1024 * 1024;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.closed) throw new Error("mcp client already closed");
    const verbose = process.env.SMITH_MCP_VERBOSE === "1";
    this.child = spawn(this.opts.command, [...(this.opts.args ?? [])], {
      // When SMITH_MCP_VERBOSE=1 the user opted in to live stderr; otherwise
      // pipe stderr so we can drain it to a log file without flooding the
      // parent terminal. The reader MUST consume the pipe (via the on-data
      // handler below) or the child will deadlock when the buffer fills.
      stdio: verbose ? ["pipe", "pipe", "inherit"] : ["pipe", "pipe", "pipe"],
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
      ...(this.opts.env ? { env: { ...process.env, ...this.opts.env } } : {}),
    });
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    this.child.on("error", (err) => this.failAll(err));
    this.child.on("exit", (code, signal) => {
      this.stderrLog?.close().catch(() => {});
      this.stderrLog = null;
      if (this.pending.size > 0) {
        this.failAll(new Error(
          `mcp server exited with code ${code}${signal ? ` (signal ${signal})` : ""} while RPCs were pending`,
        ));
      }
    });
    if (!verbose && this.child.stderr) {
      const serverName = basename(this.opts.command).replace(/\.[a-z]+$/i, "") || "mcp";
      this.stderrLog = await openMcpStderrLog({
        logDir: join(runtimeStateHome(), "mcp-logs"),
        serverName,
      });
      this.child.stderr.on("data", (chunk: Buffer) => {
        this.stderrLog?.write(chunk);
      });
    }
    const initResult = await this.callRaw("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "agent-smith", version: "1.2.0" },
    }, this.initializeTimeoutMs) as { protocolVersion?: string };
    // Verify the server's negotiated version is one we support.
    const negotiated = initResult?.protocolVersion;
    if (typeof negotiated !== "string" || !SUPPORTED_PROTOCOL_VERSIONS.includes(negotiated)) {
      await this.close();
      throw new Error(
        `mcp server returned unsupported protocolVersion '${negotiated}'; smith supports ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      );
    }
    // Send notifications/initialized (id-less; spec MUST).
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.connected = true;
  }

  listTools(): Promise<McpToolDescriptor[]> {
    // Return the callRaw promise directly so the passive unhandled-rejection
    // handler attached inside callRaw applies to the promise the caller
    // receives. Wrapping with async/await would create a fresh promise that
    // the passive handler doesn't cover.
    const promise = this.callRaw("tools/list", {}).then(
      (r) => ((r as { tools?: McpToolDescriptor[] }).tools ?? []),
    );
    promise.catch(() => { /* unhandled-rejection tracking */ });
    return promise;
  }

  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const promise = this.callRaw("tools/call", { name, arguments: args }) as Promise<McpToolCallResult>;
    promise.catch(() => { /* unhandled-rejection tracking */ });
    return promise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("mcp client closed"));
    const child = this.child;
    this.child = null;
    this.connected = false;
    await this.stderrLog?.close().catch(() => {});
    this.stderrLog = null;
    if (!child) return;
    try { child.stdin?.end(); } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      const t1 = setTimeout(() => {
        child.kill("SIGTERM");
        const t2 = setTimeout(() => child.kill("SIGKILL"), 500);
        child.once("exit", () => { clearTimeout(t2); resolve(); });
      }, 200);
      child.once("exit", () => { clearTimeout(t1); resolve(); });
    });
  }

  private callRaw(method: string, params: Record<string, unknown>, timeoutOverrideMs?: number): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error("mcp client not connected"));
    }
    const id = this.nextId++;
    const timeoutMs = timeoutOverrideMs ?? this.callTimeoutMs;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp call ${method} timed out after ${timeoutMs}ms (server did not respond)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
    // Attach a passive handler so the rejection is considered "handled"
    // even if the caller hasn't awaited yet (e.g. close() drains in-flight
    // RPCs before the test attaches its `expect().rejects` handler). The
    // returned promise still rejects normally for the caller.
    promise.catch(() => { /* swallowed for unhandled-rejection tracking */ });
    return promise;
  }

  private write(msg: Record<string, unknown>): void {
    const line = JSON.stringify(msg) + "\n";
    this.child?.stdin?.write(line);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    if (this.buf.length > this.maxResponseBytes) {
      this.failAll(new Error(`mcp server response exceeded ${this.maxResponseBytes} bytes`));
      this.buf = "";
      return;
    }
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: { id?: number; result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === undefined) continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const detail = msg.error.data ? ` (${JSON.stringify(msg.error.data)})` : "";
        p.reject(new Error(`mcp error ${msg.error.code ?? "?"}: ${msg.error.message ?? "unknown"}${detail}`));
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private failAll(err: Error): void {
    const entries = Array.from(this.pending.values());
    this.pending.clear();
    for (const p of entries) {
      clearTimeout(p.timer);
      try { p.reject(err); } catch { /* should never happen */ }
    }
  }
}
