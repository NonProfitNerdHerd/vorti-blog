import { describe, expect, it } from 'vitest'
import { cmsActionIssues, cmsMappingFields, mappedCMSText } from './cms'
import { emptyDefinition, type FormAction } from './model'
import { validateDefinition } from './engine'

describe('CMS action mappings', () => {
  const contact: FormAction = { id: 'contact', kind: 'contact', name: 'Contact', config: { emailField: 'email', nameField: 'name' } }
  it('accepts compatible answers and keeps structured names readable', () => {
    const fields = [{ id: 'email', kind: 'email', label: 'Email' }, { id: 'name', kind: 'name', label: 'Name' }]
    expect(cmsActionIssues(contact, { fields })).toEqual([])
    expect(mappedCMSText({ name: { first: 'Ada', last: 'Lovelace' } }, contact, 'nameField')).toBe('Ada Lovelace')
    expect(() => mappedCMSText({}, contact, 'emailField', true)).toThrow('missing')
  })
  it('rejects sensitive ancestors, repeated values, and incompatible mapping fields before publication', () => {
    const fields = [{ id: 'private', kind: 'section', label: 'Private', sensitive: true, children: [{ id: 'email', kind: 'email', label: 'Email' }] }, { id: 'people', kind: 'repeater', label: 'People', children: [{ id: 'name', kind: 'name', label: 'Name' }] }]
    expect(cmsActionIssues(contact, { fields }).join(' ')).toContain('sensitive')
    expect(cmsActionIssues(contact, { fields }).join(' ')).toContain('repeatable')
    expect(cmsMappingFields(fields).some(field => field.id === 'name')).toBe(false)
    const definition = emptyDefinition(); definition.fields = fields; definition.actions = [contact]
    expect(validateDefinition(definition).some(issue => issue.message.includes('Contact email'))).toBe(true)
    expect(validateDefinition(definition).find(issue => issue.message.includes('Contact email'))?.action).toBe(contact.id)
  })
  it('requires a numeric registered Post Type and refuses structured bodies as plaintext', () => {
    const action: FormAction = { id: 'post', kind: 'content', name: 'Post', config: { titleField: 'title', bodyField: 'body', postType: 'users' } }
    const fields = [{ id: 'title', kind: 'text', label: 'Title' }, { id: 'body', kind: 'textarea', label: 'Body' }]
    expect(cmsActionIssues(action, { fields })).toContain('Select a published Post Type for the draft Post.')
    expect(() => mappedCMSText({ body: { role: 'administrator' } }, action, 'bodyField', true)).toThrow('invalid')
  })
})
