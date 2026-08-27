import { useState } from 'react'
import { Eye, EyeOff, PlugZap, Save, Server, Trash2, X } from 'lucide-react'
import type { ModelConfig, ProviderConfig } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { Badge, Button, Input, Spinner } from '../ui'
import { normalizeBaseUrl } from '../../lib/utils'
import clsx from 'clsx'
import zhipuIcon from '../../assets/icons/zhipu.svg'

function isZhipuProvider(provider: ProviderConfig): boolean {
  const text = [
    provider.name,
    provider.baseUrl,
    ...provider.models.map(model => model.id + ' ' + (model.name ?? ''))
  ].join(' ').toLowerCase()
  return text.includes('智谱') || text.includes('zhipu') || text.includes('bigmodel') || text.includes('glm')
}

export default function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const saveProvider = useSettingsStore(s => s.saveProvider)
  const removeProvider = useSettingsStore(s => s.removeProvider)
  const testProvider = useSettingsStore(s => s.testProvider)
  const [draft, setDraft] = useState(provider)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [newModelId, setNewModelId] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(provider)

  const save = async (): Promise<void> => {
    const clean = { ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl) }
    try {
      await saveProvider(clean)
      setDraft(clean)
      setSaveResult({ ok: true, message: '保存成功，模型选择已生效' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setSaveResult({ ok: false, message })
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    setSaveResult(null)
    const clean = { ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl) }
    const res = await testProvider(clean)
    setTestResult({ ok: res.ok, message: res.message })
    if (res.ok && res.models && res.models.length > 0) {
      const existing = new Set(draft.models.map(m => m.id))
      const added = res.models.filter(m => !existing.has(m.id))
      if (added.length > 0) {
        setDraft(d => ({ ...d, models: [...d.models, ...added] }))
      }
    }
    setTesting(false)
  }

  const addModel = (): void => {
    const id = newModelId.trim()
    if (!id) return
    if (draft.models.some(m => m.id === id)) { setNewModelId(''); return }
    const m: ModelConfig = { id }
    setSaveResult(null)
    setDraft(d => ({ ...d, models: [...d.models, m] }))
    setNewModelId('')
  }

  return (
    <div className='provider-card'>
      <div className='provider-head'>
        <div className={clsx('provider-icon', isZhipuProvider(draft) && 'brand-zhipu')}>
          {isZhipuProvider(draft) ? <img src={zhipuIcon} alt='' aria-hidden /> : <Server size={16} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className='provider-name'>{draft.name}</span>
            {provider.isBuiltIn ? <Badge tone='builtin'>内置</Badge> : <Badge tone='off'>自定义</Badge>}
            {provider.apiKey ? <Badge tone='ok'>已配置</Badge> : <Badge tone='off'>未配置 Key</Badge>}
          </div>
          <div className='provider-sub'>{provider.baseUrl}</div>
        </div>
        {!provider.isBuiltIn && (
          <Button variant='danger' size='sm' onClick={() => void removeProvider(provider.id)}><Trash2 size={12} /> 删除</Button>
        )}
      </div>

      <div className='form-grid'>
        <div>
          <label className='field-label'>服务名称</label>
          <Input value={draft.name} onChange={e => { setSaveResult(null); setDraft({ ...draft, name: e.target.value }) }} placeholder='例如：DeepSeek' />
        </div>
        <div>
          <label className='field-label'>Base URL（OpenAI 兼容）</label>
          <Input value={draft.baseUrl} onChange={e => { setSaveResult(null); setDraft({ ...draft, baseUrl: e.target.value }) }} placeholder='https://api.deepseek.com' />
        </div>
        <div className='full'>
          <label className='field-label'>API Key</label>
          <div className='input-wrap'>
            <Input type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={e => { setSaveResult(null); setDraft({ ...draft, apiKey: e.target.value }) }} placeholder='sk-…' style={{ paddingRight: 30 }} />
            <span className='input-suffix'>
              <button type='button' className='icon-btn' onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            </span>
          </div>
          {provider.id === 'deepseek' && !draft.apiKey && (
            <div className='field-hint'>前往 platform.deepseek.com 注册并创建 API Key，粘贴到这里即可使用。</div>
          )}
          {testResult && <div className={clsx('key-status', testResult.ok ? 'ok' : 'bad')}>{testResult.ok ? '✓' : '✕'} {testResult.message}</div>}
        </div>
      </div>

      <div>
        <label className='field-label'>模型列表</label>
        <div className='model-chip-list'>
          {draft.models.map(m => (
            <span key={m.id} className='model-chip-item'>
              <span className='mono'>{m.id}</span>
              <span className='remove' onClick={() => { setSaveResult(null); setDraft(d => ({ ...d, models: d.models.filter(x => x.id !== m.id) })) }}><X size={11} /></span>
            </span>
          ))}
          {draft.models.length === 0 && <span className='muted fs-xs'>暂无模型，可点击「测试连接」自动导入</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Input value={newModelId} onChange={e => setNewModelId(e.target.value)} placeholder='添加模型 ID，如 deepseek-v4-flash' onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModel() } }} />
          <Button size='sm' onClick={addModel}>添加</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button variant='primary' size='sm' disabled={!dirty} onClick={() => void save()}><Save size={13} /> 保存</Button>
        <Button size='sm' onClick={() => void test()} disabled={testing}>
          {testing ? <Spinner size={12} /> : <PlugZap size={13} />} 测试连接
        </Button>
        {saveResult && <div role='status' className={clsx('key-status', saveResult.ok ? 'ok' : 'bad')}>{saveResult.ok ? '✓' : '✕'} {saveResult.message}</div>}
      </div>
    </div>
  )
}
