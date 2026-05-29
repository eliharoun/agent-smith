import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireInstallLock,
  acquireManifestLock,
  acquireRefreshLock,
  releaseRefreshLock,
} from "../../../src/core/knowledge/refresh-lock";

describe("refresh-lock", () => {
  test("acquires fresh lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const handle = await acquireRefreshLock(dir, "agent-a", "src-1");
      expect(handle).toBeDefined();
      await releaseRefreshLock(handle!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("second concurrent acquire returns undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const a = await acquireRefreshLock(dir, "agent-a", "src-1");
      const b = await acquireRefreshLock(dir, "agent-a", "src-1");
      expect(a).toBeDefined();
      expect(b).toBeUndefined();
      await releaseRefreshLock(a!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stale lock (>30s) is taken over", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const a = await acquireRefreshLock(dir, "agent-a", "src-1");
      expect(a).toBeDefined();
      // Backdate the lock file's mtime by 40 seconds
      const past = new Date(Date.now() - 40_000);
      await utimes(a!.path, past, past);

      const b = await acquireRefreshLock(dir, "agent-a", "src-1");
      expect(b).toBeDefined();
      // The takeover should have overwritten with a fresh mtime
      const s = await stat(b!.path);
      expect(s.mtimeMs).toBeGreaterThan(past.getTime());
      await releaseRefreshLock(b!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("releases by deleting the lockfile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const a = await acquireRefreshLock(dir, "agent-a", "src-1");
      await releaseRefreshLock(a!);
      // After release another acquire should succeed
      const b = await acquireRefreshLock(dir, "agent-a", "src-1");
      expect(b).toBeDefined();
      await releaseRefreshLock(b!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("manifest lock", () => {
  test("acquires fresh manifest lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const handle = await acquireManifestLock(home, "agent-a");
      expect(handle).toBeDefined();
      expect(handle!.path).toBe(join(home, "agents", "agent-a", ".manifest.lock"));
      await releaseRefreshLock(handle!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("second concurrent acquire on same agent returns undefined", async () => {
    const home = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const a = await acquireManifestLock(home, "agent-a");
      const b = await acquireManifestLock(home, "agent-a");
      expect(a).toBeDefined();
      expect(b).toBeUndefined();
      await releaseRefreshLock(a!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("different agents get independent locks", async () => {
    const home = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const a = await acquireManifestLock(home, "agent-a");
      const b = await acquireManifestLock(home, "agent-b");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a!.path).not.toBe(b!.path);
      await releaseRefreshLock(a!);
      await releaseRefreshLock(b!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("stale manifest lock (>30s) is taken over", async () => {
    const home = await mkdtemp(join(tmpdir(), "refresh-lock-"));
    try {
      const a = await acquireManifestLock(home, "agent-a");
      expect(a).toBeDefined();
      const past = new Date(Date.now() - 40_000);
      await utimes(a!.path, past, past);

      const b = await acquireManifestLock(home, "agent-a");
      expect(b).toBeDefined();
      const s = await stat(b!.path);
      expect(s.mtimeMs).toBeGreaterThan(past.getTime());
      await releaseRefreshLock(b!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("install lock", () => {
  test("serializes concurrent install attempts for the same agent", async () => {
    const home = await mkdtemp(join(tmpdir(), "install-lock-"));
    try {
      const lock1 = await acquireInstallLock(home, "platform-ai");
      expect(lock1).toBeDefined();
      const lock2 = await acquireInstallLock(home, "platform-ai");
      expect(lock2).toBeUndefined();
      await releaseRefreshLock(lock1!);
      const lock3 = await acquireInstallLock(home, "platform-ai");
      expect(lock3).toBeDefined();
      await releaseRefreshLock(lock3!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("different agents don't block each other", async () => {
    const home = await mkdtemp(join(tmpdir(), "install-lock-"));
    try {
      const lockA = await acquireInstallLock(home, "agent-a");
      const lockB = await acquireInstallLock(home, "agent-b");
      expect(lockA).toBeDefined();
      expect(lockB).toBeDefined();
      await releaseRefreshLock(lockA!);
      await releaseRefreshLock(lockB!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("takes over a stale lock (older than 1h)", async () => {
    const home = await mkdtemp(join(tmpdir(), "install-lock-"));
    try {
      const lock1 = await acquireInstallLock(home, "platform-ai");
      expect(lock1).toBeDefined();
      // Backdate the lock file mtime by 2 hours
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(lock1!.path, twoHoursAgo, twoHoursAgo);
      // Don't release — simulate crashed prior holder
      const lock2 = await acquireInstallLock(home, "platform-ai");
      expect(lock2).toBeDefined();
      const s = await stat(lock2!.path);
      expect(s.mtimeMs).toBeGreaterThan(twoHoursAgo.getTime());
      await releaseRefreshLock(lock2!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("does NOT take over a lock younger than 1h", async () => {
    const home = await mkdtemp(join(tmpdir(), "install-lock-"));
    try {
      const lock1 = await acquireInstallLock(home, "platform-ai");
      expect(lock1).toBeDefined();
      // Backdate by only 30 minutes — still fresh for install lock
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      await utimes(lock1!.path, thirtyMinAgo, thirtyMinAgo);
      const lock2 = await acquireInstallLock(home, "platform-ai");
      expect(lock2).toBeUndefined();
      await releaseRefreshLock(lock1!);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
