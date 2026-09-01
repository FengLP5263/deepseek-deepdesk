import { describe, expect, it } from 'vitest'
import type { MemoryItem } from '../src/shared/types'
import { extractMemoryCandidates, formatMemoryContext, normalizeMemoryContent, searchMemories } from '../src/shared/memory'

function memory(patch: Partial<MemoryItem>): MemoryItem {
  return {
    id: patch.id ?? 'm',
    scope: patch.scope ?? 'user',
    kind: patch.kind ?? 'fact',
    content: patch.content ?? '',
    tags: patch.tags ?? [],
    enabled: patch.enabled ?? true,
    createdAt: patch.createdAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
    source: patch.source
  }
}

describe('memory helpers', () => {
  it('提取显式记忆、高置信偏好和项目约定', () => {
    expect(extractMemoryCandidates('帮我记一下：我喜欢先给结论再解释')).toEqual([expect.objectContaining({
      scope: 'user',
      kind: 'preference',
      content: '我喜欢先给结论再解释'
    })])
    expect(extractMemoryCandidates('以后请默认使用约定式提交')).toEqual([expect.objectContaining({ kind: 'preference' })])
    expect(extractMemoryCandidates('我们这个项目约定：合并前必须跑完测试')).toEqual([expect.objectContaining({ scope: 'project', kind: 'decision' })])
  })

  it('不记录普通一次性指令和敏感凭据', () => {
    expect(extractMemoryCandidates('帮我检查一下这个文件')).toEqual([])
    expect(extractMemoryCandidates('帮我记住 API Key 是 secret-value')).toEqual([])
    expect(normalizeMemoryContent('先给结论， 再解释。')).toBe('先给结论再解释')
  })

  it('按关键词、标签和范围检索启用的记忆', () => {
    const items = [
      memory({ id: 'a', scope: 'user', kind: 'preference', content: '用户喜欢直接给结论', tags: ['沟通'], updatedAt: 1 }),
      memory({ id: 'b', scope: 'project', kind: 'fact', content: 'DeepDesk 是 Electron 桌面客户端', tags: ['deepdesk'], updatedAt: 3 }),
      memory({ id: 'c', scope: 'agent', kind: 'procedure', content: '提交前运行 pnpm flow -- check', tags: ['工程化'], updatedAt: 2 }),
      memory({ id: 'd', scope: 'project', kind: 'fact', content: '停用记忆', tags: ['deepdesk'], enabled: false, updatedAt: 4 })
    ]

    const result = searchMemories(items, 'deepdesk', ['project'], 3)

    expect(result.map(item => item.id)).toEqual(['b'])
  })

  it('格式化为可注入的 system 上下文', () => {
    const context = formatMemoryContext([
      memory({ scope: 'user', kind: 'preference', content: '少讲概念，多给操作步骤', tags: ['沟通'] })
    ])

    expect(context).toContain('长期记忆')
    expect(context).toContain('[用户/偏好]')
    expect(context).toContain('少讲概念')
  })
})
