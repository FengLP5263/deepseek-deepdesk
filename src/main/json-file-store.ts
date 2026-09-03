import { promises as fs } from 'node:fs'

const DEFAULT_WRITE_DELAY_MS = 80
const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200, 400]

function isTransientRenameError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return code === 'EBUSY' || code === 'EACCES' || code === 'EPERM'
}

async function renameWithRetry(temporary: string, file: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temporary, file)
      return
    } catch (error) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !isTransientRenameError(error)) throw error
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

async function parseJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T
}

export async function readJsonWithTempRecovery<T>(file: string): Promise<{ value: T; recovered: boolean }> {
  try {
    return { value: await parseJsonFile<T>(file), recovered: false }
  } catch (primaryError) {
    try {
      return { value: await parseJsonFile<T>(`${file}.tmp`), recovered: true }
    } catch {
      throw primaryError
    }
  }
}

export class CoalescedJsonWriter {
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private pending = false
  private writeQueued = false

  constructor(
    private readonly file: string,
    private readonly serialize: () => string,
    private readonly delayMs = DEFAULT_WRITE_DELAY_MS
  ) {}

  request(): void {
    this.pending = true
    if (this.timer || this.writeQueued) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.enqueue()
    }, this.delayMs)
  }

  private enqueue(): void {
    if (!this.pending || this.writeQueued) return
    this.writeQueued = true
    this.writing = this.writing
      .then(async () => {
        while (this.pending) {
          this.pending = false
          const snapshot = this.serialize()
          const temporary = `${this.file}.tmp`
          await fs.writeFile(temporary, snapshot, 'utf8')
          await renameWithRetry(temporary, this.file)
        }
      })
      .catch(error => {
        console.error('[store] 持久化失败:', error)
      })
      .finally(() => {
        this.writeQueued = false
        if (this.pending && !this.timer) this.request()
      })
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending) this.enqueue()
    await this.writing
    if (this.pending || this.timer || this.writeQueued) await this.flush()
  }
}
