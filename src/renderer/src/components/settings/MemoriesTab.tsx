import { useEffect } from 'react'
import { Edit3, Trash2 } from 'lucide-react'
import type { MemoryKind, MemoryScope } from '@shared/types'
import { Button, Select, Switch, Textarea, Input } from '../ui'
import { useMemoryStore } from '../../stores/useMemoryStore'

const scopeOptions: Array<{ value: MemoryScope; label: string }> = [
  { value: 'user', label: '用户' },
  { value: 'project', label: '项目' },
  { value: 'agent', label: 'Agent' }
]

const kindOptions: Array<{ value: MemoryKind; label: string }> = [
  { value: 'preference', label: '偏好' },
  { value: 'fact', label: '事实' },
  { value: 'procedure', label: '流程' },
  { value: 'decision', label: '决策' },
  { value: 'summary', label: '摘要' }
]

function labelOf<T extends string>(items: Array<{ value: T; label: string }>, value: T): string {
  return items.find(item => item.value === value)?.label ?? value
}

export default function MemoriesTab() {
  const loaded = useMemoryStore(s => s.loaded)
  const memories = useMemoryStore(s => s.memories)
  const draft = useMemoryStore(s => s.draft)
  const editingId = useMemoryStore(s => s.editingId)
  const init = useMemoryStore(s => s.init)
  const setDraft = useMemoryStore(s => s.setDraft)
  const saveDraft = useMemoryStore(s => s.saveDraft)
  const cancelEdit = useMemoryStore(s => s.cancelEdit)
  const edit = useMemoryStore(s => s.edit)
  const toggle = useMemoryStore(s => s.toggle)
  const remove = useMemoryStore(s => s.remove)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className='settings-section'>
      <div className='settings-section-title'>长期记忆</div>
      <div className='settings-section-desc'>显式要求记住的内容和高置信长期偏好会自动保存在本地；你可以在这里编辑、停用或删除。</div>

      <div className='settings-card memory-editor'>
        <div className='memory-editor-grid'>
          <Select value={draft.scope} onChange={e => setDraft({ scope: e.target.value as MemoryScope })} aria-label='记忆范围'>
            {scopeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Select value={draft.kind} onChange={e => setDraft({ kind: e.target.value as MemoryKind })} aria-label='记忆类型'>
            {kindOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
        <Textarea
          value={draft.content}
          rows={4}
          placeholder='例如：用户偏好直接给结论，少讲概念；DeepDesk 当前目标是本地优先的桌面 Agent 客户端。'
          onChange={e => setDraft({ content: e.target.value })}
        />
        <Input value={draft.tags} placeholder='标签，用空格或逗号分隔，例如 ui 工程化 deepdesk' onChange={e => setDraft({ tags: e.target.value })} />
        <div className='memory-editor-actions'>
          {editingId && <Button size='sm' onClick={cancelEdit}>取消编辑</Button>}
          <Button variant='primary' size='sm' onClick={() => void saveDraft()}>{editingId ? '保存记忆' : '添加记忆'}</Button>
        </div>
      </div>

      <div className='memory-list'>
        {!loaded && <div className='memory-empty'>正在加载记忆...</div>}
        {loaded && memories.length === 0 && <div className='memory-empty'>还没有可长期使用的记忆。你也可以手动添加一条偏好或项目事实。</div>}
        {memories.map(memory => (
          <div key={memory.id} className='memory-card'>
            <div className='memory-card-main'>
              <div className='memory-meta'>
                <span>{labelOf(scopeOptions, memory.scope)}</span>
                <span>{labelOf(kindOptions, memory.kind)}</span>
                <span>{memory.source?.type === 'manual' ? '手动添加' : '自动记录'}</span>
                {!memory.enabled && <span>已停用</span>}
              </div>
              <div className='memory-content'>{memory.content}</div>
              {memory.tags.length > 0 && (
                <div className='memory-tags'>
                  {memory.tags.map(tag => <span key={tag} className='memory-tag'>#{tag}</span>)}
                </div>
              )}
            </div>
            <div className='memory-card-actions'>
              <Switch checked={memory.enabled} onChange={() => void toggle(memory.id)} label='启用记忆' />
              <button type='button' className='icon-btn' onClick={() => edit(memory)} title='编辑记忆' aria-label='编辑记忆'><Edit3 size={15} /></button>
              <button type='button' className='icon-btn danger' onClick={() => void remove(memory.id)} title='删除记忆' aria-label='删除记忆'><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
