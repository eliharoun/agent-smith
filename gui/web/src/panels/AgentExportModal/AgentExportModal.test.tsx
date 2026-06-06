import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { AgentExportModal } from "./AgentExportModal";

const mutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({ useStartJob: () => ({ mutate, isPending: false }) }));

// useJobStream is only active in RunStep; stub it out for all other tests.
vi.mock("@/hooks/useJobStream", () => ({ useJobStream: () => [] }));

const FAKE_MANIFEST = {
  exportSchemaVersion: 1,
  bundle: { name: "code-reviewer", contentHash: "0".repeat(64) },
  producedBy: {
    smithVersion: "1.7.0",
    exportedAt: "2026-06-04T15:00:00Z",
    sourceSha: null,
    userAgent: "smith-cli/1.7.0 (test)",
  },
  requires: {
    minSmithVersion: "1.7.0",
    mcpServers: { required: [], peer: [], perAgent: [] },
    credentials: [],
    skills: [],
    remoteKnowledge: [],
  },
  contents: { files: [], knowledgeSnapshots: [], skillBundles: [] },
  omitted: { skills: [] },
};

function renderModal(props?: Partial<Parameters<typeof AgentExportModal>[0]>) {
  return render(
    <MemoryRouter>
      <AgentExportModal name="code-reviewer" open onClose={() => {}} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mutate.mockReset();
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ manifest: FAKE_MANIFEST, defaultExportDir: "/Users/test/Downloads" }),
  })) as unknown as typeof fetch;
});

describe("AgentExportModal", () => {
  it("does not render when closed", () => {
    render(
      <MemoryRouter>
        <AgentExportModal name="code-reviewer" open={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/export agent/i)).toBeNull();
  });

  it("renders the plan step heading once the plan loads", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText("code-reviewer")).toBeTruthy();
    });
  });

  it("toggles the embed-required-skills checkbox", async () => {
    renderModal();
    const cb = (await waitFor(() =>
      screen.getByLabelText(/embed required skills/i),
    )) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });

  it("confirm step shows the resolved path in an editable input", async () => {
    renderModal();
    // Wait for plan to load, then advance to confirm step.
    await waitFor(() => screen.getByText("code-reviewer"));
    fireEvent.click(screen.getByText("continue"));
    // The resolved path must appear as an editable input.
    const input = (await waitFor(() =>
      screen.getByRole("textbox", { name: /save to path/i }),
    )) as HTMLInputElement;
    expect(input.value).toBe("/Users/test/Downloads");
    // Settings link must be present.
    expect(screen.getByText(/change default in settings/i)).toBeTruthy();
  });
});

test("renders the format segmented control on the Plan step", async () => {
  renderModal({ open: true });
  await waitFor(() => screen.getByRole("button", { name: /Archive/i }));
  expect(screen.getByRole("button", { name: /Archive/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Directory/i })).toBeInTheDocument();
});

test("clicking Directory toggles the format and re-fetches the plan", async () => {
  renderModal({ open: true });
  await waitFor(() => screen.getByRole("button", { name: /Directory/i }));
  fireEvent.click(screen.getByRole("button", { name: /Directory/i }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Directory/i }).getAttribute("aria-pressed")).toBe("true");
  });
});

test("shows a collision warning when the destination <name>/ exists", async () => {
  const originalFetch = global.fetch;
  global.fetch = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
    const u = url.toString();
    if (u.includes("/export/preflight-collision")) {
      return Promise.resolve(
        new Response(JSON.stringify({ exists: true, modifiedAt: "2026-06-01T00:00:00Z" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (u.includes("/export/plan")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ manifest: FAKE_MANIFEST, defaultExportDir: "/tmp" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as unknown as typeof globalThis.fetch;

  try {
    renderModal({ open: true });
    // Switch to directory format on the plan step.
    await waitFor(() => screen.getByRole("button", { name: /Directory/i }));
    fireEvent.click(screen.getByRole("button", { name: /Directory/i }));
    // Wait for plan ready then click Continue.
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    // After advancing to confirm step, collision preflight should fire and show the warning.
    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/overwrite existing files/i)).toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
  }
});
