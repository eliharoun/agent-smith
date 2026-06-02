#!/usr/bin/env bun
/**
 * Test fixture: a minimal MCP-protocol-compliant echo server. Used by
 * mcp-client / mcp-client-pool / acquire-via tests. Tests spawn this
 * file as a stdio child via `bun <path>`.
 *
 * Behaviors:
 *   - initialize → returns protocolVersion + capabilities.tools.listChanged:false + serverInfo
 *   - tools/list → one tool "Fetch" (read-shaped name so the via-tool guard accepts it)
 *   - tools/call → echoes args back as JSON in a text content block
 *   - notifications/initialized → ignored (no response, per JSON-RPC notification rules)
 *   - any other method → error -32601
 *
 * Reads line-delimited JSON from stdin until EOF, then exits.
 */
import { stdin } from "node:process";

const decoder = new TextDecoder();
let buf = "";

for await (const chunk of stdin) {
  buf += decoder.decode(chunk);
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let req: { id?: number; method?: string; params?: unknown };
    try { req = JSON.parse(line); } catch { continue; }
    if (req.id === undefined) continue; // notification — no reply per spec
    let result: unknown;
    if (req.method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "echo", version: "0.0.1" },
      };
    } else if (req.method === "tools/list") {
      result = {
        tools: [
          {
            name: "Fetch",
            description: "Fetches a URL and echoes the args back as JSON in a text content block",
            inputSchema: { type: "object", properties: { url: { type: "string" } } },
          },
        ],
      };
    } else if (req.method === "tools/call") {
      const params = req.params as { name?: string; arguments?: unknown } | undefined;
      if (params?.name === "Fetch") {
        result = { content: [{ type: "text", text: JSON.stringify(params.arguments ?? {}) }] };
      } else {
        console.log(JSON.stringify({
          jsonrpc: "2.0", id: req.id,
          error: { code: -32601, message: `tool not found: ${params?.name}` },
        }));
        continue;
      }
    } else {
      console.log(JSON.stringify({
        jsonrpc: "2.0", id: req.id,
        error: { code: -32601, message: `method not found: ${req.method}` },
      }));
      continue;
    }
    console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
  }
}
