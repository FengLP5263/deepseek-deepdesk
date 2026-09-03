import { useEffect, useState } from 'react'
import { Cable, Pencil, Plus, ServerCog, Trash2, Unplug } from 'lucide-react'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import clsx from 'clsx'
import { useMcpStore } from '../../stores/useMcpStore'
import { Button, Modal, Spinner } from '../ui'
import McpServerForm from './McpServerForm'

function endpoint(config: McpServerConfig): string {
  return config.transport === 'stdio'
    ? [config.command, ...config.args].filter(Boolean).join(' ')
    : config.url
}

function McpServerCard({ status, onEdit }: { status: McpServerStatus; onEdit: () => void }) {
  const connect = useMcpStore(state => state.connect)
  const disconnect = useMcpStore(state => state.disconnect)
  const remove = useMcpStore(state => state.remove)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const toggleConnection = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    const result = status.state === 'connected'
      ? await disconnect(status.config.id)
      : await connect(status.config.id)
    setMessage(result.message)
    setBusy(false)
  }

  return (
    <div className='mcp-card'>
      <div className='mcp-card-head'>
        <div className='mcp-server-icon'><ServerCog size={18} /></div>
        <div className='mcp-card-title'>
          <div className='mcp-name-row'>
            <span>{status.config.name}</span>
            <span className={clsx('mcp-status', status.state)}>
              <i />{status.state === 'connected' ? '已连接' : status.state === 'connecting' ? '连接中' : status.state === 'error' ? '连接异常' : '未连接'}
            </span>
          </div>
          <div className='mcp-endpoint mono' title={endpoint(status.config)}>{endpoint(status.config)}</div>
        </div>
        <div className='mcp-card-actions'>
          <Button size='sm' variant={status.state === 'connected' ? 'ghost' : 'primary'} onClick={() => void toggleConnection()} disabled={busy || status.state === 'connecting'}>
            {busy || status.state === 'connecting' ? <Spinner size={12} /> : status.state === 'connected' ? <Unplug size={13} /> : <Cable size={13} />}
            {status.state === 'connected' ? '断开' : '连接'}
          </Button>
          <button type='button' className='icon-btn' title='编辑服务器' onClick={onEdit}><Pencil size={14} /></button>
          <button type='button' className='icon-btn danger' title='删除服务器' onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className='mcp-card-body'>
        <div className='mcp-tool-summary'>{status.state === 'connected' ? `${status.toolCount} 个可用工具` : status.message}</div>
        {status.tools.length > 0 && (
          <div className='mcp-tool-list'>
            {status.tools.slice(0, 6).map(tool => <span key={tool.name} title={tool.description}>{tool.annotations?.title || tool.name}</span>)}
            {status.tools.length > 6 && <span>+{status.tools.length - 6}</span>}
          </div>
        )}
        {message && <div role='status' className={clsx('key-status', status.state === 'error' ? 'bad' : 'ok')}>{message}</div>}
      </div>
      {confirmDelete && (
        <Modal title='删除 MCP 服务器' onClose={() => setConfirmDelete(false)} width={420} footer={
          <><Button onClick={() => setConfirmDelete(false)}>取消</Button><Button variant='danger' onClick={() => void remove(status.config.id)}>删除</Button></>
        }>
          删除“{status.config.name}”后，本地配置将被移除，Agent 也无法再调用它提供的工具。
        </Modal>
      )}
    </div>
  )
}

export default function McpTab() {
  const statuses = useMcpStore(state => state.statuses)
  const loaded = useMcpStore(state => state.loaded)
  const load = useMcpStore(state => state.load)
  const [editing, setEditing] = useState<McpServerConfig | null | undefined>(undefined)

  useEffect(() => { void load() }, [load])

  return (
    <div className='settings-section'>
      <div className='settings-section-head'>
        <div className='settings-section-title'>MCP 服务器</div>
        <Button size='sm' onClick={() => setEditing(null)}><Plus size={13} /> 添加服务器</Button>
      </div>
      <div className='settings-section-desc'>连接本地或远程 MCP 服务器。连接后，其工具会自动出现在 Agent 的可用工具中，并遵循当前审批模式。</div>
      {!loaded && <div className='mcp-empty'><Spinner /> 正在读取服务器配置…</div>}
      {loaded && statuses.length === 0 && <div className='mcp-empty'><ServerCog size={20} />还没有 MCP 服务器，添加后即可扩展 DeepDesk 的工具能力。</div>}
      <div className='mcp-list'>
        {statuses.map(status => <McpServerCard key={status.config.id} status={status} onEdit={() => setEditing(status.config)} />)}
      </div>
      {editing !== undefined && <McpServerForm config={editing ?? undefined} onClose={() => setEditing(undefined)} />}
    </div>
  )
}
