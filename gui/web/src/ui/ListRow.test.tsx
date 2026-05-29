import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListRow } from "./ListRow";

describe("ListRow", () => {
  it("applies grid-template-columns from props", () => {
    const { container } = render(
      <ul>
        <ListRow columns="auto minmax(14rem,18rem) 1fr auto">
          <span>icon</span>
          <span>name</span>
          <span>desc</span>
          <span>chips</span>
        </ListRow>
      </ul>,
    );
    const li = container.querySelector("li")!;
    expect(li.style.gridTemplateColumns).toBe("auto minmax(14rem,18rem) 1fr auto");
    expect(li.className).toContain("grid");
  });
});
