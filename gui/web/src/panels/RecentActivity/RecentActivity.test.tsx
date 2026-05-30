import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentActivity } from "./RecentActivity";

describe("RecentActivity", () => {
  it("shows empty state when no jobs", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <RecentActivity />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/no jobs yet/i)).toBeInTheDocument();
  });
});
