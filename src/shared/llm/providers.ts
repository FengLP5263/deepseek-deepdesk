import type { ProviderConfig } from '../types'

export const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    isBuiltIn: true,
    createdAt: 0,
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash（快速）', contextWindow: 256000 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro（深度思考）', contextWindow: 256000, supportsReasoning: true }
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama（本地模型）',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    isBuiltIn: true,
    createdAt: 0,
    models: []
  }
]

export function getProviderById(providers: ProviderConfig[], id: string): ProviderConfig | undefined {
  return providers.find(p => p.id === id)
}
