import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormSubmit } from "./types";
import { WebpageForm as UrlForm } from "./WebpageForm";

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("UrlForm: lazy toggle", () => {
  it("renders a 'Lazy fetch' toggle", () => {
    wrap(<UrlForm existingIds={[]} onSubmit={vi.fn()} formId="t-form" />);
    expect(screen.getByRole("switch", { name: /lazy fetch/i })).toBeInTheDocument();
  });

  it("submits FormSubmit with lazy:true when toggle is on", () => {
    const onSubmit = vi.fn();
    wrap(<UrlForm existingIds={[]} onSubmit={onSubmit} formId="t-form" />);
    // Fill required fields. Labels are rendered as `// id`, `// url` — match
    // the existing test pattern in sourceForms.test.tsx which uses `^// id`.
    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "wiki" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url/), {
      target: { value: "https://example.com/x" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ description/), {
      target: { value: "Test wiki. Use when answering questions." },
    });
    // Toggle lazy ON.
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    // Submit.
    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
    const submission = onSubmit.mock.calls[0]![0] as FormSubmit;
    expect(submission.request.lazy).toBe(true);
  });

  it("submits without lazy when toggle is off (default)", () => {
    const onSubmit = vi.fn();
    wrap(<UrlForm existingIds={[]} onSubmit={onSubmit} formId="t-form" />);
    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url/), {
      target: { value: "https://x.example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ description/), { target: { value: "X." } });
    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
    const submission = onSubmit.mock.calls[0]![0] as FormSubmit;
    expect(submission.request.lazy).toBeUndefined();
  });

  it("shows L1 metadata hint when lazy is on", () => {
    wrap(<UrlForm existingIds={[]} onSubmit={vi.fn()} formId="t-form" />);
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    // Hint text should mention the agent's runtime use of the description.
    expect(screen.getByText(/agent reads|runtime/i)).toBeInTheDocument();
  });
});
