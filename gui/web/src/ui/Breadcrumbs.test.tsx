import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );
}

describe("Breadcrumbs", () => {
  it.each([
    ["/", ["smith"]],
    ["/agents", ["smith", "agents"]],
    ["/agents/new", ["smith", "agents", "new"]],
    ["/agents/install-matrix", ["smith", "agents", "install matrix"]],
    ["/agents/myagent", ["smith", "agents", "myagent"]],
    ["/agents/myagent?tab=knowledge", ["smith", "agents", "myagent", "knowledge"]],
    ["/agents/myagent?tab=skills", ["smith", "agents", "myagent", "skills"]],
    ["/skills", ["smith", "skills"]],
    ["/skills/new", ["smith", "skills", "new"]],
    ["/skills/myskill", ["smith", "skills", "myskill"]],
    ["/catalogs", ["smith", "catalogs"]],
    ["/catalogs/register", ["smith", "catalogs", "register"]],
    ["/knowledge", ["smith", "knowledge"]],
    ["/knowledge/refresh-history", ["smith", "knowledge", "refresh history"]],
    ["/knowledge/myagent/refresh-history", ["smith", "knowledge", "myagent", "refresh history"]],
    ["/system/atlassian-setup", ["smith", "system", "atlassian setup"]],
    ["/system/doctor", ["smith", "system", "doctor"]],
    ["/system/settings", ["smith", "system", "settings"]],
    ["/onboarding", ["smith", "onboarding"]],
  ])("renders crumbs for %s", (path, expected) => {
    renderAt(path);
    for (const label of expected) {
      expect(screen.getByText(label, { exact: false })).toBeTruthy();
    }
  });

  it("first crumb (smith) is a link to /", () => {
    renderAt("/agents");
    const smith = screen.getByText("smith");
    expect(smith.closest("a")?.getAttribute("href")).toBe("/");
  });

  it("last crumb is not a link", () => {
    renderAt("/agents/new");
    const last = screen.getByText("new");
    expect(last.closest("a")).toBeNull();
  });
});
