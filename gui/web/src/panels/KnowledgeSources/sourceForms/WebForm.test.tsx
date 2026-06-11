import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormSubmit } from "./types";
import { WebForm } from "./WebForm";

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("WebForm", () => {
  it("submits with typeOrUrl='web', pathOrUrl=url, mode='crawl' by default", () => {
    const onSubmit = vi.fn();
    wrap(<WebForm existingIds={[]} onSubmit={onSubmit} formId="t-form" />);

    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "my-web" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url/), {
      target: { value: "https://example.com" },
    });

    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0] as FormSubmit;
    expect(submitted.request.typeOrUrl).toBe("web");
    expect(submitted.request.pathOrUrl).toBe("https://example.com");
    expect(submitted.request.mode).toBe("crawl");
    expect(submitted.request.id).toBe("my-web");
  });

  it("includes maxPages and depth when mode is crawl and values are set", () => {
    const onSubmit = vi.fn();
    wrap(<WebForm existingIds={[]} onSubmit={onSubmit} formId="t-form" />);

    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "site" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url/), {
      target: { value: "https://docs.dev" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ max pages/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ depth/), { target: { value: "3" } });

    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);

    const submitted = onSubmit.mock.calls[0]![0] as FormSubmit;
    expect(submitted.request.maxPagesWeb).toBe(50);
    expect(submitted.request.depth).toBe(3);
  });

  it("hides maxPages and depth when mode is not crawl", () => {
    wrap(<WebForm existingIds={[]} onSubmit={vi.fn()} formId="t-form" />);

    fireEvent.change(screen.getByRole("combobox", { name: /mode/i }), {
      target: { value: "llms-txt" },
    });

    expect(screen.queryByLabelText(/^\/\/ max pages/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^\/\/ depth/)).not.toBeInTheDocument();
  });
});
