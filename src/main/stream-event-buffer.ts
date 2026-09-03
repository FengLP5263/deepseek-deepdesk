interface TextStreamEvent {
  type: string
  text?: string
}

interface StreamEventBufferOptions<T extends TextStreamEvent> {
  delayMs?: number
  maxCharacters?: number
  isBufferable: (event: T) => boolean
}

export interface StreamEventBuffer<T extends TextStreamEvent> {
  send: (event: T) => void
  flush: () => void
}

export function createStreamEventBuffer<T extends TextStreamEvent>(
  sendNow: (event: T) => void,
  options: StreamEventBufferOptions<T>
): StreamEventBuffer<T> {
  const delayMs = options.delayMs ?? 24
  const maxCharacters = options.maxCharacters ?? 512
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    const event = pending
    pending = null
    sendNow(event)
  }

  const schedule = (): void => {
    if (!timer) timer = setTimeout(flush, delayMs)
  }

  const send = (event: T): void => {
    if (!options.isBufferable(event) || !event.text) {
      flush()
      sendNow(event)
      return
    }

    if (pending && pending.type === event.type) {
      pending = { ...event, text: (pending.text ?? '') + event.text }
    } else {
      flush()
      pending = event
    }

    if ((pending.text?.length ?? 0) >= maxCharacters) flush()
    else schedule()
  }

  return { send, flush }
}
