# Architecture Quality Workflow

Use this reference whenever adding a feature, creating a module, or touching a file near its size budget.

1. Run `pnpm architecture` before and after structural changes.
2. Keep React components and Zustand stores focused on one domain responsibility.
3. Put renderer network/file/command side effects behind typed preload IPC and Main handlers.
4. When a file approaches 80% of its budget, create a new module for the new responsibility.
5. Never raise a limit or legacy exception only to make CI pass. A changed exception requires an explicit reason, target size, and architecture review.
6. Add behavior tests in a domain-specific test file; do not append unrelated scenarios to a legacy aggregate spec.

Canonical limits, legacy debt, and decomposition guidance are in `docs/architecture-quality.md`. Executable policy lives in `scripts/architecture-budget.json`; enforcement lives in `scripts/check-architecture.mjs`.
