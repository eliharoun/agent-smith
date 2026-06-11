import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormSubmit, SourceFormProps } from "./types";
import { McpForm } from "./McpForm";

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("McpForm", () => {
  it("submits with typeOrUrl='mcp', server and tool", () => {
    const onSubmit = vi.fn();
    wrap(<McpForm existingIds={[]} onSubmit={onSubmit} formId="t-form" />);

    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "my-mcp" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ server/), { target: { value: "notion" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ tool/), { target: { value: "search" } });

    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0] as FormSubmit;
    expect(submitted.request.typeOrUrl).toBe("mcp");
    expect(submitted.request.server).toBe("notion");
    expect(submitted.request.tool).toBe("search");
    expect(submitted.request.id).toBe("my-mcp");
  });

  it("includes preset when one is selected", () => {
    const onSubmit = vi.fn();
    wrap(<McpForm existingIds={[]} onSubmit={onSubmit} formId="t-form" />);

    fireEvent.change(screen.getByRole("combobox", { name: /preset/i }), {
      target: { value: "notion" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "n" } });

    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);

    const submitted = onSubmit.mock.calls[0]![0] as FormSubmit;
    expect(submitted.request.preset).toBe("notion");
    expect(submitted.request.server).toBe("notion-mcp");
    expect(submitted.request.tool).toBe("search");
  });
});
