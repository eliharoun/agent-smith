import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "@/test/TestProviders";
import { Dashboard } from "./Dashboard";

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  global.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
});

describe("Dashboard route (v1.13.0)", () => {
  it("smoke test: renders without crashing and shows QuickActions + Add agent button", () => {
    render(<TestProviders><Dashboard /></TestProviders>);
    expect(screen.getByRole("button", { name: /\+ add agent/i })).toBeInTheDocument();
  });

  it("'Manage installs' link is present on the Dashboard (renamed from Install matrix)", () => {
    render(<TestProviders><Dashboard /></TestProviders>);
    expect(screen.getByRole("link", { name: /manage installs/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /install matrix/i })).toBeNull();
  });

  it("shows a '+ Add skill' action on the Dashboard quick actions", () => {
    render(<TestProviders><Dashboard /></TestProviders>);
    expect(screen.getByRole("button", { name: /\+ add skill/i })).toBeInTheDocument();
  });

  it("no stale '+ New agent' link appears (replaced by button)", () => {
    render(<TestProviders><Dashboard /></TestProviders>);
    expect(screen.queryByRole("link", { name: /new agent/i })).toBeNull();
  });
});
