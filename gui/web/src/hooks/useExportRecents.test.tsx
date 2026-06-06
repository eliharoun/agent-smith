import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useExportRecents } from "./useExportRecents";

beforeEach(() => {
  localStorage.clear();
});

describe("useExportRecents", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useExportRecents("archive"));
    expect(result.current.recents).toEqual([]);
  });

  it("records added paths in MRU order", () => {
    const { result } = renderHook(() => useExportRecents("archive"));
    act(() => result.current.add("/Users/me/Downloads"));
    act(() => result.current.add("/Users/me/Desktop"));
    expect(result.current.recents).toEqual(["/Users/me/Desktop", "/Users/me/Downloads"]);
  });

  it("dedupes when adding an existing path", () => {
    const { result } = renderHook(() => useExportRecents("archive"));
    act(() => result.current.add("/A"));
    act(() => result.current.add("/B"));
    act(() => result.current.add("/A"));
    expect(result.current.recents).toEqual(["/A", "/B"]);
  });

  it("caps at 5 entries with FIFO eviction", () => {
    const { result } = renderHook(() => useExportRecents("archive"));
    for (const p of ["/1", "/2", "/3", "/4", "/5", "/6"]) {
      act(() => result.current.add(p));
    }
    expect(result.current.recents).toHaveLength(5);
    expect(result.current.recents[0]).toBe("/6");
    expect(result.current.recents).not.toContain("/1");
  });

  it("keeps archive and directory recents separate", () => {
    const archive = renderHook(() => useExportRecents("archive"));
    const directory = renderHook(() => useExportRecents("directory"));
    act(() => archive.result.current.add("/archive-path"));
    act(() => directory.result.current.add("/directory-path"));
    expect(archive.result.current.recents).toEqual(["/archive-path"]);
    expect(directory.result.current.recents).toEqual(["/directory-path"]);
  });
});
