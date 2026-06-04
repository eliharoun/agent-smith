import { describe, expect, test } from "bun:test";
import { readArchive, writeArchive } from "../../src/io/archive-tar";

describe("writeArchive", () => {
  test("produces byte-identical output for identical inputs", async () => {
    const entries = [
      { path: "foo/a.txt", bytes: Buffer.from("hello", "utf8") },
      { path: "foo/b.txt", bytes: Buffer.from("world", "utf8") },
    ];
    const a = await writeArchive(entries, { gzip: true });
    const b = await writeArchive(entries, { gzip: true });
    expect(a.equals(b)).toBe(true);
  });

  test("entries are emitted in lexicographic order regardless of input order", async () => {
    const a = await writeArchive(
      [
        { path: "foo/b.txt", bytes: Buffer.from("B") },
        { path: "foo/a.txt", bytes: Buffer.from("A") },
      ],
      { gzip: false },
    );
    const b = await writeArchive(
      [
        { path: "foo/a.txt", bytes: Buffer.from("A") },
        { path: "foo/b.txt", bytes: Buffer.from("B") },
      ],
      { gzip: false },
    );
    expect(a.equals(b)).toBe(true);
  });

  test("round-trips through readArchive", async () => {
    const entries = [
      { path: "foo/a.txt", bytes: Buffer.from("alpha") },
      { path: "foo/sub/b.txt", bytes: Buffer.from("beta") },
    ];
    const archive = await writeArchive(entries, { gzip: true });
    const out = await readArchive(archive);
    expect(out.map((e) => e.path).sort()).toEqual(["foo/a.txt", "foo/sub/b.txt"]);
    const a = out.find((e) => e.path === "foo/a.txt")!;
    expect(a.bytes.toString()).toBe("alpha");
  });

  test("file mtimes are epoch-pinned", async () => {
    const archive = await writeArchive([{ path: "x.txt", bytes: Buffer.from("x") }], {
      gzip: false,
    });
    const out = await readArchive(archive);
    expect(out[0]?.mtime).not.toBeNull();
    expect(out[0]!.mtime!.getTime()).toBe(0);
  });

  test("rejects entry paths that escape the stage directory", async () => {
    await expect(
      writeArchive([{ path: "../../etc/passwd", bytes: Buffer.from("x") }], { gzip: false }),
    ).rejects.toThrow(/escapes/);
  });

  test("does not collide with an entry literally named _out.tar", async () => {
    const archive = await writeArchive(
      [{ path: "_out.tar", bytes: Buffer.from("payload") }],
      { gzip: false },
    );
    const out = await readArchive(archive);
    expect(out.find((e) => e.path === "_out.tar")?.bytes.toString()).toBe("payload");
  });
});

// Build a raw (non-gzip) tar buffer in memory with `count` 1-byte File entries.
// Each entry has a 512-byte POSIX ustar header followed by a 512-byte data block.
function buildRawTar(count: number): Buffer {
  // Header (512) + 1 data byte padded to 512 + two 512-byte end-of-archive blocks.
  const entrySize = 512 + 512;
  const eoa = 1024;
  const buf = Buffer.alloc(count * entrySize + eoa, 0);
  for (let i = 0; i < count; i++) {
    const hdr = Buffer.alloc(512, 0);
    const name = Buffer.from(`file-${i}.txt`);
    name.copy(hdr, 0, 0, Math.min(name.length, 100));
    // mode
    Buffer.from("0000644\0").copy(hdr, 100);
    // uid/gid
    Buffer.from("0000000\0").copy(hdr, 108);
    Buffer.from("0000000\0").copy(hdr, 116);
    // size = 1 byte, octal
    Buffer.from("00000000001\0").copy(hdr, 124);
    // mtime
    Buffer.from("00000000000\0").copy(hdr, 136);
    // typeflag = '0' (regular file)
    hdr[156] = 48;
    // ustar magic
    Buffer.from("ustar  \0").copy(hdr, 257);
    // Checksum: sum of all bytes with checksum field as spaces
    hdr.fill(32, 148, 156);
    let sum = 0;
    for (let b = 0; b < 512; b++) sum += hdr[b]!;
    Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ").copy(hdr, 148);
    // Write header and 1 byte of data
    const off = i * entrySize;
    hdr.copy(buf, off);
    buf[off + 512] = 120; // 'x'
  }
  return buf;
}

describe("readArchive — safety caps", () => {
  test("rejects archives exceeding the entry count cap", async () => {
    // Build a raw tar with one more entry than the 10,000 cap.
    const archive = buildRawTar(10_001);
    await expect(readArchive(archive)).rejects.toThrow(/too many entries/);
  });
});
