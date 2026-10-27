import { expect, it } from 'vitest'
import { formHostFeature, formSessionScope } from '../../src/forms/host-feature'
import { hmac } from '../../src/forms/security'

it('binds embedded sessions to their host while leaving standalone sessions independent', async () => {
  const standalone = new Headers(), embedded = new Headers({'x-vorti-form-host': 'pages'})
  expect(formHostFeature(standalone)).toBeUndefined()
  expect(formHostFeature(embedded)).toBe('pages')
  const sign = (headers: Headers) => hmac('synthetic-secret', `${formSessionScope('revision', headers)}.nonce.expiry`)
  expect(await sign(embedded)).not.toBe(await sign(standalone))
  expect(await sign(new Headers({'x-vorti-form-host': 'posts'}))).not.toBe(await sign(embedded))
  expect(() => formHostFeature(new Headers({'x-vorti-form-host': 'unknown'}))).toThrow('unavailable')
})
