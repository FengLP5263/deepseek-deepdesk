import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createMemoryUserData, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('retries a failed task in place after the user changes model availability', async ({ browserName: _browserName }, testInfo) => {
  const mock = await startMockChatServer('换用可用模型后已恢复')
  try {
    const userDataDir = createMemoryUserData(mock.baseUrl)
    const statePath = join(userDataDir, 'deepdesk.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { agentSessions: unknown[] }
    state.agentSessions = [{
      id: 'failed-session',
      task: '继续完成原任务',
      workdir: '',
      providerId: 'mock-local',
      modelId: 'mock-chat',
      createdAt: 1,
      updatedAt: 2,
      steps: [{ kind: 'task', text: '继续完成原任务' }, { kind: 'error', message: '原模型当前不可用' }],
      history: []
    }]
    writeFileSync(statePath, JSON.stringify(state), 'utf8')
    ctx = await launchDeepDesk(userDataDir)

    await ctx.page.locator('.conv-item', { hasText: '继续完成原任务' }).click()
    const failure = ctx.page.getByRole('alert').filter({ hasText: '原模型当前不可用' })
    await expect(failure).toBeVisible()
    await testInfo.attach('failed-task-retry', { body: await ctx.page.screenshot(), contentType: 'image/png' })
    await failure.getByRole('button', { name: '重试' }).click()
    await expect(ctx.page.getByText('换用可用模型后已恢复')).toBeVisible()
    await expect(failure).toHaveCount(0)
    expect(mock.requests).toHaveLength(1)
  } finally {
    await mock.close()
  }
})
