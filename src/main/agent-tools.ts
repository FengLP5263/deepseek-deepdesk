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
      description: '点击页面中的元素。操作前会在用户浏览器中显示 DeepDesk 可视指针；点击可能提交表单或触发外部操作，需遵守权限审批。',
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
      description: '在输入框或可编辑元素中输入文本，但不提交。聚焦输入位置时会显示 DeepDesk 可视指针；如需搜索、发送或提交，输入完成后必须再调用 browser_click 点击 browser_snapshot 返回的可见按钮。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'browser_snapshot 返回的 CSS selector' },
          text: { type: 'string', description: '要输入的文本' },
          target_id: { type: 'string', description: '可选，页面 ID' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_hover',
      description: '把 DeepDesk 可视指针移动到页面元素并悬停，用于展开菜单、显示提示或检查悬停状态。',
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
      name: 'browser_scroll',
      description: '在当前页面中执行可见滚动。DeepDesk 指针会先移动到页面滚动区域，再通过浏览器原生滚轮事件平滑滚动。',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: '滚动方向' },
          amount: { type: 'number', description: '滚动距离，单位像素，默认 640' },
          target_id: { type: 'string', description: '可选，页面 ID' }
        },
        required: ['direction']
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
      name: 'search_mcp_tools',
      description: '搜索当前已连接 MCP 服务的工具目录。连接的工具很多时，先按服务名、能力或操作对象搜索；命中的真实工具会在下一轮可用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要查找的能力，例如“搜索文档”“数据库查询”或服务名' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'inspect_mcp_server',
      description: '检查用户明确提供的 HTTP MCP 服务端点，读取服务身份和工具清单，并生成一个短时安装凭证。只支持可直接连接的 Streamable HTTP MCP 地址；不要把 GitHub、npm 或普通网页地址当作服务端点。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '用户提供的完整 HTTP 或 HTTPS MCP 服务端点' }
        },
        required: ['source']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'install_mcp_server',
      description: '使用 inspect_mcp_server 返回的短时凭证安装并连接 MCP 服务。该操作始终要求用户确认，不能自行构造 candidate_id，也不要通过命令或改配置文件绕过确认。',
      parameters: {
        type: 'object',
        properties: {
          candidate_id: { type: 'string', description: 'inspect_mcp_server 返回的 candidate_id' }
        },
        required: ['candidate_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_evaluate',
      description: '在页面上下文执行只读 JavaScript 调试表达式并返回可序列化结果。禁止用脚本点击、输入、滚动或导航，交互必须改用 browser_click、browser_type、browser_hover、browser_scroll 或 browser_navigate，以确保用户能看见 DeepDesk 指针的操作过程。该能力权限较高，通常需要用户批准。',
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
