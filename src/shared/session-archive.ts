export type SessionKind = 'agent' | 'chat'
export interface SessionTarget { kind: SessionKind; id: string }
export interface ArchivedSession extends SessionTarget {
  title: string
  archivedAt: number
  source: 'desktop' | 'lark' | 'wechat' | 'chat'
}
