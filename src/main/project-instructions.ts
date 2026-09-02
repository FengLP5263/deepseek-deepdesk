import { lstat, open } from 'node:fs/promises'
import path from 'node:path'

const MAX_INSTRUCTION_BYTES = 24 * 1024
const CANDIDATES = ['AGENTS.override.md', 'AGENTS.md'] as const

export interface ProjectInstructions {
  path: string
  content: string
  truncated: boolean
}

async function readBoundedFile(file: string): Promise<{ content: string; truncated: boolean }> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const truncated = bytesRead > MAX_INSTRUCTION_BYTES
    const content = buffer.subarray(0, Math.min(bytesRead, MAX_INSTRUCTION_BYTES))
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trim()
    return {
      content: truncated ? `${content}\n\n[DeepDesk：项目指令过长，已安全截断]` : content,
      truncated
    }
  } finally {
    await handle.close()
  }
}

export async function loadProjectInstructions(workdir: string): Promise<ProjectInstructions | null> {
  const root = path.resolve(workdir)
  for (const filename of CANDIDATES) {
    const file = path.join(root, filename)
    try {
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      const result = await readBoundedFile(file)
      if (!result.content) continue
      return { path: file, ...result }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        console.warn(`[project-instructions] 无法读取 ${file}:`, error)
      }
    }
  }
  return null
}
