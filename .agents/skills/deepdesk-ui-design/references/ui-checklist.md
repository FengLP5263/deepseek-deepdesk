# DeepDesk UI Checklist

## Visual direction

DeepDesk should feel like a serious desktop productivity client, not an AI demo. The target is closer to WorkBuddy / ChatGPT desktop: quiet, compact, high-signal, neutral, and smooth.

## Typography

- Use local font assets, never remote font loading in renderer.
- Body stack:
  - `Alimama FangYuanTi VF`
  - system fallbacks: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `PingFang SC`, `Microsoft YaHei UI`, `Microsoft YaHei`, `Noto Sans SC`, `sans-serif`
- Display/title stack:
  - `Alimama ShuHeiTi`
  - fallback to body stack
- Code stack:
  - `SF Mono`, `Monaco`, `Cascadia Code`, `Roboto Mono`, `Consolas`, `Courier New`, `monospace`
- Composer bottom controls should share one visual weight. Current target: `15px`, `font-weight: 400`, `line-height: 22px`.
- Do not mix bold control labels with normal status text in the same row unless there is a semantic reason.

## Color and surface

- Use neutral surfaces first: `--bg`, `--bg-panel`, `--bg-elevated`, `--sidebar-surface`.
- Use a single accent sparingly. Avoid adding extra blues, greens, purples, or gradients unless the state genuinely requires it.
- Prefer subtle active backgrounds over borders for selected nav/menu items.
- Avoid thick outline rings. Keep focus visible but refined.
- Menus must be opaque/elevated, not transparent.

## App shell and titlebar

- The top titlebar and left shell should feel integrated, not like two crossed grid lines.
- Titlebar height target: `34px`.
- Do not show `DeepDesk · 对话` style text in the titlebar. Use compact icon tools instead.
- Left titlebar tools:
  - first: expand/collapse sidebar
  - second: new task
- Windows window controls stay on the right; macOS uses native traffic lights on the left and reserves their inset space.
- Collapsed sidebar target: width `0px`; provide the expand entry from titlebar.

## Sidebar

- Default width target: `220px`.
- Keep brand area compact; show app version under brand name.
- Left nav primary entries:
  - 新建任务: `SquarePen`
  - 连接器: `Link2`
  - 技能广场: `Blocks`
  - 更多: `MoreHorizontal`
- Nav icon target: `17px`, `strokeWidth=1.9`.
- Use one selected item background at a time. Hover should be subtle.
- Recent tasks must support expand/collapse.
- Footer account should be generic unless real account data is available. Do not invent user names.

## Composer

- New/empty task composer should sit near the visual center, not glued to the bottom.
- Active conversation composer can sit at the bottom.
- Bottom row controls should be balanced:
  - permission selector
  - workspace folder
  - context meter
  - model selector
  - send/stop
- Permission, workspace, and model labels should use the same size and weight.
- Workspace label should show only the final folder name when space is limited.
- Avoid backgrounds behind permission/model controls unless needed for active state.

## Popovers and menus

- All product popovers should share the same style as the model picker:
  - gray/elevated background
  - compact radius around `8px`
  - subtle shadow
  - opaque surface
  - compact rows
- Only one popover should be open at a time.
- Click outside must close popovers, including clicks into the textarea.
- Remove non-essential metadata such as model price multipliers unless the user explicitly asks for it.

## Messages

- User messages:
  - right aligned
  - content-width, not fixed width
  - simple soft bubble
  - support copy and edit actions on hover
- Assistant messages:
  - readable text area, usually no card border
  - support copy, regenerate, like, dislike, and related actions
  - actions appear on hover except where always-visible last-message controls are intentional
- Code blocks:
  - support copy
  - support download
  - language label should be small and quiet
  - no loud borders
- Error blocks must avoid action-button overlap; reserve spacing when necessary.

## Settings

- Settings should follow a desktop app settings pattern:
  - left navigation
  - content aligned to a consistent column
  - neutral cards
  - compact row controls
- Search, nav item, and content column left edges must align.
- Avoid overly rounded cards and oversized empty whitespace.

## Skill marketplace / feature hub

- Use round skill avatars, not square icons with large rounded corners.
- Cards should be consistent in height, icon size, title weight, and action placement.
- Toolbar chips must not wrap awkwardly when the window narrows.
- Search and installed filters should use the same neutral control language.

## Test expectations

Add or update E2E coverage for UI changes that affect:

- titlebar tools and drag/no-drag zones
- sidebar collapse/expand width and entry point
- nav icon names, sizes, and stroke width
- font stacks and loaded local fonts
- composer toolbar typography
- one-popover-at-a-time behavior
- click-outside popover closing
- message action visibility
- code block copy/download controls
- settings alignment
- skill marketplace responsive toolbar and round avatars

Use `pnpm flow -- e2e` for visible interaction changes. Use `pnpm flow -- check` before handoff.
