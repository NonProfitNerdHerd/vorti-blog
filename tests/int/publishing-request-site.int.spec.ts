import { expect, it } from 'vitest'
import { publishingRequestSite } from '@/publishing/request-site'
import { PUBLIC_SITE_HEADER } from '@/organizations/public-site-headers'

it('pins prefixed requests to the Worker-resolved site and rejects conflicting hints', () => {
  const headers = new Headers({ [PUBLIC_SITE_HEADER]: 'child' })
  expect(publishingRequestSite('https://example.invalid/sites/child/api/publishing/media/1', headers)).toBe('child')
  expect(publishingRequestSite('https://example.invalid/api/knowledge?site=child', headers)).toBe('child')
  expect(() => publishingRequestSite('https://example.invalid/api/knowledge?site=default', headers)).toThrow('does not match')
  headers.set('x-vorticause-site', 'another')
  expect(() => publishingRequestSite('https://example.invalid/api/publishing/media/1', headers)).toThrow('does not match')
})

it('retains explicit central administration site selection and validates its syntax', () => {
  expect(publishingRequestSite('https://example.invalid/api/publishing/sharing?site=child', new Headers())).toBe('child')
  expect(publishingRequestSite('https://example.invalid/api/knowledge', new Headers())).toBe('default')
  expect(() => publishingRequestSite('https://example.invalid/api/knowledge?site=../child', new Headers())).toThrow('valid site')
})
