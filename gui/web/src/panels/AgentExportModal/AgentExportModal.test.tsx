import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentExportModal } from "./AgentExportModal";

const mutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({ useStartJob: () => ({ mutate, isPending: false }) }));

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

beforeEach(() => {
  mutate.mockReset();
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ manifest: FAKE_MANIFEST }),
  })) as unknown as typeof fetch;
});

describe("AgentExportModal", () => {
  it("does not render when closed", () => {
    render(<AgentExportModal name="code-reviewer" open={false} onClose={() => {}} />);
    expect(screen.queryByText(/export agent/i)).toBeNull();
  });

  it("renders the plan step heading once the plan loads", async () => {
    render(<AgentExportModal name="code-reviewer" open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("code-reviewer")).toBeTruthy();
    });
  });

  it("toggles the embed-required-skills checkbox", async () => {
    render(<AgentExportModal name="code-reviewer" open onClose={() => {}} />);
    const cb = (await waitFor(() =>
      screen.getByLabelText(/embed required skills/i),
    )) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });
});
