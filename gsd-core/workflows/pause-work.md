@~/.claude/gsd-core/references/response-language-directive.md

<purpose>
Create structured `.planning/HANDOFF.json` and `.continue-here.md` handoff files to preserve complete work state across sessions. The JSON provides machine-readable state for `/gsd:resume-work`; the markdown provides human-readable context.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="detect">
## Context Detection

Determine what kind of work is being paused and set the handoff destination accordingly:

```bash
# Check for active phase
phase=$(ls -t .planning/phases/*/PLAN.md 2>/dev/null | head -1 || true)
phase=${phase:+$(basename "$(dirname "$phase")")}

# Check for active spike
spike=$(ls -t .planning/spikes/*/SPIKE.md .planning/spikes/*/DESIGN.md .planning/spikes/*/README.md 2>/dev/null | head -1 || true)
spike=${spike:+$(basename "$(dirname "$spike")")}

# Check for active sketch
sketch=$(ls -t .planning/sketches/*/README.md .planning/sketches/*/index.html 2>/dev/null | head -1 || true)
sketch=${sketch:+$(basename "$(dirname "$sketch")")}

# Check for active deliberation
deliberation=$(ls .planning/deliberations/*.md 2>/dev/null | head -1 || true)
```

- **Phase work**: active phase directory → handoff to `.planning/phases/XX-name/.continue-here.md`
- **Spike work**: active spike directory or spike-related files (no active phase) → handoff to `.planning/spikes/SPIKE-NNN/.continue-here.md` (create directory if needed)
- **Sketch work**: active sketch directory (no active phase/spike) → handoff to `.planning/sketches/.continue-here.md`
- **Deliberation work**: active deliberation file (no phase/spike/sketch) → handoff to `.planning/deliberations/.continue-here.md`
- **Research work**: research notes exist but no phase/spike/sketch/deliberation → handoff to `.planning/.continue-here.md`
- **Default**: no detectable context → handoff to `.planning/.continue-here.md`, note the ambiguity in `<current_state>`

If phase is detected, proceed with phase handoff path. Otherwise use the first matching non-phase path above.
</step>

<step name="gather">
**Collect complete state for handoff:**

1. **Current position**: Which phase, which plan, which task
2. **Work completed**: What got done this session
3. **Work remaining**: What's left in current plan/phase
4. **Decisions made**: Key decisions and rationale
5. **Blockers/issues**: Anything stuck
6. **Human actions pending**: Things that need manual intervention (MCP setup, API keys, approvals, manual testing)
7. **Background processes**: Any running servers/watchers that were part of the workflow
8. **Files modified**: What's changed but not committed
9. **Outstanding async external jobs**: any `.planning/async-jobs/*.json` manifests for non-terminal jobs — record job id, backend, status, expected artifacts, verification + resume commands, and any watcher/daemon state. Do NOT cancel the external job; it keeps running across the pause.
10. **Blocking constraints**: Anti-patterns or methodological failures encountered during this session that a resuming agent MUST be aware of before proceeding. Only include items discovered through actual failure — not warnings or predictions. Assign each constraint a `severity`:
   - `blocking` — The resuming agent MUST demonstrate understanding before proceeding. The discuss-phase and execute-phase workflows will enforce a mandatory understanding check.
   - `advisory` — Important context but does not gate resumption.

Ask user for clarifications if needed via conversational questions.

**Also inspect SUMMARY.md files for false completions:**
```bash
# Check for placeholder content in existing summaries
grep -l "To be filled\|placeholder\|TBD" .planning/phases/*/*.md 2>/dev/null || true
```
Report any summaries with placeholder content as incomplete items.
</step>

<step name="write_structured">
**Write structured handoff to `.planning/HANDOFF.json`:**

