'use client'
import { useId, useRef, type ReactNode } from 'react'
export function SetupWizard({
  steps,
  current,
  onChange,
  children,
}: {
  steps: string[]
  current: number
  onChange: (step: number) => void
  children: ReactNode
}) {
  const id = useId(),
    heading = useRef<HTMLHeadingElement>(null)
  const go = (step: number) => {
    onChange(step)
    requestAnimationFrame(() => heading.current?.focus())
  }
  return (
    <section className="pt-wizard">
      <nav aria-label="Post Type setup steps">
        <ol>
          {steps.map((step, index) => (
            <li key={step}>
              <button
                type="button"
                aria-current={current === index ? 'step' : undefined}
                onClick={() => go(index)}
              >
                {index + 1}. {step}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="pt-wizard-body" aria-labelledby={id}>
        <h2 id={id} ref={heading} tabIndex={-1}>
          Step {current + 1}: {steps[current]}
        </h2>
        {children}
        <div className="pt-wizard-actions">
          <button type="button" disabled={current === 0} onClick={() => go(current - 1)}>
            Back
          </button>
          <span>
            {current + 1} of {steps.length}
          </span>
          <button
            type="button"
            disabled={current === steps.length - 1}
            onClick={() => go(current + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  )
}
