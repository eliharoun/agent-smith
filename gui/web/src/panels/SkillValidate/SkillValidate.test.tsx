import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
let isPending = false;
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutate, isPending }),
}));

import { SkillValidate } from "./SkillValidate";

describe("SkillValidate", () => {
  beforeEach(() => {
    mutate.mockClear();
    isPending = false;
  });

  it("dispatches skill.validate with the given name on click", () => {
    render(<SkillValidate name="brainstorming" />);
    fireEvent.click(screen.getByRole("button", { name: /validate/ }));
    expect(mutate).toHaveBeenCalledWith({ command: "skill.validate", name: "brainstorming" });
  });

  it("disables the button while a job is pending", () => {
    isPending = true;
    render(<SkillValidate name="x" />);
    expect(screen.getByRole("button", { name: /validate/ })).toBeDisabled();
  });
});
