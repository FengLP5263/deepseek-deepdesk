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

export async function startMockChatServer(reply = '已收到记忆上下文。'): Promise<MockChatServer> {
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
      writeSse(res, { id: 'mock-1', model: body.model ?? 'mock-chat', choices: [{ index: 0, delta: { role: 'assistant' } }] })
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

export function createMemoryUserData(baseUrl: string): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'mock-local',
      defaultModelId: 'mock-chat',
      temperature: 1,
      theme: 'light',
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

export function createLongAgentSessionUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))
  const content = Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 段本地验收内容，用于验证长对话阅读和回到底部操作。`).join('\n\n')
  const state = {
    settings: {
      version: 1,
      defaultProviderId: 'deepseek',
      defaultModelId: 'deepseek-v4-flash',
      temperature: 1,
      theme: 'light',
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
      steps: [
        { kind: 'task', text: '请展示一段较长的本地会话内容。' },
        { kind: 'text', text: content }
      ],
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

export async function launchDeepDesk(userDataDir = mkdtempSync(join(tmpdir(), 'deepdesk-e2e-'))): Promise<DeepDeskE2EApp> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      DEEPDESK_USER_DATA_DIR: userDataDir,
      DEEPDESK_E2E_PICK_DIRECTORY: userDataDir,
      DEEPDESK_DISABLE_DIRECT_CONNECTORS: '1'
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
