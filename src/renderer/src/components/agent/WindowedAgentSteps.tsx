import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentStep } from '@shared/agent-types'
import { INITIAL_RENDERED_STEPS, STEP_RENDER_BATCH, visibleStepStart } from '../../lib/step-window'

export default function WindowedAgentSteps({ sessionId, steps, renderStep }: {
  sessionId: string | null
  steps: AgentStep[]
  renderStep: (step: AgentStep, index: number) => ReactNode
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDERED_STEPS)
  const start = visibleStepStart(steps.length, visibleCount)

  useEffect(() => setVisibleCount(INITIAL_RENDERED_STEPS), [sessionId])

  const loadEarlier = (button: HTMLButtonElement): void => {
    const scroll = button.closest<HTMLElement>('.agent-scroll')
    const distanceFromBottom = scroll ? scroll.scrollHeight - scroll.scrollTop : 0
    setVisibleCount(count => count + STEP_RENDER_BATCH)
    if (scroll) {
      window.requestAnimationFrame(() => {
        scroll.scrollTop = scroll.scrollHeight - distanceFromBottom
      })
    }
  }

  return (
    <>
      {start > 0 && (
        <button className='agent-load-earlier' type='button' onClick={event => loadEarlier(event.currentTarget)}>
          加载更早的 {Math.min(STEP_RENDER_BATCH, start)} 条内容
        </button>
      )}
      {steps.slice(start).map((step, offset) => {
        const index = start + offset
        return <Fragment key={index}>{renderStep(step, index)}</Fragment>
      })}
    </>
  )
}
