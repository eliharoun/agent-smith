import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestProviders } from "./TestProviders";

describe("TestProviders", () => {
  it("renders children inside QueryClient + MemoryRouter contexts", () => {
    render(
      <TestProviders>
        <p>hello-providers</p>
      </TestProviders>,
    );
    expect(screen.getByText("hello-providers")).toBeInTheDocument();
  });

  it("accepts custom routerEntries", () => {
    render(
      <TestProviders routerEntries={["/custom-path"]}>
        <p>routed</p>
      </TestProviders>,
    );
    expect(screen.getByText("routed")).toBeInTheDocument();
  });
});
