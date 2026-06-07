import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallExistingForm } from "./InstallExistingForm";

const onDispatch = vi.fn();

beforeEach(() => {
  onDispatch.mockReset();
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      kind: "agent",
      bundles: [{ name: "my-agent", description: "desc", alreadyInstalled: false }],
      detectedTargets: ["opencode"],
      catalog: { suggestedLabel: "o/r", rootPath: "/x" },
      existingCatalog: null,
    }),
  })) as unknown as typeof fetch;
});

describe("InstallExistingForm", () => {
  it("renders title with kind", () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    expect(screen.getByText(/install existing agent/i)).toBeInTheDocument();
  });

  it("renders URL field and disabled Discover button initially", () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    expect(screen.getByLabelText(/where is the agent/i, { selector: "input" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/git ref/i, { selector: "input" })).toBeNull();
    expect(screen.getByRole("button", { name: /discover/i })).toBeDisabled();
  });

  it("does not render when open=false", () => {
    render(<InstallExistingForm kind="agent" open={false} onClose={() => {}} onDispatch={onDispatch} />);
    expect(screen.queryByLabelText(/where is the agent/i, { selector: "input" })).toBeNull();
  });

  it("enables Discover when URL is non-empty", () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    expect(screen.getByRole("button", { name: /discover/i })).toBeEnabled();
  });

  it("renders skill-kind title for kind=skill", () => {
    render(<InstallExistingForm kind="skill" open onClose={() => {}} onDispatch={onDispatch} />);
    expect(screen.getByText(/install existing skill/i)).toBeInTheDocument();
  });

  it("shows also-install-skills checkbox in select step for kind=agent", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    expect(screen.getByLabelText(/also install required skills/i)).toBeInTheDocument();
  });

  it("does not show also-install-skills for kind=skill", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        kind: "skill",
        bundles: [{ name: "s", description: "", alreadyInstalled: false }],
        detectedTargets: ["opencode"],
        catalog: { suggestedLabel: "o/r", rootPath: "/x" },
        existingCatalog: null,
      }),
    }));
    render(<InstallExistingForm kind="skill" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the skill/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("s"));
    expect(screen.queryByLabelText(/also install required skills/i)).toBeNull();
  });

  it("dispatches agent.install with agents + platforms after discover", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.change(screen.getByLabelText(/git ref/i, { selector: "input" }), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    fireEvent.click(screen.getByLabelText("my-agent"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(onDispatch).toHaveBeenCalledTimes(1);
    const req = onDispatch.mock.calls[0]![0];
    expect(req.command).toBe("agent.install");
    expect(req.from).toBe("https://github.com/o/r.git");
    expect(req.agents).toEqual(["my-agent"]);
    expect(req.platforms).toEqual(["opencode"]);
    expect(req.withSkills).toBe(true);
    expect(req.ref).toBe("main");
  });

  it("omits ref when ref input is empty", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    fireEvent.click(screen.getByLabelText("my-agent"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(onDispatch.mock.calls[0]![0].ref).toBeUndefined();
  });

  it("drop zone rejects a non-.smith-bundle.tgz file with a visible error", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    const dropZone = screen.getByText(/drop a/i).closest("div")!;
    const badFile = new File(["content"], "agent.tar.gz", { type: "application/gzip" });
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [badFile] },
    });
    await waitFor(() => expect(screen.getByText(/expected a \.smith-bundle\.tgz file/i)).toBeInTheDocument());
  });

  it("drop zone uploads a .smith-bundle.tgz and pre-fills the URL field", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/import/stage")) {
        return { ok: true, json: async () => ({ path: "/tmp/staged.smith-bundle.tgz" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    const dropZone = screen.getByText(/drop a/i).closest("div")!;
    const goodFile = new File(["archive bytes"], "my-agent.smith-bundle.tgz", { type: "application/gzip" });
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [goodFile] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/where is the agent/i, { selector: "input" })).toHaveValue("/tmp/staged.smith-bundle.tgz"),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/import/stage",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("seeds url from initialUrl prop", () => {
    render(<InstallExistingForm kind="skill" open onClose={() => {}} onDispatch={onDispatch} initialUrl="https://github.com/x/y" />);
    expect(screen.getByLabelText(/where is the skill/i, { selector: "input" })).toHaveValue("https://github.com/x/y");
  });

  it("includes allowMissingCli in agent.install request when checkbox is checked", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    fireEvent.click(screen.getByLabelText(/install even if a platform cli isn't on path/i));
    fireEvent.click(screen.getByLabelText("my-agent"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(onDispatch.mock.calls[0]![0].allowMissingCli).toBe(true);
  });

  it("shows error when discovery fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "repo not found", code: "git-clone-failed" }),
    }));
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("repo not found"));
  });

  it("badges the source as archive when URL ends in .smith-bundle.tgz", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    const input = screen.getByLabelText(/where is the agent/i, { selector: "input" });
    fireEvent.change(input, { target: { value: "/tmp/foo.smith-bundle.tgz" } });
    expect(screen.getByText(/\[archive\]/)).toBeInTheDocument();
  });

  it("badges the source as local directory for an absolute path", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    const input = screen.getByLabelText(/where is the agent/i, { selector: "input" });
    fireEvent.change(input, { target: { value: "/Users/me/work/team-agents" } });
    expect(screen.getByText(/\[local directory\]/)).toBeInTheDocument();
  });

  it("badges the source as git url for a git@ URL", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    const input = screen.getByLabelText(/where is the agent/i, { selector: "input" });
    fireEvent.change(input, { target: { value: "git@github.com:acme/team-agents.git" } });
    expect(screen.getByText(/\[git url\]/)).toBeInTheDocument();
  });

  it("git-ref field is hidden when URL classification is not git-url", () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    expect(screen.queryByLabelText(/git ref/i, { selector: "input" })).toBeNull();
  });

  it("git-ref field appears when URL classification is git-url", () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/acme/repo" },
    });
    expect(screen.getByLabelText(/git ref/i, { selector: "input" })).toBeInTheDocument();
  });

  it("embedded mode renders no backdrop dialog role (AddAgentModal supplies chrome)", () => {
    const { container } = render(
      <InstallExistingForm kind="agent" open embedded onClose={() => {}} onDispatch={() => {}} />
    );
    // No fixed-inset backdrop in embedded mode.
    expect(container.querySelector(".fixed.inset-0")).toBeNull();
    // No own dialog role in embedded mode.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("standalone mode (no embedded prop) still renders its own dialog chrome", () => {
    const { container } = render(
      <InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={() => {}} />
    );
    expect(container.querySelector('[role="dialog"]')).toBeInTheDocument();
    expect(container.querySelector(".fixed.inset-0")).toBeInTheDocument();
  });

  it("uses plain-English toggle labels in select step", async () => {
    render(<InstallExistingForm kind="agent" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the agent/i, { selector: "input" }), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    expect(screen.getByLabelText(/also install required skills/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/install even if a platform cli isn't on path/i)).toBeInTheDocument();
  });
});
