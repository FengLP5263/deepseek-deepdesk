import type { PlatformInfo } from '../shared/platform'
import { getPlatformAdapter } from './platform'

export function createAgentTools(platform: PlatformInfo): Array<Record<string, unknown>> {
  const shell = platform.shellName === 'powershell' ? 'PowerShell' : 'zsh'
  return [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在用户电脑上执行一条 ' + shell + ' 命令，返回标准输出、错误与退出码。优先用只读命令了解现状。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          cwd: { type: 'string', description: '可选，命令的工作目录（相对或绝对路径，需在工作目录内）' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容（带行号）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径（相对或绝对，需在工作目录内）' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '创建或覆盖一个文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '精准替换文件中唯一出现的一段文本',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出目录内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，默认工作目录' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '在文件中递归搜索文本，返回匹配行（带行号）',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: '搜索范围（文件或目录），默认工作目录' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_feishu_user',
      description: '按姓名在飞书通讯录中搜索同事，返回候选人的姓名、部门与 open_id',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '同事姓名' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_feishu_message',
      description: '给指定同事发送一条飞书文本消息（需要 open_id，先用 search_feishu_user 查询）',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: '接收人的 open_id（ou_ 开头）' },
          text: { type: 'string', description: '要发送的文本内容' }
        },
        required: ['user_id', 'text']
      }
    }
  }
  ]
}

export const AGENT_TOOLS = createAgentTools(getPlatformAdapter().info)
