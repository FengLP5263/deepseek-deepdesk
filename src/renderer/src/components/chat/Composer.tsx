import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, Send, Settings } from 'lucide-react'
import { useChatStore } from '../../stores/useChatStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import clsx from 'clsx'

export default function Composer({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [text, setText] = useState('')
  const streaming = useChatStore(s => s.streaming)
  const sendMessage = useChatStore(s => s.sendMessage)
  const stopStreaming = useChatStore(s => s.stopStreaming)
  const setModel = useChatStore(s => s.setModel)
  const activeId = useChatStore(s => s.activeId)
  const conversations = useChatStore(s => s.conversations)
  const pendingModel = useChatStore(s => s.pendingModel)
  const providers = useSettingsStore(s => s.providers)
  const settings = useSettingsStore(s => s.settings)
  const enterToSend = settings?.enterToSend ?? true
  const [modelOpen, setModelOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const conv = conversations.find(c => c.id === activeId) ?? null
  const provider = providers.find(p => p.id === (conv?.providerId ?? pendingModel?.providerId ?? settings?.defaultProviderId ?? 'deepseek')) ?? null
  const modelId = conv?.modelId ?? pendingModel?.modelId ?? settings?.defaultModelId ?? 'deepseek-v4-flash'

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'
  }, [text])

  const canSend = text.trim().length > 0 && !streaming

  const submit = async (): Promise<void> => {
    if (!canSend) return
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
    await sendMessage(text)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault()
      void submit()
    }
  }

  const modelLabel = useMemo(() => {
    const m = provider?.models.find(m => m.id === modelId)
    return m?.name ?? modelId
  }, [provider, modelId])

  return (
    <div className='composer-wrap'>
      {modelOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setModelOpen(false)} />
          <div className='popover model-popover'>
            {providers.length === 0 && <div className='popover-header'>暂无模型服务，请先在设置中添加</div>}
            {providers.map(p => (
              <div key={p.id}>
                <div className='popover-header'>{p.name}{!p.apiKey && '（未配置 Key）'}</div>
                {p.models.length === 0 && <div className='popover-item' style={{ cursor: 'default', opacity: 0.6 }}>该服务暂无模型，可在设置中导入</div>}
                {p.models.map(m => (
                  <button key={m.id} className={clsx('popover-item', p.id === provider?.id && m.id === modelId && 'active')} onClick={() => { setModel(p.id, m.id); setModelOpen(false) }}>
                    {m.name ?? m.id}
                  </button>
                ))}
              </div>
            ))}
            <div className='popover-sep' />
            <button className='popover-item' onClick={() => { setModelOpen(false); onOpenSettings() }}>
              <Settings size={13} /> 管理模型服务
            </button>
          </div>
        </>
      )}
      <div className='composer'>
        <textarea
          ref={taRef}
          className='composer-textarea'
          placeholder='输入消息，Enter 发送，Shift+Enter 换行…'
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <div className='composer-actions'>
          <button className='model-pill' onClick={() => setModelOpen(o => !o)} title='切换模型'>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: provider && provider.apiKey ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }} />
            <span className='name'>{provider ? modelLabel : '选择模型'}</span>
            <ChevronDown size={13} />
          </button>
          <div className='composer-hint'>{streaming ? '正在生成…按 Esc 停止' : enterToSend ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送'}</div>
          {streaming ? (
            <button className='stop-btn' onClick={stopStreaming} title='停止生成' aria-label='停止生成'>
              <span className='stop-square' aria-hidden />
            </button>
          ) : (
            <button className='send-btn' disabled={!canSend} onClick={() => void submit()} title='发送'>
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
