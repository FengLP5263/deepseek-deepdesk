import { describe, expect, it } from 'vitest'
import { limitStoredDrafts, parseStoredDrafts } from '../src/renderer/src/hooks/useSessionDraft'

describe('session drafts', () => {
  it('ignores malformed storage values and invalid entries', () => {
    expect(parseStoredDrafts('not-json')).toEqual({})
    expect(parseStoredDrafts(JSON.stringify({ valid: { text: '草稿', updatedAt: 2 }, invalid: { text: 3, updatedAt: 'now' } }))).toEqual({
      valid: { text: '草稿', updatedAt: 2 }
    })
  })

  it('keeps only the thirty most recently updated drafts', () => {
    const drafts = Object.fromEntries(Array.from({ length: 35 }, (_, index) => [`session-${index}`, { text: String(index), updatedAt: index }]))
    const limited = limitStoredDrafts(drafts)
    expect(Object.keys(limited)).toHaveLength(30)
    expect(limited['session-34']).toBeDefined()
    expect(limited['session-0']).toBeUndefined()
  })

  it('bounds restored draft text', () => {
    const restored = parseStoredDrafts(JSON.stringify({ session: { text: 'x'.repeat(25_000), updatedAt: 1 } }))
    expect(restored.session.text).toHaveLength(20_000)
  })
})
