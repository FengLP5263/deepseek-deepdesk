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
  },
  {
    type: 'function',
    function: {
      name: 'browser_pages',
      description: '列出当前浏览器调试连接中的所有可操作页面，返回页面 ID、标题和 URL。使用其他浏览器工具前先调用此工具。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: '让浏览器页面访问指定 HTTP/HTTPS 地址，也可以新建页面。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 http:// 或 https:// 地址' },
          target_id: { type: 'string', description: '可选，browser_pages 返回的页面 ID' },
          new_page: { type: 'boolean', description: '为 true 时创建新页面' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description: '读取页面标题、URL、正文和可交互元素列表。返回的 selector 可直接用于点击和输入。',
      parameters: {
        type: 'object',
        properties: { target_id: { type: 'string', description: '可选，页面 ID；默认使用第一个普通页面' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: '点击页面中的元素。点击可能提交表单或触发外部操作，需遵守权限审批。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'browser_snapshot 返回的 CSS selector' },
          target_id: { type: 'string', description: '可选，页面 ID' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: '在输入框或可编辑元素中输入文本，可选提交表单。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'browser_snapshot 返回的 CSS selector' },
          text: { type: 'string', description: '要输入的文本' },
          submit: { type: 'boolean', description: '输入后是否提交表单' },
          target_id: { type: 'string', description: '可选，页面 ID' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_debug',
      description: '采集页面运行状态、控制台输出、脚本异常、网络失败和最近资源请求，用于调试网页问题。',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: '可选，页面 ID' },
          duration_ms: { type: 'number', description: '采集新事件的时长，100 到 2000 毫秒' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_evaluate',
      description: '在页面上下文执行 JavaScript 调试表达式并返回可序列化结果。该能力权限较高，通常需要用户批准。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '要执行的 JavaScript 表达式' },
          target_id: { type: 'string', description: '可选，页面 ID' }
        },
        required: ['expression']
      }
    }
  }
  ]
}

export const AGENT_TOOLS = createAgentTools(getPlatformAdapter().info)
