// src/io/user-template.ts
//
// Canonical "About me" stub written to ~/.config/agent-smith/USER.md by:
//   - `smith init`           (init.ts)
//   - `smith init-user`      (init-user.ts: self-bootstrap path)
//   - `smith agent init`     (init-agent.ts: canonical-symlink seed)
//
// Single source of truth: this constant is the ONLY place the template
// string lives. Through rc.3 the string was duplicated across the three
// commands above with `// keep in sync` comments — that was acceptable
// when there were two consumers, fragile at three, and a typo waiting
// to happen at four. Imported as a constant from each consumer site.
//
// Contract: starts with `# About me` so downstream readers (the
// architect skill's USER.md sniffer, doctor's stub-detection logic)
// can recognize a fresh seed vs. user-edited content.

export const CANONICAL_USER_MD_TEMPLATE =
  "# About me\n\nReplace this with context the agents should know about you, your preferences, and your environment.\n";
