import { useState } from 'react'
import type { McpServerConfig, McpTransport } from '@shared/types'
import { Eye, EyeOff } from 'lucide-react'
import { uid } from '../../lib/utils'
import { useMcpStore } from '../../stores/useMcpStore'
import { Button, Input, Modal, Select, Textarea } from '../ui'

function entriesToLines(entries: Record<string, string>): string {
  return Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n')
}

function linesToEntries(value: string): Record<string, string> {
  const entries: Array<[string, string]> = []
  for (const raw of value.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(`“${line}”需要使用 KEY=VALUE 格式`)
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()])
  }
  return Object.fromEntries(entries)
}

function createDraft(config?: McpServerConfig): McpServerConfig {
  const now = Date.now()
  return config ? structuredClone(config) : {
    id: uid(),
    name: '',
    transport: 'stdio',
    enabled: false,
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    token: '',
    headers: {},
    createdAt: now,
    updatedAt: now
  }
}

export default function McpServerForm({ config, onClose }: { config?: McpServerConfig; onClose: () => void }) {
  const saveServer = useMcpStore(state => state.save)
  const [draft, setDraft] = useState(() => createDraft(config))
  const [args, setArgs] = useState(draft.args.join('\n'))
  const [env, setEnv] = useState(entriesToLines(draft.env))
  const [headers, setHeaders] = useState(entriesToLines(draft.headers))
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (shouldConnect: boolean): Promise<void> => {
    if (!draft.name.trim()) { setError('请填写服务器名称'); return }
    if (draft.transport === 'stdio' && !draft.command.trim()) { setError('请填写启动命令'); return }
    if (draft.transport === 'http' && !draft.url.trim()) { setError('请填写服务器地址'); return }
    setSaving(true)
    setError('')
    try {
      const next: McpServerConfig = {
        ...draft,
        name: draft.name.trim(),
        command: draft.command.trim(),
        args: args.split('\n').map(value => value.trim()).filter(Boolean),
        env: linesToEntries(env),
        cwd: draft.cwd.trim(),
        url: draft.url.trim(),
        token: draft.token.trim(),
        headers: linesToEntries(headers),
        enabled: shouldConnect || draft.enabled
      }
      const status = await saveServer(next)
      if (shouldConnect && status.state !== 'connected') {
        throw new Error(status.message)
      }
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const setTransport = (transport: McpTransport): void => setDraft(current => ({ ...current, transport }))

  return (
    <Modal title={config ? '编辑 MCP 服务器' : '添加 MCP 服务器'} onClose={onClose} width={560} footer={
      <>
        <Button onClick={onClose}>取消</Button>
        <Button onClick={() => void submit(false)} disabled={saving}>保存</Button>
        <Button variant='primary' onClick={() => void submit(true)} disabled={saving}>保存并连接</Button>
      </>
    }>
      <div className='mcp-form'>
        <div className='mcp-form-grid'>
          <div>
            <label className='field-label'>服务器名称</label>
            <Input aria-label='服务器名称' autoFocus value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder='例如：本地文件工具' />
          </div>
          <div>
            <label className='field-label'>连接方式</label>
            <Select aria-label='连接方式' value={draft.transport} onChange={event => setTransport(event.target.value as McpTransport)}>
              <option value='stdio'>本地进程（stdio）</option>
              <option value='http'>远程服务（HTTP）</option>
            </Select>
          </div>
        </div>

        {draft.transport === 'stdio' ? (
          <>
            <div>
              <label className='field-label'>启动命令</label>
              <Input aria-label='启动命令' value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} placeholder='例如：npx' />
            </div>
            <div>
              <label className='field-label'>命令参数</label>
              <Textarea value={args} onChange={event => setArgs(event.target.value)} placeholder={'每行一个参数，例如：\n-y\n@modelcontextprotocol/server-filesystem\nC:\\工作目录'} />
            </div>
            <details className='mcp-advanced'>
              <summary>高级设置</summary>
              <div className='mcp-advanced-body'>
                <div>
                  <label className='field-label'>工作目录（可选）</label>
                  <Input value={draft.cwd} onChange={event => setDraft({ ...draft, cwd: event.target.value })} placeholder='留空时使用 DeepDesk 的运行目录' />
                </div>
                <div>
                  <label className='field-label'>环境变量（可选）</label>
                  <Textarea value={env} onChange={event => setEnv(event.target.value)} placeholder={'每行一项：KEY=VALUE'} />
                </div>
              </div>
            </details>
          </>
        ) : (
          <>
            <div>
              <label className='field-label'>服务器地址</label>
              <Input aria-label='服务器地址' value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} placeholder='https://example.com/mcp' />
              <div className='field-hint'>支持 MCP Streamable HTTP 连接。</div>
            </div>
            <div>
              <label className='field-label'>访问令牌（可选）</label>
              <div className='input-wrap'>
                <Input type={showToken ? 'text' : 'password'} value={draft.token} onChange={event => setDraft({ ...draft, token: event.target.value })} placeholder='Bearer Token' style={{ paddingRight: 34 }} />
                <span className='input-suffix'><button type='button' className='icon-btn' onClick={() => setShowToken(value => !value)}>{showToken ? <EyeOff size={14} /> : <Eye size={14} />}</button></span>
              </div>
            </div>
            <details className='mcp-advanced'>
              <summary>自定义请求头</summary>
              <div className='mcp-advanced-body'>
                <Textarea value={headers} onChange={event => setHeaders(event.target.value)} placeholder={'每行一项：Header-Name=Value'} />
              </div>
            </details>
          </>
        )}
        {error && <div role='alert' className='key-status bad'>✕ {error}</div>}
      </div>
    </Modal>
  )
}
