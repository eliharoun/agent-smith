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

  it("seeds url from initialUrl prop", () => {
    render(<InstallFromUrlModal kind="skill" open onClose={() => {}} initialUrl="https://github.com/x/y" />);
    expect(screen.getByLabelText(/git url/i)).toHaveValue("https://github.com/x/y");
  });

  it("shows error when discovery fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: false,
      json: async () => ({ message: "repo not found" }),
    }));
    render(<InstallFromUrlModal kind="agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("repo not found"));
  });
});
