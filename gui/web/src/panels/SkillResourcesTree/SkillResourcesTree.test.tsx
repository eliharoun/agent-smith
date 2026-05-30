import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillResourcesTree } from "./SkillResourcesTree";

describe("SkillResourcesTree", () => {
  it("renders empty state when resources array is empty", () => {
    render(<SkillResourcesTree resources={[]} />);
    expect(screen.getByText(/no bundled resources/i)).toBeInTheDocument();
  });

  it("renders files and directories with size and trailing slash", () => {
    render(
      <SkillResourcesTree
        resources={[
          { relPath: "refs/", isDirectory: true },
          { relPath: "refs/style.md", isDirectory: false, bytes: 1024 },
          { relPath: "README.md", isDirectory: false, bytes: 256 },
        ]}
      />,
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("refs/")).toBeInTheDocument();
    expect(screen.getByText("style.md")).toBeInTheDocument();
    expect(screen.getByText("1024b")).toBeInTheDocument();
    expect(screen.getByText("256b")).toBeInTheDocument();
  });
});
