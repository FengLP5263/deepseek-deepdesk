import { useEffect } from 'react'
import { changeAppFontScale, normalizeAppFontScale } from '@shared/font-scale'
import { useSettingsStore } from '../stores/useSettingsStore'

const WHEEL_STEP_THRESHOLD = 40
const WHEEL_GESTURE_RESET_MS = 240

function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale))
  document.documentElement.dataset.fontScale = String(Math.round(scale * 100))
}

export function useAppFontScale(): void {
  useEffect(() => {
    let current = normalizeAppFontScale(useSettingsStore.getState().settings?.appFontScale)
    let accumulatedDelta = 0
    let lastWheelAt = 0

    const syncFromSettings = (): void => {
      current = normalizeAppFontScale(useSettingsStore.getState().settings?.appFontScale)
      applyFontScale(current)
    }

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()

      const now = Date.now()
      if (now - lastWheelAt > WHEEL_GESTURE_RESET_MS || Math.sign(accumulatedDelta) !== Math.sign(event.deltaY)) {
        accumulatedDelta = 0
      }
      lastWheelAt = now
      accumulatedDelta += event.deltaY
      if (Math.abs(accumulatedDelta) < WHEEL_STEP_THRESHOLD) return

      const next = changeAppFontScale(current, accumulatedDelta < 0 ? 'increase' : 'decrease')
      accumulatedDelta = 0
      if (next === current) return

      current = next
      applyFontScale(next)
      useSettingsStore.setState(state => ({
        settings: state.settings ? { ...state.settings, appFontScale: next } : null
      }))
      void useSettingsStore.getState().updateSettings({ appFontScale: next })
    }

    syncFromSettings()
    const unsubscribe = useSettingsStore.subscribe(syncFromSettings)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      unsubscribe()
      window.removeEventListener('wheel', onWheel)
    }
  }, [])
}
