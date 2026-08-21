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
3. Read the nearest folder-level `AGENTS.md` for every directory being edited.
4. Use `pnpm flow -- ...` for checks, builds, smoke tests, packages, and releases.

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
- Behavior change: update or add tests, then run `pnpm flow -- check`.
- IPC, permission, persistence, or Agent tool change: run `pnpm flow -- check --include-build`.
- Feature or bugfix change: update SemVer in both `package.json` and `src/shared/app-meta.ts`. Before the first stable public release, keep the major version at `0` (`feat` -> minor, `fix` -> patch, breaking -> minor with explicit release notes). Only the first stable public release may become `1.0.0`.
- Release candidate: run `pnpm flow -- release --target <platform>`.
- macOS packages must be built on macOS.
- DeepDesk currently supports Windows x64 and macOS arm64; Linux is out of scope.
- Playwright Electron E2E is installed; run isolated mode for CI and session mode for local visual acceptance.

## Architecture guardrails

- Renderer must not perform direct network requests.
- Platform differences belong in `src/main/platform`; do not duplicate the application or hardcode a shell in business logic.
- IPC changes follow: channel constant -> API type -> preload bridge -> main handler -> renderer caller.
- Agent tool changes follow: tool schema -> executor branch -> permission evaluation -> tests.
- Shared code belongs in `src/shared`; do not import Electron across layers.
- Tests must not call real model services, send real Feishu messages, or execute dangerous commands.

## References

Read `references/workflows.md` when changing IPC, Agent tools, or preparing release candidates.

Read `docs/folder-map.md` when routing work across multiple project folders.
