import { describe, expect, it } from 'vitest'
import { prepareLegacyForm, prepareStoredForm, legacyReviewRequired } from '@/forms/legacy'
import { emptyDefinition } from '@design-system/payload-design-core/forms'

describe('legacy forms in the sole canvas editor', () => {
  it('preserves supported identities, widths, choices, defaults and validation without mutating storage', () => {
    const doc = { fields: [{ blockType: 'select', name: 'choice', label: 'Choice', required: true, width: 50, options: [{ label: 'One', value: 'one' }], defaultValue: 'one' }, { blockType: 'text', name: 'name', label: 'Name', maxLength: 20, width: 25 }] }
    const before = JSON.stringify(doc), result = prepareLegacyForm(doc)
    expect(result.issues).toEqual([])
    expect(result.definition.fields[0]).toMatchObject({ id: 'choice', required: true, width: 6, defaultValue: 'option_0_0' })
    expect(result.definition.fields[1]).toMatchObject({ id: 'name', maxLength: 20, width: 3 })
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('transfers notifications and flags settings that cannot be safely applied', () => {
    const doc = { fields: [{ blockType: 'email', name: 'email' }], emails: [{ emailTo: '{{ email }}', subject: 'New entry', message: '{{*}}', cc: 'review@example.test', replyTo: 'sender@example.test' }] }
    const result = prepareLegacyForm(doc)
    expect(result.definition.actions[0].config).toMatchObject({ to: '{{email}}', body: '{{summary}}' })
    expect(result.issues.map(issue => issue.message).join(' ')).toContain('cc')
    expect(legacyReviewRequired(doc, result.definition)).toBe(true)
    expect(legacyReviewRequired(doc, { ...result.definition, legacyReview: result.issues.map(issue => issue.message) })).toBe(false)
  })
  it('reports unsupported types, widths, defaults, rich text and unknown placeholders', () => {
    const result = prepareLegacyForm({ fields: [{ blockType: 'country', name: 'place', width: 42 }, { blockType: 'select', name: 'choice', defaultValue: 'missing', options: [{ value: 'one' }] }], emails: [{ emailTo: '{{missing}}', message: { root: { children: [{ text: 'Hello' }] } } }] })
    expect(result.issues.map(issue => issue.message).join(' ')).toMatch(/country.*42.*default.*rich-text.*placeholder/s)
  })
  it('surfaces old emails alongside modern actions exactly once', () => {
    const definition = emptyDefinition()
    definition.actions = [{ id: 'webhook', kind: 'webhook', name: 'Existing', config: {} }]
    const doc = { definition, emails: [{ emailTo: 'owner@example.test', subject: 'Hello' }] }
    const first = prepareStoredForm(doc)
    expect(first.definition.actions.map(action => action.id)).toEqual(['webhook', 'legacy_email_0'])
    expect(prepareStoredForm({ ...doc, definition: first.definition }).definition.actions).toHaveLength(2)
    expect(definition.actions).toHaveLength(1)
  })
})
