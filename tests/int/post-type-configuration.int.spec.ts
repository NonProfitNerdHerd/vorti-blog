import { describe, expect, it } from 'vitest'
import { PostTypes } from '@/content-framework/collections'
import type { CollectionBeforeValidateHook } from 'payload'
import { restoreRequiredField } from '@/content-framework/type-field-requirements'
import type { TypeField } from '@design-system/payload-design-core/content'

const validate = PostTypes.hooks!.beforeValidate![0] as CollectionBeforeValidateHook
const base = {
  key: 'resource',
  prefix: 'resources',
  capability: 'content',
  fieldDefinitions: [] as TypeField[],
}
const run = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
  validate({
    data: { ...base, ...data },
    originalDoc,
    req: {
      payload: {
        findByID: async () => ({
          allowedCollections: ['posts'],
          _status: 'published',
          layout: [] as unknown[],
        }),
      },
    },
  } as unknown as Parameters<CollectionBeforeValidateHook>[0])

describe('actionable Post Type configuration errors', () => {
  it('restores a missing schedule without replacing custom fields or colliding IDs', () => {
    const custom = { id: 'eventSchedule', kind: 'text' as const, label: 'Custom notes' }
    const fields = restoreRequiredField([custom], 'eventSchedule')
    expect(fields[0]).toBe(custom)
    expect(fields[1]).toMatchObject({
      id: 'eventSchedule2',
      kind: 'eventSchedule',
      public: true,
      required: true,
    })
  })
  it('reuses an existing schedule and preserves its configuration', () => {
    const fields = restoreRequiredField(
      [
        {
          id: 'schedule',
          kind: 'eventSchedule',
          label: 'Our schedule',
          helpText: 'Local time',
          public: false,
        },
      ],
      'eventSchedule',
    )
    expect(fields).toEqual([
      {
        id: 'schedule',
        kind: 'eventSchedule',
        label: 'Our schedule',
        helpText: 'Local time',
        public: true,
        required: true,
      },
    ])
  })
  it.each([
    [{ key: 'INVALID' }, 'key'],
    [{ prefix: undefined }, 'prefix'],
    [{ prefix: 'admin' }, 'prefix'],
    [{ capability: 'missing' }, 'capability'],
    [{ capability: 'event' }, 'fieldDefinitions'],
    [{ defaultTemplate: 99, templates: [] }, 'defaultTemplate'],
  ])('returns a field-associated HTTP 400: %j', async (data, path) => {
    await expect(run(data)).rejects.toMatchObject({ status: 400, data: { errors: [{ path }] } })
  })
  it('names saved fields that cannot be removed', async () => {
    await expect(
      run(
        {},
        {
          id: 1,
          key: base.key,
          prefix: base.prefix,
          fieldDefinitions: [{ id: 'bio', label: 'Biography', kind: 'text' }],
        },
      ),
    ).rejects.toMatchObject({
      status: 400,
      data: {
        errors: [{ path: 'fieldDefinitions', message: expect.stringContaining('Biography (bio)') }],
      },
    })
  })
  it('allows required fields with no default or preview values', async () => {
    await expect(
      run({ fieldDefinitions: [{ id: 'bio', label: 'Biography', kind: 'text', required: true }] }),
    ).resolves.toMatchObject({ schemaVersion: 1 })
  })
})
