import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildTemplate: vi.fn((template: Array<Record<string, unknown>>) => template),
  destroy: vi.fn(),
  quit: vi.fn(),
  register: vi.fn((_accelerator: string, callback: () => void) => { mocks.shortcut = callback; return true }),
  setContextMenu: vi.fn(),
  setTemplateImage: vi.fn(),
  setToolTip: vi.fn(),
  shortcut: undefined as (() => void) | undefined,
  trayClick: undefined as (() => void) | undefined,
  unregister: vi.fn()
}))

vi.mock('electron', () => {
  const image = { resize: () => image, setTemplateImage: mocks.setTemplateImage, isEmpty: () => false }
  return {
    app: { isPackaged: false, getAppPath: () => 'C:\\DeepDesk', quit: mocks.quit },
    globalShortcut: { register: mocks.register, unregister: mocks.unregister },
    Menu: { buildFromTemplate: mocks.buildTemplate },
    nativeImage: { createFromPath: () => image },
    Tray: class {
      setToolTip = mocks.setToolTip
      setContextMenu = mocks.setContextMenu
      on(_event: string, callback: () => void): void { mocks.trayClick = callback }
      destroy = mocks.destroy
    }
  }
})

import { configureDesktopPresence, DEEPDESK_GLOBAL_SHORTCUT, shutdownDesktopPresence } from '../src/main/desktop-presence'

beforeEach(() => {
  shutdownDesktopPresence()
  vi.clearAllMocks()
  mocks.shortcut = undefined
  mocks.trayClick = undefined
})

describe('desktop presence', () => {
  it('托盘和全局快捷键可以唤起窗口及新建任务', () => {
    const showWindow = vi.fn()
    const newTask = vi.fn()
    configureDesktopPresence({ showWindow, newTask })

    expect(mocks.register).toHaveBeenCalledWith(DEEPDESK_GLOBAL_SHORTCUT, showWindow)
    mocks.shortcut?.()
    mocks.trayClick?.()
    expect(showWindow).toHaveBeenCalledTimes(2)

    const template = mocks.buildTemplate.mock.calls.at(-1)?.[0] as Array<{ label?: string; click?: () => void }>
    template.find(item => item.label === '新建任务')?.click?.()
    expect(newTask).toHaveBeenCalledOnce()
  })

  it('退出时注销快捷键并销毁托盘', () => {
    configureDesktopPresence({ showWindow: vi.fn(), newTask: vi.fn() })
    shutdownDesktopPresence()

    expect(mocks.unregister).toHaveBeenCalledWith(DEEPDESK_GLOBAL_SHORTCUT)
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
