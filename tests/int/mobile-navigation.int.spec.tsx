// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Navigation } from '@/payload-types'
import { MobileMenuProvider, MobileMenuToggle, SiteNavigation } from '@/components/site-shell/Navigation'

const items = [{ label: 'External', linkType: 'external' as const, url: 'https://example.com', enabled: true }]

describe('mobile Site Template navigation', () => {
  afterEach(cleanup)
  it('opens and closes with linked accessible state', () => {
    render(<MobileMenuProvider><MobileMenuToggle /><SiteNavigation items={items as Navigation['primary']} label="Primary navigation" /></MobileMenuProvider>)
    const button = screen.getByRole('button', { name: 'Menu' })
    const navigation = screen.getByRole('navigation')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe(navigation.id)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})
