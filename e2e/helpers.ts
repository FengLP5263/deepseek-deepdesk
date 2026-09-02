import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface DeepDeskE2EApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

export interface MockChatRequest {
  model?: string
  messages?: Array<Record<string, unknown>>
  tools?: Array<Record<string, unknown>>
  stream?: boolean
}

export interface MockChatServer {
  baseUrl: string
  requests: MockChatRequest[]
  close: () => Promise<void>
}

export interface MockMcpInstallServer extends MockChatServer {
  mcpUrl: string
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve({})
      }
    })
  })
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write('data: ' + JSON.stringify(payload) + '\n\n')
}

export async function startMockChatServer(reply = '已收到记忆上下文。', responseDelayMs = 0, reasoning = ''): Promise<MockChatServer> {
  const requests: MockChatRequest[] = []
  const server = createServer(async (req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
      return
    }
    if (req.url === '/chat/completions') {
      const body = await readJsonBody(req) as MockChatRequest
      requests.push(body)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      if (responseDelayMs > 0) await new Promise(resolve => setTimeout(resolve, responseDelayMs))
      writeSse(res, { id: 'mock-1', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: { role: 'assistant' } }] })
      if (reasoning) writeSse(res, { id: 'mock-1', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: { reasoning_content: reasoning } }] })
      writeSse(res, { id: 'mock-1', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: { content: reply } }] })
      writeSse(res, { id: 'mock-1', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    baseUrl: 'http://127.0.0.1:' + port,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve()))
  }
}

export async function startMockApprovalServer(): Promise<MockChatServer> {
  const requests: MockChatRequest[] = []
  const server = createServer(async (req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
      return
    }
    if (req.url === '/chat/completions') {
      const body = await readJsonBody(req) as MockChatRequest
      requests.push(body)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      writeSse(res, {
        id: 'mock-approval',
        model: body.model ?? 'mock-chat',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_approval_1',
              type: 'function',
              function: {
                name: 'run_command',
                arguments: JSON.stringify({ command: 'node -v' })
              }
            }]
          }
        }]
      })
      writeSse(res, { id: 'mock-approval', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    baseUrl: 'http://127.0.0.1:' + port,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve()))
  }
}

export async function startMockMcpInstallServer(): Promise<MockMcpInstallServer> {
  const requests: MockChatRequest[] = []
  let mcpUrl = ''

  const server = createServer(async (req, res) => {
    if (req.url === '/mcp') {
      const body = await readJsonBody(req) as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> }
      if (body.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      let result: Record<string, unknown>
      if (body.method === 'initialize') {
        result = {
          protocolVersion: String(body.params?.protocolVersion ?? '2025-11-25'),
          capabilities: { tools: {} },
          serverInfo: { name: 'DeepDesk Docs', version: '1.2.0' }
        }
      } else if (body.method === 'tools/list') {
        result = {
          tools: [{
            name: 'search_docs',
            description: '搜索团队文档',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            annotations: { readOnlyHint: true, destructiveHint: false }
          }]
        }
      } else if (body.method === 'tools/call') {
        result = { content: [{ type: 'text', text: 'result:ok' }] }
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32601, message: 'Method not found' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      return
    }
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
      return
    }
    if (req.url === '/chat/completions') {
      const body = await readJsonBody(req) as MockChatRequest
      requests.push(body)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const toolMessages = (body.messages ?? []).filter(message => message.role === 'tool')
      if (toolMessages.length === 0) {
        writeSse(res, {
          id: 'mock-mcp-inspect',
          model: body.model ?? 'mock-chat',
          choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_inspect_mcp', type: 'function', function: { name: 'inspect_mcp_server', arguments: JSON.stringify({ source: mcpUrl }) } }] } }]
        })
        writeSse(res, { id: 'mock-mcp-inspect', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else if (toolMessages.length === 1) {
        const content = String(toolMessages[0].content ?? '{}')
        let candidateId = ''
        try {
          candidateId = (JSON.parse(content) as { candidate_id?: string }).candidate_id ?? ''
        } catch {
          throw new Error(`MCP inspection failed in E2E: ${content}`)
        }
        writeSse(res, {
          id: 'mock-mcp-install',
          model: body.model ?? 'mock-chat',
          choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_install_mcp', type: 'function', function: { name: 'install_mcp_server', arguments: JSON.stringify({ candidate_id: candidateId }) } }] } }]
        })
        writeSse(res, { id: 'mock-mcp-install', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        writeSse(res, { id: 'mock-mcp-done', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: { role: 'assistant' } }] })
        writeSse(res, { id: 'mock-mcp-done', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: { content: 'MCP 服务已安装并连接。' } }] })
        writeSse(res, { id: 'mock-mcp-done', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const baseUrl = 'http://127.0.0.1:' + port
  mcpUrl = baseUrl + '/mcp'
  return {
    baseUrl,
    mcpUrl,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve()))
  }
}

export function createMemoryUserData(baseUrl: string): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'mock-local',
      defaultModelId: 'mock-chat',
      temperature: 1,
      theme: 'light',
      appFont: 'default',
      enterToSend: true,
      agentWorkdir: '',
      agentPermissionMode: 'ask'
    },
    providers: [{
      id: 'mock-local',
      name: 'Mock Local',
      type: 'openai',
      baseUrl,
      apiKey: 'sk-e2e',
      models: [{ id: 'mock-chat', name: 'Mock Chat' }],
      createdAt: 1
    }],
    conversations: [],
    agentSessions: [],
    memories: []
  }
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify(state), 'utf8')
  return userDataDir
}

export function createMultiProviderUserData(baseUrl: string): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'mock-local',
      defaultModelId: 'mock-chat',
      temperature: 1,
      theme: 'light',
      appFont: 'default',
      enterToSend: true,
      agentWorkdir: '',
      agentPermissionMode: 'ask'
    },
    providers: [
      {
        id: 'mock-local',
        name: 'Mock Local',
        type: 'openai',
        baseUrl,
        apiKey: 'sk-mock',
        models: [{ id: 'mock-chat', name: 'Mock Chat' }],
        createdAt: 1
      },
      {
        id: 'zhipu-local',
        name: '智谱模型',
        type: 'openai',
        baseUrl,
        apiKey: 'sk-zhipu',
        models: [{ id: 'glm-5.3-flash', name: 'GLM 5.3 Flash' }],
        createdAt: 2
      }
    ],
    conversations: [],
    agentSessions: [],
    memories: []
  }
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify(state), 'utf8')
  return userDataDir
}

