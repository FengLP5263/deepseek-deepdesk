import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoalescedJsonWriter, readJsonWithTempRecovery } from '../src/main/json-file-store'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'deepdesk-json-store-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

describe('CoalescedJsonWriter', () => {
  it('合并连续更新并只序列化最新状态', async () => {
    const file = join(directory, 'state.json')
    let value = 1
    let serializations = 0
    const writer = new CoalescedJsonWriter(file, () => {
      serializations += 1
      return JSON.stringify({ value })
    }, 1000)

    writer.request()
    value = 2
    writer.request()
    value = 3
    writer.request()
    expect(existsSync(file)).toBe(false)

    await writer.flush()

    expect(serializations).toBe(1)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ value: 3 })
  })

  it('主文件损坏时从完整临时文件恢复', async () => {
    const file = join(directory, 'state.json')
    writeFileSync(file, '{bad json', 'utf8')
    writeFileSync(`${file}.tmp`, JSON.stringify({ value: 4 }), 'utf8')

    await expect(readJsonWithTempRecovery<{ value: number }>(file)).resolves.toEqual({
      value: { value: 4 },
      recovered: true
    })
  })
})
