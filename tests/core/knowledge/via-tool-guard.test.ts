import { describe, expect, it } from "bun:test";
import { assertViaToolAllowed } from "../../../src/core/knowledge/via-tool-guard";

describe("assertViaToolAllowed", () => {
  it("accepts read-shaped names without opt-in", () => {
    for (const name of [
      "read_page",
      "get_file_contents",
      "fetch_url",
      "search_pages",
      "list_repos",
      "describe_thing",
      "preview_doc",
      "head_url",
      "Read_Page",
      "GET_FILE",
      "Fetch_Url",
    ]) {
      expect(() => assertViaToolAllowed({ server: "x", tool: name })).not.toThrow();
    }
  });

  it("rejects non-read-shaped names without opt-in", () => {
    for (const name of [
      "create_repo",
      "delete_branch",
      "update_file",
      "post_comment",
      "push_changes",
      "send_email",
      "approve_pr",
    ]) {
      expect(() => assertViaToolAllowed({ server: "x", tool: name })).toThrow(
        /read-shaped|allowWriteTool/,
      );
    }
  });

  it("accepts non-read-shaped names with allowWriteTool: true", () => {
    expect(() =>
      assertViaToolAllowed({ server: "x", tool: "delete_repo", allowWriteTool: true }),
    ).not.toThrow();
  });

  it("error message names the tool and the opt-out flag", () => {
    try {
      assertViaToolAllowed({ server: "x", tool: "delete_branch" });
    } catch (err) {
      expect(String(err)).toContain("delete_branch");
      expect(String(err)).toContain("allowWriteTool");
    }
  });
});
