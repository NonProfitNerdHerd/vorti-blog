import { describe, it, expect } from 'vitest'
import { embedOrigin, resizeHeight } from '../../packages/payload-design-core/src/forms/embed'
import { emptyDefinition, validateDefinition } from '../../packages/payload-design-core/src/forms'

describe('Form iframe boundaries', () => {
  it('accepts exact origins and rejects wildcard, credential, path, and opaque sources', () => {
    expect(embedOrigin('https://example.test/')).toBe('https://example.test')
    expect(embedOrigin('http://localhost:3110')).toBe('http://localhost:3110')
    for (const origin of ['*', 'https://*.example.test', 'https://user@example.test', 'https://example.test/path', 'https://example.test?secret=1', 'https://example.test#fragment', 'https://a;script-src.example', "https://a'b.example", 'data:text/html,test', 'http://example.test']) expect(embedOrigin(origin)).toBeUndefined()
  })
  it('accepts only bounded numeric resize messages for the expected instance', () => {
    expect(resizeHeight({ type: 'vorti-form-resize', id: 'own', height: 512.5 }, 'own')).toBe(513)
    expect(resizeHeight({ type: 'vorti-form-resize', id: 'own', height: 25000 }, 'own')).toBe(20000)
    for (const data of [null, {}, { type: 'other', id: 'own', height: 500 }, { type: 'vorti-form-resize', id: 'other', height: 500 }, { type: 'vorti-form-resize', id: 'own', height: '500' }, { type: 'vorti-form-resize', id: 'own', height: Infinity }, { type: 'vorti-form-resize', id: 'own', height: -1 }]) expect(resizeHeight(data, 'own')).toBeUndefined()
  })
  it('prevents publication of unsafe allowlists', () => {
    const definition = emptyDefinition()
    definition.access.embedOrigins = ['https://example.test; script-src *']
    expect(validateDefinition(definition).some(issue => issue.message.includes('Iframe hosts'))).toBe(true)
    definition.access.embedOrigins = ['https://example.test']
    expect(validateDefinition(definition)).toEqual([])
  })
})
