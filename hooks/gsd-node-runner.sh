#!/bin/sh
# gsd-hook-version: {{GSD_VERSION}}
# gsd-node-runner.sh — GSD portable node resolver (#3662).
#
# Managed JS hook commands under --portable-hooks route through this script:
#
#   bash "<hooks>/gsd-node-runner.sh" "<baked-node-path>" "<script.js>" [args...]
#
# so a config root shared across environments (mounted ~/.claude, shared
# containers) resolves node at hook-fire time instead of depending on the
# absolute path of whichever environment ran the installer. Candidates, in
# order — the first executable one wins:
#
#   1. the first argument — the install-time node path, tried FIRST and by
#      absolute path so the #2979/#3002/#3017/#3022 minimal-PATH guarantee
#      holds (GUI launches with a stripped PATH still resolve where the
#      baked path exists);
#   2. `command -v node`, accepted only when it yields an absolute path;
#   3. the well-known stable layouts: $HOME-derived mise/volta shims, the
#      Homebrew prefixes, /usr/local/bin/node, /usr/bin/node.
#
# No bare `node` lookup is ever depended on: a candidate is used only after
# an explicit executable check, and when nothing resolves this script fails
# visibly (stderr diagnostic naming every candidate tried; exit 2 on
# PreToolUse, exit 1 on any other event — see the failure branch) rather than
# emitting a half-resolved invocation.
#
# [gsd-local] Scope of that guarantee: it covers only the commands that call
# THIS script, which are the managed JS hooks of a global --portable-hooks
# install and the graphify .sh scripts. Every other install emits the inline
# chain token (buildNodeRunnerChainToken) instead. That token is one word
# inside a command substitution and cannot set an exit code, so with no node
# it expands to "" and the hook exits 127: non-blocking, and a PreToolUse
# guard fails OPEN. On this fork the live install MUST pass --portable-hooks
# (ADR-0135, decision b).
#
# The candidate list below is a SUPERSET of the inline chain token emitted by
# buildNodeRunnerChainToken (src/runtime-hooks-surface.cts, #3662) — keep the
# two lists consistent.
#
# Diagnostic escape: GSD_NODE_RUNNER_NO_FALLBACKS=1 disables candidates 2-3
# (first-argument-only resolution) — used by the test suite and useful to
# pin down which node a given environment picks.
set -u

preferred=${1:-}
script=${2:-}
if [ -n "$script" ]; then
  shift 2
elif [ -n "$preferred" ]; then
  shift 1
  preferred=
fi

found=''

# check <path> — record <path> if it is an absolute, executable file.
# Absolute = POSIX root (/*) or a win32 drive-letter path (C:/…), which is
# what the installer bakes on Windows; anything else (a relative `command -v`
# hit under a relative PATH entry, a bare name) is rejected so repo-cwd
# content can never reach the runner slot.
check() {
  case "$1" in
    /*|[A-Za-z]:/*) if [ -x "$1" ]; then found=$1; fi ;;
  esac
  [ -n "$found" ]
}

check "$preferred" || {
  if [ "${GSD_NODE_RUNNER_NO_FALLBACKS:-0}" != "1" ]; then
    path_node=$(command -v node 2>/dev/null || true)
    check "$path_node" ||
      check "${HOME:-}/.local/share/mise/shims/node" ||
      check "${HOME:-}/.volta/bin/node" ||
      check /opt/homebrew/bin/node ||
      check /usr/local/bin/node ||
      check /usr/bin/node ||
      true
  fi
}

if [ -z "$found" ]; then
  tried=${preferred:-<none>}
  if [ "${GSD_NODE_RUNNER_NO_FALLBACKS:-0}" != "1" ]; then
    tried="$tried, command -v node, ${HOME:-}/.local/share/mise/shims/node, ${HOME:-}/.volta/bin/node, /opt/homebrew/bin/node, /usr/local/bin/node, /usr/bin/node"
  fi
  target=${script:-<no script>}
  if [ "$target" = "-e" ]; then
    target='an inline node script (-e)'
  fi
  echo "gsd-node-runner: no usable node found for $target (tried: $tried)" >&2
  # [gsd-local] Claude Code blocks only on exit 2, and on Stop/SubagentStop a
  # block means "keep going" — a missing node there would loop every stop.
  # So exit 2 only on PreToolUse (the guard fails CLOSED), 1 everywhere else.
  # stdin is read on this failure path only: a resolved node gets it untouched.
  # The FIRST hook_event_name key wins: Claude Code sends it before tool_input,
  # and a tool input carrying the same key must not decide the exit code.
  # Pre-tool events recognized: Claude's PreToolUse and Gemini's BeforeTool.
  # Cursor's before* events have other semantics and exit 1.
  event=''
  if [ ! -t 0 ]; then
    event=$(tr -d '\r\n' | grep -o '"hook_event_name"[[:space:]]*:[[:space:]]*"[A-Za-z]*"' | head -n 1 | sed 's/.*"\([A-Za-z]*\)"$/\1/')
  fi
  if [ "$event" = "PreToolUse" ] || [ "$event" = "BeforeTool" ]; then
    exit 2
  fi
  exit 1
fi

exec "$found" "$script" "$@"
