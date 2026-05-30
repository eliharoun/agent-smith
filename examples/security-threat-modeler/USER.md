This file is a placeholder.

In a real install, this path is a symlink pointing to your canonical user
context at `~/.config/agent-smith/USER.md`.

The canonical file is shared across every agent in your install.

Write your global preferences, environment notes, name, and project context
there once, and every agent (including this one) reads them.

If you are reading this verbatim, the symlink hasn't been created yet.

The installer's Step 8b runs `smith init` for you. If for some reason
your canonical USER.md isn't there, run `smith init-user` (which self-
bootstraps a missing manifest), then re-install this agent — the
install pipeline replaces this stub with the symlink.

Specific preferences security-threat-modeler honors from USER.md:

- Compliance regimes you operate under (SOC 2, HIPAA, PCI-DSS, GDPR, etc.)
  — affects what threats are in-scope and how findings are framed.
- Your preferred risk-rating scale (e.g. CVSS, DREAD, qualitative
  low/medium/high/critical) — used consistently across the document.
- Trust assumptions about your platform (single-tenant vs multi-tenant,
  internal vs internet-facing, on-prem vs cloud, etc.) — these change which
  threats are plausible and which mitigations apply.
- Threat-actor profiles relevant to your context (external attacker,
  malicious insider, accidental user error, supply-chain compromise, nation
  state) — scopes the lens applied during the STRIDE walk.

Anything else you write in USER.md is read as general user context, not
configuration for this agent.
