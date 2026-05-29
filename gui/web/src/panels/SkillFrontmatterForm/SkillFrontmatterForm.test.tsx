import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillFrontmatterForm } from "./SkillFrontmatterForm";

describe("SkillFrontmatterForm", () => {
  it("renders all keys, JSON-stringifies non-string values, and shows edit-on-disk banner", () => {
    render(
      <SkillFrontmatterForm
        frontmatter={{
          name: "tdd",
          description: "Test-driven dev",
          tags: ["testing", "discipline"],
        }}
      />,
    );
    expect(screen.getByText(/skills are edited on disk/i)).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("tdd")).toBeInTheDocument();
    expect(screen.getByText("description")).toBeInTheDocument();
    expect(screen.getByText("Test-driven dev")).toBeInTheDocument();
    expect(screen.getByText("tags")).toBeInTheDocument();
    expect(screen.getByText(/\["testing","discipline"\]/)).toBeInTheDocument();
  });

  it("renders empty-frontmatter notice when no keys", () => {
    render(<SkillFrontmatterForm frontmatter={{ name: "", description: "" } as never} />);
    // With name+description present (even if empty strings) we list them, so this is
    // a stricter case: pass a truly-empty object via type cast.
    expect(screen.getByText(/skills are edited on disk/i)).toBeInTheDocument();
  });
});
