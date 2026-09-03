import { describe, expect, it } from 'vitest'
import {
  APP_FONT_SCALE_DEFAULT,
  APP_FONT_SCALE_MAX,
  APP_FONT_SCALE_MIN,
  changeAppFontScale,
  normalizeAppFontScale
} from '../src/shared/font-scale'

describe('app font scale', () => {
  it('uses the default for missing or invalid values', () => {
    expect(normalizeAppFontScale(undefined)).toBe(APP_FONT_SCALE_DEFAULT)
    expect(normalizeAppFontScale(Number.NaN)).toBe(APP_FONT_SCALE_DEFAULT)
    expect(normalizeAppFontScale('1.2')).toBe(APP_FONT_SCALE_DEFAULT)
  })

  it('rounds to supported steps and clamps the range', () => {
    expect(normalizeAppFontScale(1.06)).toBe(1.1)
    expect(normalizeAppFontScale(0.1)).toBe(APP_FONT_SCALE_MIN)
    expect(normalizeAppFontScale(2)).toBe(APP_FONT_SCALE_MAX)
  })

  it('changes one step without crossing the supported range', () => {
    expect(changeAppFontScale(1, 'increase')).toBe(1.1)
    expect(changeAppFontScale(1, 'decrease')).toBe(0.9)
    expect(changeAppFontScale(APP_FONT_SCALE_MAX, 'increase')).toBe(APP_FONT_SCALE_MAX)
    expect(changeAppFontScale(APP_FONT_SCALE_MIN, 'decrease')).toBe(APP_FONT_SCALE_MIN)
  })
})
