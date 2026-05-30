#!/usr/bin/env bash
# Portable Node 20 invocation used by the GUI workspace scripts.
#
# Why this exists: vite/tsc/vitest must run under Node, not Bun. We want to
# prefer nvm-managed Node 20 when present (matches the original CONTRIBUTING
# setup) but not fail outright for fresh-install users who have a system Node
# (homebrew, nodenv, fnm, asdf, plain install).
#
# Resolution order:
#   1. If $HOME/.nvm/nvm.sh exists, source it and `nvm use 20 --silent`.
#   2. Otherwise, use whatever `node` is on PATH, provided its major >= 18.
#   3. If neither works, print a clear hint and exit 1.
#
# Usage:
#   scripts/run-with-node.sh node_modules/vite/bin/vite.js build
#   scripts/run-with-node.sh node_modules/typescript/bin/tsc --noEmit
set -euo pipefail

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 --silent >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found on PATH." >&2
  echo "Install Node 20 (https://nodejs.org/), or via brew: brew install node@20" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "error: Node $NODE_MAJOR.x is too old; agent-smith GUI requires Node >= 18 (20 recommended)." >&2
  echo "Current node: $(command -v node) → $(node --version)" >&2
  exit 1
fi

exec node "$@"
