import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createMemoryUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null
test.afterEach(async () => { await closeDeepDesk(ctx); ctx = null })

for (const [theme, scale] of [['light', 1], ['dark', 1.5]] as const) {
  test(`archives, restores and confirms permanent deletion (${theme}, ${scale})`, async ({ browserName: _browserName }, testInfo) => {
    const dir = createMemoryUserData('http://127.0.0.1:1')
    const file = join(dir, 'deepdesk.json')
    const seed = JSON.parse(readFileSync(file, 'utf8'))
    seed.settings = { ...seed.settings, theme, appFontScale: scale }
    seed.agentSessions = [{ id: 'archive-ui', task: '需要保留的会话', providerId: 'mock-local', modelId: 'mock-chat', workdir: '', createdAt: 1, updatedAt: 1,
      steps: [{ kind: 'task', text: '重要的历史内容' }, { kind: 'text', text: '这条回复必须可以恢复。' }],
      history: [{ role: 'user', content: '重要的历史内容' }, { role: 'assistant', content: '这条回复必须可以恢复。' }] }]
    writeFileSync(file, JSON.stringify(seed))
    ctx = await launchDeepDesk(dir)
    let page = ctx.page
    await page.locator('.conv-item', { hasText: '需要保留的会话' }).click()
    await page.getByRole('button', { name: '会话操作：需要保留的会话' }).click()
    await page.getByRole('menuitem', { name: '归档会话' }).click()
    await expect(page.locator('.conv-item', { hasText: '需要保留的会话' })).toHaveCount(0)
    expect((await page.evaluate(() => window.api.sessionArchive.list())).map(s => s.id)).toEqual(['archive-ui'])
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(dir)
    page = ctx.page
    await expect(page.locator('.conv-item', { hasText: '需要保留的会话' })).toHaveCount(0)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '归档', exact: true }).click()
    const row = page.locator('.archive-row', { hasText: '需要保留的会话' })
    await expect(row).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`archive-${theme}-${scale}.png`), animations: 'disabled' })
    await row.getByRole('button', { name: '恢复', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('已恢复会话')
    await page.getByRole('button', { name: '返回应用', exact: true }).click()
    await page.locator('.conv-item', { hasText: '需要保留的会话' }).click()
    await expect(page.getByText('这条回复必须可以恢复。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '会话操作：需要保留的会话' }).click()
    await page.getByRole('menuitem', { name: '归档会话' }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '归档', exact: true }).click()
    await row.getByRole('button', { name: '永久删除', exact: true }).click()
    const modal = page.locator('.modal')
    await expect(modal).toContainText('无法恢复')
    await modal.getByRole('button', { name: '取消', exact: true }).click()
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '永久删除', exact: true }).click()
    await expect(modal.getByRole('button', { name: '确认永久删除' })).toHaveCSS('white-space', 'nowrap')
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`delete-confirm-${theme}-${scale}.png`), animations: 'disabled' })
    await modal.getByRole('button', { name: '确认永久删除' }).click()
    await expect(page.getByText('暂无归档会话', { exact: true })).toBeVisible()
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(dir)
    expect(await ctx.page.evaluate(() => window.api.sessionArchive.list())).toEqual([])
    expect(await ctx.page.evaluate(() => window.api.agent.listSessions())).toEqual([])
  })
}
