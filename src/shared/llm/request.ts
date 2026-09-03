const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRY_DELAYS_MS = [250, 750]
const NON_RETRYABLE_QUOTA = /insufficient[ _-]?(balance|quota)|余额不足|充值|billing|resource package/i

function abortError(): Error {
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.min(Math.max(0, timestamp - Date.now()), 5000)
}

function waitForRetry(durationMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, durationMs)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function responseDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 600)
  } catch {
    return ''
  }
}

export async function fetchLlmResponse(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal)
    let response: Response
    try {
      response = await fetch(url, { ...init, signal })
    } catch (error) {
      throwIfAborted(signal)
      if (!(error instanceof TypeError) || attempt >= RETRY_DELAYS_MS.length) throw error
      await waitForRetry(RETRY_DELAYS_MS[attempt], signal)
      continue
    }
    if (response.ok) return response

    const detail = await responseDetail(response)
    throwIfAborted(signal)
    const canRetry = attempt < RETRY_DELAYS_MS.length
      && RETRYABLE_STATUS.has(response.status)
      && !NON_RETRYABLE_QUOTA.test(detail)
    if (!canRetry) throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`)

    await waitForRetry(retryAfterMs(response.headers.get('Retry-After')) ?? RETRY_DELAYS_MS[attempt], signal)
  }
}
