import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SkillEditorTabs } from "./SkillEditorTabs";

function Probe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.search}</span>;
}

function renderTabs(initialEntries: string[] = ["/skills/tdd"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <SkillEditorTabs
        tabs={[
          { id: "frontmatter", label: "Frontmatter", element: <div>FM</div> },
          { id: "body", label: "Body", element: <div>BD</div> },
          { id: "resources", label: "Resources", element: <div>RS</div> },
        ]}
      />
      <Probe />
    </MemoryRouter>,
  );
}

describe("SkillEditorTabs", () => {
  it("renders the initial (frontmatter) tab by default", () => {
    renderTabs();
    expect(screen.getByText("FM")).toBeInTheDocument();
    expect(screen.queryByText("BD")).not.toBeInTheDocument();
  });

  it("respects ?tab= query param on initial render", () => {
    renderTabs(["/skills/tdd?tab=body"]);
    expect(screen.getByText("BD")).toBeInTheDocument();
  });

  it("updates URL with ?tab= on tab click", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: /resources/i }));
    expect(screen.getByText("RS")).toBeInTheDocument();
    expect(screen.getByTestId("loc").textContent).toBe("?tab=resources");
  });

  it("ignores unknown ?tab= values and falls back to initial", () => {
    renderTabs(["/skills/tdd?tab=nope"]);
    expect(screen.getByText("FM")).toBeInTheDocument();
  });
});
