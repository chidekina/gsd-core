#!/usr/bin/env bash
# gsd-hook-version: {{GSD_VERSION}}
# gsd-phase-boundary.sh — PostToolUse hook: detect .planning/ file writes
# Outputs a reminder when planning files are modified outside normal workflow.
# Uses Node.js for JSON parsing (always available in GSD projects, no jq dependency).
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

# Resolve project root via upward traversal (AUTO-01 / AUTO-02)
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

INPUT=$(cat)

# Extract file_path from JSON using Node (handles escaping correctly).
# #2304: Kimi CLI registers this hook with matcher 'WriteFile|StrReplaceFile'
# and its file tools name the field `path`, not `file_path` (kimi-cli
# src/kimi_cli/tools/file/write.py + replace.py) — fall back to tool_input.path
# when file_path is absent, mirroring normalizeKimiPayload in the JS guards.
# #2752: `path` is AUTHORITATIVE (kimi-cli executes on it; it sends `path` only,
# never `file_path`). `file_path` is model-controlled on Kimi, so consulting it
# first let a model-supplied decoy suppress/fabricate the reminder. `path` wins,
# `file_path` is the fallback (Claude Code emits `file_path` and no `path`, so the
# fallback must remain). The JS guards reach the same "path authoritative" outcome
# via an upstream normalizeKimiPayload step (copies path→file_path before any guard
# reads); this shell hook parses tool_input once, raw, so it applies the precedence
# directly at the read site.
FILE=$(echo "$INPUT" | gsd_node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const i=JSON.parse(d).tool_input||{};process.stdout.write((typeof i.path==='string'&&i.path)||(typeof i.file_path==='string'&&i.file_path)||'')}catch{}})" 2>/dev/null)

# Emit a structured JSON envelope (#2974). additionalContext carries the
# user-visible reminder text; the typed `planning_modified` boolean and
# `file_path` let tests assert on the structured contract without grepping.
PLANNING_MODIFIED="false"
if [[ "$FILE" == *.planning/* ]] || [[ "$FILE" == .planning/* ]]; then
  PLANNING_MODIFIED="true"
fi

if [ "$PLANNING_MODIFIED" = "true" ]; then
  gsd_node -e '
    const file = process.argv[1];
    const additionalContext = ".planning/ file modified: " + file + "\n" +
      "Check: Should STATE.md be updated to reflect this change?";
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext,
        planning_modified: true,
        file_path: file,
      },
    }));
  ' "$FILE"
fi

exit 0
