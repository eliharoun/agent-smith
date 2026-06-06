import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NotificationCenter } from "@/ui/NotificationCenter";
import type { ReactNode } from "react";
import { useSyncHintToast } from "./useSyncHintToast";

const wrapper = ({ children }: { children: ReactNode }) => (
  <NotificationCenter>{children}</NotificationCenter>
);

beforeEach(() => {
  localStorage.clear();
});

describe("useSyncHintToast", () => {
  it("fires no toast when the directory has no git remote", () => {
    const onRegister = vi.fn();
    const { result } = renderHook(() => useSyncHintToast(onRegister), { wrapper });
    act(() => result.current.maybeFire({ catalogPath: "/foo", gitRemote: undefined }));
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("fires a toast when the directory has a git remote and not previously dismissed", () => {
    const onRegister = vi.fn();
    const { result } = renderHook(() => useSyncHintToast(onRegister), { wrapper });
    act(() =>
      result.current.maybeFire({
        catalogPath: "/foo",
        gitRemote: "git@github.com:acme/repo.git",
      }),
    );
    expect(document.body.textContent).toContain("Detected git remote");
    expect(document.body.textContent).toContain("git@github.com:acme/repo.git");
  });

  it("does not re-fire if the path has been dismissed", () => {
    const onRegister = vi.fn();
    const { result, rerender } = renderHook(() => useSyncHintToast(onRegister), { wrapper });
    act(() =>
      result.current.maybeFire({
        catalogPath: "/foo",
        gitRemote: "git@github.com:acme/repo.git",
      }),
    );
    const dismissed = JSON.parse(localStorage.getItem("smith.installModal.dismissedSyncHints") ?? "[]");
    dismissed.push("/foo");
    localStorage.setItem("smith.installModal.dismissedSyncHints", JSON.stringify(dismissed));
    rerender();
    act(() =>
      result.current.maybeFire({
        catalogPath: "/foo",
        gitRemote: "git@github.com:acme/repo.git",
      }),
    );
    expect(onRegister).not.toHaveBeenCalled();
  });
});
