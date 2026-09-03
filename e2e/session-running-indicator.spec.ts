import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createMemoryUserData, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('transitions a background session from a calm spinner to a persistent unread marker', async () => {
  const mock = await startMockChatServer('后台任务已完成', 5000)
  try {
    ctx = await launchDeepDesk(createMemoryUserData(mock.baseUrl))
    await ctx.page.getByPlaceholder('发消息，或让我帮你做点事…').fill('检查会话运行状态')
    await ctx.page.locator('.send-btn').click()

    const session = ctx.page.locator('.conv-item', { hasText: '检查会话运行状态' })
    const indicator = session.getByRole('status', { name: '任务进行中' })
    const unread = session.getByRole('status', { name: '未读更新' })
    await expect(indicator).toHaveCount(0)
    await expect(unread).toHaveCount(0)

    await ctx.page.getByRole('button', { name: '连接器' }).click()
    await expect(indicator).toBeVisible()
    expect(await indicator.evaluate(element => {
      const style = getComputedStyle(element)
      return { animationName: style.animationName, animationDuration: style.animationDuration }
    })).toEqual({ animationName: 'spin', animationDuration: '1.8s' })
    await expect(unread).toBeVisible()
    await expect(indicator).toHaveCount(0)

    await session.click()
    await expect(ctx.page.getByText('后台任务已完成')).toBeVisible()
    await expect(indicator).toHaveCount(0)
    await expect(unread).toHaveCount(0)
    await ctx.page.getByRole('button', { name: '连接器' }).click()
    await expect(unread).toHaveCount(0)
  } finally {
    await mock.close()
  }
})

test('shows model reasoning as a collapsible shimmer without a spinner', async () => {
  const reasoning = '先核对当前信息，再组织最终回答。'
  const mock = await startMockChatServer('分析完成。', 800, reasoning)
  try {
    ctx = await launchDeepDesk(createMemoryUserData(mock.baseUrl))
    await ctx.page.getByPlaceholder('发消息，或让我帮你做点事…').fill('分析这个问题')
    await ctx.page.locator('.send-btn').click()

    const activeThinking = ctx.page.getByRole('button', { name: /思考中/ })
    await expect(activeThinking).toBeVisible()
    await expect(ctx.page.locator('.thinking-icon')).toHaveCount(0)
    expect(await activeThinking.locator('.thinking-status').evaluate(element => {
      const style = getComputedStyle(element)
      return { animationName: style.animationName, animationDuration: style.animationDuration }
    })).toEqual({ animationName: 'thinkingShimmer', animationDuration: '1.8s' })

    await expect(ctx.page.getByText('分析完成。')).toBeVisible()
    const completedThinking = ctx.page.getByRole('button', { name: /已思考/ })
    await expect(completedThinking).toHaveAttribute('aria-expanded', 'false')
    await expect(ctx.page.getByText(reasoning)).toHaveCount(0)
    await completedThinking.click()
    await expect(completedThinking).toHaveAttribute('aria-expanded', 'true')
    await expect(ctx.page.getByText(reasoning)).toBeVisible()
    await completedThinking.click()
    await expect(ctx.page.getByText(reasoning)).toHaveCount(0)
  } finally {
    await mock.close()
  }
})