```bash
_GSD_SHIM_NAME="gsd-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}"; _gsd_at() { for _p; do if [ -f "$_p" ]; then GSD_TOOLS="$_p"; return 0; fi; done; return 1; }; _gsd_id_ok() { case "$("$1" runtime-identity --raw 2>/dev/null || true)" in '{"packageName":"@opengsd/gsd-core"'*'}') return 0;; *) return 1;; esac; }; _gsd_homes() { _gsd_at "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/gsd-core/bin/${_GSD_SHIM_NAME}" "${HERMES_HOME:-$HOME/.hermes}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEX_HOME:-$HOME/.codex}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/gsd-core/bin/${_GSD_SHIM_NAME}" "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/gsd-core/bin/${_GSD_SHIM_NAME}" "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/gsd-core/bin/${_GSD_SHIM_NAME}" "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/gsd-core/bin/${_GSD_SHIM_NAME}" "${TRAE_CONFIG_DIR:-$HOME/.trae}/gsd-core/bin/${_GSD_SHIM_NAME}" "${QWEN_CONFIG_DIR:-$HOME/.qwen}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CLINE_CONFIG_DIR:-$HOME/.cline}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GROK_AGENTS_HOME:-$HOME/.agents}/gsd-core/bin/${_GSD_SHIM_NAME}" "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/gsd-core/bin/${_GSD_SHIM_NAME}" "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/gsd-core/bin/${_GSD_SHIM_NAME}" "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/gsd-core/bin/${_GSD_SHIM_NAME}"; }; if _gsd_at "${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.codex/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif _gsd_homes; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif unset -f gsd_run; _G="$(command -v gsd_run)"; [ -n "$_G" ] && _gsd_id_ok "$_G"; then GSD_TOOLS="$_G"; gsd_run() { "$GSD_TOOLS" "$@"; }; else echo "ERROR: gsd-tools.cjs not found at $GSD_TOOLS and no identity-proving gsd_run is on PATH. Run: npx -y @opengsd/gsd-core@latest --claude --local" >&2; exit 1; fi; GSD_IDENTITY_STATUS=unverified; _gsd_id_ok gsd_run && GSD_IDENTITY_STATUS=ok; export GSD_IDENTITY_STATUS; [ "$GSD_IDENTITY_STATUS" = ok ] || echo "WARNING: \"$GSD_TOOLS\" did not prove it is @opengsd/gsd-core - it is either a different package or an @opengsd/gsd-core older than the runtime-identity verb. See docs/how-to/diagnose-a-foreign-gsd-tools.md" >&2; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi; [ "${GSD_SKIP_SDK_WRAP:-0}" != "1" ] && [ -x "${GSD_SDK_WRAPPER:-$HOME/.local/bin/gsd-sdk}" ] && [ -x "$GSD_TOOLS" ] && { _GSD_WRAP="${GSD_SDK_WRAPPER:-$HOME/.local/bin/gsd-sdk}"; _GSD_REAL_TOOLS="$GSD_TOOLS"; gsd_run() { GSD_SDK_REAL="$_GSD_REAL_TOOLS" "$_GSD_WRAP" "$@"; }; }; # [gsd-local] route gsd_run through the Phase 139 effect wrapper when installed
timestamp=$(gsd_run query current-timestamp full --raw)
```

```json
{
  "version": "1.0",
  "timestamp": "{timestamp}",
  "phase": "{phase_number}",
  "phase_name": "{phase_name}",
  "phase_dir": "{phase_dir}",
  "plan": {current_plan_number},
  "task": {current_task_number},
  "total_tasks": {total_task_count},
  "status": "paused",
  "completed_tasks": [
    {"id": 1, "name": "{task_name}", "status": "done", "commit": "{short_hash}"},
    {"id": 2, "name": "{task_name}", "status": "done", "commit": "{short_hash}"},
    {"id": 3, "name": "{task_name}", "status": "in_progress", "progress": "{what_done}"}
  ],
  "remaining_tasks": [
    {"id": 4, "name": "{task_name}", "status": "not_started"},
    {"id": 5, "name": "{task_name}", "status": "not_started"}
  ],
  "blockers": [
    {"description": "{blocker}", "type": "technical|human_action|external", "workaround": "{if any}"}
  ],
  "async_jobs": [
    {"manifest": ".planning/async-jobs/{job}.json", "job_id": "{id}", "backend": "{backend}", "status": "running", "submit_command": "{cmd}", "submitted_at": "{iso8601}", "expected_artifacts": ["..."], "verification_command": "{cmd}", "resume_command": "{cmd}"}
  ],
  "human_actions_pending": [
    {"action": "{what needs to be done}", "context": "{why}", "blocking": true}
  ],
  "decisions": [
    {"decision": "{what}", "rationale": "{why}", "phase": "{phase_number}"}
  ],
  "uncommitted_files": ["XY path", "..."],  # #3968: MEASURED — see below
  "next_action": "{specific first action when resuming}",
  "context_notes": "{mental state, approach, what you were thinking}"
}
```

