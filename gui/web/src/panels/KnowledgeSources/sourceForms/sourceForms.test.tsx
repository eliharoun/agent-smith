import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfluenceForm } from "./ConfluenceForm";
import { DirForm } from "./DirForm";
import { FileForm } from "./FileForm";
import { GitForm } from "./GitForm";
import { GlobForm } from "./GlobForm";
import { JiraForm } from "./JiraForm";
import { NpmForm } from "./NpmForm";
import type { FormSubmit, SourceFormProps } from "./types";
import { UrlForm } from "./UrlForm";

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Most forms don't need a router; ConfluenceForm/JiraForm only fetch
  // useAtlassianEnv which renders nothing extra when data is undefined.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ hasToken: true, source: "smith-env-file", editable: true }), {
      status: 200,
    })) as unknown as typeof fetch;
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

interface Case {
  name: string;
  Component: (p: SourceFormProps) => JSX.Element;
  /** Fill these fields by label (regex). */
  fill: Array<{ label: RegExp; value: string }>;
  /** Expected fields in the dispatched request. */
  expect: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    name: "FileForm",
    Component: FileForm,
    fill: [{ label: /^\/\/ path/, value: "/tmp/a.md" }],
    expect: { typeOrUrl: "file", pathOrUrl: "/tmp/a.md", id: "src-1" },
  },
  {
    name: "DirForm",
    Component: DirForm,
    fill: [{ label: /^\/\/ directory/, value: "/tmp/notes" }],
    expect: { typeOrUrl: "dir", pathOrUrl: "/tmp/notes", id: "src-1" },
  },
  {
    name: "GlobForm",
    Component: GlobForm,
    fill: [{ label: /^\/\/ glob/, value: "src/**/*.md" }],
    expect: { typeOrUrl: "glob", pathOrUrl: "src/**/*.md", id: "src-1" },
  },
  {
    name: "UrlForm",
    Component: UrlForm,
    fill: [{ label: /^\/\/ url/, value: "https://example.com/p" }],
    expect: { typeOrUrl: "https://example.com/p", id: "src-1" },
  },
  {
    name: "GitForm",
    Component: GitForm,
    fill: [{ label: /^\/\/ git url/, value: "https://github.com/o/r" }],
    expect: { typeOrUrl: "git", pathOrUrl: "https://github.com/o/r", id: "src-1" },
  },
  {
    name: "NpmForm",
    Component: NpmForm,
    fill: [{ label: /^\/\/ package/, value: "@scope/pkg" }],
    expect: { typeOrUrl: "npm", pathOrUrl: "@scope/pkg", id: "src-1" },
  },
  {
    name: "ConfluenceForm",
    Component: ConfluenceForm,
    fill: [{ label: /^\/\/ space key/, value: "ENG" }],
    expect: { typeOrUrl: "confluence", pathOrUrl: "ENG", id: "src-1", includeChildren: false },
  },
  {
    name: "JiraForm",
    Component: JiraForm,
    fill: [{ label: /^\/\/ jql/, value: "project = ENG" }],
    expect: { typeOrUrl: "jira", pathOrUrl: "project = ENG", id: "src-1" },
  },
];

describe("sourceForms", () => {
  for (const c of CASES) {
    it(`${c.name} dispatches a knowledge.add payload with the right shape`, () => {
      const onSubmit = vi.fn();
      wrap(<c.Component existingIds={[]} onSubmit={onSubmit} formId="t-form" />);
      // Fill id (common).
      fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "src-1" } });
      // Fill case-specific.
      for (const { label, value } of c.fill) {
        const target =
          c.name === "JiraForm" && /jql/.test(label.source)
            ? screen.getByLabelText(label)
            : screen.getByLabelText(label);
        fireEvent.change(target, { target: { value } });
      }
      // Submit via form element to trigger the form's onSubmit handler.
      const form = document.getElementById("t-form") as HTMLFormElement;
      fireEvent.submit(form);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submitted = onSubmit.mock.calls[0]![0] as FormSubmit;
      for (const [k, v] of Object.entries(c.expect)) {
        expect(submitted.request[k as keyof typeof submitted.request]).toEqual(v);
      }
    });
  }

  it("blocks submit when id collides with existingIds", () => {
    const onSubmit = vi.fn();
    wrap(<FileForm existingIds={["dupe"]} onSubmit={onSubmit} formId="t-form" />);
    fireEvent.change(screen.getByLabelText(/^\/\/ id/), { target: { value: "dupe" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ path/), { target: { value: "/x" } });
    const form = document.getElementById("t-form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/id already exists/i)).toBeInTheDocument();
  });
});
