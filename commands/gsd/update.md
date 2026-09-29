---
name: gsd:update
description: "Disabled on this fork: refuses and points at the fork rebase procedure"
argument-hint: "[--sync | --reapply | --next | --rc]"
allowed-tools:
  - Read
---

<objective>
**[gsd-local] `/gsd-update` is DISABLED on the chidekina/gsd-core fork (ADR-0135), for EVERY argument.** The upstream flow would install the upstream package over the fork's `[gsd-local]` patches (`npx @opengsd/gsd-core@<tag> ... --global`, no `--config-dir`), `--reapply` would 3-way merge stale `gsd-local-patches/` backups into the fork's agents, and `--sync` would rewrite installed skills across runtime roots.
</objective>

<flags>
Every flag ends at the same refusal: `--sync`, `--reapply`, `--next`, `--rc`, and no flag.
</flags>

<process>
Ignore `$ARGUMENTS`. Do NOT read or execute any workflow (`update.md`, `sync-skills.md`, `reapply-patches.md`). Print exactly this and STOP:

```
/gsd-update is disabled: this install is the chidekina/gsd-core fork (branch local).
Upgrades are a deliberate rebase of the fork, not an in-place upstream install.
Procedure: README.md ("Local patches" and the rebase steps) in https://github.com/chidekina/gsd-core (branch local),
decision record ADR-0135. Nothing was changed.
```
</process>
