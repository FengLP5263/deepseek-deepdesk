---
name: deepdesk-ui-design
description: Use for DeepDesk desktop UI design and polish work, including WorkBuddy/ChatGPT/DeepSeek-style visual refinement, app shell, sidebar, titlebar, composer, popovers, settings, skill marketplace, message bubbles, typography, iconography, spacing, visual QA, and E2E UI assertions. Trigger when the user says the UI feels AI-generated, ugly, inconsistent, misaligned, too colorful, too heavy, or asks to make DeepDesk simpler, more advanced, smoother, or closer to WorkBuddy.
---

# DeepDesk UI Design

## Core rule

Use this skill together with `deepdesk-engineering` for repository changes. Read `AGENTS.md`, `src/renderer/AGENTS.md`, and `e2e/AGENTS.md` before editing UI code or tests.

## Workflow

1. Inspect the current UI state: relevant React component, CSS block, E2E coverage, and any screenshot supplied by the user.
2. Apply the DeepDesk visual direction: quiet, neutral, integrated, text-led, restrained iconography, one accent color.
3. Keep implementation local and deterministic: no renderer network, no remote font loading, no runtime design dependency.
4. Update tests for visual behavior that can regress: layout alignment, one-popover-at-a-time behavior, icon metrics, font stacks, action visibility, and collapsed states.
5. Run `pnpm flow -- check`; run `pnpm flow -- e2e` for visible interaction/layout changes.
6. For feature/fix UI changes, update SemVer in both `package.json` and `src/shared/app-meta.ts`.
7. After building visible UI changes on Windows, use Computer Use for a real-client visual pass when available. Inspect the affected surface, window edges, popovers, and relevant min/default/max states. If Computer Use is unavailable, inspect screenshots from the built Electron app instead and explicitly report the fallback; automated assertions do not replace this visual review.

## Design principles

- Prefer fewer visual elements. Separate sections with space, type, subtle dividers, and simple icons.
- Avoid default browser-looking controls: no thick blue focus rings, no blue-white native select menus for custom product UI, no transparent floating menus.
- Use one active shadow or emphasis at a time. Multiple simultaneous shadows make the client look low-quality.
- Make user messages right-aligned and content-width; assistant content stays readable and borderless unless it is a structured block.
- Show secondary message actions on hover, while preserving reserved height when needed to prevent layout jump.
- Keep all popovers visually consistent: gray/elevated surface, compact radius, subtle shadow, click-outside close, only one open at a time.
- Treat screenshots as acceptance evidence. If the user marks an area, write or update E2E coverage for that area when practical.

## Detailed reference

Read `references/ui-checklist.md` when changing any visible UI surface, reviewing screenshots, creating new UI components, or adjusting spacing, fonts, icons, popovers, composer, sidebar, settings, messages, or skill marketplace.
