import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { DeepDeskE2EApp, MockChatRequest } from './helpers'
import { closeDeepDesk, createMemoryUserData, launchDeepDesk, openSettings } from './helpers'

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { resolve({}) }
    })
  })
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write('data: ' + JSON.stringify(payload) + '\n\n')
}

test('installs and connects a local stdio MCP from the conversation after confirmation', async ({ browserName: _browserName }, testInfo) => {
  const fixture = join(process.cwd(), 'tests', 'fixtures', 'mcp-stdio-server.mjs')
  const server = createServer(async (req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
      return
    }
    if (req.url !== '/chat/completions') { res.writeHead(404); res.end(); return }
    const body = await readJson(req) as MockChatRequest
    const toolMessages = (body.messages ?? []).filter(message => message.role === 'tool')
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    if (toolMessages.length === 0) {
      writeSse(res, { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'inspect-stdio', type: 'function', function: { name: 'inspect_mcp_server', arguments: JSON.stringify({ name: 'DeepDesk Test MCP', command: process.execPath, args: [fixture] }) } }] } }] })
      writeSse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else if (toolMessages.length === 1) {
      const candidateId = (JSON.parse(String(toolMessages[0].content ?? '{}')) as { candidate_id?: string }).candidate_id ?? ''
      writeSse(res, { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'install-stdio', type: 'function', function: { name: 'install_mcp_server', arguments: JSON.stringify({ candidate_id: candidateId }) } }] } }] })
      writeSse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      writeSse(res, { choices: [{ index: 0, delta: { role: 'assistant', content: '本地 MCP 已由 DeepDesk 安装并连接。' } }] })
      writeSse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  let ctx: DeepDeskE2EApp | null = null

  try {
    ctx = await launchDeepDesk(createMemoryUserData(baseUrl))
    const page = ctx.page
    await page.getByPlaceholder('发消息，或让我帮你做点事…').fill('安装这个本地 MCP')
    await page.locator('.send-btn').click()

    const approval = page.getByRole('dialog', { name: '安装 MCP 服务' })
    await expect(approval).toBeVisible()
    await expect(approval).toContainText('DeepDesk Test MCP')
    await expect(approval).toContainText(process.execPath)
    await expect(approval).toContainText('启动并验证这个本地 MCP 进程')
    await expect(approval.getByRole('button', { name: '安装并连接' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('stdio-mcp-install-approval.png') })
    await approval.getByRole('button', { name: '安装并连接' }).click()
    await expect(page.getByText('本地 MCP 已由 DeepDesk 安装并连接。')).toBeVisible()

    await openSettings(page)
    await page.getByRole('button', { name: 'MCP', exact: true }).click()
    const card = page.locator('.mcp-card', { hasText: 'DeepDesk Test MCP' })
    await expect(card).toContainText('已连接')
    await expect(card).toContainText('1 个可用工具')
  } finally {
    await closeDeepDesk(ctx)
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