Any recorded `async_jobs` entries are the primary resume context on the next session — check them first before treating a PLAN-without-SUMMARY as incomplete work.

**`uncommitted_files` is measured, never asserted (#3968).** Populate it from an actual call,
not from memory — a narrated `[]` over a dirty tree is how 14 plans' worth of uncommitted
code went invisible in the wild:
```bash
UNCOMMITTED=$(git status --porcelain)
# One array entry per line ("XY path"); truncate the list at 50 entries and note the
# elided count, but NEVER round it to empty — a non-empty porcelain output is the single
# most load-bearing fact a resume session needs.
```
</step>

<step name="write">
**Write handoff to the path determined in the detect step** (e.g. `.planning/phases/XX-name/.continue-here.md`, `.planning/spikes/SPIKE-NNN/.continue-here.md`, or `.planning/.continue-here.md`):

```markdown
---
context: [phase|spike|sketch|deliberation|research|default]
phase: XX-name
task: 3
total_tasks: 7
status: in_progress
last_updated: [timestamp from current-timestamp]
---

# BLOCKING CONSTRAINTS — Read Before Anything Else

> These are not suggestions. Each constraint below was discovered through failure.
> Acknowledge each one explicitly before proceeding.

- [ ] CONSTRAINT: [name] — [what it is] — [structural mitigation required]

**Do not proceed until all boxes are checked.**

_If no constraints have been identified yet, remove this section._

## Critical Anti-Patterns

| Pattern | Description | Severity | Prevention Mechanism |
|---------|-------------|----------|---------------------|
| [pattern name] | [what it is and how it manifested] | blocking | [structural step that prevents recurrence — not acknowledgment] |
| [pattern name] | [what it is and how it manifested] | advisory | [guidance for avoiding it] |

**Severity values:** `blocking` — resuming agent must pass understanding check before proceeding. `advisory` — important context, does not gate resumption.

_Remove rows that do not apply. The discuss-phase and execute-phase workflows parse this table and enforce a mandatory understanding check for any `blocking` rows._

<current_state>
[Where exactly are we? Immediate context]
</current_state>

<completed_work>

Completed Tasks:
- Task 1: [name] - Done
- Task 2: [name] - Done
- Task 3: [name] - In progress, [what's done]
</completed_work>

<remaining_work>

- Task 3: [what's left]
- Task 4: Not started
- Task 5: Not started
</remaining_work>

<decisions_made>

- Decided to use [X] because [reason]
- Chose [approach] over [alternative] because [reason]
</decisions_made>

<blockers>
- [Blocker 1]: [status/workaround]
</blockers>

## Required Reading (in order)
<!-- List documents the resuming agent must read before acting -->
1. [document] — [why it matters]
1. `.planning/METHODOLOGY.md` (if it exists) — project analytical lenses; apply before any assumption analysis

## Critical Anti-Patterns (do NOT repeat these)
<!-- Mistakes discovered this session that must be structurally avoided -->
- [ANTI-PATTERN]: [what it is] → [structural mitigation]

## Infrastructure State
<!-- Running services, external state, environment specifics -->
- [service/env]: [current state]

## Pre-Execution Critique Required
<!-- Fill in ONLY if pausing between design and execution (e.g. spike design done, not yet run) -->
- Design artifact: [path]
- Critique focus: [key questions the critic should probe]
- Gate: Do NOT begin execution until critique is complete and design is revised

<context>
[Mental state, what were you thinking, the plan]
</context>

<next_action>
Start with: [specific first action when resuming]
</next_action>
```

Be specific enough for a fresh Claude to understand immediately.

Use `current-timestamp` for last_updated field. You can use init todos (which provides timestamps) or call directly:
```bash
timestamp=$(gsd_run query current-timestamp full --raw)
```
</step>

<step name="commit">
```bash
gsd_run query commit "wip: [context-name] paused at [X]/[Y]" --files [handoff-path] .planning/HANDOFF.json
```
</step>

<step name="confirm">
```
[If pending lessons > 0 (count=$(grep -c "<!-- hash:" ~/.aria/pending-lessons.md 2>/dev/null || echo 0)):]
⚠️ N lessons pendentes — /lesson antes de pausar?

<!-- cwd-resolution-start -->
Resolve project root: run the following bash commands and capture PROJECT_ROOT.

```bash
. "$HOME/.claude/hooks/gsd-find-project-root.sh"
find_gsd_project_root "${CLAUDE_CWD:-$(pwd)}"
```

After running: if PROJECT_ROOT is empty, print `⚠️ pause-work: project root not found — memory mapper and VPS sync skipped` and skip all blocks through vps-sync-end.

Store PROJECT_ROOT as the absolute path to use in all subsequent .planning/ reads.
<!-- cwd-resolution-end -->

<!-- memory-mapper-start -->
Detect project name: run `python3 -c "import json,pathlib,sys; d=json.loads(pathlib.Path(sys.argv[1]).read_text()); print(d['project']['name'])" "$PROJECT_ROOT/.planning/config.json"`. If `.planning/config.json` does not exist or the `project.name` key is missing, set name to empty string and skip the entire mapper block silently (non-blocking).

If name is non-empty, resolve memory file: check whether `~/.claude/projects/-home-hidekina-projetos/memory/project_<name>.md` exists. If yes, set `_gsd_memory_file` to that path. If not, check `~/.claude/projects/-home-hidekina-projetos/memory/<name>.md`. If that exists, set `_gsd_memory_file` to that path. If neither exists, create `~/.claude/projects/-home-hidekina-projetos/memory/project_<name>.md` with the following content and set `_gsd_memory_file` to that path:

```
---
name: <name>
description: "<name> project context"
type: project
last_updated: <today YYYY-MM-DD>
---

# <name>

*Memory file created automatically by pause-work on <today YYYY-MM-DD>.*
```

After resolving or creating the file, check `~/.claude/projects/-home-hidekina-projetos/memory/MEMORY.md` for an existing entry matching `project_<name>` or `(<name>)`. If no match found, append the following line to MEMORY.md:

`- [project_<name>](memory/project_<name>.md) — <name> project context`

Do not add a duplicate if any matching entry already exists. Store the resolved path as `_gsd_memory_file` for use by subsequent steps (progress sync and VPS sync below).

Any exception in the above logic must print `⚠️ Memory mapper failed: <brief reason>` and continue — this block is non-blocking.
<!-- memory-mapper-end -->

<!-- progress-sync-start -->
If `_gsd_memory_file` is empty or unset (mapper was skipped), skip this entire block silently.

Otherwise, open `.planning/STATE.md`. If the file does not exist, print `⚠️ Progress sync skipped — STATE.md not found` and skip to end of block.

Extract the following fields from STATE.md:
- `phase`: the phase identifier from the `## Current Focus` or `## Current Position` section (e.g. `03-hook-pause-work-memory-sync`)
- `plan`: current plan number from the same section
- `progress`: percentage or fraction from the `progress:` frontmatter field or `## Progress` section (e.g. `2/5 phases (40%)`)
- `next`: first meaningful line from `## Next Action`, `## What's Next`, or the `## Current Focus` next-step line (fallback: `"See STATE.md"`)

Get timestamp: `python3 -c "from datetime import datetime; print(datetime.now().strftime('%Y-%m-%d %H:%M'))"`.

Append the following block to the end of `_gsd_memory_file`:

```
(blank line)
## Session Sync [TIMESTAMP]
- Phase: PHASE
- Plan: PLAN
- Progress: PROGRESS
- Next: NEXT
```

Then bump `last_updated` in the memory file frontmatter: read the file, replace the `last_updated:` value between the leading `---` delimiters with today's date (`python3 -c "from datetime import date; print(date.today())"`) using a python3 inline substitution. If `last_updated` is absent from frontmatter, insert `last_updated: YYYY-MM-DD` as the last line before the closing `---`. Write the file back.

Emit `✓ Memory synced: <basename of _gsd_memory_file>` (e.g. `✓ Memory synced: project_claude-harness.md`).

Any file I/O failure must print `⚠️ Memory sync failed: <brief reason>` and continue — this block is non-blocking.
<!-- progress-sync-end -->

<!-- rich-enrichment-start -->
If `_gsd_memory_file` is empty or unset (mapper was skipped), skip this entire block silently.

Collect the following fields in sequence — each sub-step is non-blocking (failures fall back to "none"):

**1. Branch (RICH-01):**
Run `git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null`. If output is empty, use "unknown".

**2. Open PRs (RICH-01):**
Get `REMOTE_URL` via `git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null`. If empty, set PR_LINES to "none". Otherwise check if REMOTE_URL contains "github.com" (case-insensitive) — if not, set PR_LINES to "none". If yes:
- Extract REPO_SLUG: `echo "$REMOTE_URL" | sed 's|git@github.com:||; s|https://github.com/||; s|\.git$||'`
- Run `gh pr list --json number,title,state --repo "$REPO_SLUG" --limit 10 2>/dev/null || echo "[]"`
- Use python3 to parse JSON and format as markdown lines: `- #N — title (state)`. If list is empty, use "none".

**3. Stack (RICH-01):**
Check for manifests in PROJECT_ROOT in this order: `package.json` → `pyproject.toml` → `Cargo.toml` → `go.mod`.
- `package.json`: use python3 to read `dependencies` + `devDependencies`, filter out `@types/` prefixes and pure tooling packages (eslint, prettier, typescript, vitest, jest, ts-node), return top 10 as comma-separated string.
- `pyproject.toml`: `grep -E '^\s*(fastapi|django|flask|sqlalchemy|pydantic)' "$PROJECT_ROOT/pyproject.toml" | head -8 | tr '\n' ', '`
- `Cargo.toml`: `grep -A 50 '\[dependencies\]' "$PROJECT_ROOT/Cargo.toml" | grep -E '^[a-z]' | cut -d' ' -f1 | head -8 | tr '\n' ', '`
- `go.mod`: `grep '^module\|require' "$PROJECT_ROOT/go.mod" | head -5 | tr '\n' ' '`
If no manifest found or extraction returns empty, use "unknown".

**4. Blocked tasks (RICH-02):**
Use python3 with `sys.argv` to read `STATE.md`:
```
python3 - "$PROJECT_ROOT" <<'PYEOF'
import sys, re, pathlib
project_root = sys.argv[1]
state_path = pathlib.Path(project_root) / ".planning" / "STATE.md"
try:
    state = state_path.read_text()
    m = re.search(r'^## Blockers\s*\n(.*?)(?=^## |\Z)', state, re.MULTILINE | re.DOTALL)
    if m:
        lines = [l.strip() for l in m.group(1).splitlines() if l.strip() and l.strip() not in ('Nenhum.', 'None.', '—', '-')]
        print('\n'.join(f'- {l.lstrip("- ")}' for l in lines) if lines else 'none')
    else:
        print('none')
except Exception as e:
    print('none')
PYEOF
```
If output is empty or "none", BLOCKED_LINES = "none".

**5. Last 3 decisions (RICH-02):**
Use python3 with `sys.argv` to read `STATE.md`:
```
python3 - "$PROJECT_ROOT" <<'PYEOF'
import sys, re, pathlib
project_root = sys.argv[1]
state_path = pathlib.Path(project_root) / ".planning" / "STATE.md"
PLACEHOLDERS = {'(none yet — roadmap just created)', '(none)', '(none yet)'}
try:
    state = state_path.read_text()
    m = re.search(r'^## Key Decisions\s*\n(.*?)(?=^## |\Z)', state, re.MULTILINE | re.DOTALL)
    if m:
        lines = [l.strip() for l in m.group(1).splitlines() if l.strip().startswith('- ') and l.strip() not in PLACEHOLDERS]
        last3 = lines[-3:]
        print('\n'.join(last3) if last3 else 'none')
    else:
        print('none')
except Exception as e:
    print('none')
PYEOF
```
If output is empty or "none", DECISION_LINES = "none".

**Write Rich Context to memory file:**

Get timestamp: `python3 -c "from datetime import datetime; print(datetime.now().strftime('%Y-%m-%d %H:%M'))"`.

Build the new section:
```
<!-- rich-start -->
## Rich Context [TIMESTAMP]

**Branch:** BRANCH
**Stack:** STACK
**Open PRs:**
PR_LINES

**Blocked Tasks:**
BLOCKED_LINES

**Last 3 Decisions:**
DECISION_LINES
<!-- rich-end -->
```

Use python3 with `sys.argv` to write idempotently to the memory file:
```
python3 - "$_gsd_memory_file" "$NEW_SECTION" <<'PYEOF'
import sys, re, pathlib
mem_file = sys.argv[1]
new_section = sys.argv[2]
try:
    content = pathlib.Path(mem_file).read_text()
    if re.search(r'<!-- rich-start -->', content):
        updated = re.sub(r'<!-- rich-start -->.*?<!-- rich-end -->', new_section, content, flags=re.DOTALL)
    else:
        updated = content.rstrip() + '\n\n' + new_section + '\n'
    pathlib.Path(mem_file).write_text(updated)
    print(f'✓ Rich context updated: {pathlib.Path(mem_file).name}')
except Exception as e:
    print(f'⚠️ Rich enrichment failed: {e}')
PYEOF
```

Emit the output of the python3 command above (either `✓ Rich context updated: <basename>` or `⚠️ Rich enrichment failed: <reason>`).

Any failure in any sub-step must be caught (try/except in python3, `|| echo "none"` in bash) — the entire block is non-blocking and must not interrupt pause-work execution.
<!-- rich-enrichment-end -->

<!-- vps-sync-start -->
Detect VPS config using two checks:
- Check A: `python3 -c "import json,pathlib,sys; d=json.loads(pathlib.Path(sys.argv[1]).read_text()); print('yes' if 'vps' in d else 'no')" "$PROJECT_ROOT/.planning/config.json"` — prints `yes` if top-level `vps` key exists.
- Check B: `grep -rl "VPS\|vps:" .planning/phases/ 2>/dev/null` — returns matching files if VPS appears in any CONTEXT.md.

If neither check finds VPS config, skip the entire block silently (non-VPS project).

If VPS config is detected, extract SSH connection details from `.planning/config.json` `vps` object: `host`, `port` (default `22` if absent), `user` (default `root` if absent). If config.json has no `vps` key but the grep check matched, print `⚠️ VPS config detected in CONTEXT.md but no ssh details in config.json — snapshot skipped` and skip.

Run SSH snapshot with timeout: `ssh -o ConnectTimeout=5 -o BatchMode=yes -p PORT USER@HOST "docker ps --format '{{.Names}}\t{{.Status}}'" 2>&1`. If the command exits non-zero or the output contains `Connection refused`, `Connection timed out`, or `Permission denied`, print `⚠️ VPS snapshot skipped — SSH unreachable (HOST:PORT)` and skip.

On success, get timestamp via `python3 -c "from datetime import datetime; print(datetime.now().strftime('%Y-%m-%d %H:%M'))"` and append the following to `~/.claude/projects/-home-hidekina-projetos/memory/vps-apps-status.md`:

```
(blank line)
## VPS Snapshot [TIMESTAMP] — PROJECT_NAME
RAW_DOCKER_PS_OUTPUT
```

Where PROJECT_NAME = `project.name` from config.json (or empty if unavailable).

Emit `✓ VPS snapshot saved: vps-apps-status.md` on success.

Any exception must print `⚠️ VPS sync failed: <brief reason>` and continue — this block is non-blocking.
<!-- vps-sync-end -->

✓ Handoff created:
  - .planning/HANDOFF.json (structured, machine-readable)
  - [handoff-path] (human-readable)

Current state:

- Context: [phase|spike|deliberation|research]
- Location: [XX-name or SPIKE-NNN]
- Task: [X] of [Y]
- Status: [in_progress/blocked]
- Blockers: [count] ({human_actions_pending count} need human action)
- Committed as WIP

To resume: /gsd:resume-work

```
</step>

</process>

<success_criteria>
- [ ] Context detected (phase/spike/deliberation/research/default)
- [ ] .continue-here.md created at correct path for detected context
- [ ] Required Reading, Anti-Patterns, and Infrastructure State sections filled
- [ ] Pre-Execution Critique section filled if pausing between design and execution
- [ ] Committed as WIP
- [ ] User knows location and how to resume
</success_criteria>
