import { useState } from 'react'
import { MAX_MCP_JSON_BYTES, parseMcpJson } from '@shared/mcp-json'
import type { McpImportConfig } from '@shared/mcp-json'
import { useMcpStore } from '../../stores/useMcpStore'
import { Button, Modal, Textarea } from '../ui'
import '../../assets/mcp-json.css'

const example = '{\n  "mcpServers": {\n    "example": {\n      "command": "npx",\n      "args": ["-y", "your-mcp-package"]\n    }\n  }\n}'

export default function McpJsonImport({ onClose, onImported }: { onClose: () => void; onImported: (count: number) => void }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<McpImportConfig[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const updateText = (value: string): void => { setText(value); setPreview(null); setError('') }
  const validate = (): void => {
    try {
      const configs = parseMcpJson(text)
      const names = new Set(useMcpStore.getState().statuses.map(item => item.config.name.trim().toLocaleLowerCase()))
      if (configs.some(config => names.has(config.name.toLocaleLowerCase()))) throw new Error('存在同名服务器，请更名后再导入。已有配置不会被覆盖。')
      setPreview(configs); setError('')
    } catch (reason) { setPreview(null); setError(reason instanceof Error ? reason.message : '配置检查失败') }
  }
  const pick = async (): Promise<void> => {
    setBusy(true); setError('')
    try { const result = await window.api.mcp.pickJson(); if (result !== null) updateText(result) }
    catch { setError('读取失败，请选择不超过 256 KB、UTF-8 编码的 JSON 文件') }
    finally { setBusy(false) }
  }
  const confirm = async (): Promise<void> => {
    if (!preview) return
    setBusy(true); setError('')
    try {
      const count = await window.api.mcp.importJson(text)
      await useMcpStore.getState().load()
      onImported(count)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败，请检查配置'); setPreview(null) }
    finally { setBusy(false) }
  }
  return (
    <Modal title='导入 MCP JSON' width={680} onClose={() => { if (!busy) onClose() }} footer={
      <><Button disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !text.trim()} onClick={validate}>检查配置</Button><Button variant='primary' disabled={busy || !preview} onClick={() => void confirm()}>确认导入</Button></>
    }>
      <div className='mcp-json-import'>
        <div className='mcp-json-toolbar'><span>粘贴 JSON，或选择本地文件</span><Button size='sm' disabled={busy} onClick={() => void pick()}>选择 JSON 文件</Button></div>
        <Textarea aria-label='MCP JSON 配置' placeholder={example} value={text} disabled={busy} maxLength={MAX_MCP_JSON_BYTES} onChange={event => updateText(event.target.value)} spellCheck={false} />
        <p className='muted'>支持 mcpServers 或 servers；本地 stdio 和远程 Streamable HTTP。导入后默认未连接，不执行命令。请只导入可信来源的配置。</p>
        {error && <div role='alert' className='mcp-json-error'>{error}</div>}
        {preview && <div className='mcp-json-preview' aria-label='导入预览'>
          <div role='status'>检查通过，将新增 {preview.length} 个服务器</div>
          {preview.map(config => <div className='mcp-json-preview-row' key={config.name}><strong>{config.name}</strong><span>{config.transport === 'stdio' ? '本地命令' : '远程服务'} · 未连接</span></div>)}
        </div>}
      </div>
    </Modal>
  )
}
