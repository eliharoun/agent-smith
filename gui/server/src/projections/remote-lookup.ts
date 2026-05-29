// gui/server/src/projections/remote-lookup.ts
//
// C4.1.3 (v1-task): shared helper for the agent and skill projections.
// Picks the longest rootPath in `remotes` that is a path-prefix of
// `bundlePath`. Returns the matching RemoteBlock or undefined.
//
// Path-prefix semantics: '/a/b' matches '/a/b/c' and '/a/b' itself, but
// does NOT match '/a/bb' (the boundary must be at a '/' or end-of-string).
// This prevents '/a' from spuriously matching '/abc' when both could in
// principle be registered.

import type { RemoteBlock } from "gui-shared";

export type RemoteLookup = ReadonlyMap<string, RemoteBlock>;

export function findRemoteForPath(
  bundlePath: string,
  remotes: RemoteLookup,
): RemoteBlock | undefined {
  let best: { root: string; remote: RemoteBlock } | null = null;
  for (const [root, remote] of remotes) {
    if (bundlePath === root || bundlePath.startsWith(`${root}/`)) {
      if (!best || root.length > best.root.length) {
        best = { root, remote };
      }
    }
  }
  return best?.remote;
}
