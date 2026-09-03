---
name: deepdesk-engineering
description: "Use for DeepDesk repository engineering work: development workflow, quality gates, testing, Electron smoke tests, packaging, release preparation, IPC changes, Agent tool changes, and AI handoff conventions. Trigger when working in this repository on scripts, docs, tests, builds, package/release tasks, or changes that must follow DeepDesk engineering rules."
---

# DeepDesk Engineering

## Overview

Use this skill to keep DeepDesk changes reproducible and AI-friendly. Prefer scripted workflows over ad-hoc commands.

## Required first steps

1. Read `AGENTS.md`.
2. Inspect the current worktree with `git -c core.quotepath=false status --short`.
3. Confirm ordinary development is on `develop` or a short-lived branch created from `develop`; do not modify `main` outside an explicit release workflow.
4. Read the nearest folder-level `AGENTS.md` for every directory being edited.
5. Use `pnpm flow -- ...` for checks, builds, smoke tests, packages, and releases.

## Command entrypoint

Use:

```sh
pnpm flow -- <command> [options]
```

Common commands:

- Diagnose environment: `pnpm flow -- doctor`
- Fast quality gate: `pnpm flow -- check`
- Full local gate: `pnpm flow -- check --include-build --include-smoke --include-e2e`
- CI-equivalent gate: `pnpm flow -- ci --include-build`
- E2E isolated entrypoint: `pnpm flow -- e2e`
- E2E session entrypoint: `pnpm flow -- e2e --mode session`
- Unit/integration tests: `pnpm flow -- test --kind unit`
- Electron smoke: `pnpm flow -- test --kind smoke`
- Seed UI review mock session: `pnpm flow -- seed-ui-session`
- Windows package: `pnpm flow -- package --target win`
- macOS arm64 package: `pnpm flow -- package --target mac`
- Release candidate: `pnpm flow -- release --target <win-or-mac>`

## Validation rules

- Ordinary code change: run `pnpm flow -- check`.
- Structural change or new module: read `references/architecture-quality.md` and run `pnpm architecture`.
- Behavior change: update or add tests, then run `pnpm flow -- check`.
- IPC, permission, persistence, or Agent tool change: run `pnpm flow -- check --include-build`.
- Feature or bugfix change: update SemVer in both `package.json` and `src/shared/app-meta.ts`. Before the first stable public release, keep the major version at `0` (`feat` -> minor, `fix` -> patch, breaking -> minor with explicit release notes). Only the first stable public release may become `1.0.0`.
- Release candidate: run `pnpm flow -- release --target <platform>`.
- Git Flow: ordinary changes target `develop`; a reviewed release PR uses Squash Merge from `develop` into `main`, then the new `main` commit must be merged back into `develop` with a normal merge commit and both branches synchronized to both remotes. Create the annotated `vX.Y.Z` tag matching `package.json` only for a formal release.
- macOS packages must be built on macOS.
- DeepDesk currently supports Windows x64 and macOS arm64; Linux is out of scope.
- Playwright Electron E2E is installed; isolated mode automatically discovers every domain spec except `session.spec.ts`, while session mode is reserved for local single-window acceptance.
- Documentation changes ship with the behavior they describe: update `README.md` for user-visible capabilities or support changes, architecture documents for boundaries and data-flow changes, and engineering documents plus this skill for workflow changes. If no documentation changes are needed, state why in the PR description.

## Architecture guardrails

- Renderer must not perform direct network requests.
- Platform differences belong in `src/main/platform`; do not duplicate the application or hardcode a shell in business logic.
- IPC changes follow: channel constant -> API type -> preload bridge -> main handler -> renderer caller.
- Agent tool changes follow: tool schema -> executor branch -> permission evaluation -> tests.
- Shared code belongs in `src/shared`; do not import Electron across layers.
- Tests must not call real model services, send real Feishu messages, or execute dangerous commands.
- Documentation must describe implemented behavior and must not present planned work as an existing capability.
- New files must stay within `scripts/architecture-budget.json`; legacy exceptions are frozen and cannot grow. Split responsibilities instead of raising limits to pass CI.

## References

Read `references/workflows.md` when changing IPC, Agent tools, or preparing release candidates.

Read `references/architecture-quality.md` when adding features, changing module boundaries, or touching a file near its size budget.

Read `docs/folder-map.md` when routing work across multiple project folders.
