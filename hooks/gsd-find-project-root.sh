#!/usr/bin/env bash
# gsd-hook-version: {{GSD_VERSION}}
# gsd-find-project-root.sh — [gsd-local] shipped with the hooks that source it (gsd-core#3).
# Source this file (. helper.sh), do NOT execute. Defines find_gsd_project_root().
# After call: $PROJECT_ROOT (absolute path, or "" if not found) and $PROJECT_NAME (or "unknown")
#
# Usage in hooks:
#   . "$HOOK_DIR/gsd-find-project-root.sh"   # beside the hook, never a runtime-specific $HOME path
#   find_gsd_project_root "${CLAUDE_CWD:-$(pwd)}"
#   [ -z "$PROJECT_ROOT" ] && exit 0
#
# T-09-02 mitigation: [ "$parent" = "$search" ] && break — prevents infinite loop at filesystem root.
# T-09-03 note: 4-level cap avoids ancestor project collision; projects nested >4 levels deep are
# expected to be ≤2 levels from their own .planning/. A smarter "prefer closer root" heuristic is
# deferred if ancestor collisions prove problematic in practice.

find_gsd_project_root() {
  local start="${1:-${CLAUDE_CWD:-$(pwd)}}"
  local search="$start"
  local depth=0
  PROJECT_ROOT=""
  PROJECT_NAME="unknown"

  while [ "$depth" -le 4 ]; do
    if [ -f "$search/.planning/config.json" ]; then
      PROJECT_ROOT="$search"
      PROJECT_NAME=$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    name = d.get('project', {}).get('name', '')
    print(name if name else '')
except Exception:
    print('')
" "$search/.planning/config.json" 2>/dev/null || echo "")
      if [ -z "$PROJECT_NAME" ]; then
        PROJECT_NAME=$(basename "$search")
      fi
      return 0
    fi
    local parent
    parent=$(dirname "$search")
    [ "$parent" = "$search" ] && break  # reached filesystem root
    search="$parent"
    depth=$((depth + 1))
  done

  echo "[gsd] projeto=unknown — .planning/config.json not found within 4 levels of $start" >&2
  return 1
}
