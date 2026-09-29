<purpose>
Capture business requirements for a phase — business rules, personas, screen flows, edge cases, and conflict detection vs prior BRDs. Produces BRD.md that discuss-phase and plan-phase consume to avoid losing business context mid-process.

This workflow handles "who/what/when/why/screens" — spec-phase handles technical falsifiability, discuss-phase handles "how".
</purpose>

<completeness_model>
All 5 dimensions must be covered before BRD.md is written:

| Dimension         | What it captures                                              |
|-------------------|---------------------------------------------------------------|
| Business Rules    | "When X, then Y" — who does what, when, under what condition |
| Personas          | Roles affected, permissions, user journeys                    |
| Screen Flows      | Numbered wireframe steps per screen/view                      |
| Edge Cases        | Business exceptions, error states, boundary conditions        |
| Conflict Check    | Contradictions vs prior BRDs — resolved before writing        |

Gate: all 5 covered → write BRD.md.
</completeness_model>

<process>

## Step 1: Initialize

```bash
_GSD_SHIM_NAME="gsd-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}"; _gsd_at() { for _p; do if [ -f "$_p" ]; then GSD_TOOLS="$_p"; return 0; fi; done; return 1; }; _gsd_id_ok() { case "$("$1" runtime-identity --raw 2>/dev/null || true)" in '{"packageName":"@opengsd/gsd-core"'*'}') return 0;; *) return 1;; esac; }; _gsd_homes() { _gsd_at "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/gsd-core/bin/${_GSD_SHIM_NAME}" "${HERMES_HOME:-$HOME/.hermes}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEX_HOME:-$HOME/.codex}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/gsd-core/bin/${_GSD_SHIM_NAME}" "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/gsd-core/bin/${_GSD_SHIM_NAME}" "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/gsd-core/bin/${_GSD_SHIM_NAME}" "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/gsd-core/bin/${_GSD_SHIM_NAME}" "${TRAE_CONFIG_DIR:-$HOME/.trae}/gsd-core/bin/${_GSD_SHIM_NAME}" "${QWEN_CONFIG_DIR:-$HOME/.qwen}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CLINE_CONFIG_DIR:-$HOME/.cline}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GROK_AGENTS_HOME:-$HOME/.agents}/gsd-core/bin/${_GSD_SHIM_NAME}" "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/gsd-core/bin/${_GSD_SHIM_NAME}" "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/gsd-core/bin/${_GSD_SHIM_NAME}" "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/gsd-core/bin/${_GSD_SHIM_NAME}"; }; if _gsd_at "${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.codex/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif _gsd_homes; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif unset -f gsd_run; _G="$(command -v gsd_run)"; [ -n "$_G" ] && _gsd_id_ok "$_G"; then GSD_TOOLS="$_G"; gsd_run() { "$GSD_TOOLS" "$@"; }; else echo "ERROR: gsd-tools.cjs not found at $GSD_TOOLS and no identity-proving gsd_run is on PATH. See the fork README (https://github.com/chidekina/gsd-core, branch local): install the fork tarball, never an upstream npx" >&2; exit 1; fi; GSD_IDENTITY_STATUS=unverified; _gsd_id_ok gsd_run && GSD_IDENTITY_STATUS=ok; export GSD_IDENTITY_STATUS; [ "$GSD_IDENTITY_STATUS" = ok ] || echo "WARNING: \"$GSD_TOOLS\" did not prove it is @opengsd/gsd-core - it is either a different package or an @opengsd/gsd-core older than the runtime-identity verb. See docs/how-to/diagnose-a-foreign-gsd-tools.md" >&2; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi; [ "${GSD_SKIP_SDK_WRAP:-0}" != "1" ] && [ -x "${GSD_SDK_WRAPPER:-$HOME/.local/bin/gsd-sdk}" ] && [ -x "$GSD_TOOLS" ] && { _GSD_WRAP="${GSD_SDK_WRAPPER:-$HOME/.local/bin/gsd-sdk}"; _GSD_REAL_TOOLS="$GSD_TOOLS"; gsd_run() { GSD_SDK_REAL="$_GSD_REAL_TOOLS" "$_GSD_WRAP" "$@"; }; }; # [gsd-local] route gsd_run through the Phase 139 effect wrapper when installed
INIT=$(gsd_run query init.phase-op "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `state_path`, `requirements_path`, `roadmap_path`, `planning_path`, `response_language`, `commit_docs`.

**If `response_language` is set:** All user-facing text MUST be in `{response_language}`. Technical terms, code, and file paths stay in English.

**If `phase_found` is false:**
```
Phase [X] not found in roadmap.
Use /gsd-progress to see available phases.
```
Exit.

**Check for existing BRD.md:**
```bash
EXISTING_BRD=$(ls ${phase_dir}/*-BRD.md 2>/dev/null | head -1 || true)
```

If BRD.md already exists:
- Read the existing BRD — extract current version from frontmatter (`**Version:** X.Y`)
- Compute next version: if major change (overwrite) → bump major (1.0 → 2.0); if append → bump minor (1.0 → 1.1)
- Show: "BRD.md v{current_version} already exists for phase ${phase_number}."
- AskUserQuestion: "Overwrite or append to existing BRD.md?"
  Options: ["Overwrite — start fresh (v{major+1}.0)", "Append — add new sections (v{minor+1})", "Cancel — keep existing"]
- On "Cancel": exit cleanly.
- On "Overwrite" or "Append": record the previous version's business rules diff in the Changelog section before writing. Format: `| {new_version} | {date} | system | [Overwrite/Append] — {N} rules changed, {M} rules added`

## Step 1.5: --from-code Mode (retroactive BRD generation)

**Active only when `--from-code` flag is present in arguments.**

For existing phases that have code but no BRD, infer business requirements from implementation:

```bash
# Find all source files modified/created in this phase
PHASE_FILES=$(git log --diff-filter=AM --name-only --format="" $(git log --oneline .planning/phases/${padded_phase}*/ 2>/dev/null | tail -1 | awk '{print $1}')..HEAD -- 2>/dev/null | sort -u | head -50)
```

If `PHASE_FILES` is empty: fall back to reading all non-test source files in common dirs (`src/`, `app/`, `lib/`, `components/`).

**Inference steps:**
1. Read SUMMARY.md files for this phase (accomplishments, key files)
2. Read PLAN.md files for this phase (task descriptions, acceptance criteria)
3. Read VERIFICATION.md if present (what was tested)
4. Read up to 10 most significant source files from `PHASE_FILES`

From these, infer:
- **Business rules:** Extract from task names, acceptance criteria, conditional logic (if/else, guards, role checks)
- **Personas:** Extract from route guards, auth checks, user roles referenced in code
- **Screen flows:** Extract from component names, route definitions, API endpoints → reconstruct user journey
- **Edge cases:** Extract from error handling, validation logic, edge case comments

Display inferred content and ask:
```
AskUserQuestion([{
  question: "Inferred BRD from code for Phase ${phase_number}. Review and confirm?",
  header: "Review Inferred BRD",
  options: [
    { label: "Looks good — write BRD", description: "Accept inference as-is" },
    { label: "Edit before writing", description: "I'll refine the inferred content" },
    { label: "Start from scratch", description: "Discard inference — run full interview" }
  ]
}])
```

On "Edit before writing": show each dimension and allow inline edits.
On "Start from scratch": skip to Step 4 (interview) with `--from-code` ignored.
On "Looks good": skip Step 4, proceed to Step 5 with inferred content.

## Step 2: Scan Prior BRDs for Conflicts

```bash
PRIOR_BRDS=$(find "${planning_path}/phases" -name "*-BRD.md" 2>/dev/null | sort)
```

Read each prior BRD found. Extract business rules (lines matching "When X" / "Rule:" / numbered lists under "Business Rules" section).

Build a `prior_rules` list: `[{phase, rule_text}]` for conflict comparison in Step 6.

If no prior BRDs found: log "No prior BRDs — conflict check will be skipped." and continue.

## Step 3: Load Phase Context

Read (in order, skip if path is null):
1. `roadmap_path` — phase goal and scope
2. `requirements_path` — functional requirements
3. `state_path` — current project state
4. Any existing SPEC.md for this phase: `ls ${phase_dir}/*-SPEC.md 2>/dev/null | grep -v AI-SPEC | head -1`

**Master BRD inheritance:**
```bash
MASTER_BRD=$(ls "${planning_path}/MASTER-BRD.md" 2>/dev/null || true)
```

If `MASTER_BRD` exists:
- Read it and extract: business rules, personas, screen flows relevant to this phase
- Pre-populate interview dimensions 1–3 with master BRD content
- Log: `Master BRD found — pre-populating from milestone context. Review and refine for Phase ${phase_number}.`
- During interview: show inherited values first, ask "Keep / Modify / Remove" for each

Synthesize a working model of: what the phase should achieve, who uses it, what screens likely exist.

## Step 4: Interview (skip if --auto flag)

Run structured interview across 5 dimensions. Each question block uses AskUserQuestion. Use `--text` mode (plain numbered list) if `--text` flag is set.

**Dimension 1 — Business Rules:**
```
AskUserQuestion([{
  question: "What are the main business rules for this phase? (e.g., 'Only admins can approve', 'Invoice is locked after 24h')",
  header: "Business Rules",
  multiSelect: false,
  options: [
    { label: "Describe rules", description: "I'll type the business rules" },
    { label: "Infer from context", description: "Claude infers from roadmap/requirements — I'll review" },
    { label: "Skip", description: "No explicit business rules for this phase" }
  ]
}])
```
If "Describe rules": follow up with free-text input prompt.
If "Infer from context": Claude proposes rules from loaded context, user confirms/edits.

**Dimension 2 — Personas:**
```
AskUserQuestion([{
  question: "Which user roles/personas interact with this phase's features?",
  header: "Personas",
  multiSelect: true,
  options: [
    { label: "Admin", description: "Full access, configuration, management" },
    { label: "Regular User", description: "Standard app user" },
    { label: "Viewer/Read-only", description: "Read access only" },
    { label: "External/Guest", description: "Unauthenticated or limited access" }
  ]
}])
```
Follow up: "For each selected persona, describe the main action they take in this phase."

**Dimension 3 — Screen Flows:**
```
AskUserQuestion([{
  question: "List the screens/views involved. For each, describe the main user flow (numbered steps).",
  header: "Screen Flows",
  multiSelect: false,
  options: [
    { label: "Describe screens", description: "I'll describe each screen and flow" },
    { label: "Infer from context", description: "Claude drafts wireframe steps from requirements" },
    { label: "No new screens", description: "This phase has no UI changes" }
  ]
}])
```

**Dimension 4 — Edge Cases:**
```
AskUserQuestion([{
  question: "What business exceptions or edge cases must be handled?",
  header: "Edge Cases",
  multiSelect: false,
  options: [
    { label: "Describe edge cases", description: "I'll type them" },
    { label: "Infer from context", description: "Claude proposes edge cases — I'll confirm" },
    { label: "None identified", description: "No special edge cases" }
  ]
}])
```

**If --auto flag:** Claude infers all 4 dimensions from loaded context. Skip AskUserQuestion for dimensions 1–4. Proceed directly to Step 5.

## Step 5: Completeness Check

Verify coverage for each dimension:
- Business Rules: at least 1 rule defined or explicitly "none"
- Personas: at least 1 persona identified
- Screen Flows: at least 1 flow described or "no UI changes" confirmed
- Edge Cases: explicitly addressed or "none identified"

If any dimension is empty AND --auto is NOT set: re-prompt for that dimension only.

## Step 6: Conflict Detection

Compare new business rules against `prior_rules` from Step 2.

For each new rule, check if any prior rule:
- Contradicts it (opposite conditions or outcomes)
- Overlaps ambiguously (same trigger, different action)

If conflicts found → for EACH conflict:
```
AskUserQuestion([{
  question: "Business rule conflict detected:\n\nNEW (Phase ${phase_number}): \"${new_rule}\"\nEXISTING (Phase ${prior_phase}): \"${prior_rule}\"\n\nHow should this be resolved?",
  header: "Rule Conflict",
  multiSelect: false,
  options: [
    { label: "New rule wins", description: "Phase ${phase_number} rule overrides the prior one" },
    { label: "Prior rule wins", description: "Keep existing rule, drop/modify new one" },
    { label: "Both apply", description: "Rules are compatible — different contexts" },
    { label: "Needs discussion", description: "Flag as unresolved — add to Conflicts Resolved table with status OPEN" }
  ]
}])
```

Record all resolutions in `conflict_log`: `[{new_rule, prior_rule, prior_phase, resolution, status}]`.

## Step 7: Generate BRD.md

Read the BRD template:
```bash
cat "$HOME/.claude/gsd-core/templates/brd.md"
```

Fill template with:
- `phase_number`, `phase_name`, current date
- `version`: computed in Step 1 (1.0 for new, bumped for updates)
- `updated`: current date (same as `created` for new BRDs)
- Changelog entry: add row for this version
- Business rules from dimension 1
- Personas + actions from dimension 2
- Screen flows (text wireframes) from dimension 3
- Edge cases from dimension 4
- Conflicts table from `conflict_log`
- Out of scope: infer from roadmap + explicitly asked boundaries

Write to:
```bash
BRD_PATH="${phase_dir}/${padded_phase}-BRD.md"
```

## Step 8: Commit

If `commit_docs` is true:
```bash
gsd_run query commit "docs(${padded_phase}): add BRD — business rules, personas, screen flows" --files "${BRD_PATH}"
```

## Step 9: Summary

Display:
```
BRD.md written → ${BRD_PATH}

Coverage:
  ✓ Business Rules: [N rules]
  ✓ Personas: [list]
  ✓ Screen Flows: [N screens]
  ✓ Edge Cases: [N cases]
  [✓/⚠] Conflicts: [N resolved, M open]

Next steps:
  /gsd-spec-phase ${phase_number}   → technical requirements
  /gsd-plan-phase ${phase_number}   → plan (reads BRD automatically)
```

</process>
