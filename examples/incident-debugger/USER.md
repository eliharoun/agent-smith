This file is a placeholder.

In a real install, this path is a symlink pointing to your canonical user context at `~/.config/agent-smith/USER.md`.

The canonical file is shared across every agent in your install.

You write your global preferences, environment notes, name, and project context there once, and every agent (including this one) reads them.

If you are reading this file verbatim instead of your own canonical content, the symlink has not been created yet.

The installer's Step 8b runs `smith init` for you. If for some reason your canonical USER.md isn't there, run `smith init-user` (which self-bootstraps a missing manifest), then re-install this agent.

The install pipeline replaces this stub with the symlink automatically.

Specific preferences incident-debugger honors from USER.md when present:

- Production environment notes: cluster names, log locations, paging rotation, runbook URLs, on-call escalation chain.

- Preferred rollback mechanism: git revert plus redeploy, blue-green flip, feature-flag toggle, kubectl rollout undo, Terraform state rollback, or something custom to your stack.

- Severity definitions and escalation contacts your team uses: what counts as sev-1 vs sev-2, who to page at each level, the channel where incidents are coordinated.

- Service ownership map: which team owns which service, so handoffs are clean.

- Default observability tooling: which metrics system, which log aggregator, which tracing system, and how to query them from a terminal.

- Communication preference during an incident: terse status pings, full narrative, or silence-until-resolution.

- Known-noisy alerts to deprioritize, and any standing context about flapping services that does not constitute a real incident.

Anything else you write in USER.md is read as general user context, not configuration.

The agent uses it the way a new teammate would use a project README — to understand the environment without asking obvious questions.

This stub itself is intentionally non-functional.

It exists so the example bundle validates and installs cleanly.

Replace it (via the symlink mechanism above) with your real context before relying on the agent in a live incident.
