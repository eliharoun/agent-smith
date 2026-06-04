import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("confirm step shows the resolved path read-only (no text input)", async () => {
    renderModal();
    // Wait for plan to load, then advance to confirm step.
    await waitFor(() => screen.getByText("code-reviewer"));
    fireEvent.click(screen.getByText("continue"));
    // The resolved path must appear as static text, not as an input.
    expect(screen.getByText("/Users/test/Downloads")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /output directory/i })).toBeNull();
    // Settings link must be present.
    expect(screen.getByText(/change default in settings/i)).toBeTruthy();
  });
});
