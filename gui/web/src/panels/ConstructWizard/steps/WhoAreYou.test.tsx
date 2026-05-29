import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhoAreYou } from "./WhoAreYou";

function setup(opts: { existingContent?: string; putStatus?: number; onNext?: () => void } = {}) {
  sessionStorage.setItem("smith.gui.token", "t");
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/api/user-md") && method === "GET") {
      return new Response(JSON.stringify({ content: opts.existingContent ?? "" }), { status: 200 });
    }
    if (url.includes("/api/user-md") && method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: opts.putStatus ?? 200 });
    }
    return new Response("{}", { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const qc = new QueryClient();
  const onNext = vi.fn(opts.onNext);
  render(
    <QueryClientProvider client={qc}>
      <WhoAreYou onNext={onNext} />
    </QueryClientProvider>,
  );
  return { fetchMock, onNext, qc };
}

describe("WhoAreYou", () => {
  afterEach(() => vi.restoreAllMocks());

  it("seeds the textarea with existing USER.md content", async () => {
    setup({ existingContent: "# USER\n\nI am Alice." });
    const ta = await screen.findByRole("textbox", { name: /user\.md/i });
    await waitFor(() => expect(ta).toHaveValue("# USER\n\nI am Alice."));
  });

  it("seeds the textarea with the template when no content exists", async () => {
    setup({ existingContent: "" });
    const ta = await screen.findByRole("textbox", { name: /user\.md/i });
    await waitFor(() => expect((ta as HTMLTextAreaElement).value).toMatch(/USER/i));
  });

  it("PUT to /api/user-md and calls onNext on success", async () => {
    const { fetchMock, onNext } = setup({ existingContent: "" });
    const ta = (await screen.findByRole("textbox", { name: /user\.md/i })) as HTMLTextAreaElement;
    // Wait for the seeding effect to land before the user starts typing.
    await waitFor(() => expect(ta.value).toMatch(/USER/i));
    fireEvent.change(ta, { target: { value: "# USER\n\nI am Bob." } });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/api/user-md") && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({
      content: "# USER\n\nI am Bob.",
    });
  });

  it("shows an error and does not call onNext when save fails", async () => {
    const { onNext } = setup({ putStatus: 500 });
    const ta = (await screen.findByRole("textbox", { name: /user\.md/i })) as HTMLTextAreaElement;
    await waitFor(() => expect(ta.value).toMatch(/USER/i));
    fireEvent.change(ta, { target: { value: "# USER\n\nI am Carol." } });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    await screen.findByText(/save failed/i);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("does not re-seed the textarea after the user clears it when the query data refreshes", async () => {
    const { qc } = setup({ existingContent: "# USER\n\nI am Alice." });
    const ta = (await screen.findByRole("textbox", { name: /user\.md/i })) as HTMLTextAreaElement;
    await waitFor(() => expect(ta).toHaveValue("# USER\n\nI am Alice."));
    // User intentionally clears the textarea.
    fireEvent.change(ta, { target: { value: "" } });
    expect(ta).toHaveValue("");
    // Simulate a react-query refetch (e.g. window focus) producing a new data reference.
    qc.setQueryData(["user-md"], { content: "# USER\n\nI am Alice." });
    // Give the effect a chance to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(ta).toHaveValue("");
  });

  it("does not show 'save failed' when onNext throws after a successful save", async () => {
    // Swallow the unhandled rejection that the thrown onNext produces — we are
    // intentionally provoking it to assert the error is NOT misattributed to save.
    const onUnhandled = (reason: unknown) => {
      if (reason instanceof Error && reason.message === "router exploded") return;
      throw reason;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const onNextThrow = () => {
        throw new Error("router exploded");
      };
      const { onNext } = setup({ existingContent: "", onNext: onNextThrow });
      const ta = (await screen.findByRole("textbox", { name: /user\.md/i })) as HTMLTextAreaElement;
      await waitFor(() => expect(ta.value).toMatch(/USER/i));
      fireEvent.change(ta, { target: { value: "# USER\n\nI am Dave." } });
      fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
      await waitFor(() => expect(onNext).toHaveBeenCalled());
      // Allow microtasks to flush so the unhandled rejection is registered.
      await new Promise((r) => setTimeout(r, 10));
      // The save itself succeeded — we must not display a misleading "save failed" error.
      expect(screen.queryByText(/save failed/i)).toBeNull();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
