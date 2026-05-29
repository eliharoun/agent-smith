#!/usr/bin/env bash
#
# scaffold-skill.sh — create a new agent skill directory structure
#
# Usage: scaffold-skill.sh [-y] <skill-name> [target-parent-dir]
#
#   -y                  non-interactive; do not prompt on overwrite
#   <skill-name>        lowercase-kebab; validated against spec regex
#   [target-parent-dir] optional. If omitted: uses $(pwd)/skills if it exists,
#                       otherwise walks up looking for the nearest skills/
#                       ancestor; if none found, creates $(pwd)/skills.
#
# Refuses to write into agent install directories (~/.claude/skills,
# ~/.config/opencode/skills, ~/.agents/skills). Always work in your source
# repo and link or copy the result into install paths.
#
# Exits: 0 success | 1 validation or write failure | 2 usage error

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

# Locate the template relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/../assets/SKILL.md.template"

NON_INTERACTIVE=0
if [ "${1:-}" = "-y" ]; then
  NON_INTERACTIVE=1
  shift
fi

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  usage
fi

SKILL_NAME="$1"
TARGET_PARENT="${2:-}"

# Validate skill name against spec regex
if ! [[ "$SKILL_NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  error "invalid skill name: '$SKILL_NAME'"
  error "must be lowercase alphanumeric with single hyphens, no leading/trailing/consecutive hyphens"
  exit 1
fi
if [ "${#SKILL_NAME}" -gt 64 ]; then
  error "skill name must be at most 64 characters"
  exit 1
fi

# Resolve target parent directory
resolve_target_parent() {
  if [ -n "$TARGET_PARENT" ]; then
    echo "$TARGET_PARENT"
    return
  fi
  local cwd; cwd="$(pwd)"
  if [ -d "$cwd/skills" ]; then
    echo "$cwd/skills"
    return
  fi
  local dir="$cwd"
  while [ "$dir" != "/" ]; do
    dir="$(dirname "$dir")"
    if [ -d "$dir/skills" ]; then
      echo "$dir/skills"
      return
    fi
  done
  echo "$cwd/skills"
}

TARGET_PARENT_RESOLVED="$(resolve_target_parent)"

# Safety: refuse agent install paths
case "$TARGET_PARENT_RESOLVED/" in
  "$HOME/.claude/"*|"$HOME/.config/opencode/"*|"$HOME/.agents/"*)
    error "refuses to write under '$TARGET_PARENT_RESOLVED'"
    error "this is an agent install directory; edits should happen in your source repo"
    error "create the skill in your repo, then symlink or copy it into the install path"
    exit 1
    ;;
esac

TARGET_DIR="${TARGET_PARENT_RESOLVED}/${SKILL_NAME}"

# Overwrite check
if [ -e "$TARGET_DIR" ]; then
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    warn "directory '$TARGET_DIR' exists; -y given, will overwrite"
    rm -rf "$TARGET_DIR"
  else
    echo -n "Directory '$TARGET_DIR' exists. Overwrite? [y/N] "
    read -r answer
    if [ "${answer:-n}" != "y" ] && [ "${answer:-n}" != "Y" ]; then
      error "aborted by user"
      exit 1
    fi
    rm -rf "$TARGET_DIR"
  fi
fi

# Create structure
mkdir -p "$TARGET_DIR/scripts" "$TARGET_DIR/references"

# Render template with name substitution
if [ ! -f "$TEMPLATE" ]; then
  error "template not found at '$TEMPLATE'"
  exit 1
fi
sed "s/{{NAME}}/${SKILL_NAME}/g" "$TEMPLATE" > "$TARGET_DIR/SKILL.md"

info "created ${TARGET_DIR}/"
info "next: edit ${TARGET_DIR}/SKILL.md to fill in the TODOs"
info "then: run validate-skill.sh ${TARGET_DIR}"
