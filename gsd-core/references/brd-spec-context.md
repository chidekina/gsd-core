# BRD + SPEC Context Load

**Purpose:** Load and compare existing BRD and SPEC files at the start of any GSD command. Prevents divergence between agreed business/technical requirements and what is about to be planned, executed, or verified.

## Standard Init Block

Include this at the start of any workflow step that reads phase context. Execute after `INIT` is parsed and `phase_dir` is known.

```bash
# Load BRD + SPEC for comparison baseline
PHASE_BRD=$(ls "${phase_dir}"/*-BRD.md 2>/dev/null | head -1 || true)
PHASE_SPEC=$(ls "${phase_dir}"/*-SPEC.md 2>/dev/null | grep -v AI-SPEC | head -1 || true)
MASTER_BRD=$(ls ".planning/MASTER-BRD.md" 2>/dev/null || true)
```

## Comparison Protocol

When `PHASE_BRD` and/or `PHASE_SPEC` are non-empty:

1. **Read both files** before any planning/execution/verification step.
2. **Extract locked decisions:**
   - From BRD: business rules, personas, screen flows
   - From SPEC: requirements, boundaries, acceptance criteria
3. **Compare against current task/plan/goal:**
   - Does the work align with documented business rules?
   - Does it stay within the SPEC boundaries?
   - Are acceptance criteria achievable by what is planned?
4. **Flag divergences** — do not silently proceed if a plan contradicts a locked BRD rule or SPEC boundary.

## Divergence Handling

**Minor divergence** (implementation detail not covered by BRD/SPEC): proceed, note it in output.

**Major divergence** (plan contradicts a BRD rule OR exceeds SPEC boundaries): surface to user:
```
⚠️  BRD/SPEC DIVERGENCE DETECTED
BRD Rule: "[rule]"
Current plan/task: "[what conflicts]"
Recommended: update BRD (/gsd-brd-phase N) or SPEC (/gsd-spec-phase N) before proceeding, OR confirm this is intentional.
```
Ask user to confirm before continuing.

## Coverage Display

When surfacing BRD+SPEC status, use this compact format:

```
📋 Phase {N} requirements context:
  BRD:  {N rules} | {M personas} | {K screen flows}  [{path}]
  SPEC: {N requirements} | ambiguity {score}          [{path}]
  Master BRD: {present/absent}
```

If neither exists: display `📋 No BRD or SPEC found for Phase {N} — run /gsd-brd-phase and /gsd-spec-phase to document requirements.`

## Scope

This reference is consumed by:
- `plan-phase.md` — before spawning planner (BRD/SPEC injected into planner context)
- `execute-phase.md` — before spawning executor agents (locked rules travel as context)
- `discuss-phase.md` — before gray area analysis (already documented decisions skip re-asking)
- `verify-work.md` — before UAT generation (business rules become test cases)
- `ship.md` — before PR body generation (BRD summary in PR body)
- `gsd-update.md` — before state update (check if update contradicts BRD/SPEC)
- `resume-project.md` — at session start (surface BRD/SPEC status per active phase)
