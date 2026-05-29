import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jobsApi } from "@/api/jobs";
import { TestProviders } from "@/test/TestProviders";
import { InstallFromUrlModal } from "./InstallFromUrlModal";

describe("InstallFromUrlModal (C4.5.1)", () => {
  it("renders title with kind", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.getByText(/install agent from url/i)).toBeInTheDocument();
  });

  it("renders URL and ref fields and disabled Install button initially", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.getByLabelText(/git url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^.*ref.*$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
  });

  it("does not render when open=false", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open={false} onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.queryByLabelText(/git url/i)).toBeNull();
  });

  it("shows auto-install-skills checkbox only for kind=agent", () => {
    const { rerender } = render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.getByLabelText(/auto-install required skills/i)).toBeInTheDocument();

    rerender(
      <TestProviders>
        <InstallFromUrlModal kind="skill" open onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.queryByLabelText(/auto-install required skills/i)).toBeNull();
  });

  it("renders skill-kind title for kind=skill", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="skill" open onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.getByText(/install skill from url/i)).toBeInTheDocument();
  });

  // ── C4.5.2: URL + ref validation ──

  it("enables Install when URL is valid (C4.5.2)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    expect(screen.getByRole("button", { name: /install/i })).toBeEnabled();
  });

  it("keeps Install disabled when URL is rejected by transport allowlist (C4.5.2)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "ext::sh -c whoami" },
    });
    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
    expect(screen.getByText(/not a recognized git url/i)).toBeInTheDocument();
  });

  it("keeps Install disabled when URL has option-injection segment (C4.5.2)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/-evil/r.git" },
    });
    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
    expect(screen.getByText(/option injection/i)).toBeInTheDocument();
  });

  it("keeps Install disabled when ref starts with - (C4.5.2)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.change(screen.getByLabelText(/^.*ref.*$/i), {
      target: { value: "--upload-pack=evil" },
    });
    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
    expect(screen.getByText(/ref must not start with '-'/i)).toBeInTheDocument();
  });

  it("keeps Install disabled when ref contains forbidden character (C4.5.2)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.change(screen.getByLabelText(/^.*ref.*$/i), {
      target: { value: "main; rm -rf /" },
    });
    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
    expect(screen.getByText(/forbidden character/i)).toBeInTheDocument();
  });

  // ── C4.5.3: live clone-path preview ──

  it("shows live clone-path preview as URL is typed (C4.5.3)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/owner/repo.git" },
    });
    expect(screen.getByText(/github\.com\/owner\/repo/)).toBeInTheDocument();
  });

  it("hides preview when URL is invalid (C4.5.3)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "ftp://nope" },
    });
    expect(screen.queryByText(/github\.com|_local|clone target/i)).toBeNull();
  });

  it("hides preview when URL is empty (C4.5.3)", () => {
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    expect(screen.queryByText(/clone target/i)).toBeNull();
  });

  // ── C4.5.4: dispatch via useStartJob ──

  it("dispatches agent.install with from + ref on submit and closes (C4.5.4)", async () => {
    const calls: unknown[] = [];
    const spy = vi.spyOn(jobsApi, "start").mockImplementation((req) => {
      calls.push(req);
      return Promise.resolve({ jobId: "j-install-1", preview: "agent install --from …" });
    });
    const onClose = vi.fn();
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={onClose} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.change(screen.getByLabelText(/^.*ref.*$/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      command: "agent.install",
      from: "https://github.com/o/r.git",
      ref: "main",
    });
    expect(onClose).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("includes withSkills flag for kind=agent (C4.5.4)", async () => {
    const calls: unknown[] = [];
    const spy = vi.spyOn(jobsApi, "start").mockImplementation((req) => {
      calls.push(req);
      return Promise.resolve({ jobId: "j-install-skills", preview: "" });
    });
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    // Default is checked; uncheck to verify the wiring carries the value.
    fireEvent.click(screen.getByLabelText(/auto-install required skills/i));
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      command: "agent.install",
      from: "https://github.com/o/r.git",
      withSkills: false,
    });
    spy.mockRestore();
  });

  it("dispatches skill.install with from for kind=skill (C4.5.4)", async () => {
    const calls: unknown[] = [];
    const spy = vi.spyOn(jobsApi, "start").mockImplementation((req) => {
      calls.push(req);
      return Promise.resolve({ jobId: "j-skill", preview: "" });
    });
    render(
      <TestProviders>
        <InstallFromUrlModal kind="skill" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      command: "skill.install",
      from: "https://github.com/o/r.git",
    });
    spy.mockRestore();
  });

  it("omits ref when ref input is empty (C4.5.4)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const spy = vi.spyOn(jobsApi, "start").mockImplementation((req) => {
      calls.push(req as Record<string, unknown>);
      return Promise.resolve({ jobId: "j-noref", preview: "" });
    });
    render(
      <TestProviders>
        <InstallFromUrlModal kind="agent" open onClose={() => {}} />
      </TestProviders>,
    );
    fireEvent.change(screen.getByLabelText(/git url/i), {
      target: { value: "https://github.com/o/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.ref).toBeUndefined();
    spy.mockRestore();
  });
});
