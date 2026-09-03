import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createLongAgentSessionUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('renders long sessions in stable batches and loads earlier steps in place', async () => {
  ctx = await launchDeepDesk(createLongAgentSessionUserData())
  const page = ctx.page
  await page.locator('.conv-item', { hasText: '长对话视觉回归' }).click()

  const messages = page.locator('.agent-inner .agent-message')
  const loadEarlier = page.getByRole('button', { name: '加载更早的 60 条内容' })
  await expect(messages).toHaveCount(60)
  await expect(loadEarlier).toBeVisible()

  const scroll = page.locator('.agent-scroll')
  await scroll.evaluate(element => { element.scrollTop = 0 })
  const before = await scroll.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop }))
  await loadEarlier.click()
  await expect(messages).toHaveCount(120)
  await expect.poll(() => scroll.evaluate(element => element.scrollHeight)).toBeGreaterThan(before.height)
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(before.top)

  await page.getByRole('button', { name: '加载更早的 60 条内容' }).click()
  await expect(messages).toHaveCount(180)
  await expect(page.locator('.agent-load-earlier')).toHaveCount(0)
})
