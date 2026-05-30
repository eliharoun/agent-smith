import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AtlassianEnvForm } from "./AtlassianEnvForm";

type Call = { url: string; init?: RequestInit | undefined };

interface EnvState {
  source: "env" | "smith-env-file" | "none";
  email?: string;
  hasToken: boolean;
  baseUrl?: string;
  editable: boolean;
}

function mockFetch(
  state: { env: EnvState; affected: Array<Record<string, unknown>>; putStatus?: number },
  calls: Call[],
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, init });
    if (url.endsWith("/api/atlassian-env") && method === "GET") {
      return new Response(JSON.stringify(state.env), { status: 200 });
    }
    if (url.endsWith("/api/atlassian-env") && method === "PUT") {
      const status = state.putStatus ?? 200;
      if (status === 200) {
        // simulate updated state
        const body = JSON.parse(String(init?.body ?? "{}"));
        state.env = {
          ...state.env,
          email: body.email,
          baseUrl: body.baseUrl,
          source: "smith-env-file",
          hasToken: true,
          editable: true,
        };
        return new Response(JSON.stringify(state.env), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "NOT_EDITABLE", message: "read-only" }), {
        status,
      });
    }
    if (url.includes("/api/atlassian/affected-sources")) {
      return new Response(JSON.stringify({ sources: state.affected }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AtlassianEnvForm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AtlassianEnvForm", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  it("renders read-only banner when status.editable is false", async () => {
    globalThis.fetch = mockFetch(
      {
        env: { source: "env", hasToken: true, email: "a@b.c", editable: false },
        affected: [],
      },
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/read-only/)).toBeInTheDocument());
    expect(screen.getAllByText(/process env/).length).toBeGreaterThan(0);
    // Save button disabled.
    expect(screen.getByRole("button", { name: /save credentials/i })).toBeDisabled();
  });

  it("masks existing token and requires 'replace token' before edit", async () => {
    globalThis.fetch = mockFetch(
      {
        env: {
          source: "smith-env-file",
          hasToken: true,
          email: "a@b.c",
          editable: true,
        },
        affected: [],
      },
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByDisplayValue("••••••••")).toBeInTheDocument());
    const replace = screen.getByRole("button", { name: /replace token/i });
    fireEvent.click(replace);
    // After clicking, the password field should appear (placeholder text).
    expect(screen.getByPlaceholderText(/paste from id.atlassian.com/i)).toBeInTheDocument();
  });

  it("submits PUT with email + baseUrl and shows 'saved' chip on success", async () => {
    globalThis.fetch = mockFetch(
      {
        env: {
          source: "none",
          hasToken: false,
          editable: true,
        },
        affected: [],
      },
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save credentials/i })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@acme.com" },
    });
    fireEvent.change(screen.getByLabelText(/base url/i), {
      target: { value: "https://acme.atlassian.net" },
    });
    fireEvent.change(screen.getByLabelText(/api token/i), {
      target: { value: "tok123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save credentials/i }));
    await waitFor(() => expect(screen.getByText("saved")).toBeInTheDocument());
    const put = calls.find((c) => c.init?.method === "PUT");
    const body = JSON.parse(String(put?.init?.body ?? "{}"));
    expect(body.email).toBe("ada@acme.com");
    expect(body.apiToken).toBe("tok123");
    expect(body.baseUrl).toBe("https://acme.atlassian.net");
  });

  it("lists affected confluence + jira sources", async () => {
    globalThis.fetch = mockFetch(
      {
        env: { source: "smith-env-file", hasToken: true, email: "a@b.c", editable: true },
        affected: [
          { agent: "example-agent", sourceId: "wiki", type: "confluence", label: "ENG" },
          { agent: "the-architect", sourceId: "tickets", type: "jira", label: "project = INFRA" },
        ],
      },
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("example-agent")).toBeInTheDocument());
    expect(screen.getByText(/ENG/)).toBeInTheDocument();
    expect(screen.getByText(/project = INFRA/)).toBeInTheDocument();
    expect(screen.getAllByText("confluence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("jira").length).toBeGreaterThan(0);
  });
});
