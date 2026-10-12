import { describe, expect, it } from 'vitest'
import { ValidationError } from 'payload'
import { validateFields } from '@/content-framework/validation'
import type { TypeField } from '@design-system/payload-design-core'

describe('Post Type definition API errors', () => {
  it.each([
    [null],
    [{ label: 'Missing identifier', kind: 'text' }],
    [{ id: 'count', label: 'Count', kind: 'number', defaultValue: 'not a number' }],
    [
      {
        id: 'email',
        label: 'Email',
        kind: 'text',
        rules: [{ kind: 'email' }],
        defaultValue: 'invalid',
      },
    ],
    [
      {
        id: 'end',
        label: 'End',
        kind: 'date',
        rules: [{ kind: 'compare', field: 'missing', operator: 'after' }],
      },
    ],
  ])('returns a field-scoped 400 for malformed definitions: %j', (definition) => {
    try {
      validateFields([definition] as unknown as TypeField[])
      expect.fail('Definition should fail validation')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).status).toBe(400)
      expect((error as ValidationError).data?.errors[0].path).toBe('fieldDefinitions')
    }
  })
  it('keeps legacy fields and valid constrained defaults usable', () => {
    expect(() =>
      validateFields([
        { id: 'legacy', label: 'Legacy', kind: 'text' },
        {
          id: 'email',
          label: 'Email',
          kind: 'text',
          rules: [{ kind: 'email' }],
          defaultValue: 'a@example.org',
        },
      ]),
    ).not.toThrow()
  })
})
