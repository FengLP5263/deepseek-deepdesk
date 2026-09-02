import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamEventBuffer } from '../src/main/stream-event-buffer'

interface Event {
  type: 'content' | 'reasoning' | 'done'
  text?: string
}

describe('stream event buffer', () => {
  afterEach(() => vi.useRealTimers())

  it('coalesces frequent text chunks into one event', () => {
    vi.useFakeTimers()
    const events: Event[] = []
    const buffer = createStreamEventBuffer<Event>(event => events.push(event), {
      delayMs: 20,
      isBufferable: event => event.type === 'content' || event.type === 'reasoning'
    })

    for (let index = 0; index < 100; index++) buffer.send({ type: 'content', text: String(index % 10) })
    expect(events).toHaveLength(0)

    vi.advanceTimersByTime(20)
    expect(events).toEqual([{ type: 'content', text: '0123456789'.repeat(10) }])
  })

  it('flushes in order at a stream boundary', () => {
    vi.useFakeTimers()
    const events: Event[] = []
    const buffer = createStreamEventBuffer<Event>(event => events.push(event), {
      isBufferable: event => event.type !== 'done'
    })

    buffer.send({ type: 'reasoning', text: '先想' })
    buffer.send({ type: 'reasoning', text: '一下' })
    buffer.send({ type: 'content', text: '答案' })
    buffer.send({ type: 'done' })

    expect(events).toEqual([
      { type: 'reasoning', text: '先想一下' },
      { type: 'content', text: '答案' },
      { type: 'done' }
    ])
  })

  it('flushes large chunks without waiting for the timer', () => {
    vi.useFakeTimers()
    const events: Event[] = []
    const buffer = createStreamEventBuffer<Event>(event => events.push(event), {
      maxCharacters: 4,
      isBufferable: event => event.type === 'content'
    })

    buffer.send({ type: 'content', text: '12' })
    buffer.send({ type: 'content', text: '34' })

    expect(events).toEqual([{ type: 'content', text: '1234' }])
  })
})
