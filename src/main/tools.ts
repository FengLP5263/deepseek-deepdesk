import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentToolCall, AgentToolResult } from '../shared/agent-types'
import { getPlatformAdapter } from './platform'

const MAX_OUTPUT = 20000

export function resolvePath(workdir: string, p: string): { abs: string; inside: boolean } {
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(workdir, p)
  const wd = path.resolve(workdir)
  const rel = path.relative(wd, abs)
  const inside = !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
  return { abs, inside }
}

export function resolveInWorkdir(workdir: string, p: string): string {
  const r = resolvePath(workdir, p)
  if (!r.inside) throw new Error('路径超出工作目录范围: ' + p)
  return r.abs
}

function runLarkCli(args: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return getPlatformAdapter().executeCommand(args, process.cwd(), {
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1'
  })
}

export function toolTargetPaths(call: AgentToolCall): string[] {
  switch (call.name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return [String(call.args.path ?? '')]
    case 'list_files':
    case 'search_content':
      return call.args.path ? [String(call.args.path)] : []
    default:
      return []
  }
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s
  return s.slice(0, MAX_OUTPUT) + '\n...（输出过长已截断）'
}

export async function executeTool(call: AgentToolCall, workdir: string, allowOutside = false): Promise<AgentToolResult> {
  const resolve = (p: string): string => {
    const r = resolvePath(workdir, p)
    if (!r.inside && !allowOutside) throw new Error('路径超出工作目录范围: ' + p)
    return r.abs
  }
  const a = call.args
  switch (call.name) {
    case 'run_command': {
      const command = String(a.command ?? '')
      if (!command.trim()) return { ok: false, content: '命令为空', summary: '命令为空' }
      const cwd = a.cwd ? resolve(String(a.cwd)) : workdir
      const r = await getPlatformAdapter().executeCommand(command, cwd)
      const content = (r.stdout ? truncate(r.stdout) + '\n' : '') + (r.stderr ? '[stderr]\n' + truncate(r.stderr) + '\n' : '') + '[exit code: ' + r.code + ']'
      return { ok: r.code === 0, content, summary: command }
    }
    case 'read_file': {
      const p = resolve(String(a.path ?? ''))
      const raw = await fs.readFile(p, 'utf-8')
      const lines = raw.split('\n')
      const numbered = lines.map((l, i) => (i + 1) + ': ' + l).join('\n')
      return { ok: true, content: truncate(numbered), summary: path.basename(p) }
    }
    case 'write_file': {
      const p = resolve(String(a.path ?? ''))
      const content = String(a.content ?? '')
      await fs.mkdir(path.dirname(p), { recursive: true })
      await fs.writeFile(p, content, 'utf-8')
      return { ok: true, content: '已写入 ' + p + '（' + content.length + ' 字符）', summary: '写入 ' + path.basename(p) }
    }
    case 'edit_file': {
      const p = resolve(String(a.path ?? ''))
      const oldStr = String(a.old_string ?? '')
      const newStr = String(a.new_string ?? '')
      const raw = await fs.readFile(p, 'utf-8')
      const count = raw.split(oldStr).length - 1
      if (count === 0) return { ok: false, content: '未找到要替换的文本', summary: '未找到替换文本' }
      if (count > 1) return { ok: false, content: '要替换的文本出现 ' + count + ' 次，请提供更精确的上下文', summary: '替换文本不唯一' }
      const updated = raw.replace(oldStr, newStr)
      await fs.writeFile(p, updated, 'utf-8')
      return { ok: true, content: '已替换 ' + path.basename(p) + ' 中的 1 处文本', summary: '编辑 ' + path.basename(p) }
    }
    case 'list_files': {
      const p = a.path ? resolve(String(a.path)) : workdir
      const entries = await fs.readdir(p, { withFileTypes: true })
      const lines = entries.map(e => (e.isDirectory() ? '[目录] ' : '       ') + e.name)
      return { ok: true, content: lines.join('\n') || '（空目录）', summary: '列出 ' + entries.length + ' 项' }
    }
    case 'search_content': {
      const pattern = String(a.pattern ?? '')
      const root = a.path ? resolve(String(a.path)) : workdir
      const matches: string[] = []
      const walk = async (dir: string): Promise<void> => {
        let entries
        try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'out') continue
            await walk(full)
          } else if (e.isFile()) {
            try {
              const txt = await fs.readFile(full, 'utf-8')
              if (txt.includes(pattern)) {
                const ls = txt.split('\n')
                ls.forEach((l, i) => { if (l.includes(pattern)) matches.push(full + ':' + (i + 1) + ': ' + l.trim().slice(0, 200)) })
              }
            } catch { /* 跳过二进制 */ }
          }
        }
      }
      await walk(root)
      const content = matches.slice(0, 200).join('\n') || '未找到匹配内容'
      return { ok: true, content: truncate(content), summary: matches.length + ' 处匹配' }
    }
    case 'search_feishu_user': {
      const name = String(a.name ?? '').trim()
      if (!name) return { ok: false, content: '缺少 name 参数', summary: '缺少姓名' }
      const quote = getPlatformAdapter().quoteArgument
      const cmd = 'lark-cli contact +search-user --query ' + quote(name) + ' --exclude-external-users --as user'
      const r = await runLarkCli(cmd)
      try {
        const j = JSON.parse(r.stdout.trim()) as { data?: { users?: Array<{ open_id?: string; localized_name?: string; department?: string }> } }
        const users = (j.data?.users ?? []).map(u => ({ open_id: u.open_id ?? '', name: u.localized_name ?? '', department: u.department || '（无部门）' }))
        if (users.length === 0) return { ok: true, content: '未找到「' + name + '」', summary: '0 人' }
        const content = users.map(u => u.name + ' | 部门: ' + u.department + ' | open_id: ' + u.open_id).join('\n')
        return { ok: true, content, summary: users.length + ' 人' }
      } catch {
        return { ok: false, content: '解析 lark-cli 输出失败: ' + r.stdout.slice(0, 500), summary: '解析失败' }
      }
    }
    case 'send_feishu_message': {
      const user_id = String(a.user_id ?? '').trim()
      const text = String(a.text ?? '')
      if (!user_id || !text) return { ok: false, content: '缺少 user_id 或 text 参数', summary: '缺少参数' }
      const quote = getPlatformAdapter().quoteArgument
      const cmd = 'lark-cli im +messages-send --user-id ' + quote(user_id) + ' --text ' + quote(text) + ' --as user'
      const r = await runLarkCli(cmd)
      try {
        const j = JSON.parse(r.stdout.trim()) as { ok?: boolean; data?: { message_id?: string }; error?: { message?: string } }
        if (j.ok) return { ok: true, content: '消息已发送，message_id=' + (j.data?.message_id ?? ''), summary: '已发送给 ' + user_id }
        return { ok: false, content: '发送失败: ' + (j.error?.message ?? JSON.stringify(j)), summary: '发送失败' }
      } catch {
        return { ok: false, content: '发送异常: ' + r.stdout.slice(0, 500), summary: '发送异常' }
      }
    }
    default:
      return { ok: false, content: '未知工具: ' + call.name, summary: '未知工具' }
  }
}

