import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AgentEditorTabs } from "./AgentEditorTabs";

function LocReporter() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.search}</div>;
}

function renderTabs(initialEntries: string[] = ["/agents/a"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/agents/:name"
          element={
            <>
              <AgentEditorTabs
                tabs={[
                  { id: "identity", label: "Identity", element: <div>id-body</div> },
                  { id: "soul", label: "Soul", element: <div>soul-body</div> },
                  { id: "knowledge", label: "Knowledge", element: <div>kn-body</div> },
                ]}
              />
              <LocReporter />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentEditorTabs", () => {
  it("renders the initial tab when ?tab= is missing", () => {
    renderTabs();
    expect(screen.getByText("id-body")).toBeInTheDocument();
  });

  it("switches active tab on click and updates ?tab= in the URL", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: /soul/i }));
    expect(screen.getByText("soul-body")).toBeInTheDocument();
    expect(screen.getByTestId("loc").textContent).toBe("?tab=soul");
  });

  it("respects ?tab=knowledge on initial render (deep-link from /knowledge)", () => {
    renderTabs(["/agents/a?tab=knowledge"]);
    expect(screen.getByText("kn-body")).toBeInTheDocument();
  });

  it("ignores unknown ?tab= values and falls back to initial", () => {
    renderTabs(["/agents/a?tab=bogus"]);
    expect(screen.getByText("id-body")).toBeInTheDocument();
  });
});
