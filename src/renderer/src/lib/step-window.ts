export const INITIAL_RENDERED_STEPS = 60
export const STEP_RENDER_BATCH = 60

export function visibleStepStart(totalSteps: number, visibleSteps: number): number {
  return Math.max(0, totalSteps - Math.max(1, visibleSteps))
}
