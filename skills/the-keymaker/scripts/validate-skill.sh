#!/usr/bin/env bash
#
# validate-skill.sh — validate a SKILL.md against the Agent Skills spec
#                     (https://agentskills.io) and OpenCode/Claude Code rules.
#
# Usage: validate-skill.sh <path-to-SKILL.md-or-skill-dir>
#
# Exits: 0 all checks pass (warnings allowed) | 1 one or more errors | 2 usage

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS_COUNT=0; WARN_COUNT=0; ERR_COUNT=0

pass() { echo -e "${GREEN}✅${NC}  $*"; PASS_COUNT=$((PASS_COUNT+1)); }
warn() { echo -e "${YELLOW}⚠️${NC}   $*"; WARN_COUNT=$((WARN_COUNT+1)); }
err()  { echo -e "${RED}❌${NC}  $*"; ERR_COUNT=$((ERR_COUNT+1)); }

usage() {
  echo "Usage: $(basename "$0") <path-to-SKILL.md-or-skill-dir>" >&2
  exit 2
}

[ $# -eq 1 ] || usage

INPUT="$1"
if [ -d "$INPUT" ]; then
  SKILL_MD="$INPUT/SKILL.md"
else
  SKILL_MD="$INPUT"
fi

# ---------- Structure ----------
# Check 1: file exists and is readable
if [ ! -r "$SKILL_MD" ]; then
  echo "SKILL.md not found or unreadable: $SKILL_MD" >&2
  exit 2
fi
pass "SKILL.md exists and is readable"

# Check 2: parent directory name derivable
SKILL_DIR="$(cd "$(dirname "$SKILL_MD")" && pwd)"
DIR_NAME="$(basename "$SKILL_DIR")"
pass "parent directory name: '$DIR_NAME'"

# Check 3: frontmatter well-formed
FIRST_LINE="$(head -n1 "$SKILL_MD")"
if [ "$FIRST_LINE" != "---" ]; then
  err "frontmatter must start with '---' on line 1"
  echo
  echo "Summary: $PASS_COUNT passed, $WARN_COUNT warnings, $ERR_COUNT errors"
  exit 1
fi

FRONTMATTER="$(awk '/^---$/{c++; if(c==2) exit; next} c==1' "$SKILL_MD")"
if [ -z "$FRONTMATTER" ]; then
  err "frontmatter appears empty or missing closing '---'"
  echo
  echo "Summary: $PASS_COUNT passed, $WARN_COUNT warnings, $ERR_COUNT errors"
  exit 1
fi
pass "frontmatter block delimited"

if python3 -c "import yaml" 2>/dev/null; then
  PARSED="$(echo "$FRONTMATTER" | python3 -c "
import sys, yaml
try:
    d = yaml.safe_load(sys.stdin) or {}
except Exception:
    d = {}
print(d.get('name') or '')
print(d.get('description') or '')
" 2>/dev/null)" || PARSED=$'\n'
  NAME="$(echo "$PARSED" | sed -n '1p')"
  DESC="$(echo "$PARSED" | sed -n '2p')"
else
  NAME="$(echo "$FRONTMATTER" | grep -E '^name:' | sed 's/^name:[[:space:]]*//' | head -n1 | tr -d '"' | tr -d "'" || true)"
  DESC="$(echo "$FRONTMATTER" | grep -E '^description:' | sed 's/^description:[[:space:]]*//' | head -n1 || true)"
fi

# Strip surrounding quotes from DESC if shell-fallback kept them
DESC="${DESC%\"}"; DESC="${DESC#\"}"
DESC="${DESC%\'}"; DESC="${DESC#\'}"

# ---------- Frontmatter — spec-required ----------
# Check 4: name regex + length
if [ -z "$NAME" ]; then
  err "frontmatter must contain a 'name' field"
elif ! [[ "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  err "name '$NAME' must be lowercase alphanumeric with single hyphens, no leading/trailing/consecutive hyphens"
elif [ "${#NAME}" -gt 64 ]; then
  err "name '$NAME' exceeds 64 characters"
else
  pass "name '$NAME' is valid"
fi

# Check 5: name matches directory
if [ -n "$NAME" ] && [ "$NAME" != "$DIR_NAME" ]; then
  err "name '$NAME' does not match directory '$DIR_NAME'"
elif [ -n "$NAME" ]; then
  pass "name matches directory"
fi

# Check 6: description 1-1024 chars
DESC_LEN="${#DESC}"
if [ -z "$DESC" ]; then
  err "frontmatter must contain a 'description' field"
elif [ "$DESC_LEN" -gt 1024 ]; then
  err "description is $DESC_LEN chars; must be 1-1024"
else
  pass "description length: $DESC_LEN chars"
fi

# Check 7: description not too generic
if [ -n "$DESC" ] && [ "$DESC_LEN" -le 30 ]; then
  warn "description is very short ($DESC_LEN chars); be more specific"
elif [ -n "$DESC" ] && [[ "$DESC" =~ ^[Hh]elps\ with\  ]]; then
  warn "description starts with 'Helps with' — consider intent-driven phrasing (start with 'Use when…')"
elif [ -n "$DESC" ] && [[ "$DESC" =~ ^[Ff]or\ .+\ operations$ ]]; then
  warn "description matches 'For X operations' pattern — consider concrete trigger phrases"
elif [ -n "$DESC" ]; then
  pass "description passes genericness heuristic"
fi

# ---------- Body structure ----------
BODY="$(awk '/^---$/{c++; next} c>=2' "$SKILL_MD")"

# For file-reference checks, strip code spans and fenced code blocks
BODY_NO_CODE="$(echo "$BODY" | awk '
  /^```/ { in_fence = !in_fence; next }
  !in_fence { print }
' | sed "s/\`[^\`]*\`//g" | sed 's/"[^"]*"//g')"

# Check 8: H1 present as first non-blank body line
FIRST_BODY_LINE="$(echo "$BODY" | grep -v '^[[:space:]]*$' | head -n1 || true)"
if [[ "$FIRST_BODY_LINE" =~ ^#[[:space:]] ]]; then
  pass "H1 heading present as first body content"
else
  err "first body line must be an H1 heading (starts with '# ')"
fi

# Check 9: canonical section present
if echo "$BODY" | grep -qE '^##[[:space:]]+(Overview|Purpose|Usage|When to use|Instructions|Workflow)'; then
  pass "at least one canonical section present"
else
  err "must include at least one of: ## Overview, ## Purpose, ## Usage, ## When to use, ## Instructions, ## Workflow"
fi

# Check 10: body length
BODY_LINES="$(echo "$BODY" | wc -l | tr -d ' ')"
if [ "$BODY_LINES" -gt 500 ]; then
  err "body is $BODY_LINES lines; must be ≤ 500 (progressive-disclosure ceiling)"
elif [ "$BODY_LINES" -gt 400 ]; then
  warn "body is $BODY_LINES lines; approaching the 500-line ceiling — consider splitting into references/"
else
  pass "body length: $BODY_LINES lines"
fi

# ---------- Supporting files ----------
# Check 11: referenced scripts exist and are executable
SCRIPTS_REFS="$(echo "$BODY_NO_CODE" | grep -oE '\bscripts/[a-zA-Z0-9_/-]+\.(sh|py|js|ts)\b' | sort -u || true)"
if [ -n "$SCRIPTS_REFS" ]; then
  all_ok=1
  while IFS= read -r ref; do
    full="$SKILL_DIR/$ref"
    if [ ! -f "$full" ]; then
      err "referenced script missing: $ref"
      all_ok=0
    elif [ ! -x "$full" ]; then
      err "referenced script not executable: $ref (run chmod +x)"
      all_ok=0
    fi
  done <<< "$SCRIPTS_REFS"
  [ "$all_ok" -eq 1 ] && pass "all referenced scripts exist and are executable"
else
  pass "no bundled scripts referenced"
fi

# Check 12: referenced references/ and assets/ files resolve
OTHER_REFS="$(echo "$BODY_NO_CODE" | grep -oE '\b(references|assets)/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)?\b' | sort -u || true)"
if [ -n "$OTHER_REFS" ]; then
  all_ok=1
  while IFS= read -r ref; do
    full="$SKILL_DIR/$ref"
    if [ ! -f "$full" ]; then
      err "referenced file missing: $ref"
      all_ok=0
    fi
  done <<< "$OTHER_REFS"
  [ "$all_ok" -eq 1 ] && pass "all referenced references/ and assets/ files exist"
fi

# Check 13: markdown links of shape [text](path.ext) — exclude URLs
BROKEN_LINKS=""
while IFS= read -r link; do
  [ -z "$link" ] && continue
  case "$link" in
    http*|mailto:*) ;;
    *) [ ! -f "$SKILL_DIR/$link" ] && BROKEN_LINKS="${BROKEN_LINKS}${link}"$'\n' ;;
  esac
done <<< "$(echo "$BODY_NO_CODE" | grep -oE '\]\([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)?\)' | sed 's/^](//' | sed 's/)$//' | sort -u || true)"
BROKEN_LINKS="${BROKEN_LINKS%$'\n'}"
if [ -n "$BROKEN_LINKS" ]; then
  while IFS= read -r link; do
    err "broken markdown link: $link"
  done <<< "$BROKEN_LINKS"
else
  pass "no broken internal markdown links"
fi

# ---------- Safety ----------
# Check 14: no secret-shaped strings in body
SECRET_HITS="$(echo "$BODY" | grep -nE '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]+PRIVATE KEY-----)' || true)"
if [ -n "$SECRET_HITS" ]; then
  err "possible secret detected in body:"
  echo "$SECRET_HITS" | head -3 | sed 's/^/    /'
else
  pass "no secret-shaped strings in body"
fi

# Check 15: bundled scripts don't write to protected install paths (warn)
if [ -d "$SKILL_DIR/scripts" ]; then
  # shellcheck disable=SC2016
  if grep -rlE '(~/\.claude/skills|\$HOME/\.claude/skills|~/\.config/opencode/skills|\$HOME/\.config/opencode/skills|~/\.agents/skills|\$HOME/\.agents/skills)' "$SKILL_DIR/scripts" 2>/dev/null | grep -v validate-skill.sh | grep -v scaffold-skill.sh > /dev/null; then
    warn "bundled scripts reference install-path skill directories — ensure they are refusal messages, not write targets (edits should be made in source repos)"
  fi
fi

echo
echo "Summary: $PASS_COUNT passed, $WARN_COUNT warnings, $ERR_COUNT errors"
[ "$ERR_COUNT" -eq 0 ]