export function isDangerousCommand(command: string): boolean {
  const c = command.toLowerCase()
  const patterns = [
    'rm -rf', 'rm -fr', 'rm --recursive', 'mkfs', 'diskutil erase', 'diskutil apfs delete', 'dd if=',
    'rd /s /q', 'del /f /s /q', 'format ', 'shutdown', 'reboot', 'poweroff', 'restart-computer',
    'stop-computer', 'remove-item -recurse -force', 'drop table', 'deltree', 'diskpart'
  ]
  return patterns.some(p => c.includes(p))
}

export function isReadOnlyCommand(command: string): boolean {
  const c = command.trim().toLowerCase()
  if (isDangerousCommand(c)) return false
  // 管道、多命令、重定向都可能产生副作用，视为风险
  if (c.includes('|') || c.includes(';') || c.includes('>')) return false
  const keywords = [
    'get-', 'select-', 'where-', 'measure-', 'test-path', 'resolve-path', 'sort-', 'group-', 'compare-',
    'git status', 'git log', 'git diff', 'git show', 'git branch', 'git remote', 'git ls-files', 'git tag', 'git rev-parse', 'git fetch', 'git --version',
    'dir ', 'ls ', 'gci ', 'cat ', 'type ', 'more ', 'echo ', 'printf ', 'write-output', 'pwd', 'get-location', 'whoami', 'where ', 'which ',
    'rg ', 'find ', 'head ', 'tail ', 'wc ', 'stat ', 'uname', 'sw_vers', 'ps ', 'lsof ',
    'node --version', 'node -v', 'npm --version', 'npm -v', 'python --version', 'git -v'
  ]
  return keywords.some(k => c.startsWith(k))
}
