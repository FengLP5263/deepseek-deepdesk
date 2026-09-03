# DeepDesk workflow reference

## Git Flow

1. Keep `main` and `develop` as permanent branches.
2. Start ordinary work on `develop` or a short-lived branch created from `develop`; ordinary PRs target `develop`.
3. Use Squash Merge for ordinary PRs when practical.
4. Release only through a reviewed `develop` → `main` PR after the complete release gate.
5. Squash Merge the release PR so `main` receives one release commit while `develop` retains its detailed history.
6. Immediately merge the new `main` commit back into `develop` with a normal merge commit, then push both permanent branches to both remotes. Do not substitute rebase, reset, or force push.
7. Create and push the annotated `vX.Y.Z` tag from the `main` release commit only when formally publishing that version.
8. See `docs/git-flow.md` for branch protection and exact commands.

## Development

1. Read `AGENTS.md`.
2. Inspect current status with `git -c core.quotepath=false status --short`.
3. Read the nearest folder-level `AGENTS.md` for every directory being edited.
4. Confirm the current branch follows the Git Flow rules above.
5. Prefer narrow changes.
6. Run `pnpm flow -- check` for ordinary code changes.
7. Run `pnpm flow -- check --include-build` before handoff.

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

1. Prepare the version and release notes on `develop`.
2. `pnpm flow -- check --include-build --include-smoke --include-e2e`
3. Run `pnpm flow -- package --target win` on Windows or `pnpm flow -- package --target mac` on Apple Silicon macOS.
4. Verify the Windows `.exe` or macOS `.dmg` under `release/`.
5. Squash Merge a reviewed `develop` → `main` release PR.
6. Merge the resulting `main` release commit back into `develop` with a normal merge commit and synchronize both branches to both remotes.
7. For a formal release, create and push the annotated `vX.Y.Z` tag from the `main` release commit.

## CI and E2E

- PR/push CI calls `pnpm flow -- ci --include-build`.
- Windows smoke calls `pnpm flow -- test --kind smoke`.
- Manual release workflow calls `pnpm flow -- release --target <platform>`.
- E2E has stable entrypoints: `pnpm flow -- e2e` for isolated CI mode, `pnpm flow -- e2e --mode session` for local single-window acceptance, and `pnpm flow -- e2e --mode all` for both.
