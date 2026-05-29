import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteBadge } from "./RemoteBadge";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("RemoteBadge (C4.7.1)", () => {
  it("renders nothing for local agents (no remote block)", () => {
    const { container } = render(<RemoteBadge remote={undefined} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders SYNCED chip when lastRemoteSha is unset", () => {
    render(
      <RemoteBadge
        remote={{ url: "https://x/y/z.git", ref: "main", lastPulledSha: SHA_A }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
  });

  it("renders SYNCED chip when lastRemoteSha === lastPulledSha", () => {
    render(
      <RemoteBadge
        remote={{
          url: "https://x/y/z.git",
          ref: "main",
          lastPulledSha: SHA_A,
          lastRemoteSha: SHA_A,
        }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
  });

  it("renders UPDATE AVAILABLE chip when shas differ", () => {
    render(
      <RemoteBadge
        remote={{
          url: "https://x/y/z.git",
          ref: "main",
          lastPulledSha: SHA_A,
          lastRemoteSha: SHA_B,
        }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(/update available/i)).toBeInTheDocument();
  });

  it("fires onClick when behind badge clicked", () => {
    const onClick = vi.fn();
    render(
      <RemoteBadge
        remote={{
          url: "https://x/y/z.git",
          ref: "main",
          lastPulledSha: SHA_A,
          lastRemoteSha: SHA_B,
        }}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText(/update available/i));
    expect(onClick).toHaveBeenCalled();
  });

  it("does NOT fire onClick when synced badge clicked", () => {
    const onClick = vi.fn();
    render(<RemoteBadge remote={{ url: "https://x/y/z.git", ref: "main" }} onClick={onClick} />);
    fireEvent.click(screen.getByText(/synced/i));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders nothing when remote is null (defensive)", () => {
    const { container } = render(<RemoteBadge remote={undefined} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
