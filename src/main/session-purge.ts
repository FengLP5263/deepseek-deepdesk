import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './session-objects'

/** Only the validated, per-session directory is cleared. External backups are never traversed. */
export async function clearSessionFiles(root: string, key: string, tombstone: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无效的会话存储标识')
  const directory = path.resolve(root, key)
  if (path.dirname(directory) !== path.resolve(root) || (await fs.lstat(directory)).isSymbolicLink()) throw new Error('拒绝清理不安全的会话目录')
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'purge.json') continue
    const target = path.resolve(directory, entry.name)
    if (path.dirname(target) !== directory) throw new Error('拒绝越界清理')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3 })
  }
  await atomicWrite(path.join(directory, 'events.jsonl'), tombstone + '\n')
}
