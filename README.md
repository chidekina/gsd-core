# chidekina/gsd-core - local fork

Fork of [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core). Default branch is `local`, cut from the release tag `v1.15.0` (`b10ab3fd`). `next` is upstream's pre-release line and is never a base. Decision record: ADR-0135 in the harness repo (reopens ADR-0110).

## Local patches (`[gsd-local]` commits, one file each)

| file | what it does |
|---|---|
| `gsd-core/templates/phase-prompt.md` | documents the task-level `parallel="true"` attribute |
| `gsd-core/workflows/execute-plan.md` | Within-Plan Parallel Task Groups section (dispatch of adjacent `parallel="true"` tasks) |
| `gsd-core/workflows/new-project.md` | section 5.05 Gate Zero, section 8.5 Master BRD, Master BRD row in the done table |
| `gsd-core/workflows/pr-branch.md` | `nick_nope_gate` step; needs the user agent `~/.claude/agents/gsd-nick-nope.md`, which this package does not ship |
| `agents/gsd-plan-checker.md` | calls `verify.plan-structure` instead of `plan.task-structure`, a verb the entrypoint does not register |

Added 2026-09-29 (full triage of every local edit vs a pristine 1.42.3 install; the per-file port list with proofs is `159-TRIAGE-2.md` in the harness repo, one `[gsd-local]` commit per file, `git log v1.15.0..local --grep gsd-local`):

| area | what it does |
|---|---|
| `gsd-core/workflows/_runtime-launcher.snippet.sh` + every inlined copy + `references/gsd-run-resolver.md` | `gsd_run` calls `~/.local/bin/gsd-sdk` (the Phase 139 effect wrapper, `GSD_SDK_REAL=$GSD_TOOLS`) when it is executable; fallback is the direct call; `GSD_SKIP_SDK_WRAP=1` disables. Do not run `npm run sync:launcher` blindly: it also moves an unrelated upstream preamble in `code-review-disposition.md` |
| `gsd-core/workflows/update.md` | `/gsd-update` REFUSES (step `fork_lockdown`): it would install the upstream package over these patches |
| `hooks/gsd-check-update-worker.js`, `hooks/gsd-statusline.js` | no registry lookup, `update_available` is always false; "stale hooks" points here, not at `/gsd-update` |
| `gsd-core/{workflows/brd-phase.md,templates/brd.md,references/brd-spec-context.md}`, `commands/gsd/brd-phase.md`, `agents/gsd-nick-nope.md` | BRD/SPEC feature files owned by this fork, so the legacy cleanup cannot delete the skill that includes them |
| BRD/SPEC, memory-mapper, ui-quality, destructive-git, SGND, AUTO-01/02 edits | see the triage; workflows plan/discuss/execute/verify/ship/complete/resume/pause, agents verifier/planner/plan-checker and friends, hooks check-update/phase-boundary/session-state/workflow-guard |

Rebase note: on a conflict in any of the above the `[gsd-local]` side wins unless upstream absorbed the change (then drop our commit and say so in the triage).

The phase-prompt and execute-plan patches have zero current uses; they were kept on purpose (operator decision 2026-09-28).

## Upgrading: only by trigger, never by calendar

There is NO scheduled or cadence-based upgrade. Upstream publishes about 3 releases a week; a fixed cadence would mean rebasing constantly for nothing. Nobody runs `/gsd-update`-style installs into `~/.claude` in place. Rebase only when an upstream fix affects us (trigger 1 of ADR-0110):

1. `git fetch upstream --tags`
2. `git rebase --onto <new-tag> <old-tag> local`. A conflict on a `[gsd-local]` commit names the file; resolve it there.
3. Build and install into a sandbox first: `npm ci --ignore-scripts && npm run build:lib`, then run the installer with `--config-dir <scratch> --no-legacy-cleanup`, and diff the result against the live `~/.claude` before any swap.
4. Push `local` and confirm `git ls-remote origin local` equals `git rev-parse local`.

Rollback: the previous install is kept as `~/.cache/gsd-rollback/get-shit-done-cc-1.42.3.tgz`; procedure in ADR-0135 and the phase 159 CONTEXT.

---

<div align="center">

# GSD Core

**Git. Ship. Done.**

**English** · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja-JP.md) · [한국어](README.ko-KR.md)

**A light-weight meta-prompting, context engineering, and spec-driven development system for Claude Code, OpenCode, Antigravity CLI, Kimi CLI, Kilo, Codex, Copilot, Cursor, Windsurf, and more.**

