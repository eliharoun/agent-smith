import { describe, expect, test } from "bun:test";
import { downloadArchive } from "../../src/cli/commands/install";

describe("downloadArchive — SSRF and size guards (finding 4)", () => {
  test("rejects localhost", async () => {
    await expect(
      downloadArchive("https://localhost/foo.smith-bundle.tgz"),
    ).rejects.toThrow(/internal\/loopback/);
  });

  test("rejects 127.x loopback", async () => {
    await expect(
      downloadArchive("https://127.0.0.1/foo.smith-bundle.tgz"),
    ).rejects.toThrow(/internal\/loopback/);
  });

  test("rejects link-local (169.254.x.x)", async () => {
    await expect(
      downloadArchive("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/internal\/loopback/);
  });

  test("rejects RFC1918 10.x.x.x", async () => {
    await expect(
      downloadArchive("https://10.0.0.1/bundle.smith-bundle.tgz"),
    ).rejects.toThrow(/internal\/loopback/);
  });

  test("rejects RFC1918 192.168.x.x", async () => {
    await expect(
      downloadArchive("https://192.168.1.1/bundle.smith-bundle.tgz"),
    ).rejects.toThrow(/internal\/loopback/);
  });

  test("rejects RFC1918 172.16.x.x", async () => {
    await expect(
      downloadArchive("https://172.16.0.1/bundle.smith-bundle.tgz"),
    ).rejects.toThrow(/internal\/loopback/);
  });

  test("host check fires before any network call", async () => {
    // The rejection must be synchronous (before fetch) so no real connection
    // attempt is made to the blocked host.
    const startMs = Date.now();
    await expect(
      downloadArchive("https://127.0.0.1/foo.smith-bundle.tgz"),
    ).rejects.toThrow(/internal\/loopback/);
    // If the guard fires before fetch, the call completes well under 1 second.
    expect(Date.now() - startMs).toBeLessThan(1000);
  });
});
