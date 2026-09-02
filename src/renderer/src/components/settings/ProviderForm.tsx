import { useState } from 'react'
import type { ProviderConfig, ProviderType } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { Button, Input, Modal, Select } from '../ui'
import { uid } from '../../lib/utils'

export default function ProviderForm({ onClose }: { onClose: () => void }) {
  const saveProvider = useSettingsStore(s => s.saveProvider)
  const [type, setType] = useState<ProviderType>('openai')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (!name.trim()) { setError('请填写服务名称'); return }
    if (!baseUrl.trim()) { setError('请填写 Base URL'); return }
    setSaving(true)
    const provider: ProviderConfig = {
      id: uid(),
      name: name.trim(),
      type,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models: [],
      createdAt: Date.now()
    }
    await saveProvider(provider)
    setSaving(false)
    onClose()
  }

  return (
    <Modal title='添加模型服务' onClose={onClose} width={480} footer={
      <>
        <Button onClick={onClose}>取消</Button>
        <Button variant='primary' onClick={() => void submit()} disabled={saving}>保存</Button>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className='field-label'>服务名称</label>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder='例如：Claude / 智谱 GLM / 本地 Ollama' />
        </div>
        <div>
          <label className='field-label'>接口协议</label>
          <Select value={type} onChange={event => {
            const next = event.target.value as ProviderType
            if (['https://api.deepseek.com', 'https://api.anthropic.com/v1', 'https://api.openai.com/v1'].includes(baseUrl)) {
              setBaseUrl(next === 'anthropic'
                ? 'https://api.anthropic.com/v1'
                : next === 'openai-responses' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com')
            }
            setType(next)
          }}>
            <option value='openai'>OpenAI 兼容</option>
            <option value='openai-responses'>OpenAI Responses</option>
            <option value='anthropic'>Anthropic Messages</option>
          </Select>
        </div>
        <div>
          <label className='field-label'>Base URL</label>
          <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={type === 'anthropic' ? 'https://api.anthropic.com/v1' : type === 'openai-responses' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com'} />
          <div className='field-hint'>{type === 'anthropic'
            ? '原生支持 Claude Messages API、流式回复和 Agent 工具调用。'
            : type === 'openai-responses'
              ? '原生支持 OpenAI Responses API、推理摘要和 Agent 工具调用。'
              : '支持 DeepSeek、智谱、Kimi、OpenAI、Ollama 等 OpenAI 兼容服务。'}</div>
        </div>
        <div>
          <label className='field-label'>API Key</label>
          <Input type='password' value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder='sk-…' />
        </div>
        {error && <div className='key-status bad'>✕ {error}</div>}
      </div>
    </Modal>
  )
}
