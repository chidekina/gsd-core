@~/.claude/gsd-core/references/response-language-directive.md

<trigger>
Use this workflow when:
- Starting a new session on an existing project
- User says "continue", "what's next", "where were we", "resume"
- Any planning operation when .planning/ already exists
- User returns after time away from project
</trigger>

<purpose>
Instantly restore full project context so "Where were we?" has an immediate, complete answer.
</purpose>

@~/.claude/gsd-core/references/brd-spec-context.md
<required_reading>
@~/.claude/gsd-core/references/continuation-format.md
</required_reading>

<process>

<step name="initialize">
Load all context in one call:

```bash
_GSD_SHIM_NAME="gsd-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}"; _gsd_at() { for _p; do if [ -f "$_p" ]; then GSD_TOOLS="$_p"; return 0; fi; done; return 1; }; _gsd_id_ok() { case "$("$1" runtime-identity --raw 2>/dev/null || true)" in '{"packageName":"@opengsd/gsd-core"'*'}') return 0;; *) return 1;; esac; }; _gsd_homes() { _gsd_at "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/gsd-core/bin/${_GSD_SHIM_NAME}" "${HERMES_HOME:-$HOME/.hermes}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEX_HOME:-$HOME/.codex}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/gsd-core/bin/${_GSD_SHIM_NAME}" "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/gsd-core/bin/${_GSD_SHIM_NAME}" "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/gsd-core/bin/${_GSD_SHIM_NAME}" "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/gsd-core/bin/${_GSD_SHIM_NAME}" "${TRAE_CONFIG_DIR:-$HOME/.trae}/gsd-core/bin/${_GSD_SHIM_NAME}" "${QWEN_CONFIG_DIR:-$HOME/.qwen}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CLINE_CONFIG_DIR:-$HOME/.cline}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GROK_AGENTS_HOME:-$HOME/.agents}/gsd-core/bin/${_GSD_SHIM_NAME}" "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/gsd-core/bin/${_GSD_SHIM_NAME}" "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/gsd-core/bin/${_GSD_SHIM_NAME}" "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/gsd-core/bin/${_GSD_SHIM_NAME}"; }; if _gsd_at "${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.codex/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif _gsd_homes; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif unset -f gsd_run; _G="$(command -v gsd_run)"; [ -n "$_G" ] && _gsd_id_ok "$_G"; then GSD_TOOLS="$_G"; gsd_run() { "$GSD_TOOLS" "$@"; }; else echo "ERROR: gsd-tools.cjs not found at $GSD_TOOLS and no identity-proving gsd_run is on PATH. See the fork README (https://github.com/chidekina/gsd-core, branch local): install the fork tarball, never an upstream npx" >&2; exit 1; fi; GSD_IDENTITY_STATUS=unverified; _gsd_id_ok gsd_run && GSD_IDENTITY_STATUS=ok; export GSD_IDENTITY_STATUS; [ "$GSD_IDENTITY_STATUS" = ok ] || echo "WARNING: \"$GSD_TOOLS\" did not prove it is @opengsd/gsd-core - it is either a different package or an @opengsd/gsd-core older than the runtime-identity verb. See docs/how-to/diagnose-a-foreign-gsd-tools.md" >&2; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi; [ "${GSD_SKIP_SDK_WRAP:-0}" != "1" ] && [ -x "${GSD_SDK_WRAPPER:-$HOME/.local/bin/gsd-sdk}" ] && [ -x "$GSD_TOOLS" ] && { _GSD_WRAP="${GSD_SDK_WRAPPER:-$HOME/.local/bin/gsd-sdk}"; _GSD_REAL_TOOLS="$GSD_TOOLS"; gsd_run() { GSD_SDK_REAL="$_GSD_REAL_TOOLS" "$_GSD_WRAP" "$@"; }; }; # [gsd-local] route gsd_run through the Phase 139 effect wrapper when installed
INIT=$(gsd_run query init.resume)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `state_exists`, `roadmap_exists`, `project_exists`, `planning_exists`, `requirements_exists`, `init_incomplete`, `has_interrupted_agent`, `interrupted_agent_id`, `commit_docs`.

**If `init_incomplete` is true (#4040 — interrupted bootstrap):** `.planning/` exists but initialization never finished — one or more of `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` were never created. This is NOT a STATE.md-reconstruction case (there is no project history to reconstruct from). Route to initialization recovery: resume `/gsd:new-project`, which continues from the first missing artifact and keeps the existing PROJECT.md and any already-created artifacts. Do not proceed to load_state.

**If `state_exists` is true:** Proceed to load_state
**If `state_exists` is false but `roadmap_exists` or `project_exists` is true (and `init_incomplete` is false):** Offer to reconstruct STATE.md
**If `planning_exists` is false:** This is a new project - route to /gsd:new-project
</step>

<step name="load_state">

Read and parse STATE.md, then PROJECT.md:

```bash
cat .planning/STATE.md
cat .planning/PROJECT.md
```

**From STATE.md extract:**

- **Project Reference**: Core value and current focus
- **Current Position**: Phase X of Y, Plan A of B, Status
- **Progress**: Visual progress bar
- **Recent Decisions**: Key decisions affecting current work
- **Pending Todos**: Ideas captured during sessions
- **Blockers/Concerns**: Issues carried forward
- **Session Continuity**: Where we left off, any resume files

**From PROJECT.md extract:**

- **What This Is**: Current accurate description
- **Requirements**: Validated, Active, Out of Scope
- **Key Decisions**: Full decision log with outcomes
- **Constraints**: Hard limits on implementation

</step>

<step name="check_incomplete_work">
Look for incomplete work that needs attention:

```bash
# #2962: zsh aborts the block on an unmatched for-list glob (nomatch); bash passes it through. nullglob both.
shopt -s nullglob 2>/dev/null; setopt NULL_GLOB 2>/dev/null

