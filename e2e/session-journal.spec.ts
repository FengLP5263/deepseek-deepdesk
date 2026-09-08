import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createMemoryUserData, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null
test.afterEach(async () => { await closeDeepDesk(ctx); ctx = null })

test('starts with legacy missing history and includes recovered dialogue when continuing', async ({ browserName: _browserName }, testInfo) => {
  const server = await startMockChatServer('仍然记得前面的对话。')
  try {
    const dir = createMemoryUserData(server.baseUrl)
    const file = join(dir, 'deepdesk.json')
    const original = JSON.parse(readFileSync(file, 'utf8'))
    const legacy = { id: 'legacy-no-history', task: '旧格式兼容验收', workdir: '', providerId: 'mock-local', modelId: 'mock-chat',
      createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '我的测试项目叫星河' }, { kind: 'text', text: '好的，项目叫星河。' }] }
    original.agentSessions = [legacy]
    writeFileSync(file, JSON.stringify(original), 'utf8')
    ctx = await launchDeepDesk(dir)
    await ctx.page.locator('.conv-item', { hasText: '旧格式兼容验收' }).click()
    await expect(ctx.page.getByText('好的，项目叫星河。', { exact: true })).toBeVisible()
    expect(JSON.parse(readFileSync(`${file}.pre-sessions-v1.bak`, 'utf8')).agentSessions).toEqual([legacy])
    await ctx.page.getByPlaceholder('发消息，或让我帮你做点事…').fill('项目叫什么？')
    await ctx.page.locator('.send-btn').click()
    await expect(ctx.page.getByText('仍然记得前面的对话。', { exact: true })).toBeVisible()
    expect(server.requests[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '我的测试项目叫星河' }),
      expect.objectContaining({ role: 'assistant', content: '好的，项目叫星河。' })
    ]))
    await ctx.page.screenshot({ path: testInfo.outputPath('legacy-migration-continued.png') })
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(dir)
    await ctx.page.locator('.conv-item', { hasText: '旧格式兼容验收' }).click()
    await expect(ctx.page.getByText('仍然记得前面的对话。', { exact: true })).toBeVisible()
  } finally { await server.close() }
})

test('migrates, journals a real renderer run, reloads and continues with prior history', async ({ browserName: _browserName }, testInfo) => {
  const server = await startMockChatServer('这条回答已保存到独立会话日志。')
  try {
    const dir = createMemoryUserData(server.baseUrl)
    ctx = await launchDeepDesk(dir)
    await ctx.page.getByPlaceholder('发消息，或让我帮你做点事…').fill('验证独立日志保存')
    await ctx.page.locator('.send-btn').click()
    await expect(ctx.page.getByText('这条回答已保存到独立会话日志。')).toBeVisible()
    await expect(ctx.page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
    const sessions = await ctx.page.evaluate(() => window.api.agent.listSessions())
    const current = sessions.find(session => session.task === '验证独立日志保存')!
    expect(current).toBeTruthy()
    const key = createHash('sha256').update(JSON.stringify(['agent', current.id])).digest('hex')
    const journal = join(dir, 'sessions', key, 'events.jsonl')
    await expect.poll(() => existsSync(journal) && readFileSync(journal, 'utf8').includes('这条回答已保存')).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'deepdesk.json'), 'utf8')).agentSessions).toEqual([])
    await ctx.page.screenshot({ path: testInfo.outputPath('completed-journal-session.png') })
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(dir)
    await ctx.page.locator('.conv-item', { hasText: '验证独立日志保存' }).click()
    await expect(ctx.page.getByText('这条回答已保存到独立会话日志。')).toBeVisible()
    await ctx.page.getByPlaceholder('发消息，或让我帮你做点事…').fill('继续，记得上一条吗？')
    await ctx.page.locator('.send-btn').click()
    await expect.poll(() => server.requests.length).toBe(2)
    expect(server.requests[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '验证独立日志保存' }),
      expect.objectContaining({ role: 'assistant', content: '这条回答已保存到独立会话日志。' })
    ]))
    expect(readdirSync(join(dir, 'sessions')).filter(file => /^[a-f0-9]{64}$/.test(file))).toContain(key)
  } finally { await server.close() }
})

test('recovers an in-flight main-process checkpoint after the test client is terminated', async ({ browserName: _browserName }, testInfo) => {
  let requests = 0
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      requests++
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '这是已经输出但尚未完成的内容。' } }] }) + '\n\n')
      // Intentionally leave the mock response open, so no terminal event can save it.
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as { port: number }).port
    const dir = createMemoryUserData(`http://127.0.0.1:${port}`)
    ctx = await launchDeepDesk(dir)
    await ctx.page.getByPlaceholder('发消息，或让我帮你做点事…').fill('验证中途退出恢复')
    await ctx.page.locator('.send-btn').click()
    await expect(ctx.page.getByText('这是已经输出但尚未完成的内容。')).toBeVisible()
    const id = (await ctx.page.evaluate(() => window.api.agent.listSessions())).find(item => item.task === '验证中途退出恢复')!.id
    const key = createHash('sha256').update(JSON.stringify(['agent', id])).digest('hex')
    const file = join(dir, 'sessions', key, 'events.jsonl')
    await expect.poll(() => readFileSync(file, 'utf8').includes('这是已经输出')).toBe(true)
    const child = ctx.app.process()
    const exited = once(child, 'exit')
    // app.exit bypasses before-quit/flush, but releases Chromium child-process locks too.
    await ctx.app.evaluate(({ app }) => app.exit(1)).catch(() => {})
    await exited
    ctx = null
    ctx = await launchDeepDesk(dir)
    await ctx.page.locator('.conv-item', { hasText: '验证中途退出恢复' }).click()
    await expect(ctx.page.getByText('这是已经输出但尚未完成的内容。')).toBeVisible()
    await expect(ctx.page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
    const restored = await ctx.page.evaluate(async (sessionId) => (await window.api.agent.listSessions()).find(item => item.id === sessionId), id)
    expect(restored?.history.at(-1)?.content).toBe('这是已经输出但尚未完成的内容。')
    expect(requests).toBe(1)
    await ctx.page.screenshot({ path: testInfo.outputPath('recovered-checkpoint.png') })
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
