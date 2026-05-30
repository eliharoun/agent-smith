---
name: Bug bash report
about: Report a finding from a bug-bash session
title: "[bug-bash] <area-letter>: <one-line summary>"
labels: bug-bash
assignees: ''
---

<!--
Use this template when filing a bug discovered during a structured bug-bash
session. See QA/bug-bash.md for the session protocol.

Fill in EVERY section. Do not delete the headers.
-->

## Area

<!-- A, B, C, D, E, F, G, or H — the area you were testing. See QA/bug-bash.md. -->

## Severity

<!-- One of: S1 (data loss), S2 (command broken), S3 (wrong output, recoverable), S4 (polish). -->

## Environment

- `smith --version`:
- OS / version:
- Bun version (`bun --version`):
- Platform CLI(s) tested against (and version): <!-- opencode, claude, codex, kiro -->
- Shell:

## Repro steps

<!-- Numbered, copy-pasteable. The smaller the repro, the faster the fix. -->

1.
2.
3.

## Expected behavior

<!-- What should have happened? Quote the bug-bash scenario expectation if applicable. -->

## Actual behavior

<!-- What did happen? Include exit code, stderr/stdout, and any visible state changes. -->

## Logs

<details>
<summary>SMITH_DEBUG=1 output</summary>

```
<!-- Re-run with SMITH_DEBUG=1 (or AGENT_SMITH_DEBUG=1 for doctor) and paste here. -->
```

</details>

## Notes

<!-- Optional. Anything else that would help triage: workarounds tried, related issues, hypotheses. -->