export function createLongAgentSessionUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const steps = Array.from({ length: 180 }, (_, index) => ({
    kind: index % 2 === 0 ? 'task' : 'text',
    text: `第 ${index + 1} 条本地验收内容，用于验证长对话阅读和分批加载。`
  }))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'deepseek',
      defaultModelId: 'deepseek-v4-flash',
      temperature: 1,
      theme: 'light',
      appFont: 'default',
      enterToSend: true,
      agentWorkdir: '',
      agentPermissionMode: 'ask'
    },
    providers: [],
    conversations: [],
    agentSessions: [{
      id: 'long-session',
      task: '长对话视觉回归',
      workdir: '',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 1,
      steps,
      history: []
    }]
  }
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify(state), 'utf8')
  return userDataDir
}

export function createMessageActionsUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'deepseek',
      defaultModelId: 'deepseek-v4-flash',
      temperature: 1,
      theme: 'light',
      appFont: 'default',
      enterToSend: true,
      agentWorkdir: '',
      agentPermissionMode: 'ask'
    },
    providers: [],
    conversations: [],
    agentSessions: [{
      id: 'message-actions',
      task: '消息操作视觉回归',
      workdir: '',
      createdAt: 1,
      updatedAt: 1,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      steps: [
        { kind: 'task', text: '你看看这个是什么类型' },
        { kind: 'text', text: '这是 TypeScript 示例：\n\n```ts\nexport const greeting = \'Hello, DeepDesk\'\n```' }
      ],
      history: []
    }]
  }
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify(state), 'utf8')
  return userDataDir
}

export function createContextBreakdownUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'deepseek',
      defaultModelId: 'deepseek-v4-flash',
      temperature: 1,
      theme: 'light',
      appFont: 'default',
      enterToSend: true,
      agentWorkdir: '',
      agentPermissionMode: 'ask'
    },
    providers: [],
    conversations: [],
    agentSessions: [{
      id: 'context-breakdown',
      task: '上下文组成视觉回归',
      workdir: '',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 1,
      steps: [
        { kind: 'task', text: '解释上下文组成' },
        { kind: 'tool', callId: 'call-1', name: 'read_file', args: JSON.stringify({ path: 'src/main/store.ts' }), status: 'ok', result: 'store.ts 中包含持久化逻辑。' },
        { kind: 'text', text: '上下文由系统指令、用户消息、AI 回复和工具信息共同组成。' }
      ],
      history: [
        { role: 'system', content: '系统指令：你是 DeepDesk Agent。长期记忆：用户偏好简洁结论。' },
        { role: 'user', content: '请解释上下文组成。' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/main/store.ts' }) }
          }]
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'store.ts 中包含持久化逻辑。' },
        { role: 'assistant', content: '上下文由系统指令、用户消息、AI 回复和工具信息共同组成。' }
      ]
    }],
    memories: []
  }
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify(state), 'utf8')
  return userDataDir
}

