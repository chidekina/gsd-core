---
name: gsd:brd-phase
description: "Generate BRD.md for a phase — business rules, personas, screen flows, conflict detection vs prior BRDs"
argument-hint: "<phase> [--auto] [--from-code] [--text]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Capture WHAT a phase delivers from the business perspective before planning starts.

**Position in workflow:** `brd-phase → spec-phase → discuss-phase → plan-phase → execute-phase → verify`

**How it works:**
1. Load phase context (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md)
2. Scan prior BRD.md files in all phases — detect business rule conflicts
3. Run structured interview (business rules, personas, screen flows, edge cases)
4. Conflict check: if any business rule contradicts prior BRDs → AskUserQuestion before writing
5. Gate: all 5 checklist dimensions covered → write BRD.md
6. Commit BRD.md — discuss-phase and plan-phase pick it up automatically

**Output:** `{phase_dir}/{padded_phase}-BRD.md` — business contract that locks "who/what/when/why/screens" before technical spec.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/brd-phase.md
@~/.claude/gsd-core/templates/brd.md
</execution_context>

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`. They are equivalent — `vscode_askquestions` is the VS Code Copilot implementation of the same interactive question API.
</runtime_note>

<context>
Phase number: $ARGUMENTS (required)

**Flags:**
- `--auto` — Skip interactive questions; Claude infers business rules from codebase + roadmap context and writes BRD.md directly
- `--from-code` — Retroactive mode: infer BRD from existing phase code (git log, SUMMARY.md, PLAN.md, source files). Use for phases already implemented without a BRD
- `--text` — Use plain-text numbered lists instead of TUI menus (required for `/rc` remote sessions)

Context files are resolved in-workflow using `gsd-sdk query init.phase-op`.
</context>

<process>
Execute end-to-end.

**MANDATORY:** Read the workflow file BEFORE taking any action. The workflow contains the complete step-by-step process including interview loop, conflict detection, and BRD.md generation. Do not improvise from the objective summary above.
</process>

<success_criteria>
- Prior BRDs scanned for conflicts before writing
- All 5 checklist dimensions covered (business rules, personas, screens, edge cases, conflicts)
- Any conflict confirmed by user via AskUserQuestion before BRD.md is written
- BRD.md written with business-language requirements, text wireframes, and explicit conflict resolution table
- BRD.md committed atomically
- User knows they can run /gsd-spec-phase (technical requirements) or /gsd-plan-phase next
</success_criteria>