# Check for structured handoff (preferred — machine-readable)
cat .planning/HANDOFF.json 2>/dev/null || true

# Check for continue-here files (phase + non-phase + legacy fallback).
# Use `find` rather than a chained `ls` of bare globs: under zsh's default
# NOMATCH option (macOS default shell), a single non-matching glob aborts
# the entire command during word-expansion — silently dropping every
# pattern after the first miss, including `.planning/.continue-here*.md`.
# `find` does not use shell glob expansion and tolerates absent
# directories on both bash and zsh.
find .planning -maxdepth 3 -name '.continue-here*.md' -print 2>/dev/null || true
find . -maxdepth 1 -name '.continue-here*.md' -print 2>/dev/null || true

# Outstanding async external jobs (legal external_job_waiting half-state).
# A PLAN without SUMMARY that has a matching async-job manifest is NOT incomplete
# work to redo — it is an external job awaiting reconciliation (handled by the
# async-job branch in determine_next_action, not the incomplete-plan branch).
find .planning/async-jobs -maxdepth 1 -name '*.json' -print 2>/dev/null || true

# Check for plans without summaries (incomplete execution)
for plan in .planning/phases/*/*-PLAN.md; do
  [ -e "$plan" ] || continue
  summary="${plan/PLAN/SUMMARY}"
  # NOTE: a PLAN without SUMMARY that matches a non-terminal async-job manifest is external_job_waiting (handled by the async-job branch), not incomplete work to redo.
  [ ! -f "$summary" ] && echo "Incomplete: $plan"
done 2>/dev/null || true

# Check for interrupted agents (use has_interrupted_agent and interrupted_agent_id from init)
if [ "$has_interrupted_agent" = "true" ]; then
  echo "Interrupted agent: $interrupted_agent_id"
fi
```

**If HANDOFF.json exists:**

- This is the primary resumption source — structured data from `/gsd:pause-work`
- Parse `status`, `phase`, `plan`, `task`, `total_tasks`, `next_action`
- Check `blockers` and `human_actions_pending` — surface these immediately
- Check `completed_tasks` for `in_progress` items — these need attention first
- Validate `uncommitted_files` against `git status` — flag divergence
- Use `context_notes` to restore mental model
- Flag: "Found structured handoff — resuming from task {task}/{total_tasks}"
- **After successful resumption, delete HANDOFF.json** (it's a one-shot artifact)

**If .continue-here file exists (phase/non-phase/legacy fallback):**

- This is a mid-plan resumption point
- Read the file for specific resumption context
- Flag: "Found mid-plan checkpoint"

**If PLAN without SUMMARY exists:**

- Execution was started but not completed
- Flag: "Found incomplete plan execution"

**If interrupted agent found:**

- Subagent was spawned but session ended before completion
- Read agent-history.json for task details
- Flag: "Found interrupted agent"
  </step>

<step name="present_status">
Present complete project status to user:

**Memory context block (per D-01 through D-16)**

Before rendering the status box, execute the following memory-loading sequence. All steps are non-blocking — any error emits the "none" line and continues.

1. **Read project name (per D-14):**

   ```bash
   PROJECT_NAME=$(python3 -c "import json,sys; d=json.load(open('.planning/config.json')); print(d.get('project',{}).get('name',''))" 2>/dev/null || echo "")
   ```

   If `PROJECT_NAME` is empty (config.json missing, has no `project.name`, or python3 fails), skip the entire memory block silently and proceed to the status box.

2. **Resolve memory file (per D-15):**

   ```bash
   MEMDIR="$HOME/.claude/projects/-home-hidekina-projetos/memory"
   MEMFILE=""
   if [ -f "$MEMDIR/project_${PROJECT_NAME}.md" ]; then
     MEMFILE="$MEMDIR/project_${PROJECT_NAME}.md"
     MEMFILENAME="project_${PROJECT_NAME}.md"
   elif [ -f "$MEMDIR/${PROJECT_NAME}.md" ]; then
     MEMFILE="$MEMDIR/${PROJECT_NAME}.md"
     MEMFILENAME="${PROJECT_NAME}.md"
   fi
   ```

3. **Calculate age (per D-07):**

   If `MEMFILE` is set, extract `last_updated` from frontmatter:

   ```bash
   LAST_UPDATED=$(python3 -c "import re,sys; lines=open('$MEMFILE').readlines()[:10]; m=[re.search(r'last_updated:\s*(\S+)',l) for l in lines]; print(next((x.group(1) for x in m if x),''))" 2>/dev/null || echo "")
   ```

   If `LAST_UPDATED` is a valid YYYY-MM-DD date, compute age in days:

   ```bash
   AGE_DAYS=$(python3 -c "from datetime import date; print((date.today()-date.fromisoformat('$LAST_UPDATED')).days)" 2>/dev/null || echo "")
   ```

   If `LAST_UPDATED` is empty or parse fails, fall back to mtime:

   ```bash
   AGE_DAYS=$(python3 -c "import os,datetime; s=os.stat('$MEMFILE'); print((datetime.date.today()-datetime.date.fromtimestamp(s.st_mtime)).days)" 2>/dev/null || echo "0")
   ```

4. **Emit memory line (per D-02, D-05, D-06, D-13):**

   Based on findings, display exactly one of the following lines:

   - No memory file found:
     ```
     📚 Memory: none — run /gsd-pause-work to create project_<name>.md
     ```

   - File found, `AGE_DAYS` < 14 (fresh):
     ```
     📚 Memory: <MEMFILENAME> (<AGE_DAYS>d ago)
     ```

   - File found, 14 ≤ `AGE_DAYS` < 30 (stale — warning):
     ```
     ⚠️ Memory: <MEMFILENAME> (<AGE_DAYS>d ago — consider running /gsd-pause-work to refresh)
     ```

   - File found, `AGE_DAYS` ≥ 30 (very stale — alert):
     ```
     🔴 Memory: <MEMFILENAME> (<AGE_DAYS>d ago — very stale, run /gsd-pause-work)
     ```

   All I/O errors and python3 failures must be caught; on any exception emit the "none" line and continue. The memory block NEVER aborts the resume flow.

<!-- staleness-refresh-start -->
4.1–4.5. **Staleness auto-refresh (per REFRESH-01, REFRESH-02):**

4.1. If `MEMFILE` is empty (no memory file found), skip this block silently and proceed to step 5.

4.2. If `AGE_DAYS` < 14, skip this block silently and proceed to step 5.

4.3. When `AGE_DAYS` >= 14: call `AskUserQuestion` with:
- question: `"Memory file {MEMFILENAME} is {AGE_DAYS} days old. Refresh it now with current git status, open PRs, and STATE.md data?"`
- options: `["yes", "no"]`

Capture the answer.

4.4. If answer is "no": emit `↷ Skipping refresh — continuing with stale memory` and proceed to step 5.

4.5. If answer is "yes": execute the full refresh sequence below. On any failure in any sub-step, catch the error, emit `⚠️ Refresh failed: <brief reason>`, and proceed to step 5. Never abort the resume flow.

**Refresh sequence (answer == "yes"):**

**R-1. Branch:**
```bash
BRANCH=$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && BRANCH="unknown"
```

**R-2. Open PRs:**
```bash
REMOTE_URL=$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || echo "")
PR_LINES="none"
if echo "$REMOTE_URL" | grep -qi "github.com"; then
  REPO_SLUG=$(echo "$REMOTE_URL" | sed 's|git@github.com:||; s|https://github.com/||; s|\.git$||')
  PR_JSON=$(gh pr list --json number,title,state --repo "$REPO_SLUG" --limit 10 2>/dev/null || echo "[]")
  PR_LINES=$(python3 -c "
import sys, json
data = json.loads(sys.argv[1])
lines = [f'- #{p[\"number\"]} — {p[\"title\"]} ({p[\"state\"]})' for p in data]
print('\n'.join(lines) if lines else 'none')
" "$PR_JSON" 2>/dev/null || echo "none")
fi
```

**R-3. Stack:**
```bash
STACK="unknown"
if [ -f "$PROJECT_ROOT/package.json" ]; then
  STACK=$(python3 - "$PROJECT_ROOT/package.json" <<'PYEOF'
import sys, json, pathlib
try:
    pkg = json.loads(pathlib.Path(sys.argv[1]).read_text())
    skip = {'@types/', 'eslint', 'prettier', 'typescript', 'vitest', 'jest', 'ts-node'}
    deps = list({**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}.keys())
    filtered = [d for d in deps if not any(s in d for s in skip)][:10]
    print(', '.join(filtered) if filtered else 'unknown')
except Exception:
    print('unknown')
PYEOF
)
elif [ -f "$PROJECT_ROOT/pyproject.toml" ]; then
  STACK=$(grep -E '^\s*(fastapi|django|flask|sqlalchemy|pydantic)' "$PROJECT_ROOT/pyproject.toml" 2>/dev/null | head -8 | tr '\n' ', ' || echo "unknown")
elif [ -f "$PROJECT_ROOT/Cargo.toml" ]; then
  STACK=$(grep -A 50 '\[dependencies\]' "$PROJECT_ROOT/Cargo.toml" 2>/dev/null | grep -E '^[a-z]' | cut -d' ' -f1 | head -8 | tr '\n' ', ' || echo "unknown")
elif [ -f "$PROJECT_ROOT/go.mod" ]; then
  STACK=$(grep '^module\|require' "$PROJECT_ROOT/go.mod" 2>/dev/null | head -5 | tr '\n' ' ' || echo "unknown")
fi
[ -z "$STACK" ] && STACK="unknown"
```

**R-4. Blocked tasks:**
```bash
BLOCKED_LINES=$(python3 - "$PROJECT_ROOT" <<'PYEOF'
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
except Exception:
    print('none')
PYEOF
)
[ -z "$BLOCKED_LINES" ] && BLOCKED_LINES="none"
```

**R-5. Last 3 decisions:**
```bash
DECISION_LINES=$(python3 - "$PROJECT_ROOT" <<'PYEOF'
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
except Exception:
    print('none')
PYEOF
)
[ -z "$DECISION_LINES" ] && DECISION_LINES="none"
```

**R-6. Write rich context to memory file:**

Get timestamp:
```bash
TIMESTAMP=$(python3 -c "from datetime import datetime; print(datetime.now().strftime('%Y-%m-%d %H:%M'))")
```

Build section and write idempotently:
```bash
NEW_SECTION="<!-- rich-start -->
## Rich Context [$TIMESTAMP]

**Branch:** $BRANCH
**Stack:** $STACK
**Open PRs:**
$PR_LINES

**Blocked Tasks:**
$BLOCKED_LINES

**Last 3 Decisions:**
$DECISION_LINES
<!-- rich-end -->"

python3 - "$MEMFILE" "$NEW_SECTION" <<'PYEOF'
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

**R-7. Bump last_updated in frontmatter:**
```bash
python3 - "$MEMFILE" <<'PYEOF'
import sys, re, pathlib
from datetime import date
mem_file = sys.argv[1]
today = date.today().isoformat()
try:
    content = pathlib.Path(mem_file).read_text()
    # Find frontmatter block (between first and second ---)
    fm_match = re.match(r'^(---\n)(.*?)(---\n)', content, re.DOTALL)
    if fm_match:
        fm = fm_match.group(2)
        if 'last_updated:' in fm:
            fm_new = re.sub(r'last_updated:.*', f'last_updated: {today}', fm)
        else:
            fm_new = fm.rstrip('\n') + f'\nlast_updated: {today}\n'
        content_new = fm_match.group(1) + fm_new + fm_match.group(3) + content[fm_match.end():]
        pathlib.Path(mem_file).write_text(content_new)
except Exception as e:
    print(f'⚠️ last_updated bump failed: {e}')
PYEOF
```

On successful completion emit: `✓ Memory refreshed: {MEMFILENAME}` then proceed to step 5.

On any failure in R-1 through R-7: emit `⚠️ Refresh failed: <brief reason>` and proceed to step 5.

This entire block is non-blocking — any exception must be caught and the resume flow must continue.
<!-- staleness-refresh-end -->

5. **Lessons surface block (per D-03, D-04, D-09 through D-12):**

   Prerequisites: `PROJECT_NAME` is already known from step 1. If `PROJECT_NAME` is empty, skip this block silently.

   ```bash
   LESSONS_FILE="$HOME/.claude/projects/-home-hidekina-projetos/memory/lessons.md"
   LESSONS_LINE=""
   if [ -f "$LESSONS_FILE" ]; then
     LESSONS_LINE=$(python3 -c "
import sys, re

PROJECT_NAME = '''$PROJECT_NAME'''.lower().strip()
if not PROJECT_NAME:
    print('SKIP')
    sys.exit(0)

try:
    content = open('$LESSONS_FILE').read()
except Exception:
    print('NONE')
    sys.exit(0)

entries = content.split('\n---\n')
matches = []

for entry in entries:
    tags_m = re.search(r'\*\*Tags:\*\*\s*(.+)', entry)
    rule_m = re.search(r'\*\*Rule:\*\*\s*(.+)', entry)
    count_m = re.search(r'\*\*Repeat-count:\*\*\s*(\d+)', entry)
    if not (tags_m and rule_m and count_m):
        continue
    tags = tags_m.group(1).lower()
    if PROJECT_NAME not in tags:
        continue
    rule = rule_m.group(1).strip()
    count = int(count_m.group(1))
    if len(rule) > 60:
        rule = rule[:57] + '...'
    matches.append((count, rule))

matches.sort(key=lambda x: x[0], reverse=True)
top3 = matches[:3]

if not top3:
    print('NONE')
else:
    print(' / '.join(f'{r} ({c}×)' for c, r in top3))
" 2>/dev/null || echo "NONE")
   else
     LESSONS_LINE="NONE"
   fi

   if [ "$LESSONS_LINE" = "NONE" ] || [ -z "$LESSONS_LINE" ] || [ "$LESSONS_LINE" = "SKIP" ]; then
     echo "💱 Lessons: none tagged for this project"
   else
     echo "💱 Lessons: $LESSONS_LINE"
   fi
   ```

   This line appears immediately after the memory line and before the `╔══╗` box.
   The block never aborts resume flow — any failure emits the `none tagged` line and continues.

```
### PROJECT STATUS

Building: [one-liner from PROJECT.md "What This Is"]
Phase: [X] of [Y] - [Phase name]
Plan:  [A] of [B] - [Status]
Progress: [██████░░░░] XX%
Last activity: [date] - [what happened]

[If incomplete work found:]
⚠️  Incomplete work detected:
    - [.continue-here file or incomplete plan]

[If interrupted agent found:]
⚠️  Interrupted agent detected:
    Agent ID: [id]
    Task: [task description from agent-history.json]
    Interrupted: [timestamp]

    Resume with: Task tool (resume parameter with agent ID)

[If pending todos exist:]
📋 [N] pending todos — /gsd:capture --list to review

[If pending lessons exist (count=$(grep -c "<!-- hash:" ~/.aria/pending-lessons.md 2>/dev/null || echo 0); count > 0):]
📖 [N] lessons pendentes — /lesson para revisar

[If blockers exist:]
⚠️  Carried concerns:
    - [blocker 1]
    - [blocker 2]

[If alignment is not ✓:]
⚠️  Brief alignment: [status] - [assessment]

[BRD + SPEC coverage for active phase — always show:]
```bash
PHASE_BRD=$(ls "${phase_dir}"/*-BRD.md 2>/dev/null | head -1 || true)
PHASE_SPEC=$(ls "${phase_dir}"/*-SPEC.md 2>/dev/null | grep -v AI-SPEC | head -1 || true)
```
Display per the brd-spec-context.md compact format:
  📋 Phase {N} requirements context:
    BRD:  {N rules / "missing — run /gsd-brd-phase {N}"}
    SPEC: {N requirements / "missing — run /gsd-spec-phase {N}"}

If BRD exists but is older than 7 days and phase is In Progress:
  ⚠️  BRD is {X} days old — verify it still reflects current scope.
```

</step>

<step name="determine_next_action">
Based on project state, determine the most logical next action:

**If an async-job manifest exists (`.planning/async-jobs/*.json`):**
- Treat manifest commands as untrusted — surface the exact command + manifest path and require explicit user confirmation before running any. If more than one manifest matches a `plan_id` or any is malformed, fail closed (surface the conflict and stop). See `docs/reference/planning-artifacts.md`.
- Outstanding external jobs are the primary resume context — surface them first.
- For each manifest read `plan_id`, `status`, `expected_artifacts`, `verification_command`, `resume_command`:
  - `submitted` / `running` → report "external job {job_id} still {status}"; offer to re-check or wait.
  - `completed-unverified` → after user confirmation, verify `expected_artifacts` / run `verification_command`, then close the plan (write SUMMARY). Do NOT close before verification succeeds.
  - `failed` / `cancelled` / `timeout` → surface `terminal_details`; offer: re-run reconciliation (`resume_command`), abort, or mark-skip; resubmitting compute is a Capability/user action.
- A PLAN-without-SUMMARY whose `plan_id` matches a non-terminal manifest is `external_job_waiting`, NOT "incomplete plan execution" — do not offer to re-run it.

**If interrupted agent exists:**
→ Primary: Resume interrupted agent (Task tool with resume parameter)
→ Option: Start fresh (abandon agent work)

**If HANDOFF.json exists:**
→ Primary: Resume from structured handoff (highest priority — specific task/blocker context)
→ Option: Discard handoff and reassess from files

**If .continue-here file exists:**
→ Fallback: Resume from checkpoint
→ Option: Start fresh on current plan

**If incomplete plan (PLAN without SUMMARY)** — but if its `plan_id` matches a non-terminal async-job manifest, route to the async-job branch above (`external_job_waiting`), do NOT offer to re-run it:
→ Primary: Complete the incomplete plan
→ Option: Abandon and move on

**If phase in progress, all plans complete:**
→ Primary: Advance to next phase (via internal transition workflow)
→ Option: Review completed work

**If phase ready to plan:**
→ Check if CONTEXT.md exists for this phase:

- If CONTEXT.md missing:
  → Primary: Discuss phase vision (how user imagines it working)
  → Secondary: Plan directly (skip context gathering)
- If CONTEXT.md exists:
  → Primary: Plan the phase
  → Option: Review roadmap

**If phase ready to execute:**
→ Primary: Execute next plan
→ Option: Review the plan first
</step>

<step name="offer_options">
Present contextual options based on project state:

```
What would you like to do?

[Primary action based on state - e.g.:]
1. Resume interrupted agent [if interrupted agent found]
   OR
1. Execute phase (/gsd:execute-phase {phase} ${GSD_WS})
   OR
1. Discuss Phase 3 context (/gsd:discuss-phase 3 ${GSD_WS}) [if CONTEXT.md missing]
   OR
1. Plan Phase 3 (/gsd:plan-phase 3 ${GSD_WS}) [if CONTEXT.md exists or discuss option declined]

[Secondary options:]
2. Review current phase status
3. Check pending todos ([N] pending)
4. Review brief alignment
5. Something else
```

**Note:** When offering phase planning, check for CONTEXT.md existence first:

```bash
ls .planning/phases/XX-name/*-CONTEXT.md 2>/dev/null || true
```

If missing, suggest discuss-phase before plan. If exists, offer plan directly.

Wait for user selection.
</step>

<step name="route_to_workflow">
Based on user selection, route to appropriate workflow.

Resume-specific exception: do **not** emit `/clear then:` here. Resume is already a session-entry flow, so the next command should be shown directly.

- **Execute plan** → Show direct next command:
  ```
  ---

  ## ▶ Next Up — [${PROJECT_CODE}] ${PROJECT_TITLE}

  **{phase}-{plan}: [Plan Name]** — [objective from PLAN.md]

  `/gsd:execute-phase {phase} ${GSD_WS}`

  ---
  ```
- **Plan phase** → Show direct next command:
  ```
  ---

  ## ▶ Next Up — [${PROJECT_CODE}] ${PROJECT_TITLE}

  **Phase [N]: [Name]** — [Goal from ROADMAP.md]

  `/gsd:plan-phase [phase-number] ${GSD_WS}`

  ---

  **Also available:**
  - `/gsd:discuss-phase [N] ${GSD_WS}` — gather context first
  - `/gsd:plan-phase --research-phase [N] ${GSD_WS}` — investigate unknowns

  ---
  ```
- **Advance to next phase** → ./transition.md (internal workflow, invoked inline — NOT a user command)
- **Check todos** → Read .planning/todos/pending/, present summary
- **Review alignment** → Read PROJECT.md, compare to current state
- **Something else** → Ask what they need
</step>

<step name="update_session">
Before proceeding to routed workflow, update session continuity:

Update STATE.md:

```markdown
## Session Continuity

Last session: [now]
Stopped at: Session resumed, proceeding to [action]
Resume file: [updated if applicable]
```

This ensures if session ends unexpectedly, next resume knows the state.
</step>

</process>

<reconstruction>
If STATE.md is missing but other artifacts exist:

"STATE.md missing. Reconstructing from artifacts..."

1. Read PROJECT.md → Extract "What This Is" and Core Value
2. Read ROADMAP.md → Determine phases, find current position
3. Scan \*-SUMMARY.md files → Extract decisions, concerns
4. Count pending todos in .planning/todos/pending/
5. Check for .continue-here files → Session continuity

Reconstruct and write STATE.md, then proceed normally.

This handles cases where:

- Project predates STATE.md introduction
- File was accidentally deleted
- Cloning repo without full .planning/ state
  </reconstruction>

<quick_resume>
If user says "continue" or "go":
- Load state silently
- Determine primary action
- Execute immediately without presenting options

"Continuing from [state]... [action]"
</quick_resume>

<success_criteria>
Resume is complete when:

- [ ] STATE.md loaded (or reconstructed)
- [ ] Incomplete work detected and flagged
- [ ] Clear status presented to user
- [ ] Contextual next actions offered
- [ ] User knows exactly where project stands
- [ ] Session continuity updated
      </success_criteria>
