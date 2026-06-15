import { describe, expect, test } from "bun:test";
import {
  formatCommanderError,
  formatSmithError,
  formatUnknownError,
  wrap,
} from "../../src/cli/wrap";
import { SmithError } from "../../src/core/smith-error";

interface Captured {
  out: string[];
  err: string[];
  exitCode: number | null;
}

class TestExitError extends Error {}

function capture(): {
  deps: Parameters<typeof wrap>[2];
  captured: Captured;
} {
  const captured: Captured = { out: [], err: [], exitCode: null };
  return {
    captured,
    deps: {
      print: (s: string) => {
        captured.out.push(s);
      },
      printErr: (s: string) => {
        captured.err.push(s);
      },
      exit: (code: number) => {
        captured.exitCode = code;
        throw new TestExitError();
      },
      debug: false,
    },
  };
}

describe("wrap — exit code propagation", () => {
  test("fn returns 0 → exit 0, no stderr", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap("test", async () => 0, deps);
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(0);
    expect(captured.err).toEqual([]);
  });

  test("fn returns 1 → exit 1", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap("test", async () => 1, deps);
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(1);
  });

  test("fn returns 3 (partial) → exit 3", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap("test", async () => 3, deps);
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(3);
  });

  test("forwards args to fn", async () => {
    const { deps } = capture();
    let received: unknown[] = [];
    const wrapped = wrap(
      "test",
      async (a: string, b: number) => {
        received = [a, b];
        return 0;
      },
      deps,
    );
    await expect(wrapped("hello", 42)).rejects.toBeInstanceOf(TestExitError);
    expect(received).toEqual(["hello", 42]);
  });
});

describe("wrap — SmithError handling", () => {
  test("validation-failed → printErr + exit 2", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap(
      "agent register",
      async () => {
        throw new SmithError({
          code: "validation-failed",
          what: "agent catalog",
          reasons: ["empty"],
          suggestedCommand: "smith agent register /tmp --allow-empty",
        });
      },
      deps,
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(2);
    const stderr = captured.err.join("\n");
    expect(stderr).toContain("smith agent register");
    expect(stderr).toContain("agent catalog validation failed");
    expect(stderr).toContain("- empty");
    expect(stderr).toContain("Try: smith agent register /tmp --allow-empty");
  });

  test("registry-version → printErr + exit 1", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap(
      "init",
      async () => {
        throw new SmithError({
          code: "registry-version",
          current: 99,
          expected: 1,
          path: "/p/registry.json",
        });
      },
      deps,
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(1);
    const stderr = captured.err.join("\n");
    expect(stderr).toContain("agent catalog file version mismatch");
    expect(stderr).toContain("Found version 99 in /p/registry.json (expected 1)");
    expect(stderr).toContain("mv /p/registry.json /p/registry.json.bak");
  });

  test("partial-failure → printErr + exit 3 with details", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap(
      "agent uninstall-all",
      async () => {
        throw new SmithError({
          code: "partial-failure",
          operation: "agent uninstall-all",
          succeeded: 2,
          failed: 1,
          skipped: 0,
          details: ["foo: EACCES /path/foo", "bar: not found"],
        });
      },
      deps,
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(3);
    const stderr = captured.err.join("\n");
    expect(stderr).toContain("2 succeeded, 1 failed, 0 skipped");
    expect(stderr).toContain("- foo: EACCES /path/foo");
    expect(stderr).toContain("- bar: not found");
  });

  test("usage-error without suggestedCommand omits Try line", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap(
      "init-user",
      async () => {
        throw new SmithError({ code: "usage-error", message: "EDITOR not set" });
      },
      deps,
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.err.join("\n")).not.toContain("Try:");
  });
});

