# DeepDesk workflow reference

## Development

1. Read `AGENTS.md`.
2. Inspect current status with `git -c core.quotepath=false status --short`.
3. Read the nearest folder-level `AGENTS.md` for every directory being edited.
4. Prefer narrow changes.
5. Run `pnpm flow -- check` for ordinary code changes.
6. Run `pnpm flow -- check --include-build` before handoff.

## IPC changes

Update files in this order:

1. `src/shared/ipc-channels.ts`
2. `src/shared/api.ts`
3. `src/preload/index.ts`
4. `src/main/ipc.ts`
5. Renderer caller
6. Tests

## Agent tool changes

Update files in this order:

1. `src/main/agent-tools.ts`
2. `src/main/tools.ts`
3. `src/main/agent.ts` permission evaluation
4. Tests for allowed, approval-required, and denied cases

## Release candidate

1. `pnpm flow -- check --include-build --include-smoke --include-e2e`
2. Run `pnpm flow -- package --target win` on Windows or `pnpm flow -- package --target mac` on Apple Silicon macOS.
3. Verify the Windows `.exe` or macOS `.dmg` under `release/`.

## CI and E2E

- PR/push CI calls `pnpm flow -- ci --include-build`.
- Windows smoke calls `pnpm flow -- test --kind smoke`.
- Manual release workflow calls `pnpm flow -- release --target <platform>`.
- E2E has stable entrypoints: `pnpm flow -- e2e` for isolated CI mode, `pnpm flow -- e2e --mode session` for local single-window acceptance, and `pnpm flow -- e2e --mode all` for both.
