import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createContextBreakdownUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('supports sidebar collapse, expand, and new task action', async () => {
  ctx = await launchDeepDesk()
  const page = ctx.page
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: /最近任务 \(0\)/ })).toHaveAttribute('aria-expanded', 'true')
  const navIconMetrics = await page.evaluate(() => Array.from(document.querySelectorAll<SVGElement>('.sidebar-nav-icon')).map(icon => ({
    width: Math.round(icon.getBoundingClientRect().width),
    height: Math.round(icon.getBoundingClientRect().height),
    iconClass: Array.from(icon.classList).find(className => className.startsWith('lucide-') && className !== 'lucide') ?? '',
    strokeWidth: icon.getAttribute('stroke-width')
  })))
  expect(navIconMetrics).toEqual([
    { width: 17, height: 17, iconClass: 'lucide-square-pen', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-search', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-link2', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-blocks', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-ellipsis', strokeWidth: '1.9' }
  ])

  await page.getByTitle('收起侧边栏').click()
  await expect(page.locator('.sidebar.collapsed')).toHaveCSS('width', '0px')
  await expect(page.getByTitle('展开侧边栏')).toBeVisible()
  await page.getByTitle('新建任务').click()
  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
  await page.getByTitle('展开侧边栏').click()
  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible()
  await expect(page.locator('.brand', { hasText: 'DeepDesk' })).toBeVisible()
  await expect(page.locator('.brand-version')).toHaveText(/^v\d+\.\d+\.\d+$/)
})

test('keeps the delete confirmation aligned at maximum interface scale', async ({ browserName: _browserName }, testInfo) => {
  ctx = await launchDeepDesk(createContextBreakdownUserData())
  const page = ctx.page
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', '100')
  await page.mouse.move(500, 300)
  await page.keyboard.down('Control')
  for (let step = 0; step < 5; step += 1) await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', '150')

  await page.getByRole('button', { name: '会话操作：上下文组成视觉回归' }).click()
  await page.getByRole('menuitem', { name: '删除会话' }).click()
  const menu = page.getByRole('menu', { name: '会话操作' })
  await expect(menu.getByText('删除这个会话？')).toBeVisible()
  await expect(menu.getByRole('button', { name: '确认删除' })).toHaveCSS('white-space', 'nowrap')
  const geometry = await menu.evaluate(element => {
    const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    return { insideSidebar: rect.left >= sidebar.left && rect.right <= sidebar.right, overflowFree: element.scrollWidth <= element.clientWidth + 1 }
  })
  expect(geometry).toEqual({ insideSidebar: true, overflowFree: true })
  await page.screenshot({ path: testInfo.outputPath('delete-confirmation-150.png') })
})
