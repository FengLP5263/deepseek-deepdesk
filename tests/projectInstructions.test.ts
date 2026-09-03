import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../src/main/agent'
import { loadProjectInstructions } from '../src/main/project-instructions'
import type { PlatformInfo } from '../src/shared/platform'

const roots: string[] = []
const platform: PlatformInfo = { id: 'windows', label: 'Windows', shellName: 'powershell' }

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepdesk-instructions-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('project instructions', () => {
  it('工作目录没有规则文件时不注入额外内容', async () => {
    expect(await loadProjectInstructions(createRoot())).toBeNull()
  })

  it('读取 AGENTS.md 并装配到稳定系统指令', async () => {
    const root = createRoot()
    writeFileSync(join(root, 'AGENTS.md'), '# 约定\n\n- 提交前运行测试。', 'utf8')
    const instructions = await loadProjectInstructions(root)
    const prompt = buildSystemPrompt(root, platform, 'ask', 'execute', instructions)

    expect(instructions).toMatchObject({ content: '# 约定\n\n- 提交前运行测试。', truncated: false })
    expect(prompt).toContain('项目协作指令（来自工作目录中的 AGENTS.md）')
    expect(prompt).toContain('提交前运行测试')
    expect(prompt.indexOf('DeepDesk 的安全与权限规则')).toBeLessThan(prompt.indexOf('提交前运行测试'))
  })

  it('AGENTS.override.md 存在时优先使用覆盖规则', async () => {
    const root = createRoot()
    writeFileSync(join(root, 'AGENTS.md'), '基础规则', 'utf8')
    writeFileSync(join(root, 'AGENTS.override.md'), '临时覆盖规则', 'utf8')

    const instructions = await loadProjectInstructions(root)
    expect(instructions?.path).toBe(join(root, 'AGENTS.override.md'))
    expect(instructions?.content).toBe('临时覆盖规则')
  })

  it('超大规则文件只读取有界内容并明确标记截断', async () => {
    const root = createRoot()
    writeFileSync(join(root, 'AGENTS.md'), '规则'.repeat(20_000), 'utf8')

    const instructions = await loadProjectInstructions(root)
    expect(instructions?.truncated).toBe(true)
    expect(instructions?.content).toContain('项目指令过长，已安全截断')
    expect(Buffer.byteLength(instructions?.content ?? '', 'utf8')).toBeLessThan(26 * 1024)
  })
})
