import type { ArchivedSession, SessionTarget } from '../shared/session-archive'
import type { AppStore } from './store'
import { detachSessionRun } from './run-persistence'

function validateTarget(value: SessionTarget): void {
  if (!value || !['agent', 'chat'].includes(value.kind) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 1024) throw new Error('无效的会话标识')
}

export function createSessionArchive(store: AppStore, cancel: (kind: SessionTarget['kind'], runId: string) => void) {
  const busy = new Set<string>()
  const change = async (target: SessionTarget, action: 'archive' | 'restore' | 'remove'): Promise<void> => {
    validateTarget(target)
    const key = `${target.kind}:${target.id}`
    if (busy.has(key)) throw new Error('正在处理此会话，请稍后重试')
    busy.add(key)
    try {
      if (action !== 'restore') {
        const runId = detachSessionRun(store, target)
        if (runId) cancel(target.kind, runId)
      }
      if (action === 'remove') await store.purgeArchivedSession(target)
      else {
        store.setSessionArchived(target, action === 'archive')
        await store.sessions.flush()
      }
    } finally { busy.delete(key) }
  }
  return {
    list(): ArchivedSession[] {
      const snapshot = store.getSnapshot()
      return [
        ...snapshot.agentSessions.filter(s => s.archivedAt).map(s => ({ kind: 'agent' as const, id: s.id, title: s.task, archivedAt: s.archivedAt!, source: s.source?.type === 'connector' ? s.source.connectorId : 'desktop' as const })),
        ...snapshot.conversations.filter(s => s.archivedAt).map(s => ({ kind: 'chat' as const, id: s.id, title: s.title, archivedAt: s.archivedAt!, source: 'chat' as const }))
      ].sort((a, b) => b.archivedAt - a.archivedAt)
    },
    archive: (target: SessionTarget) => change(target, 'archive'),
    restore: (target: SessionTarget) => change(target, 'restore'),
    remove: (target: SessionTarget) => change(target, 'remove')
  }
}
