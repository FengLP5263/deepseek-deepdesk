import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createMemoryUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null
test.afterEach(async () => { await closeDeepDesk(ctx); ctx = null })

for (const theme of ['light', 'dark']) {
  for (const scale of [0.8, 1, 1.5]) {
    test(`keeps the skill marketplace focused and usable (${theme}, ${scale})`, async ({ browserName: _browserName }, testInfo) => {
      const dir = createMemoryUserData('http://127.0.0.1:1')
      const file = join(dir, 'deepdesk.json')
      const state = JSON.parse(readFileSync(file, 'utf8'))
      state.settings = { ...state.settings, theme, appFontScale: scale }
      writeFileSync(file, JSON.stringify(state), 'utf8')
      ctx = await launchDeepDesk(dir)
      const { page, app } = ctx
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 760))
      await page.getByRole('button', { name: '技能广场', exact: true }).click()
      const market = page.locator('.skill-market')
      await expect(market.getByRole('heading', { name: '技能广场', exact: true, level: 1 })).toBeVisible()
      await expect(market.getByRole('button', { name: '专家', exact: true })).toHaveCount(0)
      await expect(market.getByRole('button', { name: '连接器', exact: true })).toHaveCount(0)
      await expect(market.locator('.skill-top-tabs')).toHaveCount(0)
      await expect(market.getByText('SkillHub', { exact: true })).toHaveCount(0)
      await expect(market.getByText('套件', { exact: true })).toHaveCount(0)
      await expect(market.locator('.skill-tabs')).toHaveCount(0)
      await expect(market.getByRole('heading', { name: '推荐技能', level: 2 })).toBeVisible()
      await expect(market.getByPlaceholder('搜索技能')).toBeVisible()
      await expect(market.getByRole('button', { name: /我安装的/ })).toBeVisible()
      await expect(market.getByRole('button', { name: '添加技能', exact: true })).toBeVisible()
      await expect.poll(() => market.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const layout = await market.locator('.skill-market-top').evaluate(element => {
        const title = element.querySelector('h1')!.getBoundingClientRect()
        const actions = element.querySelector('.skill-market-actions')!.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return { separated: title.right <= actions.left + 1 || title.bottom <= actions.top + 1, inside: actions.right <= bounds.right + 1 }
      })
      expect(layout).toEqual({ separated: true, inside: true })
      await page.screenshot({ path: testInfo.outputPath(`market-${theme}-${scale}.png`) })
      await market.getByRole('heading', { name: '推荐技能', level: 2 }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`recommendations-${theme}-${scale}.png`) })
      await market.getByPlaceholder('搜索技能').fill('UI 走查')
      await expect(market.locator('.skill-grid .skill-card')).toHaveCount(1)
      await market.getByRole('button', { name: /我安装的/ }).click()
      await expect(market.locator('.skill-grid .skill-card')).toHaveCount(1)
      await page.getByRole('button', { name: '连接器', exact: true }).click()
      await expect(page.getByRole('heading', { name: '连接器', exact: true })).toBeVisible()
    })
  }
}
