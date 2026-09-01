import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const tempRoots: string[] = []
const script = resolve('scripts/check-architecture.mjs')

function fixture(files: Record<string, string>, componentLimit = 5): { root: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), 'deepdesk-architecture-'))
  tempRoots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  const config = join(root, 'architecture-budget.json')
  writeFileSync(config, JSON.stringify({
    version: 1,
    limits: { component: componentLimit, store: 10, service: 10, source: 10, stylesheet: 10, test: 10, script: 10 },
    exceptions: {}
  }), 'utf8')
  return { root, config }
}

function run(root: string, config: string) {
  return spawnSync(process.execPath, [script, '--root', root, '--config', config], { encoding: 'utf8' })
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('architecture guard', () => {
  it('accepts a small renderer component using IPC-facing code', () => {
    const { root, config } = fixture({
      'src/renderer/src/components/Small.tsx': "export const Small = () => <button type='button'>OK</button>\n"
    })

    const result = run(root, config)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Architecture guard passed')
  })

  it('rejects a component that exceeds its line budget', () => {
    const { root, config } = fixture({
      'src/renderer/src/components/Large.tsx': Array.from({ length: 7 }, (_, index) => `export const line${index} = ${index}`).join('\n')
    })

    const result = run(root, config)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('超过 component 预算')
  })

  it('rejects renderer networking and direct main-process imports', () => {
    const { root, config } = fixture({
      'src/renderer/src/Bad.ts': "import { secret } from '../../main/secret'\nexport const load = () => fetch(String(secret))\n",
      'src/main/secret.ts': "export const secret = 'https://example.com'\n"
    }, 10)

    const result = run(root, config)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('renderer 禁止直接依赖 main')
    expect(result.stderr).toContain('renderer 禁止直接发起网络请求')
  })
})