[![npm version](https://img.shields.io/npm/v/%40opengsd%2Fgsd-core?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/@opengsd/gsd-core)
[![npm downloads](https://img.shields.io/npm/dm/%40opengsd%2Fgsd-core?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/@opengsd/gsd-core)
[![Tests](https://img.shields.io/github/actions/workflow/status/open-gsd/gsd-core/test.yml?branch=main&style=for-the-badge&logo=github&label=Tests)](https://github.com/open-gsd/gsd-core/actions/workflows/test.yml)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/mYgfVNfA2r)
[![GitHub stars](https://img.shields.io/github/stars/open-gsd/gsd-core?style=for-the-badge&logo=github&color=181717)](https://github.com/open-gsd/gsd-core)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

---

## What is GSD Core

GSD Core is a context-engineering and spec-driven development framework that drives AI coding agents (Claude Code, Codex, Antigravity CLI, Kimi CLI, Copilot, Cursor, and more) through a disciplined phase loop. It solves [context rot](docs/explanation/context-engineering.md) — the quality degradation that accumulates as an AI fills its context window — by running all heavy research, planning, and execution work in fresh-context subagents while keeping your main session lean.

---

## How it works

Each milestone repeats the same five-step loop, one phase at a time:

1. **Discuss** — capture implementation decisions before anything is planned
2. **Plan** — research, decompose, and verify the plan fits a fresh context window
3. **Execute** — run plans in parallel waves; each executor starts with a clean 200k-token context
4. **Verify** — walk through what was built; diagnose and fix before declaring done
5. **Ship** — create the PR, archive the phase, repeat for the next one

---

## Quickstart

```bash
npx @opengsd/gsd-core@latest
```

The installer prompts for your runtime (Claude Code, OpenCode, Antigravity CLI, Kimi CLI, Kilo, Codex, Copilot, Cursor, Windsurf, and more) and whether to install globally or locally. The installer is required for cross-runtime compatibility — do not copy files from `agents/` or `commands/` directly.

On another runtime or without Node.js? See [Install on your runtime](docs/how-to/install-on-your-runtime.md).

Once installed, start a new project or onboard an existing repo:

```bash
/gsd-new-project   # greenfield project
/gsd-onboard       # existing codebase
```

New here? Follow [Your first project](docs/tutorials/your-first-project.md) for a guided walkthrough from install to first shipped phase, or [Onboarding an existing codebase](docs/tutorials/onboarding-an-existing-codebase.md) for brownfield setup.

---

## Documentation

**What's new in 1.7.0** → [docs/whats-new-1.7.0.md](docs/whats-new-1.7.0.md)

**Tutorials** — learning by doing:
- [Your first project](docs/tutorials/your-first-project.md)
- [Onboarding an existing codebase](docs/tutorials/onboarding-an-existing-codebase.md)

**How-to guides** — task-focused recipes:
- [Install on your runtime](docs/how-to/install-on-your-runtime.md)
- [Plan a phase](docs/how-to/plan-a-phase.md)
- [Verify and ship](docs/how-to/verify-and-ship.md)
- … [see all how-to guides](docs/README.md#how-to-guides)

**Reference** — authoritative facts:
- [Commands](docs/COMMANDS.md)
- [Configuration](docs/CONFIGURATION.md)
- [CLI tools](docs/CLI-TOOLS.md)

**Explanation** — concepts and design decisions:
- [Context engineering](docs/explanation/context-engineering.md)
- [The phase loop](docs/explanation/the-phase-loop.md)
- [Architecture](docs/ARCHITECTURE.md)

Full index: [docs/README.md](docs/README.md). Other languages: [日本語](README.ja-JP.md) · [한국어](README.ko-KR.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md).

---

## Why it works

Most AI-coding setups fail at scale because context bloat silently degrades output quality, there is no shared memory between sessions, and nothing verifies that code actually works. GSD Core solves all three: heavy work runs in fresh subagents, structured artifacts like `STATE.md` and `CONTEXT.md` survive session boundaries, and the verify step walks through what was built and generates fix plans before a phase is declared done. See [docs/explanation/context-engineering.md](docs/explanation/context-engineering.md) for the full reasoning.

Troubleshooting? See [docs/how-to/recover-and-troubleshoot.md](docs/how-to/recover-and-troubleshoot.md).

---

## Community

| Project | Platform |
|---------|----------|
| [gsd-opencode](https://github.com/rokicool/gsd-opencode) | Original OpenCode port |
| [Discord](https://discord.gg/mYgfVNfA2r) | Community support |

---

## Star History

<a href="https://star-history.com/#open-gsd/gsd-core&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=open-gsd/gsd-core&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=open-gsd/gsd-core&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=open-gsd/gsd-core&type=Date" />
 </picture>
</a>

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

**Claude Code is powerful. GSD Core makes it reliable.**

</div>
