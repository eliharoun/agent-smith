# Script guidelines

Load this reference when the skill you're authoring will bundle scripts in `scripts/`. Scripts give deterministic behavior the agent can't accidentally vary; they also save context tokens because they execute without loading their source into the agent's context window.

## When to bundle a script

Three signals — any one is enough:

1. **Same logic rewritten repeatedly across runs.** If a skill consistently causes the agent to write the same parsing code, the same CLI invocation chain, or the same validation helper, extract it once into a script.
2. **Determinism matters.** Validation, spec compliance, safety refusals — anything where the right answer is binary should be a script, not prose the agent interprets differently each time.
3. **Token efficiency.** A 200-line Python utility consumed via `scripts/foo.py` never enters the agent's context. The same logic described in prose does.

If none of these apply, leave the logic in the body of SKILL.md.

## Shell script template

```bash
#!/usr/bin/env bash
#
# <script-name>.sh — <one-sentence purpose>
#
# Usage: <script-name>.sh <args>
#
# Exits: 0 success | 1 failure | 2 usage error

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

main() {
  [ $# -ge 1 ] || usage
  # Implementation here
  info "done"
}

trap 'error "failed on line $LINENO"' ERR
main "$@"
```

Keep shell scripts under ~200 lines. If they're growing larger, reach for Python or another language with proper data structures.

## Python script template

```python
#!/usr/bin/env python3
"""<script-name>.py — <one-sentence purpose>.

Usage:
    <script-name>.py <args>
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="path to input file")
    parser.add_argument("--flag", action="store_true", help="optional toggle")
    args = parser.parse_args()

    # Implementation here

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Use Python when you need: structured data (JSON, YAML), anything resembling parsing, or logic that exceeds bash comfort (~200 lines or deep nesting).

## Portability rules

The validator and most agent skill clients assume a minimal baseline. Stay within it so your skill works on every developer's machine:

- **Tools you can rely on:** `bash` (≥3.2), `python3`, `grep`, `sed`, `awk`, `find`, `sort`, `uniq`, `git`. Present on macOS, every common Linux distro, and WSL.
- **Avoid `jq` / `yq`.** They're not installed by default on macOS. Use `python3 -c "import json; ..."` or `python3 -c "import yaml; ..."` instead.
- **Avoid Bash-4-only features** (associative arrays, `${var,,}` lowercasing, etc.) unless you explicitly require Bash 4+ in `compatibility:` and document it. Stock macOS still ships Bash 3.2.
- **Avoid GNU-only flags on macOS.** `readlink -f`, `sed -i ''` (without the empty extension), `date -d` — these differ between Linux and macOS. Write a cross-platform helper or use `python3`.
- **All scripts must be executable** (`chmod +x`) and have a shebang line. The validator enforces this: a referenced script that isn't executable is a ❌.
- **Use `set -euo pipefail`** at the top of every bash script. Catches errors that would otherwise pass silently.

### Cross-platform sed in-place edit

Linux: `sed -i 's/foo/bar/' file`
macOS: `sed -i '' 's/foo/bar/' file`

Portable: `sed -i.bak 's/foo/bar/' file && rm file.bak` (works on both).

### Cross-platform readlink

`readlink -f` is GNU-only. Portable equivalent:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

## Naming conventions

- Verb-noun, lowercase-kebab: `validate-skill.sh`, `generate-report.py`.
- Never `script1.sh`, `helper.py`, `do.sh`. Descriptive names are self-documenting when the agent reads SKILL.md.
- Match the filename to the invocation the user will type.

## Documenting scripts in SKILL.md

Every bundled script **must** be documented in SKILL.md with:

- **What it does** — one sentence
- **When to use it** — which phase of the skill workflow, or which user intent
- **Parameters** — positional args + flags
- **Example invocation** — copy-paste-ready command
- **Expected output** — what success looks like

Example block:

```markdown
### scripts/validate-skill.sh

Validates a SKILL.md against the Agent Skills spec.

**When to use:** Phase 4 (validation gate) and after every revision in Phase 6.

**Usage:** `./scripts/validate-skill.sh <path-to-SKILL.md-or-skill-dir>`

**Output:** line-per-check with ✅/⚠️/❌ icons, summary at the end. Exit 0 on pass, 1 on error, 2 on usage failure.
```

Without this block, the agent may not know when to invoke the script and may duplicate its logic in prose.
