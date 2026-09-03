import type { ModelConfig, ProviderConfig, ProviderTestResult } from '../shared/types'

interface ProviderModelResponse {
  data?: Array<{
    id?: unknown
    display_name?: unknown
    max_input_tokens?: unknown
  }>
}

function providerHeaders(provider: ProviderConfig): Record<string, string> {
  if (provider.type === 'anthropic') {
    return {
      'anthropic-version': '2023-06-01',
      'x-api-key': provider.apiKey
    }
  }
  return { 'Authorization': 'Bearer ' + provider.apiKey }
}

function mapModels(json: ProviderModelResponse): ModelConfig[] {
  return (json.data ?? []).flatMap(model => {
    if (typeof model.id !== 'string' || !model.id) return []
    return [{
      id: model.id,
      ...(typeof model.display_name === 'string' && model.display_name ? { name: model.display_name } : {}),
      ...(typeof model.max_input_tokens === 'number' && model.max_input_tokens > 0
        ? { contextWindow: model.max_input_tokens }
        : {})
    }]
  })
}

export async function testProviderConnection(provider: ProviderConfig, timeoutMs = 8000): Promise<ProviderTestResult> {
  let base = provider.baseUrl.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(base + '/models', {
      headers: providerHeaders(provider),
      signal: controller.signal
    })
    if (!response.ok) return { ok: false, message: 'HTTP ' + response.status }
    const models = mapModels((await response.json()) as ProviderModelResponse)
    return { ok: true, message: '连接成功，发现 ' + models.length + ' 个模型', models }
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : '连接失败' }
  } finally {
    clearTimeout(timer)
  }
}
