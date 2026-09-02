export interface ComposerKeyboardState {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export function shouldSubmitComposer(event: ComposerKeyboardState, enterToSend: boolean): boolean {
  if (event.key !== 'Enter') return false
  return enterToSend ? !event.shiftKey : event.ctrlKey || event.metaKey
}
