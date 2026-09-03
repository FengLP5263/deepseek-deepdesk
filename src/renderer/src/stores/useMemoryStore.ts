import { create } from 'zustand'
import type { MemoryItem, MemoryKind, MemoryScope } from '@shared/types'
import { uid } from '../lib/utils'

interface MemoryDraft {
  scope: MemoryScope
  kind: MemoryKind
  content: string
  tags: string
}

interface MemoryState {
  loaded: boolean
  memories: MemoryItem[]
  draft: MemoryDraft
  editingId: string | null
  init: () => Promise<void>
  setDraft: (patch: Partial<MemoryDraft>) => void
  edit: (memory: MemoryItem) => void
  cancelEdit: () => void
  saveDraft: () => Promise<void>
  toggle: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

const emptyDraft: MemoryDraft = {
  scope: 'user',
  kind: 'preference',
  content: '',
  tags: ''
}

function tagsFromText(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,，、;；]+/u).map(tag => tag.trim()).filter(Boolean)))
}

export const useMemoryStore = create<MemoryState>()((set, get) => ({
  loaded: false,
  memories: [],
  draft: emptyDraft,
  editingId: null,
  init: async () => {
    const memories = await window.api.memories.list()
    set({ loaded: true, memories: memories.sort((a, b) => b.updatedAt - a.updatedAt) })
  },
  setDraft: patch => set(s => ({ draft: { ...s.draft, ...patch } })),
  edit: memory => set({
    editingId: memory.id,
    draft: {
      scope: memory.scope,
      kind: memory.kind,
      content: memory.content,
      tags: memory.tags.join(' ')
    }
  }),
  cancelEdit: () => set({ editingId: null, draft: emptyDraft }),
  saveDraft: async () => {
    const { draft, editingId, memories } = get()
    const content = draft.content.trim()
    if (!content) return
    const existing = editingId ? memories.find(memory => memory.id === editingId) : null
    const now = Date.now()
    const memory: MemoryItem = {
      id: existing?.id ?? uid(),
      scope: draft.scope,
      kind: draft.kind,
      content,
      tags: tagsFromText(draft.tags),
      source: existing?.source ?? { type: 'manual' },
      enabled: existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const saved = await window.api.memories.upsert(memory)
    set(s => ({
      editingId: null,
      draft: emptyDraft,
      memories: [saved, ...s.memories.filter(item => item.id !== saved.id)].sort((a, b) => b.updatedAt - a.updatedAt)
    }))
  },
  toggle: async id => {
    const memory = get().memories.find(item => item.id === id)
    if (!memory) return
    const saved = await window.api.memories.upsert({ ...memory, enabled: !memory.enabled, updatedAt: Date.now() })
    set(s => ({ memories: s.memories.map(item => item.id === id ? saved : item) }))
  },
  remove: async id => {
    await window.api.memories.remove(id)
    set(s => ({ memories: s.memories.filter(item => item.id !== id), editingId: s.editingId === id ? null : s.editingId }))
  }
}))
