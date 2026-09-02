import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

function createPinnedSessionsUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const makeSession = (id: string, updatedAt: number, pinnedAt?: number) => ({
    id,
    task: id,
    workdir: '',
    modelId: 'deepseek-v4-flash',
    createdAt: updatedAt,
    updatedAt,
    pinnedAt,
    steps: [{ kind: 'task', text: id }],
    history: []
  })
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify({
    settings: { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-flash', temperature: 1, theme: 'light', appFont: 'default', enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' },
    providers: [],
    conversations: [],
    agentSessions: [makeSession('Older', 100), makeSession('Pinned old', 50, 500), makeSession('Recent', 300)],
    memories: []
  }), 'utf8')
  return userDataDir
}

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('orders recent sessions and persists pinning from the overflow menu', async ({ browserName: _browserName }, testInfo) => {
  ctx = await launchDeepDesk(createPinnedSessionsUserData())
  const sessionTitles = ctx.page.locator('.sidebar-scroll:not(.compact) .conv-title-text')
  await expect(sessionTitles).toHaveText(['Pinned old', 'Recent', 'Older'])

  const recent = ctx.page.locator('.conv-item', { hasText: 'Recent' })
  await recent.getByRole('button', { name: '会话操作：Recent' }).click()
  await ctx.page.getByRole('menuitem', { name: '置顶会话' }).click()
  await expect(sessionTitles).toHaveText(['Recent', 'Pinned old', 'Older'])
  await expect.poll(() => {
    const state = JSON.parse(readFileSync(join(ctx!.userDataDir, 'deepdesk.json'), 'utf8')) as { agentSessions: Array<{ id: string; pinnedAt?: number }> }
    return typeof state.agentSessions.find(item => item.id === 'Recent')?.pinnedAt
  }).toBe('number')

  await testInfo.attach('session-pin', { body: await ctx.page.screenshot(), contentType: 'image/png' })
  const userDataDir = ctx.userDataDir
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = await launchDeepDesk(userDataDir)
  await expect(ctx.page.locator('.sidebar-scroll:not(.compact) .conv-title-text')).toHaveText(['Recent', 'Pinned old', 'Older'])
  await ctx.page.getByRole('button', { name: /搜索任务/ }).click()
  await expect(ctx.page.locator('.session-search-result-title')).toHaveText(['Recent', 'Pinned old', 'Older'])
  await ctx.page.keyboard.press('Escape')
  const persisted = ctx.page.locator('.conv-item', { hasText: 'Recent' })
  await persisted.getByRole('button', { name: '会话操作：Recent' }).click()
  await expect(ctx.page.getByRole('menuitem', { name: '取消置顶' })).toBeVisible()
})
