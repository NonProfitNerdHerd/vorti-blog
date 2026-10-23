import { expect, it } from 'vitest'
import { publicFormsSite, PUBLIC_SITE_HEADER } from '../../src/organizations/public-site-headers'

it('pins every compatibility public Forms endpoint to the main site', () => {
  for (const endpoint of [
    'forms-runtime',
    'forms-embed',
    'forms-surveys',
    'forms-payments',
    'forms-placement',
  ])
    expect(
      publicFormsSite('https://example.invalid/api/' + endpoint + '/application', new Headers()),
    ).toBe('default')
})

it('uses the Worker-resolved child for public Forms requests', () => {
  expect(
    publicFormsSite(
      'https://example.invalid/api/forms-runtime/application',
      new Headers({ [PUBLIC_SITE_HEADER]: 'region' }),
    ),
  ).toBe('region')
})

it('leaves native Forms administration and background jobs on their explicit editor or job context', () => {
  for (const path of [
    '/api/forms',
    '/api/forms/1',
    '/api/forms-placements',
    '/api/forms-actions/tick',
  ])
    expect(publicFormsSite('https://example.invalid' + path, new Headers())).toBeUndefined()
})
