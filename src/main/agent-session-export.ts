import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import type { AgentSession, AgentSessionExportFormat, AgentSessionExportResult } from '../shared/agent-types'
import { sessionExportContent, sessionExportFilename } from '../shared/session-export'

export async function exportAgentSession(win: BrowserWindow, session: AgentSession, format: AgentSessionExportFormat): Promise<AgentSessionExportResult> {
  const e2ePath = process.env['DEEPDESK_E2E_EXPORT_PATH']
  const extension = format === 'markdown' ? 'md' : 'json'
  const target = e2ePath || (await dialog.showSaveDialog(win, {
    title: '导出会话',
    defaultPath: sessionExportFilename(session.task, format),
    filters: [{ name: format === 'markdown' ? 'Markdown 文档' : 'JSON 数据', extensions: [extension] }]
  })).filePath
  if (!target) return { ok: false, canceled: true }

  try {
    await fs.writeFile(target, sessionExportContent(session, format), 'utf8')
    return { ok: true, filePath: target }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '导出失败' }
  }
}
