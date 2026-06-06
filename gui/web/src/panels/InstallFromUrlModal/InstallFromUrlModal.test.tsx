import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallFromUrlModal } from "./InstallFromUrlModal";

const mutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({ useStartJob: () => ({ mutate, isPending: false }) }));

beforeEach(() => {
  mutate.mockReset();
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

describe("InstallFromUrlModal", () => {
  it("renders title with kind", () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    expect(screen.getByText(/install agent from url/i)).toBeInTheDocument();
  });

  it("renders URL and ref fields and disabled Discover button initially", () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    expect(screen.getByLabelText(/git url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/git ref/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discover/i })).toBeDisabled();
  });

  it("does not render when open=false", () => {
    render(<InstallFromUrlModal kind="agent" open={false} onClose={() => {}} />);
    expect(screen.queryByLabelText(/git url/i)).toBeNull();
  });

  it("enables Discover when URL is non-empty", () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    expect(screen.getByRole("button", { name: /discover/i })).toBeEnabled();
  });

  it("renders skill-kind title for kind=skill", () => {
    render(<InstallFromUrlModal kind="skill" open onClose={() => {}} />);
    expect(screen.getByText(/install skill from url/i)).toBeInTheDocument();
  });

  it("shows auto-install-skills checkbox in select step for kind=agent", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    expect(screen.getByLabelText(/auto-install required skills/i)).toBeInTheDocument();
  });

  it("does not show auto-install-skills for kind=skill", async () => {
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
    render(<InstallFromUrlModal kind="skill" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("s"));
    expect(screen.queryByLabelText(/auto-install required skills/i)).toBeNull();
  });

  it("dispatches agent.install with agents + platforms after discover", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.change(screen.getByLabelText(/git ref/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    fireEvent.click(screen.getByLabelText("my-agent"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const req = mutate.mock.calls[0]![0];
    expect(req.command).toBe("agent.install");
    expect(req.from).toBe("https://github.com/o/r.git");
    expect(req.agents).toEqual(["my-agent"]);
    expect(req.platforms).toEqual(["opencode"]);
    expect(req.withSkills).toBe(true);
    expect(req.ref).toBe("main");
  });

  it("omits ref when ref input is empty", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    fireEvent.click(screen.getByLabelText("my-agent"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(mutate.mock.calls[0]![0].ref).toBeUndefined();
  });

  it("drop zone rejects a non-.smith-bundle.tgz file with a visible error", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
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
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    const dropZone = screen.getByText(/drop a/i).closest("div")!;
    const goodFile = new File(["archive bytes"], "my-agent.smith-bundle.tgz", { type: "application/gzip" });
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [goodFile] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/git url/i)).toHaveValue("/tmp/staged.smith-bundle.tgz"),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/import/stage",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("seeds url from initialUrl prop", () => {
    render(<InstallFromUrlModal kind="skill" open onClose={() => {}} initialUrl="https://github.com/x/y" />);
    expect(screen.getByLabelText(/git url/i)).toHaveValue("https://github.com/x/y");
  });

  it("includes allowMissingCli in agent.install request when checkbox is checked", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("my-agent"));
    fireEvent.click(screen.getByLabelText(/render even if the target platform cli isn't installed/i));
    fireEvent.click(screen.getByLabelText("my-agent"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(mutate.mock.calls[0]![0].allowMissingCli).toBe(true);
  });

  it("shows error when discovery fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "repo not found", code: "git-clone-failed" }),
    }));
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("repo not found"));
  });

  it("badges the source as archive when URL ends in .smith-bundle.tgz", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    const input = screen.getByLabelText(/git url/i);
    fireEvent.change(input, { target: { value: "/tmp/foo.smith-bundle.tgz" } });
    expect(screen.getByText(/\[archive\]/)).toBeInTheDocument();
  });

  it("badges the source as local directory for an absolute path", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    const input = screen.getByLabelText(/git url/i);
    fireEvent.change(input, { target: { value: "/Users/me/work/team-agents" } });
    expect(screen.getByText(/\[local directory\]/)).toBeInTheDocument();
  });

  it("badges the source as git url for a git@ URL", async () => {
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    const input = screen.getByLabelText(/git url/i);
    fireEvent.change(input, { target: { value: "git@github.com:acme/team-agents.git" } });
    expect(screen.getByText(/\[git url\]/)).toBeInTheDocument();
  });
});
