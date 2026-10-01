#!/usr/bin/env bash
# gsd-hook-version: {{GSD_VERSION}}
# gsd-session-state.sh — SessionStart hook: inject project state reminder
# Outputs STATE.md head on every session start for orientation.
#
# OPT-IN: This hook is a no-op unless config.json has hooks.community: true.
# Enable with: "hooks": { "community": true } in .planning/config.json
set -euo pipefail

# [gsd-local] every node call goes through the node runner, never a bare
# `node`, so a minimal hook PATH still resolves one. The installer stamps the
# install-time node here; unstamped, the runner falls through to its
# fallbacks. GSD_NODE (env, optional) overrides it for this script only.
# Failure semantics are unchanged: this hook is advisory.
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
GSD_NODE_BAKED={{GSD_NODE_TOKEN}}
gsd_node() { "${BASH:-sh}" "$HOOK_DIR/gsd-node-runner.sh" "${GSD_NODE:-$GSD_NODE_BAKED}" "$@"; }

# Resolve project root via upward traversal (AUTO-01 / AUTO-02) — [gsd-local]
CWD="${CLAUDE_CWD:-$(pwd)}"
. "$HOOK_DIR/lib/gsd-find-project-root.sh"   # [gsd-local] GSD-owned copy in hooks/lib (gsd-core#3)
# Not found returns 1, and under set -e that ended the hook with exit 1 before the
# empty-root check ran: every edit outside a GSD project showed a hook error.
find_gsd_project_root "$CWD" 2>/dev/null || exit 0

# Check opt-in config — exit silently if not enabled
GSD_CFG="$PROJECT_ROOT/.planning/config.json"   # passed by env, never pasted into JS source
export GSD_CFG
ENABLED=$(gsd_node -e "try{const c=require(process.env.GSD_CFG);process.stdout.write(c.hooks?.community===true?'1':'0')}catch{process.stdout.write('0')}" 2>/dev/null)
[ "$ENABLED" != "1" ] && exit 0

# Build the additionalContext text and emit it as a structured JSON
# envelope per the Claude Code SessionStart hook protocol (#2974). Tests
# parse the JSON and assert on typed fields (state_present: bool,
# config_mode: string, etc) rather than substring-matching free-form text.
STATE_PRESENT="false"
STATE_HEAD=""
if [ -f "$PROJECT_ROOT/.planning/STATE.md" ]; then
  STATE_PRESENT="true"
  STATE_HEAD=$(head -20 "$PROJECT_ROOT/.planning/STATE.md")
fi

CONFIG_MODE="unknown"
if [ -f "$PROJECT_ROOT/.planning/config.json" ]; then
  CONFIG_MODE=$(gsd_node -e "try{const c=require(process.env.GSD_CFG);process.stdout.write(String(c.mode||'unknown'))}catch{process.stdout.write('unknown')}" 2>/dev/null)
fi

# Build watchPaths list — only include files that exist at session start
WATCH_PATHS=()
[ -f "$PROJECT_ROOT/.planning/STATE.md" ] && WATCH_PATHS+=("$PROJECT_ROOT/.planning/STATE.md")
[ -f "$PROJECT_ROOT/.planning/ROADMAP.md" ] && WATCH_PATHS+=("$PROJECT_ROOT/.planning/ROADMAP.md")
[ -f "$HOME/.claude/settings.json" ] && WATCH_PATHS+=("$HOME/.claude/settings.json")
WATCH_JSON=$(printf '%s\n' "${WATCH_PATHS[@]}" | python3 -c "import sys,json; lines=[l.rstrip() for l in sys.stdin if l.strip()]; print(json.dumps(lines))" 2>/dev/null || echo "[]")

# Use Node for JSON encoding so embedded newlines/quotes are escaped correctly.
# additionalContext is the text Claude Code injects at session start; the
# typed fields (state_present, config_mode) let tests assert on the
# structured contract without grepping the prose.
gsd_node -e '
  const [statePresent, stateHead, configMode, watchJson] = process.argv.slice(1);
  const headerLines = ["## Project State Reminder", ""];
  if (statePresent === "true") {
    headerLines.push("STATE.md exists - check for blockers and current phase.");
    if (stateHead) headerLines.push(stateHead);
  } else {
    headerLines.push("No .planning/ found - suggest /gsd-new-project if starting new work.");
  }
  headerLines.push("");
  headerLines.push("Config: \"mode\": \"" + configMode + "\"");
  const additionalContext = headerLines.join("\n");
  const watchPaths = JSON.parse(watchJson || "[]");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
      state_present: statePresent === "true",
      config_mode: configMode,
    },
    watchPaths,
  }));
' "$STATE_PRESENT" "$STATE_HEAD" "$CONFIG_MODE" "$WATCH_JSON"

exit 0
