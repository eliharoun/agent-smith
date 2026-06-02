import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppNav } from "./AppNav";

function renderNav(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppNav />
    </MemoryRouter>,
  );
}

describe("AppNav", () => {
  it("renders construct section with Dashboard, Agents, Skills, Catalogs", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /Dashboard/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Agents/i })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: /Skills/i })).toHaveAttribute("href", "/skills");
    expect(screen.getByRole("link", { name: /Catalogs/i })).toHaveAttribute("href", "/catalogs");
  });

  it("renders knowledge section with Sources, Refresh History, Atlassian Setup", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /Sources/i })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: /Refresh History/i })).toHaveAttribute(
      "href",
      "/knowledge/refresh-history",
    );
    expect(screen.getByRole("link", { name: /Atlassian Setup/i })).toHaveAttribute(
      "href",
      "/system/atlassian-setup",
    );
  });

  it("renders system section with Doctor and Settings", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /Doctor/i })).toHaveAttribute("href", "/system/doctor");
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute(
      "href",
      "/system/settings",
    );
  });

  it("renders three section headers: construct, knowledge, system", () => {
    const { container } = renderNav();
    const labels = Array.from(container.querySelectorAll("div.font-mono.text-\\[10px\\]")).map(
      (n) => n.textContent ?? "",
    );
    expect(labels.some((t) => /construct/i.test(t))).toBe(true);
    expect(labels.some((t) => /knowledge/i.test(t))).toBe(true);
    expect(labels.some((t) => /system/i.test(t))).toBe(true);
  });
});
