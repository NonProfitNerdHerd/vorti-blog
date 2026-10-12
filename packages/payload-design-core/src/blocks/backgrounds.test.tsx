import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveBackground, validatePresentation } from './presentation'
import { ContentRenderer } from '../content/ContentRenderer'
import { createContentNode } from '../content/model'
import { countdownDeadline } from './countdown'
describe('responsive backgrounds and public schedules', () => {
  it('inherits each property and removes overrides without clearing smaller devices', () => {
    const background = {
      imageURL: '/desktop.jpg',
      opacity: 0.4,
      responsive: { tablet: { imageURL: '/tablet.jpg' }, mobile: { opacity: 0.7 } },
    }
    expect(resolveBackground(background, 'mobile')).toMatchObject({
      imageURL: '/tablet.jpg',
      opacity: 0.7,
    })
    delete (background.responsive as { tablet?: unknown }).tablet
    expect(resolveBackground(background, 'mobile')).toMatchObject({
      imageURL: '/desktop.jpg',
      opacity: 0.7,
    })
  })
  it('uses matching responsive image rules in canvas and public output', () => {
    const node = createContentNode('hero')
    node.presentation = {
      background: {
        imageURL: '/desktop.jpg',
        overlay: '#112233',
        opacity: 0.4,
        responsive: { mobile: { imageURL: '/phone.jpg', opacity: 0.8 } },
      },
    }
    const published = renderToStaticMarkup(<ContentRenderer nodes={[node]} />),
      canvas = renderToStaticMarkup(<ContentRenderer nodes={[node]} viewport="mobile" />)
    expect(published).toContain('@media(max-width:640px)')
    expect(published).toContain('background-image:url("/phone.jpg")')
    expect(canvas).toContain('--block-overlay-opacity:0.8')
    expect(
      validatePresentation({
        background: { responsive: { mobile: { imageURL: 'javascript:alert(1)' } } },
      }),
    ).toBeTruthy()
  })
  it('keeps a daily public schedule at the same wall time across daylight saving', () => {
    const next = countdownDeadline(
      '2026-03-07T15:00:00Z',
      'America/Chicago',
      'daily',
      Date.parse('2026-03-08T12:00:00Z'),
    )
    expect(new Date(next).toISOString()).toBe('2026-03-08T14:00:00.000Z')
    expect(
      new Date(
        countdownDeadline(
          '2026-10-31T14:00:00Z',
          'America/Chicago',
          'daily',
          Date.parse('2026-11-01T12:00:00Z'),
        ),
      ).toISOString(),
    ).toBe('2026-11-01T15:00:00.000Z')
  })
  it('clamps monthly schedules to month end and retains one-off completion', () => {
    expect(
      new Date(
        countdownDeadline(
          '2026-01-31T10:00:00Z',
          'UTC',
          'monthly',
          Date.parse('2026-02-01T00:00:00Z'),
        ),
      ).toISOString(),
    ).toBe('2026-02-28T10:00:00.000Z')
    expect(countdownDeadline('2026-01-01T00:00:00Z', 'UTC', 'none', Date.parse('2026-02-01'))).toBe(
      Date.parse('2026-01-01T00:00:00Z'),
    )
  })
})

it('moves nonexistent DST times forward and chooses the first repeated time', () => {
  expect(
    new Date(
      countdownDeadline(
        '2026-03-07T08:30:00Z',
        'America/Chicago',
        'daily',
        Date.parse('2026-03-08T06:00:00Z'),
      ),
    ).toISOString(),
  ).toBe('2026-03-08T08:30:00.000Z')
  expect(
    new Date(
      countdownDeadline(
        '2026-10-31T06:30:00Z',
        'America/Chicago',
        'daily',
        Date.parse('2026-11-01T05:00:00Z'),
      ),
    ).toISOString(),
  ).toBe('2026-11-01T06:30:00.000Z')
})
