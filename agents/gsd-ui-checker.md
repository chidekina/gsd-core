---
name: gsd-ui-checker
description: "[ARCHIVED — merged into ui-quality] Superseded by the unified ui-quality agent (OVERLAP-04, phase 53). Spawn ui-quality with mode=gate instead. Full original body preserved at agents/_archive/gsd-ui-checker.md."
tools: Read
color: "#6B7280"
---

# ARCHIVED — superseded by `ui-quality` (mode=gate)

This agent was merged into the unified **`ui-quality`** agent as part of OVERLAP-04
(phase 53, orchestration optimization). The original UI-SPEC.md contract-verification
behavior — the 6-dimension rubric and BLOCK/FLAG/PASS verdict semantics — now lives in
`agents/ui-quality.md` under **`mode=gate`** (read-only).

- **Do not spawn this agent.** Spawn `ui-quality` with `mode=gate` instead.
- The full original agent body is preserved verbatim at
  `agents/_archive/gsd-ui-checker.md` (the archive copy is the backup of record, since
  `agents/` is gitignored), so this merge is fully reversible. Nothing was hard-deleted.
