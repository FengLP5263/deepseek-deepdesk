export const APP_FONT_SCALE_DEFAULT = 1
export const APP_FONT_SCALE_MIN = 0.8
export const APP_FONT_SCALE_MAX = 1.5
export const APP_FONT_SCALE_STEP = 0.1

export type AppFontScaleDirection = 'increase' | 'decrease'

export function normalizeAppFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return APP_FONT_SCALE_DEFAULT
  const stepped = Math.round(value / APP_FONT_SCALE_STEP) * APP_FONT_SCALE_STEP
  return Number(Math.min(APP_FONT_SCALE_MAX, Math.max(APP_FONT_SCALE_MIN, stepped)).toFixed(1))
}

export function changeAppFontScale(value: unknown, direction: AppFontScaleDirection): number {
  const current = normalizeAppFontScale(value)
  const delta = direction === 'increase' ? APP_FONT_SCALE_STEP : -APP_FONT_SCALE_STEP
  return normalizeAppFontScale(current + delta)
}
