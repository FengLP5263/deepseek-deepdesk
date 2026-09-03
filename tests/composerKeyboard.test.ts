import { describe, expect, it } from 'vitest'
import { shouldSubmitComposer } from '../src/renderer/src/lib/composer-keyboard'

const event = (overrides: Partial<Parameters<typeof shouldSubmitComposer>[0]> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...overrides
})

describe('composer-keyboard', () => {
  it('submits plain Enter and keeps Shift+Enter as a newline when enabled', () => {
    expect(shouldSubmitComposer(event(), true)).toBe(true)
    expect(shouldSubmitComposer(event({ shiftKey: true }), true)).toBe(false)
  })

  it('requires Ctrl or Command plus Enter when plain Enter sending is disabled', () => {
    expect(shouldSubmitComposer(event(), false)).toBe(false)
    expect(shouldSubmitComposer(event({ ctrlKey: true }), false)).toBe(true)
    expect(shouldSubmitComposer(event({ metaKey: true }), false)).toBe(true)
    expect(shouldSubmitComposer(event({ key: 'a', ctrlKey: true }), false)).toBe(false)
  })
})
