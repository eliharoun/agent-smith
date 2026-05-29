import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillBodyEditor } from "./SkillBodyEditor";

describe("SkillBodyEditor", () => {
  it("renders body verbatim inside a pre block", () => {
    render(<SkillBodyEditor body={"# Heading\n\nSome **markdown**."} />);
    expect(screen.getByText(/# Heading/)).toBeInTheDocument();
    expect(screen.getByText(/Some \*\*markdown\*\*\./)).toBeInTheDocument();
  });

  it("shows empty placeholder when body is empty", () => {
    render(<SkillBodyEditor body="" />);
    expect(screen.getByText(/\(empty body\)/)).toBeInTheDocument();
  });
});
