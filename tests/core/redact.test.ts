import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../../src/core/redact";

describe("redactSecrets — userinfo stripping (parity with old redactUrl)", () => {
  test("strips user:pass@ from https URL", () => {
    expect(redactSecrets("https://alice:secret@example.com/x.git")).toBe(
      "https://example.com/x.git",
    );
  });

  test("strips token@ from https URL", () => {
    expect(redactSecrets("https://token@example.com/x.git")).toBe(
      "https://example.com/x.git",
    );
  });

  test("leaves plain https URL unchanged", () => {
    expect(redactSecrets("https://example.com/x.git")).toBe(
      "https://example.com/x.git",
    );
  });

  test("leaves SCP-style git@host:path unchanged (no scheme)", () => {
    expect(redactSecrets("git@github.com:org/x.git")).toBe(
      "git@github.com:org/x.git",
    );
  });

  test("strips user:pw@ from ssh URL", () => {
    expect(redactSecrets("ssh://user:pw@host/repo.git")).toBe(
      "ssh://host/repo.git",
    );
  });
});

describe("redactSecrets — query-param redaction", () => {
  test("redacts single api_key value", () => {
    expect(redactSecrets("https://api.example.com/v1?api_key=xxx")).toBe(
      "https://api.example.com/v1?api_key=[redacted]",
    );
  });

  test("redacts multiple secret keys, preserves non-secret keys", () => {
    expect(
      redactSecrets("https://x.com/?token=a&signature=b&q=foo"),
    ).toBe("https://x.com/?token=[redacted]&signature=[redacted]&q=foo");
  });

  test("redacts case-insensitively", () => {
    expect(redactSecrets("https://x.com/?Api_Key=xxx&TOKEN=yyy")).toBe(
      "https://x.com/?Api_Key=[redacted]&TOKEN=[redacted]",
    );
  });

  test("redacts AWS S3 presigned signature, preserves date", () => {
    expect(
      redactSecrets(
        "https://s3.amazonaws.com/b/k?X-Amz-Signature=abc&X-Amz-Date=20260506T000000Z",
      ),
    ).toBe(
      "https://s3.amazonaws.com/b/k?X-Amz-Signature=[redacted]&X-Amz-Date=20260506T000000Z",
    );
  });

  test("preserves safe characters in redacted value boundary", () => {
    // Value contains hyphens/underscores/digits — regex must stop at & or end.
    expect(redactSecrets("https://x.com/?token=abc-def_123&next=y")).toBe(
      "https://x.com/?token=[redacted]&next=y",
    );
  });
});

describe("redactSecrets — combined and edge cases", () => {
  test("redacts both userinfo and query in one URL", () => {
    expect(redactSecrets("https://u:p@host/x?token=y")).toBe(
      "https://host/x?token=[redacted]",
    );
  });

  test("passes prose through unchanged", () => {
    expect(redactSecrets("my secret recipe")).toBe("my secret recipe");
  });

  test("redacts every URL in a multi-URL string", () => {
    expect(
      redactSecrets(
        "failed for https://a.com/?token=x and https://b.com/?api_key=y",
      ),
    ).toBe(
      "failed for https://a.com/?token=[redacted] and https://b.com/?api_key=[redacted]",
    );
  });

  test("is idempotent on already-redacted input", () => {
    const input = "https://host/x?token=[redacted]";
    expect(redactSecrets(input)).toBe(input);
  });

  test("is idempotent across all secret-bearing patterns", () => {
    const cases = [
      "https://u:p@host/x",
      "https://x.com/?api_key=xxx",
      "https://u:p@host/x?token=y&signature=z",
      "https://s3.amazonaws.com/b/k?X-Amz-Signature=abc",
    ];
    for (const c of cases) {
      const once = redactSecrets(c);
      const twice = redactSecrets(once);
      expect(twice).toBe(once);
    }
  });
});
