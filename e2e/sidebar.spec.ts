import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, launchDeepDesk } from './helpers'

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
