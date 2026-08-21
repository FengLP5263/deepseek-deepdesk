import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeTool, resolveInWorkdir } from '../src/main/tools'
import { platformInfoFromNode } from '../src/shared/platform'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tools-test-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('resolveInWorkdir', () => {
  it('工作目录内正常解析', () => {
    expect(resolveInWorkdir(dir, 'a/b.txt')).toBe(join(dir, 'a', 'b.txt'))
  })
  it('越界路径抛错', () => {
    expect(() => resolveInWorkdir(dir, '../outside.txt')).toThrow()
    expect(() => resolveInWorkdir(dir, join(tmpdir(), 'elsewhere'))).toThrow()
  })
})

describe('executeTool', () => {
  it('write_file + read_file 往返', async () => {
    const w = await executeTool({ id: '1', name: 'write_file', args: { path: 'x.txt', content: 'hello\nworld' } }, dir)
    expect(w.ok).toBe(true)
    expect(readFileSync(join(dir, 'x.txt'), 'utf-8')).toBe('hello\nworld')
    const r = await executeTool({ id: '2', name: 'read_file', args: { path: 'x.txt' } }, dir)
    expect(r.content).toContain('1: hello')
    expect(r.content).toContain('2: world')
  })
  it('edit_file 精准替换', async () => {
    writeFileSync(join(dir, 'y.txt'), 'foo bar foo')
    const e = await executeTool({ id: '3', name: 'edit_file', args: { path: 'y.txt', old_string: 'bar', new_string: 'baz' } }, dir)
    expect(e.ok).toBe(true)
    expect(readFileSync(join(dir, 'y.txt'), 'utf-8')).toBe('foo baz foo')
  })
  it('edit_file 唯一性校验', async () => {
    writeFileSync(join(dir, 'z.txt'), 'a a a')
    const e = await executeTool({ id: '4', name: 'edit_file', args: { path: 'z.txt', old_string: 'a', new_string: 'b' } }, dir)
    expect(e.ok).toBe(false)
    expect(e.content).toContain('3 次')
  })
  it('list_files', async () => {
    writeFileSync(join(dir, '1.txt'), '')
    const l = await executeTool({ id: '5', name: 'list_files', args: {} }, dir)
    expect(l.content).toContain('1.txt')
  })
  it('search_content', async () => {
    writeFileSync(join(dir, 's.txt'), 'hello\nworld hello')
    const s = await executeTool({ id: '6', name: 'search_content', args: { pattern: 'hello' } }, dir)
    expect(s.ok).toBe(true)
    expect(s.summary).toContain('2')
  })
  it('run_command 使用当前平台 Shell', async () => {
    const platform = platformInfoFromNode(process.platform)
    const command = platform.id === 'windows' ? 'Write-Output hello-agent' : "printf '%s\\n' hello-agent"
    const r = await executeTool({ id: '7', name: 'run_command', args: { command } }, dir)
    expect(r.ok).toBe(true)
    expect(r.content).toContain('hello-agent')
  })
})
