---
name: gsd-ui-auditor
description: "[ARCHIVED — merged into ui-quality] Superseded by the unified ui-quality agent (OVERLAP-04, phase 53). Spawn ui-quality with mode=audit instead. Full original body preserved at agents/_archive/gsd-ui-auditor.md."
tools: Read
color: "#6B7280"
---

# ARCHIVED — superseded by `ui-quality` (mode=audit)

This agent was merged into the unified **`ui-quality`** agent as part of OVERLAP-04
(phase 53, orchestration optimization). The original retroactive 6-pillar scored audit
behavior — screenshot capture, pillar scoring, registry safety pass, and UI-REVIEW.md
output — now lives in `agents/ui-quality.md` under **`mode=audit`** (uses Write).

- **Do not spawn this agent.** Spawn `ui-quality` with `mode=audit` instead.
- The full original agent body is preserved verbatim at
  `agents/_archive/gsd-ui-auditor.md` (the archive copy is the backup of record, since
  `agents/` is gitignored), so this merge is fully reversible. Nothing was hard-deleted.
