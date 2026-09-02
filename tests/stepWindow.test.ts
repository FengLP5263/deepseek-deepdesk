import { describe, expect, it } from 'vitest'
import { INITIAL_RENDERED_STEPS, STEP_RENDER_BATCH, visibleStepStart } from '../src/renderer/src/lib/step-window'

describe('step-window', () => {
  it('renders every step in a short conversation', () => {
    expect(visibleStepStart(20, INITIAL_RENDERED_STEPS)).toBe(0)
  })

  it('starts from the most recent window in a long conversation', () => {
    expect(visibleStepStart(240, INITIAL_RENDERED_STEPS)).toBe(180)
    expect(visibleStepStart(240, INITIAL_RENDERED_STEPS + STEP_RENDER_BATCH)).toBe(120)
  })

  it('handles empty and oversized windows safely', () => {
    expect(visibleStepStart(0, INITIAL_RENDERED_STEPS)).toBe(0)
    expect(visibleStepStart(10, 1000)).toBe(0)
    expect(visibleStepStart(10, 0)).toBe(9)
  })
})
