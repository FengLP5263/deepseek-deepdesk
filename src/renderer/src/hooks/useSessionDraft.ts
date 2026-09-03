import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'deepdesk.agent-drafts.v1'
const MAX_DRAFTS = 30
const MAX_DRAFT_LENGTH = 20_000

interface StoredDraft {
  text: string
  updatedAt: number
}

export type StoredDrafts = Record<string, StoredDraft>

export function parseStoredDrafts(value: string | null): StoredDrafts {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, draft]) => {
      if (!draft || typeof draft !== 'object') return []
      const candidate = draft as Partial<StoredDraft>
      if (typeof candidate.text !== 'string' || typeof candidate.updatedAt !== 'number') return []
      return [[key, { text: candidate.text.slice(0, MAX_DRAFT_LENGTH), updatedAt: candidate.updatedAt }]]
    }))
  } catch {
    return {}
  }
}

export function limitStoredDrafts(drafts: StoredDrafts): StoredDrafts {
  return Object.fromEntries(Object.entries(drafts).sort((left, right) => right[1].updatedAt - left[1].updatedAt).slice(0, MAX_DRAFTS))
}

function loadDrafts(): StoredDrafts {
  try { return parseStoredDrafts(window.localStorage.getItem(STORAGE_KEY)) } catch { return {} }
}

function persistDrafts(drafts: StoredDrafts): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(limitStoredDrafts(drafts))) } catch { /* local-only best effort */ }
}

export default function useSessionDraft(sessionId: string): [string, (text: string) => void] {
  const [drafts, setDrafts] = useState<StoredDrafts>(loadDrafts)
  const latestDrafts = useRef(drafts)
  latestDrafts.current = drafts

  useEffect(() => {
    const timer = window.setTimeout(() => persistDrafts(drafts), 180)
    return () => window.clearTimeout(timer)
  }, [drafts])

  useEffect(() => () => persistDrafts(latestDrafts.current), [])

  const setText = useCallback((text: string): void => {
    setDrafts(current => {
      const next = { ...current }
      if (text) next[sessionId] = { text: text.slice(0, MAX_DRAFT_LENGTH), updatedAt: Date.now() }
      else {
        delete next[sessionId]
        persistDrafts(next)
      }
      return next
    })
  }, [sessionId])

  return [drafts[sessionId]?.text ?? '', setText]
}
