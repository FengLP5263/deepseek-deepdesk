import { useEffect, useState } from 'react'
import type { ArchivedSession } from '@shared/session-archive'
import { useAgentStore } from '../../stores/useAgentStore'
import { useChatStore } from '../../stores/useChatStore'
import { removeSessionDraft } from '../../hooks/useSessionDraft'
import { Button, Input, Modal } from '../ui'
import '../../assets/session-archive.css'

const sourceLabels = { desktop: '任务', chat: '聊天', wechat: '微信', lark: '飞书' }

export default function ArchiveTab() {
  const [items, setItems] = useState<ArchivedSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ArchivedSession | null>(null)
  useEffect(() => {
    let disposed = false
    void window.api.sessionArchive.list().then(list => { if (!disposed) { setItems(list); setLoaded(true) } })
      .catch(() => { if (!disposed) setError('读取归档失败，请重新打开此页面') })
    return () => { disposed = true }
  }, [])

  const mutate = async (item: ArchivedSession, action: 'restore' | 'remove'): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      await window.api.sessionArchive[action]({ kind: item.kind, id: item.id })
      if (action === 'remove' && item.kind === 'agent') removeSessionDraft(item.id)
      setItems(list => list.filter(s => s.kind !== item.kind || s.id !== item.id))
      setConfirm(null)
      setNotice(action === 'restore' ? '已恢复会话' : '已永久删除会话')
      await useAgentStore.getState().refreshSessions()
      useChatStore.setState({ conversations: await window.api.conversations.list() })
    } catch { setError('操作未能完成，请重试；如仍失败，请重启客户端后检查') }
    finally { setBusy(false) }
  }
  const visible = items.filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return (
    <div className='settings-section archive-section'>
      <p className='settings-section-desc'>归档会话不会出现在任务列表中，内容仍保存在本地。恢复后可继续对话。</p>
      <Input aria-label='搜索归档会话' placeholder='搜索归档会话…' value={query} onChange={event => setQuery(event.target.value)} />
      {notice && <div role='status'>{notice}</div>}
      {error && !confirm && <div role='alert'>{error}</div>}
      {!loaded && !error && <p className='muted'>正在读取归档…</p>}
      {loaded && !visible.length && <div className='archive-empty'>{items.length ? '没有匹配的归档会话' : '暂无归档会话'}</div>}
      {visible.map(item => (
        <div className='archive-row' key={`${item.kind}:${item.id}`}>
          <div className='archive-copy'>
            <div className='archive-title' title={item.title}>{item.title || '未命名会话'}</div>
            <div className='archive-meta'>{sourceLabels[item.source]} · {new Date(item.archivedAt).toLocaleString()} 归档</div>
          </div>
          <div className='archive-actions'>
            <Button size='sm' disabled={busy} onClick={() => void mutate(item, 'restore')}>恢复</Button>
            <Button size='sm' variant='danger' disabled={busy} onClick={() => { setError(''); setConfirm(item) }}>永久删除</Button>
          </div>
        </div>
      ))}
      {confirm && <Modal title='永久删除会话？' width={480} onClose={() => { if (!busy) setConfirm(null) }} footer={
        <><Button disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button disabled={busy} variant='danger' onClick={() => void mutate(confirm, 'remove')}>{busy ? '正在删除…' : '确认永久删除'}</Button></>
      }>
        <div className='archive-confirm'>
          <p>将删除“{confirm.title}”的本地会话、历史和上下文原文，无法恢复。</p>
          <p className='muted'>不会删除长期记忆、旧备份或微信／飞书端的消息。</p>
          {error && <p role='alert'>{error}</p>}
        </div>
      </Modal>}
    </div>
  )
}