describe("wrap — unknown error handling", () => {
  test("plain Error → exit 1, mentions SMITH_DEBUG", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap(
      "agent register",
      async () => {
        throw new TypeError("boom");
      },
      deps,
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(1);
    const stderr = captured.err.join("\n");
    expect(stderr).toContain("unexpected error");
    expect(stderr).toContain("boom");
    expect(stderr).toContain("SMITH_DEBUG=1");
    expect(stderr).toContain("https://github.com/eliharoun/agent-smith/issues");
  });

  test("non-Error throw (string) → exit 1, stringified", async () => {
    const { captured, deps } = capture();
    const wrapped = wrap(
      "test",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string";
      },
      deps,
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect(captured.exitCode).toBe(1);
    expect(captured.err.join("\n")).toContain("raw string");
  });

  test("debug=true includes stack trace", async () => {
    const captured: Captured = { out: [], err: [], exitCode: null };
    const wrapped = wrap(
      "test",
      async () => {
        throw new Error("boom");
      },
      {
        print: (s) => captured.out.push(s),
        printErr: (s) => captured.err.push(s),
        exit: (c) => {
          captured.exitCode = c;
          throw new TestExitError();
        },
        debug: true,
      },
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    const stderr = captured.err.join("\n");
    expect(stderr).toContain("at "); // stack frame marker
    expect(stderr).toContain("No SmithError payload");
  });
});

describe("wrap — defensive: formatter throws", () => {
  test("if printErr throws, still exits 1 without crashing the loop", async () => {
    let exitCode: number | null = null;
    const wrapped = wrap(
      "test",
      async () => {
        throw new Error("real error");
      },
      {
        print: () => {},
        printErr: () => {
          throw new Error("printErr broke");
        },
        exit: (c) => {
          exitCode = c;
          throw new TestExitError();
        },
        debug: false,
      },
    );
    await expect(wrapped()).rejects.toBeInstanceOf(TestExitError);
    expect<number | null>(exitCode).toBe(1);
  });
});

describe("formatCommanderError", () => {
  test("converts CommanderError-shaped object to usage-error SmithError", () => {
    const fakeCmdErr = Object.assign(new Error("missing required argument"), {
      code: "commander.missingArgument",
      exitCode: 1,
    });
    const sm = formatCommanderError(fakeCmdErr);
    expect(sm).toBeInstanceOf(SmithError);
    expect(sm.payload.code).toBe("usage-error");
    if (sm.payload.code === "usage-error") {
      expect(sm.payload.message).toContain("missing required argument");
    }
  });

  test("non-CommanderError-shaped input still yields usage-error", () => {
    const sm = formatCommanderError(new Error("plain"));
    expect(sm.payload.code).toBe("usage-error");
  });

  test("strips leading 'error:' prefix from commander messages", () => {
    // Commander prefixes its own error messages with "error: ". The wrap
    // header already prints "✗ smith <cmd>:", so leaving the prefix in
    // produces "✗ smith: error: unknown command 'foo'" — double label.
    const cmdErr = Object.assign(new Error("error: unknown command 'foo'"), {
      code: "commander.unknownCommand",
    });
    const sm = formatCommanderError(cmdErr);
    expect(sm.payload.code).toBe("usage-error");
    if (sm.payload.code === "usage-error") {
      expect(sm.payload.message).toBe("unknown command 'foo'");
      expect(sm.payload.message).not.toMatch(/^error:/);
    }
  });

  test("strips 'error:' prefix even with extra whitespace", () => {
    const cmdErr = new Error("error:    too many arguments");
    const sm = formatCommanderError(cmdErr);
    if (sm.payload.code === "usage-error") {
      expect(sm.payload.message).toBe("too many arguments");
    }
  });

  test("does NOT strip the literal substring 'error:' when not at start", () => {
    const cmdErr = new Error("got error: foo");
    const sm = formatCommanderError(cmdErr);
    if (sm.payload.code === "usage-error") {
      expect(sm.payload.message).toBe("got error: foo");
    }
  });
});

describe("formatSmithError — headline-prefix duplication for usage-error", () => {
  test("strips redundant 'smith <cmd>:' prefix from usage-error message", () => {
    // When a caller composes a usage-error message that starts with
    // "smith <subcommand>: ...", the wrap header already prints "✗ smith
    // <cmd>:", producing "✗ smith knowledge: smith knowledge requires...".
    // The renderer should strip the redundant prefix as a safety net.
    const err = new SmithError({
      code: "usage-error",
      message: "smith knowledge requires a subcommand: add, list, fetch, validate",
    });
    const out = formatSmithError("knowledge", err, false);
    expect(out).toContain("✗ smith knowledge:");
    expect(out).not.toMatch(/smith knowledge:.*smith knowledge/);
    expect(out).toContain("requires a subcommand");
  });

  test("does not over-strip when subcommand path matches but message continues sensibly", () => {
    const err = new SmithError({
      code: "usage-error",
      message: "smith agent install needs a bundle name",
    });
    const out = formatSmithError("agent install", err, false);
    expect(out).not.toMatch(/smith agent install:.*smith agent install/);
    expect(out).toContain("needs a bundle name");
  });

  test("no-op when message does not start with the command path", () => {
    const err = new SmithError({
      code: "usage-error",
      message: "EDITOR not set",
    });
    const out = formatSmithError("init-user", err, false);
    expect(out).toContain("✗ smith init-user: EDITOR not set");
  });
});

describe("formatSmithError — new variants", () => {
  test("protected-catalog renders headline with name, no Try line", () => {
    const err = new SmithError({
      code: "protected-catalog",
      name: "example-pack",
    });
    const out = formatSmithError("skill unregister", err, false);
    expect(out).toContain("✗ smith skill unregister:");
    expect(out).toContain("example-pack");
    expect(out).toContain("protected catalog");
    expect(out).not.toContain("Try:");
  });

  test("skill-registry-corrupt-json renders path and parse error", () => {
    const err = new SmithError({
      code: "skill-registry-corrupt-json",
      path: "/tmp/skill-catalogs.json",
      parseError: "Unexpected token } in JSON at position 42",
    });
    const out = formatSmithError("skill list", err, false);
    expect(out).toContain("✗ smith skill list:");
    expect(out).toContain("skill catalog file is corrupt");
    expect(out).toContain("/tmp/skill-catalogs.json");
    expect(out).toContain("Unexpected token");
  });

  test("renders skill-registry-corrupt-shape with reasons list and skill remediation", () => {
    const err = new SmithError({
      code: "skill-registry-corrupt-shape",
      path: "/tmp/skill-registry.json",
      reasons: ["catalogs[0]: must be an object", "catalogs[1].label: must be a string"],
    });
    const out = formatSmithError("skill register", err, false);
    expect(out).toContain("skill catalog file has invalid shape");
    expect(out).toContain("- catalogs[0]: must be an object");
    expect(out).toContain("- catalogs[1].label: must be a string");
    expect(out).toContain("/tmp/skill-registry.json");
    expect(out).toContain("smith skill register");
  });

  test("renders http-error 5xx with service + operation + url + snippet + remediation", () => {
    const err = new SmithError({
      code: "http-error",
      service: "Confluence",
      status: 503,
      url: "https://example.atlassian.net/wiki/api/v2/pages/123",
      operation: "GET page",
      snippet: "Service Unavailable",
    });
    const rendered = formatSmithError("knowledge add", err, false);
    expect(rendered).toContain("Confluence GET page: HTTP 503");
    expect(rendered).toContain("Service Unavailable");
    expect(rendered).toContain("https://example.atlassian.net/wiki/api/v2/pages/123");
    expect(rendered).toContain("server returned an error");
  });

  test("renders http-error 4xx with no operation, no snippet", () => {
    const err = new SmithError({
      code: "http-error",
      service: "fetch",
      status: 404,
      url: "https://example.com/missing",
    });
    const rendered = formatSmithError("knowledge add", err, false);
    expect(rendered).toContain("fetch: HTTP 404");
    expect(rendered).toContain("https://example.com/missing");
    expect(rendered).toContain("Verify the request is well-formed");
  });
});

describe("formatSmithError — permission-denied multi-word operation (Item A)", () => {
  test("body renders as '<path>: <operation>' for a multi-word operation phrase", () => {
    const err = new SmithError({
      code: "permission-denied",
      path: "https://wiki.example/space/ENG",
      operation: "list pages in space ENG",
    });
    const out = formatSmithError("knowledge fetch", err, false);
    expect(out).toContain("https://wiki.example/space/ENG: list pages in space ENG");
  });

  test("body works for a short verb operation", () => {
    const err = new SmithError({ code: "permission-denied", path: "/etc/x", operation: "read" });
    const out = formatSmithError("smith", err, false);
    expect(out).toContain("/etc/x: read");
  });
});
