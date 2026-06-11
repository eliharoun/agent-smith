export interface McpPreset {
  name: string;
  server: string;
  tool: string;
  argHints: Record<string, string>;
  docsUrl: string;
  description: string;
}

const PRESETS: Record<string, McpPreset> = {
  notion: {
    name: "notion",
    server: "notion-mcp",
    tool: "search",
    argHints: { query: "search query string" },
    docsUrl: "https://github.com/makenotion/notion-mcp-server",
    description: "Search Notion pages and databases",
  },
  github: {
    name: "github",
    server: "github-mcp",
    tool: "search_repositories",
    argHints: { query: "search query" },
    docsUrl: "https://github.com/github/github-mcp-server",
    description: "Search GitHub repositories and issues",
  },
  slack: {
    name: "slack",
    server: "slack-mcp",
    tool: "search_messages",
    argHints: { query: "search query" },
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    description: "Search Slack messages and channels",
  },
  linear: {
    name: "linear",
    server: "linear-mcp",
    tool: "search_issues",
    argHints: { query: "search query" },
    docsUrl: "https://github.com/linear/linear-mcp-server",
    description: "Search Linear issues and projects",
  },
  sentry: {
    name: "sentry",
    server: "sentry-mcp",
    tool: "search_issues",
    argHints: { query: "search query" },
    docsUrl: "https://github.com/getsentry/sentry-mcp-server",
    description: "Search Sentry error reports and issues",
  },
  grafana: {
    name: "grafana",
    server: "grafana-mcp",
    tool: "search_dashboards",
    argHints: { query: "search query" },
    docsUrl: "https://github.com/grafana/grafana-mcp-server",
    description: "Search Grafana dashboards and panels",
  },
};

export function getMcpPreset(name: string): McpPreset | undefined {
  return PRESETS[name];
}

export function listMcpPresets(): McpPreset[] {
  return Object.values(PRESETS);
}