export function createConnectorSessionUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'deepseek',
      defaultModelId: 'deepseek-v4-flash',
      temperature: 1,
      theme: 'light',
      appFont: 'default',
      enterToSend: true,
      agentWorkdir: '',
      agentPermissionMode: 'ask'
    },
    providers: [],
    conversations: [],
    connectors: [],
    connectorActivities: [],
    agentSessions: [
      {
        id: 'normal-task',
        task: '普通本地任务',
        workdir: '',
        modelId: 'deepseek-v4-flash',
        createdAt: 1,
        updatedAt: 2,
        steps: [{ kind: 'task', text: '普通本地任务' }],
        history: []
      },
      {
        id: 'connector-wechat-room-1',
        task: '项目微信群',
        workdir: '',
        modelId: 'deepseek-v4-flash',
        createdAt: 1,
        updatedAt: 3,
        steps: [
          { kind: 'task', text: '帮我同步这条微信消息', sourceActivityId: 'wx-1', sourceConnectorId: 'wechat' },
          { kind: 'text', text: '已同步到 DeepDesk 桌面端。' }
        ],
        history: [],
        source: {
          type: 'connector',
          connectorId: 'wechat',
          externalThreadId: 'room-1',
          externalConversationName: '项目微信群'
        }
      }
    ],
    memories: []
  }
  writeFileSync(join(userDataDir, 'deepdesk.json'), JSON.stringify(state), 'utf8')
  return userDataDir
}

export async function launchDeepDesk(userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))): Promise<DeepDeskE2EApp> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      DEEPDESK_USER_DATA_DIR: userDataDir,
      DEEPDESK_E2E_PICK_DIRECTORY: userDataDir,
      DEEPDESK_DISABLE_DIRECT_CONNECTORS: '1',
      DEEPDESK_DISABLE_BROWSER_EXTENSION_BRIDGE: '1',
      DEEPDESK_BROWSER_CONNECT_TIMEOUT_MS: '0',
      DEEPDESK_BROWSER_EXECUTABLE: process.execPath,
      DEEPDESK_BROWSER_NAME: 'E2E Browser'
    }
  })
  const page = await app.firstWindow()
  return { app, page, userDataDir }
}

export async function closeDeepDesk(ctx: DeepDeskE2EApp | null): Promise<void> {
  if (!ctx) return
  await ctx.app.close()
  rmSync(ctx.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

export async function closeDeepDeskWithoutRemovingData(ctx: DeepDeskE2EApp | null): Promise<void> {
  if (!ctx) return
  await ctx.app.close()
}

export async function expectAppShell(page: Page): Promise<void> {
  await expect(page.locator('.brand', { hasText: 'DeepDesk' })).toBeVisible()
  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
  await expect(page.getByText('你好，我是 DeepDesk')).toBeVisible()
}

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.locator('.settings-title', { hasText: '常规' })).toBeVisible()
}

export async function getDesktopPlatform(page: Page): Promise<'windows' | 'macos'> {
  return page.evaluate(() => (window as unknown as { api: { platform: { id: 'windows' | 'macos' } } }).api.platform.id)
}

export async function pressAppShortcut(page: Page, key: string): Promise<void> {
  const modifier = await getDesktopPlatform(page) === 'macos' ? 'Meta' : 'Control'
  await page.keyboard.down(modifier)
  await page.keyboard.press(key)
  await page.keyboard.up(modifier)
}

export async function goBackToChat(page: Page): Promise<void> {
  await page.getByTitle('返回').click()
  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
}

export async function expectComposerReady(page: Page): Promise<void> {
  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
  await expect(page.getByTitle('选择模型')).toBeVisible()
  await expect(page.locator('.ctx-trigger')).toBeVisible()
}

export async function isMainWindowMaximized(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false)
}
