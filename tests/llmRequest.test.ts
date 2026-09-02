import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLlmResponse } from '../src/shared/llm/request'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchLlmResponse', () => {
  it('短暂限流后按 Retry-After 重试', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', request)

    const response = await fetchLlmResponse('https://example.com/chat', { method: 'POST' })

    expect(response.ok).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('尚未收到响应时会从临时网络错误恢复', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', request)

    const response = await fetchLlmResponse('https://example.com/chat', { method: 'POST' })

    expect(response.ok).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('余额或资源包不足时不做无意义重试', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"message":"Insufficient Balance"}', { status: 429 }))
    vi.stubGlobal('fetch', request)

    await expect(fetchLlmResponse('https://example.com/chat', { method: 'POST' })).rejects.toThrow('Insufficient Balance')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('鉴权失败时立即返回原始错误', async () => {
    const request = vi.fn().mockResolvedValue(new Response('invalid api key', { status: 401 }))
    vi.stubGlobal('fetch', request)

    await expect(fetchLlmResponse('https://example.com/chat', { method: 'POST' })).rejects.toThrow('HTTP 401: invalid api key')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('等待重试期间仍可被用户停止', async () => {
    const request = vi.fn().mockResolvedValue(new Response('temporarily unavailable', { status: 503, headers: { 'Retry-After': '5' } }))
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()

    const pending = fetchLlmResponse('https://example.com/chat', { method: 'POST' }, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
